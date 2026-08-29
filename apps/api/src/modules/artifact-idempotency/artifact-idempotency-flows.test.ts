import assert from 'node:assert/strict';
import test from 'node:test';
import { MessagesService } from '../messages/messages.service';
import { SoftwareLicensesService } from '../software-licenses/software-licenses.service';
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
  private readonly artifacts = new Map<string, ArtifactReference>();

  async execute<TResult>(plan: ArtifactOperationPlan<TResult>) {
    this.plans.push(plan as ArtifactOperationPlan<unknown>);
    const previous = this.artifacts.get(plan.idempotencyKey);
    if (previous) {
      return { value: await plan.load(previous), replayed: true };
    }
    const artifact = await plan.create();
    this.artifacts.set(plan.idempotencyKey, artifact);
    return { value: await plan.link(artifact), replayed: false };
  }
}

const license = {
  id: 'license-1',
  organizationId: 'org-1',
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
    { create: async () => notificationCalls++ } as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  const methods = service as unknown as {
    findOne: () => Promise<typeof license>;
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

  await service.applyRenewalAction('license-1', 'org-1', 'user-1', 'renew');
  await service.applyRenewalAction('license-1', 'org-1', 'user-1', 'renew');

  assert.equal(createCalls, 1);
  assert.equal(linkCalls, 1);
  assert.equal(notificationCalls, 1);
  assert.equal(coordinator.plans[0]?.operationType, 'software_license_renewal');
  assert.equal(coordinator.plans[0]?.idempotencyKey, 'license-renewal:license-1:renew');
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

  const first = await service.postAsUser('org-1', 'user-1', 'po', 'po-1', {
    body: 'Need a quote update',
    idempotencyKey: 'request-1',
  });
  const second = await service.postAsUser('org-1', 'user-1', 'po', 'po-1', {
    body: 'Need a quote update',
    idempotencyKey: 'request-1',
  });

  assert.equal(first.id, 'message-1');
  assert.equal(second.id, 'message-1');
  assert.equal(createCalls, 1);
  assert.equal(emailCalls, 1);
  assert.equal(coordinator.plans[0]?.operationType, 'message_post');
  assert.equal(coordinator.plans[0]?.idempotencyKey, 'message:user:request-1');
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
    { create: async () => notificationCalls++ } as never,
    {} as never,
    {} as never,
    coordinator as never,
  );
  const methods = service as unknown as {
    getThreadContext: () => Promise<{ vendorId: string; internalUserId: string }>;
    assertVendorAccess: () => Promise<void>;
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
  methods.createVendorMessage = async () => {
    createCalls += 1;
    return { kind: 'message', id: 'message-2' };
  };
  methods.loadMessage = async (_organizationId, artifact) => ({
    id: artifact.id,
    body: 'The shipment is scheduled',
  });

  await service.postAsVendor('org-1', 'vendor-1', 'po', 'po-1', {
    body: 'The shipment is scheduled',
    idempotencyKey: 'request-2',
  });
  await service.postAsVendor('org-1', 'vendor-1', 'po', 'po-1', {
    body: 'The shipment is scheduled',
    idempotencyKey: 'request-2',
  });

  assert.equal(createCalls, 1);
  assert.equal(notificationCalls, 1);
  assert.equal(coordinator.plans[0]?.idempotencyKey, 'message:vendor:request-2');
});
