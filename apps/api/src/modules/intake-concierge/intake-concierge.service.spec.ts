import { IntakeConciergeService } from './intake-concierge.service';

describe('IntakeConciergeService workflow links', () => {
  it('returns the canonical RFQ route after creating an RFQ draft', async () => {
    const update = jest.fn(() => ({
      set: jest.fn(() => ({ where: jest.fn(async () => undefined) })),
    }));
    const db = {
      query: {
        intakeConciergeSessions: {
          findFirst: jest.fn(async () => ({
            id: 'session-1',
            status: 'draft',
            draft: {
              title: 'Office chairs',
              neededBy: '2026-10-01',
              suggestedVendor: 'Acme Office',
              lines: [{ description: 'Office chair', quantity: 2, unitPrice: 100 }],
            },
            plan: {
              route: { workflow: 'rfq', label: 'RFQ', reason: 'Competitive sourcing applies.' },
              estimatedAmount: 200,
              preferredVendors: [],
            },
          })),
        },
      },
      update,
    };
    const rfqService = {
      create: jest.fn(async () => ({ id: 'rfq-1' })),
    };
    const audit = { log: jest.fn(async () => undefined) };
    const service = new IntakeConciergeService(
      db as never,
      {} as never,
      {} as never,
      rfqService as never,
      audit as never,
    );

    await expect(
      service.convertSession('session-1', 'organization-1', 'requester-1', {
        workflow: 'rfq',
        acceptedValues: {
          departmentId: '00000000-0000-4000-8000-000000000001',
          supplierShortlist: ['00000000-0000-4000-8000-000000000002'],
        },
      }),
    ).resolves.toMatchObject({
      workflow: 'rfq',
      draftId: 'rfq-1',
      url: '/rfq/rfq-1',
    });
    expect(rfqService.create).toHaveBeenCalledWith(
      'organization-1',
      'requester-1',
      expect.objectContaining({
        title: 'Office chairs',
        vendorIds: ['00000000-0000-4000-8000-000000000002'],
      }),
    );
    expect(update).toHaveBeenCalled();
  });

  it('does not create a guided draft while routing questions remain', async () => {
    const db = {
      query: {
        intakeConciergeSessions: {
          findFirst: jest.fn(async () => ({
            id: 'session-1',
            status: 'draft',
            draft: { title: 'Office chairs', lines: [] },
            plan: {
              route: { workflow: 'requisition', label: 'Requisition', reason: 'Default route.' },
              missingFields: ['neededBy'],
              questions: [
                {
                  field: 'neededBy',
                  prompt: 'When do you need this by?',
                  reason: 'Required to finalize routing.',
                },
              ],
            },
          })),
        },
      },
    };
    const service = new IntakeConciergeService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.convertSession('session-1', 'organization-1', 'requester-1', {
        workflow: 'requisition',
      }),
    ).rejects.toThrow('Answer the routing questions before creating a guided draft.');
  });

  it('converts when the caller supplies each required routing value', async () => {
    const update = jest.fn(() => ({
      set: jest.fn(() => ({ where: jest.fn(async () => undefined) })),
    }));
    const db = {
      query: {
        intakeConciergeSessions: {
          findFirst: jest.fn(async () => ({
            id: 'session-1',
            status: 'draft',
            draft: {
              title: 'Office chairs',
              neededBy: '2026-10-01',
              suggestedVendor: 'Acme Office',
              lines: [{ description: 'Office chair', quantity: 2, unitPrice: 100 }],
            },
            plan: {
              route: { workflow: 'requisition', label: 'Requisition', reason: 'Default route.' },
              estimatedAmount: 200,
              missingFields: ['departmentOrProject'],
              questions: [
                {
                  field: 'departmentOrProject',
                  prompt: 'Which department or project should own the spend?',
                  reason: 'Required to finalize routing.',
                },
              ],
            },
          })),
        },
      },
      update,
    };
    const requisitionsService = { create: jest.fn(async () => ({ id: 'req-1' })) };
    const audit = { log: jest.fn(async () => undefined) };
    const service = new IntakeConciergeService(
      db as never,
      {} as never,
      requisitionsService as never,
      {} as never,
      audit as never,
    );

    await expect(
      service.convertSession('session-1', 'organization-1', 'requester-1', {
        workflow: 'requisition',
        acceptedValues: { departmentId: '00000000-0000-4000-8000-000000000001' },
      }),
    ).resolves.toMatchObject({ draftId: 'req-1', workflow: 'requisition' });
    expect(requisitionsService.create).toHaveBeenCalledWith(
      'organization-1',
      'requester-1',
      expect.objectContaining({ departmentId: '00000000-0000-4000-8000-000000000001' }),
    );
  });

  it('requires the selected workflow fields when a caller overrides the planned route', async () => {
    const db = {
      query: {
        intakeConciergeSessions: {
          findFirst: jest.fn(async () => ({
            id: 'session-1',
            status: 'draft',
            draft: {
              title: 'Office chairs',
              neededBy: '2026-10-01',
              suggestedVendor: 'Acme Office',
              lines: [{ description: 'Office chair', quantity: 2, unitPrice: 100 }],
            },
            plan: {
              route: { workflow: 'requisition', label: 'Requisition', reason: 'Default route.' },
              estimatedAmount: 200,
              missingFields: [],
              questions: [],
            },
          })),
        },
      },
    };
    const service = new IntakeConciergeService(
      db as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.convertSession('session-1', 'organization-1', 'requester-1', {
        workflow: 'rfq',
        acceptedValues: { departmentId: '00000000-0000-4000-8000-000000000001' },
      }),
    ).rejects.toThrow('Answer the routing questions before creating a guided draft.');
  });

  it('rejects routing values that cannot be applied to the conversion', async () => {
    const db = {
      query: {
        intakeConciergeSessions: {
          findFirst: jest.fn(async () => ({
            id: 'session-1',
            status: 'draft',
            draft: {
              title: 'Office chairs',
              neededBy: '2026-10-01',
              suggestedVendor: 'Acme Office',
              lines: [{ description: 'Office chair', quantity: 2, unitPrice: 100 }],
            },
            plan: {
              route: { workflow: 'requisition', label: 'Requisition', reason: 'Default route.' },
              estimatedAmount: 200,
              missingFields: ['departmentOrProject'],
              questions: [],
            },
          })),
        },
      },
    };
    const requisitionsService = { create: jest.fn() };
    const service = new IntakeConciergeService(
      db as never,
      {} as never,
      requisitionsService as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.convertSession('session-1', 'organization-1', 'requester-1', {
        acceptedValues: { departmentOrProject: {} },
      }),
    ).rejects.toThrow('Routing answers are invalid.');
    expect(requisitionsService.create).not.toHaveBeenCalled();
  });
});
