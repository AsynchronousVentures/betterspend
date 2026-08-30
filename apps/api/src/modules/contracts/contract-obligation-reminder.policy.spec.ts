import {
  contractObligationReminderIdempotencyKey,
  isContractObligationReminderDue,
  resolveContractObligationOwner,
} from './contract-obligation-reminder.policy';

describe('contract obligation reminder policy', () => {
  const dueDate = new Date('2026-09-30T12:00:00.000Z');

  it('treats the lead-date instant as due and does not fire one millisecond early', () => {
    const leadDate = new Date('2026-09-23T12:00:00.000Z');

    expect(isContractObligationReminderDue(dueDate, 7, leadDate)).toBe(true);
    expect(isContractObligationReminderDue(dueDate, 7, new Date(leadDate.getTime() - 1))).toBe(
      false,
    );
    expect(isContractObligationReminderDue(dueDate, 7, new Date(leadDate.getTime() + 1))).toBe(
      true,
    );
  });

  it('ignores missing or invalid dates and lead windows', () => {
    const now = new Date('2026-09-23T12:00:00.000Z');

    expect(isContractObligationReminderDue(null, 7, now)).toBe(false);
    expect(isContractObligationReminderDue(new Date('invalid'), 7, now)).toBe(false);
    expect(isContractObligationReminderDue(dueDate, Number.NaN, now)).toBe(false);
    expect(isContractObligationReminderDue(dueDate, 7, new Date('invalid'))).toBe(false);
  });

  it('resolves the most specific owner before the contract owner and creator', () => {
    expect(resolveContractObligationOwner('obligation-owner', 'contract-owner', 'creator')).toBe(
      'obligation-owner',
    );
    expect(resolveContractObligationOwner(null, 'contract-owner', 'creator')).toBe(
      'contract-owner',
    );
    expect(resolveContractObligationOwner(undefined, null, 'creator')).toBe('creator');
    expect(resolveContractObligationOwner(null, null, null)).toBeNull();
  });

  it('builds a stable key for an obligation schedule and recipient', () => {
    const key = contractObligationReminderIdempotencyKey(
      'org-1',
      'obligation-1',
      dueDate,
      'user-1',
    );

    expect(key).toBe(
      'contract-obligation-reminder:org-1:obligation-1:2026-09-30T12:00:00.000Z:user-1',
    );
    expect(
      contractObligationReminderIdempotencyKey('org-1', 'obligation-1', dueDate, 'user-1'),
    ).toBe(key);
    expect(
      contractObligationReminderIdempotencyKey(
        'org-1',
        'obligation-1',
        new Date('2026-10-01T12:00:00.000Z'),
        'user-1',
      ),
    ).not.toBe(key);
  });
});
