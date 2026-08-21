import type { PumpCommandMessage } from '@spff/contracts';
import { config } from './config.js';
import type { MqttCommandPublisher } from './commandPublisher.js';
import type { PostgresWorkerRepository } from './repository.js';

export class CommandDispatchService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly repository: PostgresWorkerRepository,
    private readonly publisher: MqttCommandPublisher,
  ) {}

  start() {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.command.pollIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.repository.expireCommands();
      await this.repository.createDueScheduleCommands();
      if (!this.publisher.isConnected) return;
      const commands = await this.repository.pendingCommands(config.command.batchSize);
      for (const command of commands) await this.publish(command);
    } catch (error) {
      console.error('[command-dispatch] tick failed', error);
    } finally {
      this.running = false;
    }
  }

  private async publish(command: PumpCommandMessage) {
    if (Date.parse(command.expiresAt) <= Date.now()) return;
    try {
      await this.publisher.publish(command);
      await this.repository.markPublished(command.commandId);
    } catch (error) {
      console.warn('[command-dispatch] publish failed', {
        commandId: command.commandId,
        error: error instanceof Error ? error.message : error,
      });
    }
  }
}
