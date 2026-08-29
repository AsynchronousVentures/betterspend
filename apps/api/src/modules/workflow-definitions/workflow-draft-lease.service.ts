import {
  ConflictException,
  Inject,
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import {
  workflowDraftLeaseSchema,
  workflowDraftLeaseTokenSchema,
  type WorkflowDraftLease,
  type WorkflowDraftLeaseStatus,
} from '@betterspend/shared';
import { getRedisConnection } from '../../common/queue/queue.module';

export const WORKFLOW_DRAFT_LEASE_TTL_MS = 60_000;
export const WORKFLOW_DRAFT_LEASE_REDIS = Symbol('WORKFLOW_DRAFT_LEASE_REDIS');

/** The small Redis surface used by the lease module, which keeps its tests in-process. */
export interface WorkflowDraftLeaseRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  disconnect(): void;
}

export function createWorkflowDraftLeaseRedis(): WorkflowDraftLeaseRedis {
  const redis = new Redis({ ...getRedisConnection(), lazyConnect: true });
  return redis as unknown as WorkflowDraftLeaseRedis;
}

const RENEW_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local prefix = ARGV[3]
if string.sub(current, 1, string.len(prefix)) ~= prefix then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`;

const RELEASE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
local prefix = ARGV[1]
if string.sub(current, 1, string.len(prefix)) ~= prefix then return 0 end
return redis.call('DEL', KEYS[1])
`;

const DELETE_IF_UNCHANGED_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

type StoredLease = {
  token: string;
  lease: WorkflowDraftLease;
};

/** Owns the Redis lease protocol and never returns another user's token. */
@Injectable()
export class WorkflowDraftLeaseService implements OnModuleDestroy {
  constructor(
    @Inject(WORKFLOW_DRAFT_LEASE_REDIS)
    private readonly redis: WorkflowDraftLeaseRedis,
  ) {}

  async status(
    definitionId: string,
    organizationId: string,
    userId?: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    const stored = await this.read(definitionId, organizationId);
    if (!stored) return { state: 'available' };
    if (stored.lease.holderUserId === userId) {
      return { state: 'owned', lease: stored.lease, leaseToken: stored.token };
    }
    return { state: 'held', lease: stored.lease };
  }

  async acquire(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    holderName: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    const now = new Date();
    const lease: WorkflowDraftLease = {
      definitionId,
      holderUserId,
      holderName,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + WORKFLOW_DRAFT_LEASE_TTL_MS).toISOString(),
    };
    const token = randomBytes(32).toString('base64url');
    const raw = encodeLease(token, lease);
    const result = await this.redisCall(() =>
      this.redis.set(
        this.key(organizationId, definitionId),
        raw,
        'PX',
        WORKFLOW_DRAFT_LEASE_TTL_MS,
        'NX',
      ),
    );

    if (result === 'OK') return { state: 'owned', lease, leaseToken: token };
    // An idempotent acquire by the current holder is useful after a tab refresh. The
    // status path can safely return its token because the caller's identity is known.
    return this.status(definitionId, organizationId, holderUserId);
  }

  async renew(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    token: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    const stored = await this.read(definitionId, organizationId);
    if (!stored || stored.token !== token || stored.lease.holderUserId !== holderUserId) {
      return this.status(definitionId, organizationId, holderUserId);
    }

    const lease: WorkflowDraftLease = {
      ...stored.lease,
      expiresAt: new Date(Date.now() + WORKFLOW_DRAFT_LEASE_TTL_MS).toISOString(),
    };
    const raw = encodeLease(token, lease);
    const renewed = await this.redisCall(() =>
      this.redis.eval(
        RENEW_SCRIPT,
        1,
        this.key(organizationId, definitionId),
        raw,
        WORKFLOW_DRAFT_LEASE_TTL_MS,
        ownershipPrefix(token, holderUserId),
      ),
    );
    if (Number(renewed) === 1) return { state: 'owned', lease, leaseToken: token };
    return this.status(definitionId, organizationId, holderUserId);
  }

  async release(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    token: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    await this.redisCall(() =>
      this.redis.eval(
        RELEASE_SCRIPT,
        1,
        this.key(organizationId, definitionId),
        ownershipPrefix(token, holderUserId),
      ),
    );
    return this.status(definitionId, organizationId, holderUserId);
  }

  async takeover(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    holderName: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    const now = new Date();
    const lease: WorkflowDraftLease = {
      definitionId,
      holderUserId,
      holderName,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + WORKFLOW_DRAFT_LEASE_TTL_MS).toISOString(),
    };
    const token = randomBytes(32).toString('base64url');
    await this.redisCall(() =>
      this.redis.set(
        this.key(organizationId, definitionId),
        encodeLease(token, lease),
        'PX',
        WORKFLOW_DRAFT_LEASE_TTL_MS,
      ),
    );
    return { state: 'owned', lease, leaseToken: token };
  }

  /** Returns metadata for audit records without returning a stored token. */
  async peek(definitionId: string, organizationId: string): Promise<WorkflowDraftLease | null> {
    return (await this.read(definitionId, organizationId))?.lease ?? null;
  }

  async assertOwned(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    token: string,
  ): Promise<void> {
    const stored = await this.read(definitionId, organizationId);
    if (
      !stored ||
      stored.token !== token ||
      stored.lease.holderUserId !== holderUserId ||
      new Date(stored.lease.expiresAt).getTime() <= Date.now()
    ) {
      throw new ConflictException('Workflow draft lease is missing, expired, or not owned by you');
    }
  }

  onModuleDestroy(): void {
    this.redis.disconnect();
  }

  private async read(definitionId: string, organizationId: string): Promise<StoredLease | null> {
    const key = this.key(organizationId, definitionId);
    const raw = await this.redisCall(() => this.redis.get(key));
    if (!raw) return null;

    const stored = decodeLease(raw);
    if (
      !stored ||
      stored.lease.definitionId !== definitionId ||
      new Date(stored.lease.expiresAt).getTime() <= Date.now()
    ) {
      await this.redisCall(() => this.redis.eval(DELETE_IF_UNCHANGED_SCRIPT, 1, key, raw));
      return null;
    }
    return stored;
  }

  private key(organizationId: string, definitionId: string): string {
    return `workflow:draft-lease:${organizationId}:${definitionId}`;
  }

  private async redisCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException('Workflow draft lease storage is unavailable');
    }
  }
}

function ownershipPrefix(token: string, holderUserId: string): string {
  return `${token}|${holderUserId}|`;
}

function encodeLease(token: string, lease: WorkflowDraftLease): string {
  return `${ownershipPrefix(token, lease.holderUserId)}${JSON.stringify(lease)}`;
}

function decodeLease(raw: string): StoredLease | null {
  const firstSeparator = raw.indexOf('|');
  const secondSeparator = raw.indexOf('|', firstSeparator + 1);
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator) {
    return null;
  }

  const token = raw.slice(0, firstSeparator);
  const holderUserId = raw.slice(firstSeparator + 1, secondSeparator);
  if (!workflowDraftLeaseTokenSchema.safeParse(token).success || !holderUserId) return null;

  try {
    const lease = workflowDraftLeaseSchema.parse(JSON.parse(raw.slice(secondSeparator + 1)));
    if (lease.holderUserId !== holderUserId) return null;
    return { token, lease };
  } catch {
    return null;
  }
}
