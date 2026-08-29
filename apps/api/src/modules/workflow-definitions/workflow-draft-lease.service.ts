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
export const WORKFLOW_DRAFT_LEASE_REDIS_TIMEOUT_MS = 5_000;

/** The small Redis surface used by the lease module, which keeps its tests in-process. */
export interface WorkflowDraftLeaseRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: Array<string | number>): Promise<string | null>;
  eval(script: string, numberOfKeys: number, ...args: Array<string | number>): Promise<unknown>;
  disconnect(): void;
}

export function createWorkflowDraftLeaseRedis(): WorkflowDraftLeaseRedis {
  const redis = new Redis({
    ...getRedisConnection(),
    lazyConnect: true,
    connectTimeout: WORKFLOW_DRAFT_LEASE_REDIS_TIMEOUT_MS,
    commandTimeout: WORKFLOW_DRAFT_LEASE_REDIS_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
  });
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

const ACQUIRE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then return {0, current} end

local storedSequence = tonumber(redis.call('GET', KEYS[2]))
if not storedSequence then
  storedSequence = 0
  redis.call('SET', KEYS[2], storedSequence)
end
local floor = tonumber(ARGV[4]) or 0
local sequence = storedSequence
if sequence < floor then sequence = floor end
if sequence ~= storedSequence then redis.call('SET', KEYS[2], sequence) end

local fence = redis.call('INCR', KEYS[2])
local raw = ARGV[1] .. fence .. '|' .. ARGV[2]
redis.call('SET', KEYS[3], '0\\n', 'PX', ARGV[3])
redis.call('SET', KEYS[1], raw, 'PX', ARGV[3])
return {1, raw}
`;

const TAKEOVER_SCRIPT = `
local previous = redis.call('GET', KEYS[1]) or ''
local previousTtl = -1
if previous ~= '' then previousTtl = redis.call('PTTL', KEYS[1]) end
local redisTime = redis.call('TIME')
local nowMs = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local previousExpiresAt = previousTtl > 0 and nowMs + previousTtl or 0

local storedSequence = tonumber(redis.call('GET', KEYS[2]))
if not storedSequence then
  storedSequence = 0
  redis.call('SET', KEYS[2], storedSequence)
end
local floor = tonumber(ARGV[4]) or 0
local previousFence = tonumber(string.match(previous, '^[^|]+|[^|]+|[^|]+|([0-9]+)|')) or 0
local sequence = storedSequence
if sequence < floor then sequence = floor end
if sequence < previousFence then sequence = previousFence end
if sequence ~= storedSequence then redis.call('SET', KEYS[2], sequence) end

local fence = redis.call('INCR', KEYS[2])
local raw = ARGV[1] .. fence .. '|' .. ARGV[2]
redis.call('SET', KEYS[3], previousExpiresAt .. '\\n' .. previous, 'PX', ARGV[3])
redis.call('SET', KEYS[1], raw, 'PX', ARGV[3])
return {previous, previousTtl, raw}
`;

const RECONCILE_ATTEMPT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local recovery = redis.call('GET', KEYS[2])
if not current or not recovery then return 0 end
local prefix = ARGV[1]
if string.sub(current, 1, string.len(prefix)) ~= prefix then
  redis.call('DEL', KEYS[2])
  return 0
end

local separator = string.find(recovery, '\\n', 1, true)
if not separator then return 0 end
local previousExpiresAt = tonumber(string.sub(recovery, 1, separator - 1)) or 0
local previous = string.sub(recovery, separator + 1)
local redisTime = redis.call('TIME')
local nowMs = tonumber(redisTime[1]) * 1000 + math.floor(tonumber(redisTime[2]) / 1000)
local remainingTtl = previousExpiresAt - nowMs
if previous == '' or remainingTtl <= 0 then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], previous, 'PX', remainingTtl)
end
redis.call('DEL', KEYS[2])
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

const RESTORE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == '' or tonumber(ARGV[3]) <= 0 then
  return redis.call('DEL', KEYS[1])
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`;

/** Exact script identities shared with the in-process protocol test double. */
export const WORKFLOW_DRAFT_LEASE_LUA = {
  acquire: ACQUIRE_SCRIPT,
  takeover: TAKEOVER_SCRIPT,
  renew: RENEW_SCRIPT,
  release: RELEASE_SCRIPT,
  deleteIfUnchanged: DELETE_IF_UNCHANGED_SCRIPT,
  restore: RESTORE_SCRIPT,
  reconcileAttempt: RECONCILE_ATTEMPT_SCRIPT,
} as const;

type StoredLease = {
  token: string;
  lease: WorkflowDraftLease;
};

type OwnedLeaseStatus = Extract<WorkflowDraftLeaseStatus, { state: 'owned' }>;

export type WorkflowDraftLeaseAcquisition = {
  status: WorkflowDraftLeaseStatus;
  created: boolean;
  restore: () => Promise<boolean>;
};

export type WorkflowDraftLeaseTakeover = {
  status: OwnedLeaseStatus;
  previous: WorkflowDraftLease | null;
  restore: () => Promise<boolean>;
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
    editorInstanceId?: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    const stored = await this.read(definitionId, organizationId);
    if (!stored) return { state: 'available' };
    if (
      stored.lease.holderUserId === userId &&
      stored.lease.editorInstanceId === editorInstanceId
    ) {
      return { state: 'owned', lease: stored.lease, leaseToken: stored.token };
    }
    return { state: 'held', lease: publicLeaseMetadata(stored.lease) };
  }

  async acquire(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    editorInstanceId: string,
    holderName: string,
    minimumFence = 0,
  ): Promise<WorkflowDraftLeaseStatus> {
    return (
      await this.acquireWithResult(
        definitionId,
        organizationId,
        holderUserId,
        editorInstanceId,
        holderName,
        minimumFence,
      )
    ).status;
  }

  async acquireWithResult(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    editorInstanceId: string,
    holderName: string,
    minimumFence = 0,
  ): Promise<WorkflowDraftLeaseAcquisition> {
    const leaseDocument = createLeaseDocument(
      definitionId,
      holderUserId,
      editorInstanceId,
      holderName,
    );
    const token = randomBytes(32).toString('base64url');
    const key = this.key(organizationId, definitionId);
    const prefix = ownershipPrefix(token, holderUserId, editorInstanceId);
    const recoveryKey = this.recoveryKey(organizationId, definitionId, token);
    let rawResult: unknown;
    try {
      rawResult = await this.redisCall(() =>
        this.redis.eval(
          WORKFLOW_DRAFT_LEASE_LUA.acquire,
          3,
          key,
          this.fenceKey(organizationId, definitionId),
          recoveryKey,
          prefix,
          JSON.stringify(leaseDocument),
          WORKFLOW_DRAFT_LEASE_TTL_MS,
          normalizeMinimumFence(minimumFence),
        ),
      );
    } catch (error) {
      await this.reconcileAmbiguousAttempt(key, recoveryKey, prefix, error);
    }
    const result = readRedisArray(rawResult, 2);
    if (Number(result[0]) !== 1) {
      return {
        status: await this.status(definitionId, organizationId, holderUserId, editorInstanceId),
        created: false,
        restore: async () => false,
      };
    }

    const raw = requireRedisString(result[1]);
    const stored = decodeLease(raw);
    if (
      !stored ||
      stored.lease.definitionId !== definitionId ||
      stored.lease.holderUserId !== holderUserId ||
      stored.lease.editorInstanceId !== editorInstanceId ||
      stored.lease.fence <= normalizeMinimumFence(minimumFence)
    ) {
      throw new ServiceUnavailableException(
        'Workflow draft lease storage returned an invalid lease',
      );
    }
    return {
      status: { state: 'owned', lease: stored.lease, leaseToken: stored.token },
      created: true,
      restore: () => this.restoreRaw(key, raw, '', -1),
    };
  }

  async renew(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    editorInstanceId: string,
    token: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    const stored = await this.read(definitionId, organizationId);
    if (
      !stored ||
      stored.token !== token ||
      stored.lease.holderUserId !== holderUserId ||
      stored.lease.editorInstanceId !== editorInstanceId
    ) {
      return this.status(definitionId, organizationId, holderUserId, editorInstanceId);
    }

    const lease: WorkflowDraftLease = {
      ...stored.lease,
      expiresAt: new Date(Date.now() + WORKFLOW_DRAFT_LEASE_TTL_MS).toISOString(),
    };
    const raw = encodeLease(token, lease);
    const renewed = await this.redisCall(() =>
      this.redis.eval(
        WORKFLOW_DRAFT_LEASE_LUA.renew,
        1,
        this.key(organizationId, definitionId),
        raw,
        WORKFLOW_DRAFT_LEASE_TTL_MS,
        ownershipPrefix(token, holderUserId, editorInstanceId),
      ),
    );
    if (Number(renewed) === 1) return { state: 'owned', lease, leaseToken: token };
    return this.status(definitionId, organizationId, holderUserId, editorInstanceId);
  }

  async release(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    editorInstanceId: string,
    token: string,
  ): Promise<WorkflowDraftLeaseStatus> {
    await this.redisCall(() =>
      this.redis.eval(
        WORKFLOW_DRAFT_LEASE_LUA.release,
        1,
        this.key(organizationId, definitionId),
        ownershipPrefix(token, holderUserId, editorInstanceId),
      ),
    );
    return this.status(definitionId, organizationId, holderUserId, editorInstanceId);
  }

  async takeover(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    editorInstanceId: string,
    holderName: string,
    minimumFence = 0,
  ): Promise<WorkflowDraftLeaseStatus> {
    return (
      await this.takeoverWithResult(
        definitionId,
        organizationId,
        holderUserId,
        editorInstanceId,
        holderName,
        minimumFence,
      )
    ).status;
  }

  async takeoverWithResult(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    editorInstanceId: string,
    holderName: string,
    minimumFence = 0,
  ): Promise<WorkflowDraftLeaseTakeover> {
    const leaseDocument = createLeaseDocument(
      definitionId,
      holderUserId,
      editorInstanceId,
      holderName,
    );
    const token = randomBytes(32).toString('base64url');
    const key = this.key(organizationId, definitionId);
    const prefix = ownershipPrefix(token, holderUserId, editorInstanceId);
    const recoveryKey = this.recoveryKey(organizationId, definitionId, token);
    let rawResult: unknown;
    try {
      rawResult = await this.redisCall(() =>
        this.redis.eval(
          WORKFLOW_DRAFT_LEASE_LUA.takeover,
          3,
          key,
          this.fenceKey(organizationId, definitionId),
          recoveryKey,
          prefix,
          JSON.stringify(leaseDocument),
          WORKFLOW_DRAFT_LEASE_TTL_MS,
          normalizeMinimumFence(minimumFence),
        ),
      );
    } catch (error) {
      await this.reconcileAmbiguousAttempt(key, recoveryKey, prefix, error);
    }
    const result = readRedisArray(rawResult, 3);
    const previousRaw = requireRedisString(result[0]);
    const previousTtl = Number(result[1]);
    const raw = requireRedisString(result[2]);
    const stored = decodeLease(raw);
    if (
      !stored ||
      stored.lease.definitionId !== definitionId ||
      stored.lease.holderUserId !== holderUserId ||
      stored.lease.editorInstanceId !== editorInstanceId ||
      stored.lease.fence <= normalizeMinimumFence(minimumFence)
    ) {
      throw new ServiceUnavailableException(
        'Workflow draft lease storage returned an invalid lease',
      );
    }

    const previousStored = previousRaw && previousTtl > 0 ? decodeLease(previousRaw) : null;
    const previous =
      previousStored && new Date(previousStored.lease.expiresAt).getTime() > Date.now()
        ? previousStored.lease
        : null;
    const restoreRaw = previous ? previousRaw : '';
    const restoreTtl = previous ? previousTtl : -1;
    return {
      status: { state: 'owned', lease: stored.lease, leaseToken: stored.token },
      previous,
      restore: () => this.restoreRaw(key, raw, restoreRaw, restoreTtl),
    };
  }

  /** Returns metadata for audit records without returning a stored token. */
  async peek(definitionId: string, organizationId: string): Promise<WorkflowDraftLease | null> {
    return (await this.read(definitionId, organizationId))?.lease ?? null;
  }

  async assertOwned(
    definitionId: string,
    organizationId: string,
    holderUserId: string,
    editorInstanceId: string,
    token: string,
  ): Promise<WorkflowDraftLease> {
    const stored = await this.read(definitionId, organizationId);
    if (
      !stored ||
      stored.token !== token ||
      stored.lease.holderUserId !== holderUserId ||
      stored.lease.editorInstanceId !== editorInstanceId ||
      new Date(stored.lease.expiresAt).getTime() <= Date.now()
    ) {
      throw new ConflictException('Workflow draft lease is missing, expired, or not owned by you');
    }
    return stored.lease;
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
      await this.redisCall(() =>
        this.redis.eval(WORKFLOW_DRAFT_LEASE_LUA.deleteIfUnchanged, 1, key, raw),
      );
      return null;
    }
    return stored;
  }

  private key(organizationId: string, definitionId: string): string {
    return `workflow:draft-lease:${organizationId}:${definitionId}`;
  }

  private fenceKey(organizationId: string, definitionId: string): string {
    return `workflow:draft-lease-fence:${organizationId}:${definitionId}`;
  }

  private recoveryKey(organizationId: string, definitionId: string, token: string): string {
    return `workflow:draft-lease-recovery:${organizationId}:${definitionId}:${token}`;
  }

  private async reconcileAmbiguousAttempt(
    key: string,
    recoveryKey: string,
    ownership: string,
    originalError: unknown,
  ): Promise<never> {
    try {
      await this.redisCall(() =>
        this.redis.eval(WORKFLOW_DRAFT_LEASE_LUA.reconcileAttempt, 2, key, recoveryKey, ownership),
      );
    } catch {
      throw new ServiceUnavailableException(
        'Workflow draft lease outcome could not be reconciled after a storage timeout',
        { cause: originalError },
      );
    }
    throw originalError;
  }

  private async restoreRaw(
    key: string,
    currentRaw: string,
    previousRaw: string,
    previousTtl: number,
  ): Promise<boolean> {
    const restored = await this.redisCall(() =>
      this.redis.eval(
        WORKFLOW_DRAFT_LEASE_LUA.restore,
        1,
        key,
        currentRaw,
        previousRaw,
        previousTtl,
      ),
    );
    return Number(restored) === 1;
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

function ownershipPrefix(token: string, holderUserId: string, editorInstanceId: string): string {
  return `${token}|${holderUserId}|${editorInstanceId}|`;
}

function publicLeaseMetadata(lease: WorkflowDraftLease) {
  const { editorInstanceId: _privateEditorInstanceId, ...metadata } = lease;
  return metadata;
}

type WorkflowDraftLeaseDocument = Omit<WorkflowDraftLease, 'fence'>;

function createLeaseDocument(
  definitionId: string,
  holderUserId: string,
  editorInstanceId: string,
  holderName: string,
): WorkflowDraftLeaseDocument {
  const now = new Date();
  return {
    definitionId,
    holderUserId,
    editorInstanceId,
    holderName,
    acquiredAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + WORKFLOW_DRAFT_LEASE_TTL_MS).toISOString(),
  };
}

function encodeLease(token: string, lease: WorkflowDraftLease): string {
  const { fence, ...document } = lease;
  return `${ownershipPrefix(token, lease.holderUserId, lease.editorInstanceId)}${fence}|${JSON.stringify(document)}`;
}

function decodeLease(raw: string): StoredLease | null {
  const firstSeparator = raw.indexOf('|');
  const secondSeparator = raw.indexOf('|', firstSeparator + 1);
  const thirdSeparator = raw.indexOf('|', secondSeparator + 1);
  const fourthSeparator = raw.indexOf('|', thirdSeparator + 1);
  if (
    firstSeparator <= 0 ||
    secondSeparator <= firstSeparator ||
    thirdSeparator <= secondSeparator ||
    fourthSeparator <= thirdSeparator
  ) {
    return null;
  }

  const token = raw.slice(0, firstSeparator);
  const holderUserId = raw.slice(firstSeparator + 1, secondSeparator);
  const editorInstanceId = raw.slice(secondSeparator + 1, thirdSeparator);
  const fence = Number(raw.slice(thirdSeparator + 1, fourthSeparator));
  if (
    !workflowDraftLeaseTokenSchema.safeParse(token).success ||
    !holderUserId ||
    !editorInstanceId ||
    !Number.isSafeInteger(fence) ||
    fence <= 0
  ) {
    return null;
  }

  try {
    const document = workflowDraftLeaseSchema
      .omit({ fence: true })
      .parse(JSON.parse(raw.slice(fourthSeparator + 1)));
    const lease = workflowDraftLeaseSchema.parse({ ...document, fence });
    if (lease.holderUserId !== holderUserId || lease.editorInstanceId !== editorInstanceId)
      return null;
    return { token, lease };
  } catch {
    return null;
  }
}

function normalizeMinimumFence(minimumFence: number): number {
  if (!Number.isSafeInteger(minimumFence) || minimumFence < 0) {
    throw new ConflictException('Workflow draft fence is invalid');
  }
  return minimumFence;
}

function readRedisArray(result: unknown, expectedLength: number): Array<unknown> {
  if (!Array.isArray(result) || result.length !== expectedLength) {
    throw new ServiceUnavailableException(
      'Workflow draft lease storage returned an invalid result',
    );
  }
  return result;
}

function requireRedisString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ServiceUnavailableException('Workflow draft lease storage returned an invalid value');
  }
  return value;
}
