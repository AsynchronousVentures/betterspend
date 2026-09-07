import assert from 'node:assert/strict';
import test from 'node:test';
import type { JobsOptions } from 'bullmq';
import { GlExportService } from '../../modules/gl/gl-export.service';
import { OcrService } from '../../modules/ocr/ocr.service';
import { TERMINAL_JOB_RETENTION } from './terminal-job-retention';

test('OCR initial jobs and GL initial/manual retries retain bounded execution diagnostics', async () => {
  const options: JobsOptions[] = [];
  const queue = {
    add: async (_name: string, _data: unknown, opts: JobsOptions) => options.push(opts),
  };
  const db = {
    insert: () => ({ values: () => ({ returning: async () => [{ id: 'ocr-job' }] }) }),
    query: {
      syncRecords: {
        findFirst: async () => ({
          id: 'sync',
          status: 'failed',
          localId: 'invoice',
          provider: 'qbo',
        }),
      },
    },
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  const ocr = new OcrService(db as never, queue as never, {} as never, {} as never, {} as never);
  await ocr.createJob({
    organizationId: 'org',
    uploadedBy: 'user',
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    storageKey: 'key',
  });
  const gl = new GlExportService(
    db as never,
    {} as never,
    {} as never,
    {} as never,
    queue as never,
    {} as never,
    {} as never,
  );
  await gl.enqueue('org', 'invoice', 'qbo', 'deduplicated-id');
  await gl.retryJob('sync', 'org');
  assert.equal(options.length, 3);
  for (const option of options) {
    assert.deepEqual(option.removeOnComplete, TERMINAL_JOB_RETENTION.removeOnComplete);
    assert.deepEqual(option.removeOnFail, TERMINAL_JOB_RETENTION.removeOnFail);
    assert.equal(option.attempts, 3);
    assert.deepEqual(option.backoff, { type: 'exponential', delay: 2000 });
  }
  assert.equal(options[1].jobId, 'deduplicated-id');
});
