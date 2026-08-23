import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActuatorStateMessage, CommandAckMessage, DeviceStatusMessage, TelemetryMessage } from '@spff/contracts';

export type OutboxRecord =
  | { kind: 'telemetry'; payload: TelemetryMessage }
  | { kind: 'state'; payload: ActuatorStateMessage }
  | { kind: 'ack'; payload: CommandAckMessage }
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
        const parsed = JSON.parse(await readFile(filePath, 'utf8')) as OutboxRecord;
await publish(parsed);

if (parsed.kind !== 'telemetry') {
  await unlink(filePath);
}
      }
    } finally {
      this.flushing = false;
    }
  }

async acknowledgeTelemetry(messageId: string): Promise<boolean> {
  const files = await this.listFiles();

  for (const file of files) {
    const filePath = path.join(this.directory, file);

    let parsed: OutboxRecord;

    try {
      parsed = JSON.parse(
        await readFile(filePath, 'utf8'),
      ) as OutboxRecord;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'ENOENT') continue;
      throw error;
    }

    if (
      parsed.kind !== 'telemetry' ||
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

  private async listFiles() {
    const entries = await readdir(this.directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  }
}
