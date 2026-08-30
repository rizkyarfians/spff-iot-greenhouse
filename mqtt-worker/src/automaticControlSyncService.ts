import type { AutomaticControlSyncMessage } from "@spff/contracts";
import type { AutomaticControlSyncRepository } from "./repository.js";

export interface AutomaticControlSyncPublisher {
  publishAutomaticControlSync(message: AutomaticControlSyncMessage): Promise<void>;
}

export class AutomaticControlSyncService {
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private queuedForce = false;

  constructor(
    private readonly repository: AutomaticControlSyncRepository,
    private readonly publisher: AutomaticControlSyncPublisher,
    private readonly pollIntervalMs: number,
  ) {}

  start() {
    if (this.timer) return;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), this.pollIntervalMs);
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
        const snapshots = await this.repository.automaticControlSnapshots(shouldForce);
        shouldForce = false;
        for (const snapshot of snapshots) {
          try {
            await this.publisher.publishAutomaticControlSync(snapshot);
            const publishedAt = new Date().toISOString();
            await this.repository.markAutomaticControlPublished(
              snapshot.siteId,
              snapshot.deviceId,
              snapshot.revision,
              publishedAt,
            );
            console.log("[automatic-control-sync] config published", {
              siteId: snapshot.siteId,
              deviceId: snapshot.deviceId,
              revision: snapshot.revision,
              desiredMode: snapshot.config.desiredMode,
              waterEnabled: snapshot.config.water.enabled,
              fertilizerEnabled: snapshot.config.fertilizer.enabled,
            });
          } catch (error) {
            console.error("[automatic-control-sync] publish failed", {
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
      console.error("[automatic-control-sync] sync cycle failed", error);
    } finally {
      this.syncing = false;
    }
  }
}
