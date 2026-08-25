import type { PgTable } from 'drizzle-orm/pg-core';
import { and, count, eq, like, sql } from 'drizzle-orm';
import { db, type DbTransaction } from './client';
import { DEMO_ORG_ID, upsertDemoFixtures } from './demo-fixtures';
import { materializeEmailIntakeTokens, materializeWebhookSecrets } from './random-seed-secrets';
import {
  approvalActions,
  approvalDelegations,
  approvalRequests,
  approvalRuleSteps,
  approvalRules,
  auditLog,
  budgetCommitmentEvents,
  budgetPeriods,
  budgets,
  blanketReleases,
  catalogItems,
  catalogPriceProposals,
  contractAmendments,
  contractClauses,
  contractExtractions,
  contractLines,
  contractObligations,
  contracts,
  departments,
  documents,
  emailIntakeAddresses,
  emailIntakeAttachments,
  emailIntakeItems,
  emailIntakeMessages,
  exchangeRates,
  glExportJobs,
  glMappings,
  goodsReceiptLines,
  goodsReceipts,
  integrationConnections,
  intakeConciergeSessions,
  inventoryItems,
  inventoryMovements,
  invoiceLines,
  invoices,
  legalEntities,
  matchResults,
  messages,
  notificationPreferences,
  notifications,
  ocrJobs,
  onboardingQuestionnaires,
  paymentRunEvents,
  paymentRunInvoices,
  paymentRuns,
  poLines,
  poVersions,
  procurementPolicies,
  projects,
  purchaseOrders,
  recurringPos,
  requisitionLines,
  requisitionTemplates,
  requisitions,
  rfqInvitations,
  rfqLines,
  rfqRequests,
  rfqResponseLines,
  rfqResponses,
  sanctionsScreenings,
  softwareLicenses,
  spendGuardAlerts,
  syncRecords,
  systemSettings,
  taxCodes,
  userRoles,
  users,
  vendorOnboardingSubmissions,
  vendorPaymentAccounts,
  vendorVirtualCards,
  vendors,
  webhookDeliveries,
  webhookEndpoints,
} from './schema';
import {
  assertRandomSeedCountMatches,
  assertRandomSeedMetadataMatches,
  encodeRandomSeedMetadata,
  generateRandomSeedDataset,
  randomSeedMetadataKey,
  randomSeedRequisitionPrefix,
  stableUuid,
  type RandomSeedDataset,
} from './random-seed';

const BATCH_SIZE = 200;

export function assertRandomSeedAllowed(nodeEnv = process.env.NODE_ENV): void {
  if (nodeEnv === 'production') {
    throw new Error('Random workload seeding is disabled when NODE_ENV=production.');
  }
}

async function insertBatches<T extends PgTable>(
  tx: DbTransaction,
  table: T,
  values: readonly T['$inferInsert'][] | undefined,
): Promise<void> {
  if (!values?.length) return;
  for (let offset = 0; offset < values.length; offset += BATCH_SIZE) {
    const batch = values.slice(offset, offset + BATCH_SIZE);
    await tx.insert(table).values(batch).onConflictDoNothing();
  }
}

async function countExistingSeedRequisitions(tx: DbTransaction, seed: string): Promise<number> {
  const [result] = await tx
    .select({ count: count() })
    .from(requisitions)
    .where(
      and(
        eq(requisitions.organizationId, DEMO_ORG_ID),
        like(requisitions.number, `${randomSeedRequisitionPrefix(seed)}%`),
      ),
    );
  return result?.count ?? 0;
}

/** Persist a generated graph in foreign-key order inside one transaction. */
export async function persistRandomSeed(
  options: Parameters<typeof generateRandomSeedDataset>[0],
): Promise<RandomSeedDataset['summary']> {
  assertRandomSeedAllowed();
  const dataset = generateRandomSeedDataset(options);

  await db.transaction(async (tx) => {
    const metadataKey = randomSeedMetadataKey(options.seed);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${metadataKey}, 0))`);
    let needsMetadata = false;
    const [metadata] = await tx
      .select({ value: systemSettings.value })
      .from(systemSettings)
      .where(
        and(eq(systemSettings.organizationId, DEMO_ORG_ID), eq(systemSettings.key, metadataKey)),
      );
    if (metadata) {
      assertRandomSeedMetadataMatches(options.seed, options.count, metadata.value);
    } else {
      const existingCount = await countExistingSeedRequisitions(tx, options.seed);
      assertRandomSeedCountMatches(options.seed, options.count, existingCount);
      needsMetadata = true;
    }

    await upsertDemoFixtures(tx);
    if (needsMetadata) {
      await tx
        .insert(systemSettings)
        .values({
          id: stableUuid(options.seed, 'seed-metadata', 0),
          organizationId: DEMO_ORG_ID,
          key: metadataKey,
          value: encodeRandomSeedMetadata(options.count),
        })
        .onConflictDoNothing();
    }

    await insertBatches(tx, legalEntities, dataset.legalEntities);
    await insertBatches(tx, departments, dataset.departments);
    await insertBatches(tx, projects, dataset.projects);
    await insertBatches(tx, users, dataset.users);
    await insertBatches(tx, userRoles, dataset.userRoles);
    await insertBatches(tx, vendors, dataset.vendors);
    await insertBatches(tx, catalogItems, dataset.catalogItems);
    await insertBatches(tx, taxCodes, dataset.taxCodes);
    await insertBatches(tx, exchangeRates, dataset.exchangeRates);
    await insertBatches(tx, budgets, dataset.budgets);
    await insertBatches(tx, budgetPeriods, dataset.budgetPeriods);
    await insertBatches(tx, approvalRules, dataset.approvalRules);
    await insertBatches(tx, approvalRuleSteps, dataset.approvalRuleSteps);
    await insertBatches(tx, contracts, dataset.contracts);
    await insertBatches(tx, contractLines, dataset.contractLines);
    await insertBatches(tx, contractAmendments, dataset.contractAmendments);
    await insertBatches(tx, documents, dataset.documents);
    await insertBatches(tx, contractExtractions, dataset.contractExtractions);
    await insertBatches(tx, contractClauses, dataset.contractClauses);
    await insertBatches(tx, contractObligations, dataset.contractObligations);
    await insertBatches(tx, requisitions, dataset.requisitions);
    await insertBatches(tx, requisitionLines, dataset.requisitionLines);
    await insertBatches(tx, approvalRequests, dataset.approvalRequests);
    await insertBatches(tx, approvalActions, dataset.approvalActions);
    await insertBatches(tx, auditLog, dataset.auditLog);
    await insertBatches(tx, purchaseOrders, dataset.purchaseOrders);
    await insertBatches(tx, poLines, dataset.poLines);
    await insertBatches(tx, poVersions, dataset.poVersions);
    await insertBatches(tx, blanketReleases, dataset.blanketReleases);
    await insertBatches(tx, goodsReceipts, dataset.goodsReceipts);
    await insertBatches(tx, goodsReceiptLines, dataset.goodsReceiptLines);
    await insertBatches(tx, invoices, dataset.invoices);
    await insertBatches(tx, invoiceLines, dataset.invoiceLines);
    await insertBatches(tx, matchResults, dataset.matchResults);
    await insertBatches(tx, budgetCommitmentEvents, dataset.budgetCommitmentEvents);
    await insertBatches(tx, rfqRequests, dataset.rfqRequests);
    await insertBatches(tx, rfqLines, dataset.rfqLines);
    await insertBatches(tx, rfqInvitations, dataset.rfqInvitations);
    await insertBatches(tx, rfqResponses, dataset.rfqResponses);
    await insertBatches(tx, rfqResponseLines, dataset.rfqResponseLines);
    await insertBatches(tx, recurringPos, dataset.recurringPos);
    await insertBatches(tx, inventoryItems, dataset.inventoryItems);
    await insertBatches(tx, inventoryMovements, dataset.inventoryMovements);
    await insertBatches(tx, requisitionTemplates, dataset.requisitionTemplates);
    await insertBatches(tx, paymentRuns, dataset.paymentRuns);
    await insertBatches(tx, paymentRunInvoices, dataset.paymentRunInvoices);
    await insertBatches(tx, paymentRunEvents, dataset.paymentRunEvents);
    await insertBatches(tx, vendorPaymentAccounts, dataset.vendorPaymentAccounts);
    await insertBatches(tx, vendorVirtualCards, dataset.vendorVirtualCards);
    await insertBatches(tx, catalogPriceProposals, dataset.catalogPriceProposals);
    await insertBatches(tx, softwareLicenses, dataset.softwareLicenses);
    await insertBatches(tx, spendGuardAlerts, dataset.spendGuardAlerts);
    await insertBatches(tx, webhookEndpoints, materializeWebhookSecrets(dataset.webhookEndpoints));
    await insertBatches(tx, webhookDeliveries, dataset.webhookDeliveries);
    await insertBatches(tx, glMappings, dataset.glMappings);
    await insertBatches(tx, glExportJobs, dataset.glExportJobs);
    await insertBatches(tx, notificationPreferences, dataset.notificationPreferences);
    await insertBatches(tx, notifications, dataset.notifications);
    await insertBatches(tx, messages, dataset.messages);
    await insertBatches(tx, ocrJobs, dataset.ocrJobs);
    await insertBatches(
      tx,
      emailIntakeAddresses,
      materializeEmailIntakeTokens(dataset.emailIntakeAddresses),
    );
    await insertBatches(tx, emailIntakeItems, dataset.emailIntakeItems);
    await insertBatches(tx, emailIntakeMessages, dataset.emailIntakeMessages);
    await insertBatches(tx, emailIntakeAttachments, dataset.emailIntakeAttachments);
    await insertBatches(tx, procurementPolicies, dataset.procurementPolicies);
    await insertBatches(tx, intakeConciergeSessions, dataset.intakeConciergeSessions);
    await insertBatches(tx, onboardingQuestionnaires, dataset.onboardingQuestionnaires);
    await insertBatches(tx, vendorOnboardingSubmissions, dataset.vendorOnboardingSubmissions);
    await insertBatches(tx, sanctionsScreenings, dataset.sanctionsScreenings);
    await insertBatches(tx, integrationConnections, dataset.integrationConnections);
    await insertBatches(tx, syncRecords, dataset.syncRecords);
    await insertBatches(tx, approvalDelegations, dataset.approvalDelegations);
  });

  return dataset.summary;
}

export async function seedRandomWorkload(
  options: Parameters<typeof generateRandomSeedDataset>[0],
): Promise<RandomSeedDataset['summary']> {
  const summary = await persistRandomSeed(options);
  const domains = Object.entries(summary)
    .filter(([, count]) => count > 0)
    .map(([domain, count]) => `${domain}=${count}`)
    .join(', ');
  console.log(
    `Random seed complete for ${options.count} workload stories (seed "${options.seed}").`,
  );
  console.log(`Rows inserted or already present: ${domains}`);
  return summary;
}
