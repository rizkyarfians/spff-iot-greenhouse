import type { PumpCommandMessage } from "@spff/contracts";
import { config } from "./config.js";
import type {
  CommandDispatchRepository,
  PendingControlCommand,
} from "./repository.js";

export interface CommandPublisher {
  publishCommand(message: PumpCommandMessage): Promise<void>;
}

export class CommandDispatchService {
  private timer: NodeJS.Timeout | null = null;
  private tickRunning = false;
  private stopped = true;

  constructor(
    private readonly repository: CommandDispatchRepository,
    private readonly publisher: CommandPublisher,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick();
    this.timer = setInterval(
      () => void this.tick(),
      config.command.pollIntervalMs,
    );
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    await this.repository.expireCommands();
    const commands = await this.repository.pendingCommands(
      config.command.batchSize,
    );

    for (const command of commands) {
      await this.dispatch(command);
    }
  }

  private async tick(): Promise<void> {
    if (this.tickRunning || this.stopped) return;
    this.tickRunning = true;
    try {
      await this.runOnce();
    } catch (error) {
      console.error("[command-dispatch] Tick failed", error);
    } finally {
      this.tickRunning = false;
    }
  }

  private async dispatch(command: PendingControlCommand): Promise<void> {
    const message: PumpCommandMessage = {
      schemaVersion: 1,
      siteId: command.siteId,
      deviceId: command.deviceId,
      kind: "command",
      commandId: command.commandId,
      issuedAt: command.issuedAt,
      expiresAt: command.expiresAt,
      requestedBy: command.requestedBy,
      type: "set_pump",
      targetId: command.actuatorKey,
      params: {
        isActive: command.requestedIsActive,
      },
    };

    try {
      await this.publisher.publishCommand(message);
      await this.repository.markCommandPublished(
        command.commandId,
        new Date().toISOString(),
      );
      console.log("[command-dispatch] command published", {
        commandId: command.commandId,
        siteId: command.siteId,
        deviceId: command.deviceId,
        targetId: command.actuatorKey,
        isActive: command.requestedIsActive,
      });
    } catch (error) {
      // Keep the row pending so a transient MQTT failure can be retried on the
      // next poll. ESP32 must deduplicate by commandId because publish can be
      // repeated after an uncertain connection failure.
      console.error("[command-dispatch] command publish failed; will retry", {
        commandId: command.commandId,
        error,
      });
    }
  }
}
