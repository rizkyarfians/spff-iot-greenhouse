import test from 'node:test';
import assert from 'node:assert/strict';
import { readDatalogExportStream } from '../src/datalogExportStream.ts';
import { datalogTimestamp, encodeCsvRows } from '../src/datalogCsv.ts';

const reading = { id: '1:air_temp', displayName: 'Suhu °C', value: 0 };
function stream(events, size = 17) {
  const bytes = new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
  let offset = 0;
  return new ReadableStream({ pull(controller) {
    if (offset >= bytes.length) return controller.close();
    controller.enqueue(bytes.slice(offset, offset + size));
    offset += size;
  } });
}
const start = { type: 'start' };
const batch = { type: 'batch', items: [reading] };
const complete = { type: 'complete', rowCount: 1 };

test('reads JSON and UTF-8 split across arbitrary network chunks', async () => {
  const received = [];
  const count = await readDatalogExportStream(stream([start, batch, batch, { type: 'complete', rowCount: 2 }], 1),
    new AbortController().signal, async (items) => received.push(...items));
  assert.equal(count, 2);
  assert.deepEqual(received, [reading, reading]);
});

test('empty export completes with zero rows', async () => {
  assert.equal(await readDatalogExportStream(stream([start, { type: 'complete', rowCount: 0 }]),
    new AbortController().signal, async () => assert.fail()), 0);
});

test('truncated response cannot be saved as a complete export', async () => {
  await assert.rejects(readDatalogExportStream(stream([start, batch]), new AbortController().signal, async () => {}), /terputus/);
});

test('server error does not produce a successful export', async () => {
  await assert.rejects(readDatalogExportStream(stream([start, batch, { type: 'error', message: 'failed' }]),
    new AbortController().signal, async () => {}), /failed/);
});

test('completion row count must match the received rows', async () => {
  await assert.rejects(readDatalogExportStream(stream([start, batch, { ...complete, rowCount: 2 }]),
    new AbortController().signal, async () => {}), /tidak valid/);
});

test('batch before start and extra frames after completion are rejected', async () => {
  for (const events of [[batch, complete], [start, batch, complete, batch]]) {
    await assert.rejects(readDatalogExportStream(stream(events), new AbortController().signal, async () => {}), /tidak valid/);
  }
});

test('cancel unblocks a pending network read', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const pending = readDatalogExportStream(new ReadableStream({ cancel() { cancelled = true; } }), controller.signal, async () => {});
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('callback failure cancels further reading', async () => {
  await assert.rejects(readDatalogExportStream(stream([start, batch, complete]), new AbortController().signal,
    async () => { throw new Error('CSV size limit'); }), /CSV size limit/);
});

test('CSV keeps quoting, line endings, and spreadsheet formula protection', () => {
  assert.equal(encodeCsvRows([['Waktu', 'Nilai'], ['a,"b"\nc', '=1+1'], ['0', 'µS/cm']]),
    '"Waktu","Nilai"\r\n"a,""b""\nc","\'=1+1"\r\n"0","µS/cm"\r\n');
});

test('timestamp uses Jakarta regardless of the browser/device timezone', () => {
  assert.match(datalogTimestamp('2026-10-10T17:00:00Z'), /11\/10\/2026/);
  assert.match(datalogTimestamp('2026-10-10T17:00:00Z'), /00[.:]00[.:]00/);
});
