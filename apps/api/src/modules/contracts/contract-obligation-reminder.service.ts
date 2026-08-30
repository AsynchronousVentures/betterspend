import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, aliasedTable, eq, isNotNull, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Db } from '@betterspend/db';
import { contractObligations, contracts, users } from '@betterspend/db';
import { DB_TOKEN } from '../../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { CONTRACT_OBLIGATION_REMINDER_QUEUE_NAME } from '../../common/contract-obligation-reminder-queue';
import {
  CONTRACT_OBLIGATION_REMINDER_ATTEMPTS,
  CONTRACT_OBLIGATION_REMINDER_INTERVAL_MS,
  CONTRACT_OBLIGATION_REMINDER_JOB_ID,
  CONTRACT_OBLIGATION_REMINDER_JOB_NAME,
  CONTRACT_OBLIGATION_REMINDER_TYPE,
  contractObligationReminderIdempotencyKey,
  contractObligationReminderTitle,
  isContractObligationReminderDue,
  resolveContractObligationOwner,
} from './contract-obligation-reminder.policy';

const SCHEDULE_RECOVERY_INTERVAL_MS = 60_000;

type ReminderScanScope = { organizationId?: string; contractId?: string };

const obligationOwner = aliasedTable(users, 'contract_obligation_owner');
const contractOwner = aliasedTable(users, 'contract_owner');
const contractCreator = aliasedTable(users, 'contract_creator');

export type ContractObligationReminderScanResult = {
  scanned: number;
  notified: number;
};

@Injectable()
export class ContractObligationReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContractObligationReminderService.name);
  private scheduleRecoveryTimer?: ReturnType<typeof setInterval>;
  private scheduleRecoveryRunning = false;

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(CONTRACT_OBLIGATION_REMINDER_QUEUE_NAME)
    private readonly reminderQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.recoverSchedule();
  }

  onModuleDestroy(): void {
    if (!this.scheduleRecoveryTimer) return;
    clearInterval(this.scheduleRecoveryTimer);
    this.scheduleRecoveryTimer = undefined;
  }

  async scanAndNotifyDueObligations(
    now = new Date(),
    scope: ReminderScanScope = {},
  ): Promise<ContractObligationReminderScanResult> {
    const candidates = await this.findReminderCandidates(now, scope);
    let notified = 0;

    for (const candidate of candidates) {
      if (
        candidate.organizationId !== candidate.contractOrganizationId ||
        candidate.status !== 'open' ||
        !isContractObligationReminderDue(candidate.dueDate, candidate.notificationLeadDays, now)
      ) {
        continue;
      }

      const ownerId = resolveContractObligationOwner(
        this.organizationScopedOwnerId(
          candidate.obligationOwnerId,
          candidate.obligationOwnerOrganizationId,
          candidate.organizationId,
        ),
        this.organizationScopedOwnerId(
          candidate.contractOwnerId,
          candidate.contractOwnerOrganizationId,
          candidate.organizationId,
        ),
        this.organizationScopedOwnerId(
          candidate.createdById,
          candidate.createdByOrganizationId,
          candidate.organizationId,
        ),
      );
      if (!ownerId || !candidate.dueDate) continue;

      await this.notificationsService.createIdempotent(
        contractObligationReminderIdempotencyKey(
          candidate.organizationId,
          candidate.obligationId,
          candidate.dueDate,
          ownerId,
        ),
        candidate.organizationId,
        ownerId,
        CONTRACT_OBLIGATION_REMINDER_TYPE,
        contractObligationReminderTitle(candidate.obligationTitle),
        `${candidate.contractTitle}: ${candidate.obligationDescription ?? candidate.obligationTitle}`,
        'contract',
        candidate.contractId,
      );
      notified += 1;
    }

    return { scanned: candidates.length, notified };
  }

  private async recoverSchedule(): Promise<void> {
    if (this.scheduleRecoveryRunning) return;
    this.scheduleRecoveryRunning = true;
    try {
      await this.reminderQueue.add(
        CONTRACT_OBLIGATION_REMINDER_JOB_NAME,
        {},
        {
          jobId: CONTRACT_OBLIGATION_REMINDER_JOB_ID,
          attempts: CONTRACT_OBLIGATION_REMINDER_ATTEMPTS,
          backoff: { type: 'exponential', delay: 60_000 },
          repeat: {
            every: CONTRACT_OBLIGATION_REMINDER_INTERVAL_MS,
            key: CONTRACT_OBLIGATION_REMINDER_JOB_ID,
          },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
      this.stopScheduleRecovery();
    } catch (error: unknown) {
      this.logger.warn(
        `Unable to register contract obligation reminder schedule: ${String(error)}`,
      );
      this.startScheduleRecovery();
    } finally {
      this.scheduleRecoveryRunning = false;
    }
  }

  private startScheduleRecovery(): void {
    if (this.scheduleRecoveryTimer) return;
    this.scheduleRecoveryTimer = setInterval(() => {
      void this.recoverSchedule();
    }, SCHEDULE_RECOVERY_INTERVAL_MS);
    this.scheduleRecoveryTimer.unref();
  }

  private stopScheduleRecovery(): void {
    if (!this.scheduleRecoveryTimer) return;
    clearInterval(this.scheduleRecoveryTimer);
    this.scheduleRecoveryTimer = undefined;
  }

  private async findReminderCandidates(now: Date, scope: ReminderScanScope) {
    const conditions = [
      eq(contractObligations.status, 'open'),
      isNotNull(contractObligations.dueDate),
      sql`${contractObligations.dueDate} <= ${now} + ${contractObligations.notificationLeadDays} * interval '1 day'`,
    ];
    if (scope.organizationId) {
      conditions.push(eq(contractObligations.organizationId, scope.organizationId));
    }
    if (scope.contractId) {
      conditions.push(eq(contractObligations.contractId, scope.contractId));
    }

    return this.db
      .select({
        organizationId: contractObligations.organizationId,
        contractOrganizationId: contracts.organizationId,
        obligationId: contractObligations.id,
        contractId: contracts.id,
        contractTitle: contracts.title,
        obligationTitle: contractObligations.title,
        obligationDescription: contractObligations.description,
        status: contractObligations.status,
        dueDate: contractObligations.dueDate,
        notificationLeadDays: contractObligations.notificationLeadDays,
        obligationOwnerId: obligationOwner.id,
        obligationOwnerOrganizationId: obligationOwner.organizationId,
        contractOwnerId: contractOwner.id,
        contractOwnerOrganizationId: contractOwner.organizationId,
        createdById: contractCreator.id,
        createdByOrganizationId: contractCreator.organizationId,
      })
      .from(contractObligations)
      .innerJoin(
        contracts,
        and(
          eq(contractObligations.contractId, contracts.id),
          eq(contractObligations.organizationId, contracts.organizationId),
        ),
      )
      .leftJoin(
        obligationOwner,
        and(
          eq(obligationOwner.id, contractObligations.ownerId),
          eq(obligationOwner.organizationId, contractObligations.organizationId),
          eq(obligationOwner.isActive, true),
        ),
      )
      .leftJoin(
        contractOwner,
        and(
          eq(contractOwner.id, contracts.ownerId),
          eq(contractOwner.organizationId, contracts.organizationId),
          eq(contractOwner.isActive, true),
        ),
      )
      .leftJoin(
        contractCreator,
        and(
          eq(contractCreator.id, contracts.createdBy),
          eq(contractCreator.organizationId, contracts.organizationId),
          eq(contractCreator.isActive, true),
        ),
      )
      .where(and(...conditions));
  }

  private organizationScopedOwnerId(
    ownerId: string | null,
    ownerOrganizationId: string | null,
    organizationId: string,
  ) {
    return ownerId && ownerOrganizationId === organizationId ? ownerId : null;
  }
}
