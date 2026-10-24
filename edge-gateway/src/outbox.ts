import type { WaterInterlockAck } from '@spff/contracts';
import type { FertigationPulseAck } from '@spff/contracts';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ActuatorStateMessage,
  AutomaticControlAckMessage,
  CommandAckMessage,
  DeviceStatusMessage,
  ScheduleSyncAckMessage,
  TelemetryMessage,
  FertigationSessionEvent,
} from '@spff/contracts';

export type OutboxRecord =
  | {kind:'water_interlock_ack';payload:WaterInterlockAck}
  | { kind: 'pulse_ack'; payload: FertigationPulseAck }
  | { kind: 'telemetry'; payload: TelemetryMessage }
  | { kind: 'session'; payload: FertigationSessionEvent }
  | { kind: 'state'; payload: ActuatorStateMessage }
  | { kind: 'ack'; payload: CommandAckMessage }
  | { kind: 'schedule_ack'; payload: ScheduleSyncAckMessage }
  | { kind: 'automatic_control_ack'; payload: AutomaticControlAckMessage }
  | { kind: 'status'; payload: DeviceStatusMessage };

export class DurableOutbox {
  private flushing = false;

  constructor(
    private readonly directory: string,
    private readonly maxItems: number,
  ) {}

  async start() {
    await mkdir(this.directory, { recursive: true });
  }

  async enqueue(record: OutboxRecord) {
    const files = await this.listFiles();
    if (files.length >= this.maxItems) {
      throw new Error(`Edge outbox reached configured limit (${this.maxItems} items).`);
    }
    const name = `${Date.now()}-${randomUUID()}.json`;
    const finalPath = path.join(this.directory, name);
    const temporaryPath = `${finalPath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(record), { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, finalPath);
  }

  async flush(publish: (record: OutboxRecord) => Promise<void>) {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const files = await this.listFiles();
      for (const file of files) {
        const filePath = path.join(this.directory, file);
        const parsed = await this.readRecord(file);
        if (parsed === undefined) continue;
        await publish(parsed);

        if (parsed.kind !== 'telemetry' && parsed.kind !== 'session') {
          try {
            await unlink(filePath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }

async acknowledgeTelemetry(messageId: string): Promise<boolean> {
  return this.acknowledgePersisted('telemetry', messageId);
}

async acknowledgeSession(messageId: string): Promise<boolean> {
  return this.acknowledgePersisted('session', messageId);
}

private async acknowledgePersisted(kind: 'telemetry' | 'session', messageId: string): Promise<boolean> {
  const files = await this.listFiles();

  for (const file of files) {
    const filePath = path.join(this.directory, file);

    const parsed = await this.readRecord(file);
    if (parsed === undefined) continue;

    if (
      parsed.kind !== kind ||
      parsed.payload.messageId !== messageId
    ) {
      continue;
    }

    try {
      await unlink(filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code !== 'ENOENT') throw error;
    }

    return true;
  }

  return false;
}

  private async readRecord(file: string): Promise<OutboxRecord | undefined> {
    const filePath = path.join(this.directory, file);
    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (error) {
      // A persistence ACK may remove a file after flush took its directory snapshot.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new Error(`Outbox read failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }

    try {
      return JSON.parse(text) as OutboxRecord;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // Only malformed JSON is quarantined. Disk/read/permission errors must
      // pause processing, never masquerade as corrupt or successfully sent data.
      const quarantine = path.join(this.directory, 'quarantine');
      await mkdir(quarantine, { recursive: true, mode: 0o700 });
      const destination = path.join(quarantine, `${file}.${randomUUID()}.bad`);
      try {
        await rename(filePath, destination);
      } catch (moveError) {
        if ((moveError as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw new Error(`Outbox quarantine failed for ${filePath}: ${moveError instanceof Error ? moveError.message : String(moveError)}`, { cause: moveError });
      }
      console.warn('[edge-outbox] corrupt JSON quarantined; not delivered', {
        file: filePath,
        quarantine: destination,
        reason: error.message,
        pendingFiles: (await this.listFiles()).length,
      });
      return undefined;
    }
  }

  private async listFiles() {
    const entries = await readdir(this.directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  }
}
