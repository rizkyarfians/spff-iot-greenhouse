import type {
  ScheduleExecutionAuthority,
  ScheduleSyncMessage,
} from "@spff/contracts";
import type { ScheduleSyncRepository } from "./repository.js";

export interface ScheduleSyncPublisher {
  publishScheduleSync(message: ScheduleSyncMessage): Promise<void>;
}

export class ScheduleSyncService {
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private queuedForce = false;

  constructor(
    private readonly repository: ScheduleSyncRepository,
    private readonly publisher: ScheduleSyncPublisher,
    private readonly authority: ScheduleExecutionAuthority,
    private readonly pollIntervalMs: number,
  ) {}

  start() {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(
      () => void this.runOnce(),
      this.pollIntervalMs,
    );
    this.timer.unref();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(force = false): Promise<void> {
    if (this.syncing) {
      this.queuedForce ||= force;
      return;
    }

    this.syncing = true;

    try {
      let shouldForce = force;

      do {
        this.queuedForce = false;
        const snapshots = await this.repository.scheduleSnapshots(
          this.authority,
          shouldForce,
        );
        shouldForce = false;

        for (const snapshot of snapshots) {
          try {
            await this.publisher.publishScheduleSync(snapshot);
            const publishedAt = new Date().toISOString();
            await this.repository.markSchedulePublished(
              snapshot.siteId,
              snapshot.deviceId,
              snapshot.revision,
              snapshot.executionAuthority,
              publishedAt,
            );

            console.log("[schedule-sync] snapshot published", {
              siteId: snapshot.siteId,
              deviceId: snapshot.deviceId,
              revision: snapshot.revision,
              authority: snapshot.executionAuthority,
              schedules: snapshot.schedules.length,
            });
          } catch (error) {
            console.error("[schedule-sync] snapshot publish failed", {
              siteId: snapshot.siteId,
              deviceId: snapshot.deviceId,
              revision: snapshot.revision,
              error,
            });
          }
        }

        shouldForce = this.queuedForce;
      } while (shouldForce);
    } catch (error) {
      console.error("[schedule-sync] sync cycle failed", error);
    } finally {
      this.syncing = false;
    }
  }
}
