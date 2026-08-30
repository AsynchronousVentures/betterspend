import { ContractsService } from './contracts.service';

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
