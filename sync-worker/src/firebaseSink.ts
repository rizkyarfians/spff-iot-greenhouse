import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from './config.js';
import type { OutboxEvent } from './repository.js';

const collectionByAggregate: Record<string, string> = {
  telemetry: 'telemetry',
  command: 'commands',
  command_ack: 'commandAcks',
  actuator_state: 'actuatorStates',
  device_status: 'deviceStatusEvents',
  alarm: 'alarms',
  schedule: 'schedules',
  site_settings: 'settings',
  site: 'siteMetadata',
  device: 'devices',
};

function documentId(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url') || 'root';
}

export class FirebaseSink {
  private readonly db;

  constructor() {
    const app = getApps()[0] ?? initializeApp({
      credential: applicationDefault(),
      projectId: config.firebaseProjectId,
    });
    this.db = getFirestore(app);
  }

  async write(event: OutboxEvent) {
    const siteId = event.siteId ?? String(event.payload.site_id ?? 'global');
    const siteRef = this.db.collection('spffSites').doc(documentId(siteId));
    const collection = collectionByAggregate[event.aggregateType] ?? 'events';
    const entityRef = siteRef.collection(collection).doc(documentId(event.aggregateId));
    const version = event.outboxId.padStart(20, '0');
    const replicaMeta = {
      outboxId: event.outboxId,
      version,
      aggregateType: event.aggregateType,
      operation: event.operation,
      syncedAt: new Date().toISOString(),
    };

    // Immutable event copy: retry menulis document ID yang sama sehingga idempotent.
    await siteRef.collection('outboxEvents').doc(version).set({
      ...replicaMeta,
      aggregateId: event.aggregateId,
      payload: event.payload,
    });

    // Materialized latest entity tidak boleh diregresikan oleh retry event yang lebih lama.
    await this.db.runTransaction(async (transaction) => {
      const current = await transaction.get(entityRef);
      const currentVersion = current.data()?._spffReplica?.version;
      if (typeof currentVersion === 'string' && currentVersion >= version) return;

      if (event.operation === 'delete') {
        transaction.set(entityRef, { _deleted: true, _spffReplica: replicaMeta });
        return;
      }
      transaction.set(entityRef, {
        ...event.payload,
        _deleted: false,
        _spffReplica: replicaMeta,
      });
    });
  }
}
