import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { messageOperationKey, MessagesService } from '../messages/messages.service';
import {
  SoftwareLicensesService,
  licenseRenewalFingerprint,
  type RenewalRef,
  previousRenewalPeriodStart,
} from '../software-licenses/software-licenses.service';
import type { ArtifactOperationPlan, ArtifactReference } from './artifact-idempotency.service';

type TestRenewalRef = {
  action: 'renew';
  kind: 'requisition';
  id: string;
  number: string;
  at: string;
};

class RecordingArtifactCoordinator {
  readonly plans: Array<ArtifactOperationPlan<unknown>> = [];
  private readonly operations = new Map<
    string,
    { fingerprint: string; artifact: ArtifactReference; completed: boolean }
  >();
  private readonly deliveries = new Set<string>();
  private nextOperationId = 1;

  async operationExists(_organizationId: string, idempotencyKey: string) {
    return this.operations.has(idempotencyKey);
  }

  async execute<TResult>(plan: ArtifactOperationPlan<TResult>) {
    this.plans.push(plan as ArtifactOperationPlan<unknown>);
    const previous = this.operations.get(plan.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== plan.fingerprint) {
        throw new ConflictException('The idempotency key was reused for a different operation');
      }
      if (previous.completed) {
        return { value: await plan.load(previous.artifact), replayed: true, resumed: false };
      }
    }

    const ownerIdempotencyKey = `artifact-operation:operation-${this.nextOperationId++}`;
    const recovered = previous?.artifact ?? (await plan.findExisting(ownerIdempotencyKey));
    const artifact = recovered ?? (await plan.create(ownerIdempotencyKey));
    const operation = previous ?? { fingerprint: plan.fingerprint, artifact, completed: false };
    this.operations.set(plan.idempotencyKey, operation);
    const value = await plan.link(artifact);
    await plan.notify?.(value, {
      once: async (deliveryKey, deliver) => {
        const key = `${plan.idempotencyKey}:${deliveryKey}`;
        if (this.deliveries.has(key)) return;
        await deliver(`test-${key}@betterspend.local`);
        this.deliveries.add(key);
      },
    });
    operation.completed = true;
    return { value, replayed: false, resumed: Boolean(recovered) };
  }
}

test('renewal period boundaries clamp month-end and leap-day dates', () => {
  assert.equal(
    previousRenewalPeriodStart(new Date('2027-03-31T12:30:00.000Z'), 'monthly').toISOString(),
    '2027-02-28T12:30:00.000Z',
  );
  assert.equal(
    previousRenewalPeriodStart(new Date('2028-02-29T12:30:00.000Z'), 'annual').toISOString(),
    '2027-02-28T12:30:00.000Z',
  );
});

test('renewal fingerprints keep notes outside the cycle identity', () => {
  assert.deepEqual(JSON.parse(licenseRenewalFingerprint('license-1', 'renew')), {
    licenseId: 'license-1',
    action: 'renew',
  });
  assert.notEqual(
    licenseRenewalFingerprint('license-1', 'renew'),
    licenseRenewalFingerprint('license-1', 'renegotiate'),
  );
});

const license = {
  id: 'license-1',
  organizationId: '00000000-0000-4000-8000-000000000001',
  vendorId: 'vendor-1',
  productName: 'Acme IDE',
  ownerUserId: 'user-1',
  seatCount: 4,
  pricePerSeat: '25.00',
  currency: 'USD',
  billingCycle: 'annual',
  renewalDate: new Date('2027-01-01T00:00:00.000Z'),
  notes: null,
  renewalRefs: [] as TestRenewalRef[],
  status: 'renewal_due',
};
type TestLicense = typeof license;

test('license renewal retries use the same artifact operation and do not recreate the requisition', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  let createCalls = 0;
  let linkCalls = 0;
  let notificationCalls = 0;
  let linked = false;
  const renewalRef = {
    action: 'renew' as const,
    kind: 'requisition' as const,
    id: 'requisition-1',
    number: 'REQ-2027-0001',
    at: '2026-08-29T00:00:00.000Z',
  };
  const service = new SoftwareLicensesService(
    {} as never,
    { createIdempotent: async () => notificationCalls++ } as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  const methods = service as unknown as {
    findOne: () => Promise<typeof license>;
    findRenewalArtifact: () => Promise<null>;
    createRenewalRequisition: () => Promise<ArtifactReference>;
    linkRenewalArtifact: (input: { artifact: ArtifactReference }) => Promise<{
      action: 'renew';
      kind: 'requisition';
      id: string;
      number: string;
      at: string;
    }>;
  };
  methods.findOne = async () => ({ ...license, renewalRefs: linked ? [renewalRef] : [] });
  methods.findRenewalArtifact = async () => null;
  methods.createRenewalRequisition = async () => {
    createCalls += 1;
    return { kind: 'requisition', id: 'requisition-1', number: 'REQ-2027-0001' };
  };
  methods.linkRenewalArtifact = async ({ artifact }) => {
    linkCalls += 1;
    linked = true;
    return {
      action: 'renew',
      kind: 'requisition',
      id: artifact.id,
      number: String(artifact.number),
      at: '2026-08-29T00:00:00.000Z',
    };
  };

  await service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renew');
  await service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renew');

  assert.equal(createCalls, 1);
  assert.equal(linkCalls, 1);
  assert.equal(notificationCalls, 1);
  assert.equal(coordinator.plans[0]?.operationType, 'software_license_renewal');
  assert.equal(
    coordinator.plans[0]?.idempotencyKey,
    'license-renewal:license-1:2027-01-01T00:00:00.000Z',
  );
});

test('linked license renewal resumes its durable operation after notification failure', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  let createCalls = 0;
  let notificationCalls = 0;
  let linked = false;
  let failNotification = true;
  const renewalRef = {
    action: 'renew' as const,
    kind: 'requisition' as const,
    id: 'requisition-1',
    number: 'REQ-2027-0001',
    at: '2026-08-29T00:00:00.000Z',
  };
  const service = new SoftwareLicensesService(
    {} as never,
    {
      createIdempotent: async () => {
        notificationCalls += 1;
        if (failNotification) {
          failNotification = false;
          throw new Error('notification unavailable');
        }
      },
    } as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  const methods = service as unknown as {
    findOne: () => Promise<typeof license>;
    findRenewalArtifact: () => Promise<null>;
    createRenewalRequisition: () => Promise<ArtifactReference>;
    linkRenewalArtifact: () => Promise<typeof renewalRef>;
  };
  methods.findOne = async () => ({ ...license, renewalRefs: linked ? [renewalRef] : [] });
  methods.findRenewalArtifact = async () => null;
  methods.createRenewalRequisition = async () => {
    createCalls += 1;
    return { kind: 'requisition', id: renewalRef.id, number: renewalRef.number };
  };
  methods.linkRenewalArtifact = async () => {
    linked = true;
    return renewalRef;
  };

  await assert.rejects(
    service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renew'),
    /notification unavailable/,
  );
  await service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renew');

  assert.equal(createCalls, 1);
  assert.equal(notificationCalls, 2);
  assert.equal(coordinator.plans.length, 2);
});

test('same-cycle competing renewal intents conflict before creating a second artifact', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  let createCalls = 0;
  const service = new SoftwareLicensesService(
    {} as never,
    { createIdempotent: async () => {} } as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  const methods = service as unknown as {
    findOne: () => Promise<typeof license>;
    findRenewalArtifact: () => Promise<null>;
    createRenewalRequisition: () => Promise<ArtifactReference>;
    createRenegotiationRfq: () => Promise<ArtifactReference>;
    linkRenewalArtifact: (input: { artifact: ArtifactReference }) => Promise<RenewalRef>;
  };
  methods.findOne = async () => ({ ...license, renewalRefs: [] });
  methods.findRenewalArtifact = async () => null;
  methods.createRenewalRequisition = async () => {
    createCalls += 1;
    return { kind: 'requisition', id: 'requisition-1', number: 'REQ-2027-0001' };
  };
  methods.createRenegotiationRfq = async () => {
    createCalls += 1;
    return { kind: 'rfq', id: 'rfq-1', number: 'RFQ-2027-0001' };
  };
  methods.linkRenewalArtifact = async ({ artifact }) => {
    if (artifact.kind === 'requisition') {
      return {
        action: 'renew',
        kind: 'requisition',
        id: artifact.id,
        number: String(artifact.number),
        at: '2026-08-29T00:00:00.000Z',
      };
    }
    if (artifact.kind === 'rfq') {
      return {
        action: 'renegotiate',
        kind: 'rfq',
        id: artifact.id,
        number: String(artifact.number),
        at: '2026-08-29T00:00:00.000Z',
      };
    }
    throw new Error(`Unexpected artifact kind ${artifact.kind}`);
  };

  await service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renew');
  await assert.rejects(
    service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renegotiate'),
    (error: unknown) => error instanceof ConflictException,
  );

  assert.equal(createCalls, 1);
  assert.equal(coordinator.plans.length, 2);
  assert.equal(coordinator.plans[0]?.idempotencyKey, coordinator.plans[1]?.idempotencyKey);
});

test('a matching preexisting renewal ref is reused without reserving an operation', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  const existingRef = {
    action: 'renew' as const,
    kind: 'requisition' as const,
    id: 'legacy-requisition-1',
    number: 'REQ-2026-0042',
    at: '2026-08-01T00:00:00.000Z',
  };
  const existingLicense = { ...license, renewalRefs: [existingRef] };
  const service = new SoftwareLicensesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  (service as unknown as { findOne: () => Promise<typeof existingLicense> }).findOne = async () =>
    existingLicense;

  const result = await service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renew');

  assert.equal((result as typeof existingLicense).renewalRefs[0]?.id, existingRef.id);
  assert.equal(coordinator.plans.length, 0);
});

test('a competing preexisting renewal ref conflicts before artifact creation', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  const existingLicense = {
    ...license,
    renewalRefs: [
      {
        action: 'renew' as const,
        kind: 'requisition' as const,
        id: 'legacy-requisition-1',
        number: 'REQ-2026-0042',
        at: '2026-08-01T00:00:00.000Z',
      },
    ],
  };
  const service = new SoftwareLicensesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  (service as unknown as { findOne: () => Promise<typeof existingLicense> }).findOne = async () =>
    existingLicense;

  await assert.rejects(
    service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renegotiate'),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(coordinator.plans.length, 0);
});

test('advancing a license renewal date starts a new artifact cycle', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  let createCalls = 0;
  let linkCalls = 0;
  let currentLicense = { ...license };
  const service = new SoftwareLicensesService(
    {} as never,
    { createIdempotent: async () => {} } as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  const methods = service as unknown as {
    findOne: () => Promise<typeof license>;
    findRenewalArtifact: () => Promise<null>;
    createRenewalRequisition: () => Promise<ArtifactReference>;
    linkRenewalArtifact: (input: { artifact: ArtifactReference }) => Promise<RenewalRef>;
  };
  methods.findOne = async () => ({ ...currentLicense, renewalRefs: [] });
  methods.findRenewalArtifact = async () => null;
  methods.createRenewalRequisition = async () => {
    createCalls += 1;
    return {
      kind: 'requisition',
      id: `requisition-${createCalls}`,
      number: `REQ-202${6 + createCalls}-0001`,
    };
  };
  methods.linkRenewalArtifact = async ({ artifact }) => {
    linkCalls += 1;
    return {
      action: 'renew',
      kind: 'requisition',
      id: artifact.id,
      number: String(artifact.number),
      at: '2026-08-29T00:00:00.000Z',
    };
  };

  await service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renew');
  currentLicense = { ...currentLicense, renewalDate: new Date('2028-01-01T00:00:00.000Z') };
  await service.applyRenewalAction('license-1', '00000000-0000-4000-8000-000000000001', 'user-1', 'renew');

  assert.equal(createCalls, 2);
  assert.equal(linkCalls, 2);
  assert.equal(
    coordinator.plans[0]?.idempotencyKey,
    'license-renewal:license-1:2027-01-01T00:00:00.000Z',
  );
  assert.equal(
    coordinator.plans[1]?.idempotencyKey,
    'license-renewal:license-1:2028-01-01T00:00:00.000Z',
  );
});

test('license renewal requisitions keep decimal unit prices', async () => {
  let requisitionInput: Record<string, unknown> | undefined;
  const service = new SoftwareLicensesService(
    {} as never,
    {} as never,
    {
      create: async (
        _organizationId: string,
        _requesterId: string,
        input: Record<string, unknown>,
      ) => {
        requisitionInput = input;
        return { id: 'requisition-1', number: 'REQ-2027-0001' };
      },
    } as never,
    {} as never,
    {} as never,
  );
  const methods = service as unknown as {
    createRenewalRequisition: (
      license: TestLicense,
      userId: string,
      note?: string,
      ownerIdempotencyKey?: string,
    ) => Promise<ArtifactReference>;
  };

  await methods.createRenewalRequisition(
    { ...license, pricePerSeat: '0.29', seatCount: 3 },
    'user-1',
  );

  const lines = requisitionInput?.lines as Array<Record<string, unknown>> | undefined;
  assert.equal(lines?.[0]?.unitPrice, '0.29');
});

test('linking a renewal artifact records the initiating user in the same transaction', async () => {
  const events: string[] = [];
  const transaction = {
    execute: async () => [],
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [] }),
          limit: async () => [],
          for: async () => {
            events.push('select-license');
            return [{ notes: null, renewalRefs: [] }];
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            events.push('update-license');
            return [{ id: 'license-1' }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => ({
        returning: async () => {
          events.push('audit');
          assert.equal(value.userId, 'user-1');
          assert.equal(value.entityType, 'software_license');
          assert.equal(value.entityId, 'license-1');
          return [value];
        },
      }),
    }),
  };
  const service = new SoftwareLicensesService(
    {
      transaction: async <T>(callback: (tx: typeof transaction) => Promise<T>) =>
        callback(transaction),
    } as never,
    {} as never,
    {
      ensureSpendGuardAnalysis: async () => {},
      findOne: async () => ({ status: 'submitted' }),
    } as never,
    {} as never,
    {} as never,
  );
  const methods = service as unknown as {
    linkRenewalArtifact: (input: {
      id: string;
      organizationId: string;
      userId: string;
      action: 'renew';
      artifact: ArtifactReference;
    }) => Promise<RenewalRef>;
  };

  await methods.linkRenewalArtifact({
    id: 'license-1',
    organizationId: '00000000-0000-4000-8000-000000000001',
    userId: 'user-1',
    action: 'renew',
    artifact: { kind: 'requisition', id: 'requisition-1', number: 'REQ-2027-0001' },
  });

  assert.deepEqual(events, ['select-license', 'update-license', 'audit']);
});

test('buyer message retries retain the caller key and return one message artifact', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  let createCalls = 0;
  let emailCalls = 0;
  const service = new MessagesService(
    {
      query: { users: { findFirst: async () => ({ id: 'user-1', name: 'Buyer' }) } },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  const methods = service as unknown as {
    getThreadContext: () => Promise<{ vendorId: string; internalUserId: string }>;
    findMessageArtifact: () => Promise<null>;
    createUserMessage: () => Promise<ArtifactReference>;
    loadMessage: (
      _organizationId: string,
      artifact: ArtifactReference,
    ) => Promise<{
      id: string;
      body: string;
    }>;
    emailVendorContact: () => Promise<void>;
  };
  methods.getThreadContext = async () => ({ vendorId: 'vendor-1', internalUserId: 'user-1' });
  methods.findMessageArtifact = async () => null;
  methods.createUserMessage = async () => {
    createCalls += 1;
    return { kind: 'message', id: 'message-1' };
  };
  methods.loadMessage = async (_organizationId, artifact) => ({
    id: artifact.id,
    body: 'Need a quote update',
  });
  methods.emailVendorContact = async () => {
    emailCalls += 1;
  };

  const first = await service.postAsUser('00000000-0000-4000-8000-000000000001', 'user-1', 'po', 'po-1', {
    body: 'Need a quote update',
    idempotencyKey: 'request-1',
  });
  const second = await service.postAsUser('00000000-0000-4000-8000-000000000001', 'user-1', 'po', 'po-1', {
    body: 'Need a quote update',
    idempotencyKey: 'request-1',
  });

  assert.equal(first.id, 'message-1');
  assert.equal(second.id, 'message-1');
  assert.equal(createCalls, 1);
  assert.equal(emailCalls, 1);
  assert.equal(coordinator.plans[0]?.operationType, 'message_post');
  assert.equal(coordinator.plans[0]?.idempotencyKey, 'message:user:user-1:request-1');
});

test('message operations derive a stable key when the caller omits one', () => {
  const first = messageOperationKey('user', 'user-1', undefined, 'message-intent-1');
  const second = messageOperationKey('user', 'user-1', undefined, 'message-intent-1');

  assert.equal(first, second);
  assert.match(first, /^message:user:user-1:derived:message-intent-1$/);
});

test('message operation keys keep callers independent within an organization', () => {
  assert.notEqual(
    messageOperationKey('user', 'user-1', 'shared-key', 'message-intent-1'),
    messageOperationKey('user', 'user-2', 'shared-key', 'message-intent-1'),
  );
});

test('message responses never expose private owner idempotency keys', async () => {
  const service = new MessagesService(
    {
      query: {
        messages: {
          findMany: async () => [
            {
              id: 'message-1',
              body: 'Hello',
              idempotencyKey: 'artifact-operation:private',
              createdAt: new Date(),
            },
          ],
        },
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  (service as unknown as { assertThreadExists: () => Promise<void> }).assertThreadExists =
    async () => {};

  const [message] = await service.list('00000000-0000-4000-8000-000000000001', 'po', 'po-1');

  assert.equal('idempotencyKey' in message!, false);
});

test('required vendor email failures reject with the same stable Message-ID', async () => {
  const messageIds: string[] = [];
  const service = new MessagesService(
    {
      query: {
        vendors: {
          findFirst: async () => ({
            id: 'vendor-1',
            name: 'Vendor',
            contactInfo: { email: 'vendor@example.com' },
          }),
        },
      },
    } as never,
    {} as never,
    {
      sendMail: async (_config: unknown, options: { messageId?: string }) => {
        messageIds.push(options.messageId!);
        return false;
      },
    } as never,
    { getAll: async () => ({ smtp_host: 'smtp.example.com' }) } as never,
    {} as never,
  );
  const methods = service as unknown as {
    getThreadContext: () => Promise<{ vendorId: string; internalUserId: null }>;
    emailVendorContact: (...args: unknown[]) => Promise<void>;
  };
  methods.getThreadContext = async () => ({ vendorId: 'vendor-1', internalUserId: null });
  const identity = 'artifact-stable@betterspend.local';

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(
      methods.emailVendorContact(
        '00000000-0000-4000-8000-000000000001',
        'po',
        'po-1',
        'Buyer',
        'Hello',
        undefined,
        true,
        identity,
      ),
      /not accepted by SMTP/,
    );
  }
  assert.deepEqual(messageIds, [identity, identity]);
});

test('vendor message retries retain the caller key and do not duplicate notifications', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  let createCalls = 0;
  let notificationCalls = 0;
  const service = new MessagesService(
    {
      query: {
        vendors: { findFirst: async () => ({ id: 'vendor-1', name: 'Supplier' }) },
      },
    } as never,
    { createIdempotent: async () => notificationCalls++ } as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  const methods = service as unknown as {
    getThreadContext: () => Promise<{ vendorId: string; internalUserId: string }>;
    assertVendorAccess: () => Promise<void>;
    findMessageArtifact: () => Promise<null>;
    createVendorMessage: () => Promise<ArtifactReference>;
    loadMessage: (
      _organizationId: string,
      artifact: ArtifactReference,
    ) => Promise<{
      id: string;
      body: string;
    }>;
  };
  methods.getThreadContext = async () => ({ vendorId: 'vendor-1', internalUserId: 'user-1' });
  methods.assertVendorAccess = async () => {};
  methods.findMessageArtifact = async () => null;
  methods.createVendorMessage = async () => {
    createCalls += 1;
    return { kind: 'message', id: 'message-2' };
  };
  methods.loadMessage = async (_organizationId, artifact) => ({
    id: artifact.id,
    body: 'The shipment is scheduled',
    idempotencyKey: 'artifact-operation:private',
  });

  const first = await service.postAsVendor('00000000-0000-4000-8000-000000000001', 'vendor-1', 'po', 'po-1', {
    body: 'The shipment is scheduled',
    idempotencyKey: 'request-2',
  });
  await service.postAsVendor('00000000-0000-4000-8000-000000000001', 'vendor-1', 'po', 'po-1', {
    body: 'The shipment is scheduled',
    idempotencyKey: 'request-2',
  });

  assert.equal(createCalls, 1);
  assert.equal(notificationCalls, 1);
  assert.equal(coordinator.plans[0]?.idempotencyKey, 'message:vendor:vendor-1:request-2');
  assert.equal('idempotencyKey' in first, false);
});
