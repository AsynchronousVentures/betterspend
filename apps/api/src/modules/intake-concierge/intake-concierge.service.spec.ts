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
              lines: [{ description: 'Office chair', quantity: 2, unitPrice: 100 }],
            },
            plan: {
              route: { workflow: 'rfq', label: 'RFQ', reason: 'Competitive sourcing applies.' },
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
      service.convertSession('session-1', 'organization-1', 'requester-1', { workflow: 'rfq' }),
    ).resolves.toMatchObject({
      workflow: 'rfq',
      draftId: 'rfq-1',
      url: '/rfq/rfq-1',
    });
    expect(rfqService.create).toHaveBeenCalledWith(
      'organization-1',
      'requester-1',
      expect.objectContaining({ title: 'Office chairs' }),
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
});
