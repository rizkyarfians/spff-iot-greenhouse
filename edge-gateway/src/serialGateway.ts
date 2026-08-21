import { SerialPort } from 'serialport';

export class SerialGateway {
  private port: SerialPort | null = null;
  private receiveBuffer = '';
  private available = false;
  private stopping = false;
  private connecting = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs: number;

  constructor(
    private readonly settings: {
      enabled: boolean;
      path: string;
      baudRate: number;
      maxLineBytes: number;
      reconnectMinMs: number;
      reconnectMaxMs: number;
    },
    private readonly onLine: (line: string) => Promise<void>,
    private readonly onAvailabilityChange: (available: boolean) => Promise<void>,
  ) {
    this.reconnectDelayMs = settings.reconnectMinMs;
  }

  get isAvailable() {
    return this.available;
  }

  async start() {
    if (!this.settings.enabled) {
      console.warn('[serial] Disabled. Set SERIAL_ENABLED=true after the ESP32 protocol is ready.');
      return;
    }
    this.stopping = false;
    await this.tryOpen();
  }

  async send(message: unknown) {
    if (!this.port?.isOpen) throw new Error('Serial connection is not available.');
    const line = `${JSON.stringify(message)}\n`;
    await new Promise<void>((resolve, reject) => {
      this.port?.write(line, (writeError) => {
        if (writeError) {
          reject(writeError);
          return;
        }
        this.port?.drain((drainError) => drainError ? reject(drainError) : resolve());
      });
    });
  }

  async stop() {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.setAvailable(false);
    const port = this.port;
    this.port = null;
    if (!port?.isOpen) return;
    await new Promise<void>((resolve) => port.close(() => resolve()));
  }

  private async tryOpen() {
    if (this.stopping || this.connecting || this.port?.isOpen) return;
    this.connecting = true;
    const port = new SerialPort({
      path: this.settings.path,
      baudRate: this.settings.baudRate,
      autoOpen: false,
    });
    this.port = port;
    this.attachListeners(port);

    try {
      await new Promise<void>((resolve, reject) => port.open((error) => error ? reject(error) : resolve()));
      if (this.stopping) {
        await new Promise<void>((resolve) => port.close(() => resolve()));
        return;
      }
      this.receiveBuffer = '';
      this.reconnectDelayMs = this.settings.reconnectMinMs;
      await this.setAvailable(true);
      console.log(`[serial] Connected to ${this.settings.path} at ${this.settings.baudRate} baud.`);
    } catch (error) {
      if (this.port === port) this.port = null;
      await this.setAvailable(false);
      console.warn('[serial] Open failed; retry scheduled', error instanceof Error ? error.message : error);
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private attachListeners(port: SerialPort) {
    port.on('data', (chunk: Buffer) => this.handleData(chunk));
    port.on('error', (error) => console.error('[serial] Port error', error));
    port.on('close', () => {
      if (this.port === port) this.port = null;
      void this.setAvailable(false).catch((error: unknown) =>
        console.error('[serial] Failed to publish offline state', error),
      );
      if (!this.stopping) {
        console.warn('[serial] Port closed; reconnect scheduled.');
        this.scheduleReconnect();
      }
    });
  }

  private handleData(chunk: Buffer) {
    this.receiveBuffer += chunk.toString('utf8');
    const lines = this.receiveBuffer.split(/\r?\n/);
    this.receiveBuffer = lines.pop() ?? '';
    if (Buffer.byteLength(this.receiveBuffer, 'utf8') > this.settings.maxLineBytes) {
      console.error(`[serial] Receive buffer exceeded ${this.settings.maxLineBytes} bytes; dropping partial frame.`);
      this.receiveBuffer = '';
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (Buffer.byteLength(trimmed, 'utf8') > this.settings.maxLineBytes) {
        console.error(`[serial] Frame exceeded ${this.settings.maxLineBytes} bytes; dropping message.`);
        continue;
      }
      void this.onLine(trimmed).catch((error: unknown) => console.error('[serial] Invalid message', error));
    }
  }

  private scheduleReconnect() {
    if (this.stopping || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, this.settings.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.tryOpen();
    }, delay);
  }

  private async setAvailable(available: boolean) {
    if (this.available === available) return;
    this.available = available;
    await this.onAvailabilityChange(available);
  }
}
