import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { BullModule, getQueueToken, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue, QueueEvents } from 'bullmq';
import { getRedisConnection } from '../redis-connection';

test(
  'Nest BullMQ registers a worker, retries jobs and closes its Redis connections',
  {
    skip: !process.env.REDIS_TEST_URL,
    timeout: 30_000,
  },
  async () => {
    const name = `nest-adapter-test-${randomUUID()}`;
    const connection = getRedisConnection({ REDIS_URL: process.env.REDIS_TEST_URL });
    let executions = 0;
    @Processor(name)
    class TestProcessor extends WorkerHost {
      async process(job: Job<{ value: number }>) {
        executions++;
        if (job.attemptsMade === 0) throw new Error('Expected fixture retry');
        return job.data.value * 2;
      }
    }
    @Module({
      imports: [BullModule.forRoot({ connection }), BullModule.registerQueue({ name })],
      providers: [TestProcessor],
    })
    class TestModule {}

    const app = await NestFactory.createApplicationContext(TestModule, { logger: false });
    const queue = app.get<Queue>(getQueueToken(name));
    const worker = app.get(TestProcessor).worker;
    const events = new QueueEvents(name, { connection });
    try {
      await Promise.all([worker.waitUntilReady(), events.waitUntilReady()]);
      const job = await queue.add('double', { value: 7 }, { attempts: 2 });
      assert.equal(await job.waitUntilFinished(events, 10_000), 14);
      assert.equal(executions, 2);
      assert.equal(await job.getState(), 'completed');
      await queue.obliterate({ force: true });
    } finally {
      await events.close();
      await app.close();
    }
    assert.equal(worker.isRunning(), false);
    assert.equal((await queue.client).status, 'end');
  },
);
