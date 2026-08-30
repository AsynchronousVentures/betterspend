import { ContractsService } from './contracts.service';

const organizationId = '00000000-0000-4000-8000-000000000001';
const contractId = '00000000-0000-4000-8000-000000000002';
const obligationId = '00000000-0000-4000-8000-000000000003';
const ownerId = '00000000-0000-4000-8000-000000000004';

function selectQuery(rows: unknown[]) {
  return {
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        for: jest.fn().mockResolvedValue(rows),
      }),
    }),
  };
}

describe('ContractsService obligation input validation', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an invalid notification lead day value: %s',
    async (notificationLeadDays) => {
      const transaction = jest.fn();
      const service = new ContractsService(
        { transaction } as never,
        {} as never,
        {} as never,
        {} as never,
      );

      await expect(
        service.updateObligation('contract-1', 'org-1', 'user-1', 'obligation-1', {
          notificationLeadDays,
        } as never),
      ).rejects.toThrow();
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});

it('rejects an obligation owner that is not a user in the contract organization', async () => {
  const lockedContract = {
    id: contractId,
    organizationId,
    vendorId: null,
  };
  const transaction = {
    select: jest
      .fn()
      .mockReturnValueOnce(selectQuery([lockedContract]))
      .mockReturnValueOnce(selectQuery([])),
    update: jest.fn(),
  };
  const db = {
    transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const service = new ContractsService(db as never, {} as never, {} as never, {} as never);

  await expect(
    service.updateObligation(contractId, organizationId, ownerId, obligationId, {
      ownerId,
    }),
  ).rejects.toThrow('obligation owner');
  expect(transaction.update).not.toHaveBeenCalled();
});

it('rejects extraction before persisting obligations when the contract owner is outside the organization', async () => {
  const creatorId = '00000000-0000-4000-8000-000000000005';
  const lockedContract = {
    id: contractId,
    organizationId,
    vendorId: null,
    ownerId,
    createdBy: creatorId,
    title: 'Supplier agreement',
    description: null,
    internalNotes: null,
    terms: null,
    type: 'service',
    endDate: null,
    autoRenew: false,
    renewalNoticeDays: 30,
    clauses: [],
    obligations: [],
    extractions: [],
    lines: [],
    amendments: [],
    vendor: null,
    owner: null,
    createdByUser: null,
    softwareLicenses: [],
  };
  const insert = jest.fn();
  const transaction = {
    select: jest
      .fn()
      .mockReturnValueOnce(selectQuery([lockedContract]))
      .mockReturnValueOnce(selectQuery([])),
    insert,
  };
  const db = {
    query: {
      contracts: {
        findFirst: jest.fn().mockResolvedValue(lockedContract),
      },
    },
    transaction: jest.fn(async (callback: (tx: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  };
  const service = new ContractsService(db as never, {} as never, {} as never, {} as never);

  await expect(
    service.processIntelligence(contractId, organizationId, creatorId, {
      documentText: 'The supplier must provide a certificate of insurance.',
    }),
  ).rejects.toThrow('obligation owner');
  expect(insert).not.toHaveBeenCalled();
});
