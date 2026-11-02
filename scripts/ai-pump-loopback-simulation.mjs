/**
 * Isolated proof-of-wiring exercise:
 * live Python SHADOW -> shared contract -> TS adapter -> REAL worker dispatcher
 * with a FAKE in-memory repository/publisher -> REAL ingestion validator with
 * a FAKE ACK. No DB queries, broker connections, device commands, or water.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isPumpCommandMessage, isCommandAckMessage, mqttTopics, unifiedAiDashboardSchema } from '@spff/contracts';
import { prepareAiPumpSimulation } from '../functions/lib/services/aiPumpSimulation.js';

export async function runAiPumpLoopbackSimulation(summary) {
  const plan = prepareAiPumpSimulation(unifiedAiDashboardSchema.parse(summary));
  if (!plan.mockCandidate) {
    return { simulationOnly: true, transport: 'IN_MEMORY_ONLY', plan,
      mockLifecycle: [], mockCommand: null, physicalAckReceived: false,
      physicalWaterDeliveredL: null };
  }

  // Dynamic import after a dummy DSN is supplied: the worker module's config
  // has a required DATABASE_URL even though this mock does not open a DB.
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/spff_mock_only';
  const [{ CommandDispatchService }, { IngestionService }] = await Promise.all([
    import('../mqtt-worker/dist/commandDispatchService.js'),
    import('../mqtt-worker/dist/ingestionService.js'),
  ]);

  // Explicitly NON-production identities, and no real MQTT client.
  const siteId = 'simulated-site', deviceId = 'simulated-esp32';
  const commandId = 'sim-' + randomUUID();
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(issuedAt) + 15000).toISOString();
  const command = {
    commandId, siteId, deviceId, actuatorKey: 'pump_water',
    requestedIsActive: true, requestedBy: 'mock:ai-bridge',
    issuedAt, expiresAt,
    waterTrial: {
      targetWaterL: plan.mockCandidate.targetWaterL,
      durationSec: plan.mockCandidate.durationSec,
    },
  };
  let state = 'pending';
  let mockCommand = null;
  const mockLifecycle = [{ event: 'MOCK_QUEUE_PENDING', status: 'pending' }];
  const mockRepository = {
    async expireCommands() { return 0; },
    async pendingCommands() { return state === 'pending' ? [command] : []; },
    async markCommandPublished(id) {
      assert.equal(id, commandId);
      assert.equal(state, 'pending');
      state = 'published';
      mockLifecycle.push({ event: 'MOCK_WORKER_PUBLISHED', status: state });
    },
  };
  const mockPublisher = {
    async publishCommand(message) {
      assert.equal(isPumpCommandMessage(message), true, 'worker payload must match shared contract');
      assert.equal(message.commandId, commandId);
      assert.equal(message.params.waterTrial.targetWaterL, plan.mockCandidate.targetWaterL);
      mockCommand = message;
    },
  };
  await new CommandDispatchService(mockRepository, mockPublisher).runOnce();
  assert.equal(state, 'published');
  assert.notEqual(mockCommand, null);

  const saveAcknowledgement = async (ack) => {
    assert.equal(ack.commandId, commandId);
    assert.equal(ack.siteId, siteId);
    assert.equal(ack.deviceId, deviceId);
    assert.equal(ack.targetId, 'pump_water');
    assert.equal(isCommandAckMessage(ack), true);
    if (ack.status === 'accepted' && state === 'published') {
      state = 'accepted';
    } else if (ack.status === 'completed' &&
      state === 'accepted' && ack.actualState?.isActive === false &&
      ack.reason === 'trial_mock_completed_no_hardware') {
      state = 'completed';
    } else {
      throw new Error('Invalid synthetic ACK transition');
    }
    mockLifecycle.push({
      event: ack.status === 'accepted' ? 'MOCK_ACK_ACCEPTED' : 'MOCK_ACK_COMPLETED_OFF',
      status: state,
    });
  };
  const unavailable = async () => { throw new Error('Unexpected ingestion route in in-memory simulation'); };
  const mockIngestion = new IngestionService({
    saveTelemetry: unavailable,
    saveFertigationSession: unavailable,
    saveAcknowledgement,
    saveScheduleSyncAck: unavailable,
    saveAutomaticControlAck: unavailable,
    saveActuatorState: unavailable,
    saveDeviceStatus: unavailable,
  });
  const simulatedAck = (status, extras = {}) => ({
    schemaVersion: 1, kind: 'command_ack', siteId, deviceId, commandId,
    targetId: 'pump_water', acknowledgedAt: new Date().toISOString(),
    status, ...extras,
  });
  const ackTopic = mqttTopics.acknowledgements(siteId, deviceId);
  await mockIngestion.process(ackTopic,
    Buffer.from(JSON.stringify(simulatedAck('accepted'))));
  assert.equal(state, 'accepted');
  await mockIngestion.process(ackTopic,
    Buffer.from(JSON.stringify(simulatedAck('completed', {
      actualState: { isActive: false },
      reason: 'trial_mock_completed_no_hardware',
      // No invented actualWaterL: no pump or flowmeter was used.
    }))));
  assert.equal(state, 'completed');

  return {
    simulationOnly: true, transport: 'IN_MEMORY_ONLY',
    plan, mockLifecycle, mockCommand,
    mockFinalState: 'MOCK_COMPLETED_NOT_DEVICE_PROOF',
    physicalAckReceived: false, physicalWaterDeliveredL: null,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const response = await fetch('http://127.0.0.1:5011/dashboard/summary', {
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('AI summary HTTP status ' + response.status);
    const summary = await response.json();
    const result = await runAiPumpLoopbackSimulation(summary);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Loopback simulation failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
