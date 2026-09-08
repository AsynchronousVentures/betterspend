import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';
import { ExportController } from './export.controller';
import type { ExportQuery } from './export.service';

test('CSV responses honor writable backpressure instead of consuming the whole producer', async () => {
  let produced = 0;
  let unblock: () => void = () => undefined;
  let started: () => void = () => undefined;
  const blocked = new Promise<void>((resolve) => {
    started = resolve;
  });
  let output = '';
  const response = Object.assign(
    new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        if (output === 'row\n') {
          unblock = callback;
          started();
        } else callback();
      },
    }),
    { setHeader: () => undefined },
  );
  const controller = new ExportController({
    normalizeQuery: (query: ExportQuery) => query,
    async *csvChunks() {
      for (let i = 0; i < 1000; i++) {
        produced++;
        yield 'row\n';
      }
    },
  } as never);
  const sending = controller.exportInvoices(
    'org',
    undefined,
    undefined,
    'csv',
    undefined,
    undefined,
    response as never,
  );
  await blocked;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(produced < 1000, 'A blocked response must stop the producer before all rows are read');
  unblock();
  await sending;
  assert.equal(produced, 1000);
  assert.equal(output, 'row\n'.repeat(1000));
});

test('a disconnected CSV response closes the producer', async () => {
  let closed = false;
  const response = Object.assign(
    new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        callback(new Error('client disconnected'));
      },
    }),
    { setHeader: () => undefined },
  );
  const controller = new ExportController({
    normalizeQuery: (query: ExportQuery) => query,
    async *csvChunks() {
      try {
        for (let i = 0; i < 1000; i++) yield 'row\n';
      } finally {
        closed = true;
      }
    },
  } as never);
  await assert.rejects(
    controller.exportInvoices(
      'org',
      undefined,
      undefined,
      'csv',
      undefined,
      undefined,
      response as never,
    ),
    /client disconnected/,
  );
  assert.equal(closed, true);
});
