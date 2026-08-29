import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException } from '@nestjs/common';
import { MessagesService } from '../messages/messages.service';
import {
  SoftwareLicensesService,
  type RenewalRef,
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
    { fingerprint: string; artifact: ArtifactReference }
  >();
  private nextOperationId = 1;

  async execute<TResult>(plan: ArtifactOperationPlan<TResult>) {
    this.plans.push(plan as ArtifactOperationPlan<unknown>);
    const previous = this.operations.get(plan.idempotencyKey);
    if (previous) {
      if (previous.fingerprint !== plan.fingerprint) {
        throw new ConflictException('The idempotency key was reused for a different operation');
      }
      return { value: await plan.load(previous.artifact), replayed: true };
    }

    const ownerIdempotencyKey = `artifact-operation:operation-${this.nextOperationId++}`;
    const recovered = await plan.findExisting(ownerIdempotencyKey);
    const artifact = recovered ?? (await plan.create(ownerIdempotencyKey));
    this.operations.set(plan.idempotencyKey, { fingerprint: plan.fingerprint, artifact });
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

  await service.applyRenewalAction('license-1', 'org-1', 'user-1', 'renew');
  await service.applyRenewalAction('license-1', 'org-1', 'user-1', 'renew');

  assert.equal(createCalls, 1);
  assert.equal(linkCalls, 1);
  assert.equal(notificationCalls, 1);
  assert.equal(coordinator.plans[0]?.operationType, 'software_license_renewal');
  assert.equal(
    coordinator.plans[0]?.idempotencyKey,
    'license-renewal:license-1:2027-01-01T00:00:00.000Z',
  );
});

test('same-cycle competing renewal intents conflict before creating a second artifact', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  let createCalls = 0;
  const service = new SoftwareLicensesService(
    {} as never,
    { create: async () => {} } as never,
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

  await service.applyRenewalAction('license-1', 'org-1', 'user-1', 'renew');
  await assert.rejects(
    service.applyRenewalAction('license-1', 'org-1', 'user-1', 'renegotiate'),
    (error: unknown) => error instanceof ConflictException,
  );

  assert.equal(createCalls, 1);
  assert.equal(coordinator.plans.length, 2);
  assert.equal(coordinator.plans[0]?.idempotencyKey, coordinator.plans[1]?.idempotencyKey);
});

test('advancing a license renewal date starts a new artifact cycle', async () => {
  const coordinator = new RecordingArtifactCoordinator();
  let createCalls = 0;
  let linkCalls = 0;
  let currentLicense = { ...license };
  const service = new SoftwareLicensesService(
    {} as never,
    { create: async () => {} } as never,
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

  await service.applyRenewalAction('license-1', 'org-1', 'user-1', 'renew');
  currentLicense = { ...currentLicense, renewalDate: new Date('2028-01-01T00:00:00.000Z') };
  await service.applyRenewalAction('license-1', 'org-1', 'user-1', 'renew');

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
