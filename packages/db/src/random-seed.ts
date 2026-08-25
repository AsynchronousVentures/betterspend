import { createHash } from 'node:crypto';
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
  intakeConciergeSessions,
  integrationConnections,
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
  taxCodes,
  userRoles,
  users,
  vendorOnboardingSubmissions,
  vendorPaymentAccounts,
  vendorVirtualCards,
  vendors,
  webhookDeliveries,
  webhookEndpoints,
  purchaseOrders,
} from './schema';
import {
  DEMO_ADMIN_ID,
  DEMO_APPROVER_ID,
  DEMO_ENG_DEPT_ID,
  DEMO_ORG_ID,
  DEMO_REQUESTER_ID,
  DEMO_VENDOR_IDS,
} from './demo-fixtures';

export const DEFAULT_RANDOM_COUNT = 500;
export const DEFAULT_RANDOM_SEED = 'betterspend-demo-2026';
export const MIN_RANDOM_COUNT = 1;
export const MAX_RANDOM_COUNT = 5_000;

export interface RandomSeedOptions {
  count: number;
  seed: string;
}

export interface RandomSeedCliOptions extends RandomSeedOptions {
  help?: boolean;
}

type InsertRow<T> = T extends { $inferInsert: infer R } ? R : never;
type WebhookEndpointSeedRow = Omit<InsertRow<typeof webhookEndpoints>, 'secret'>;

type Rows = {
  legalEntities: Array<InsertRow<typeof legalEntities>>;
  departments: Array<InsertRow<typeof departments>>;
  projects: Array<InsertRow<typeof projects>>;
  users: Array<InsertRow<typeof users>>;
  userRoles: Array<InsertRow<typeof userRoles>>;
  vendors: Array<InsertRow<typeof vendors>>;
  catalogItems: Array<InsertRow<typeof catalogItems>>;
  taxCodes: Array<InsertRow<typeof taxCodes>>;
  exchangeRates: Array<InsertRow<typeof exchangeRates>>;
  budgets: Array<InsertRow<typeof budgets>>;
  budgetPeriods: Array<InsertRow<typeof budgetPeriods>>;
  budgetCommitmentEvents: Array<InsertRow<typeof budgetCommitmentEvents>>;
  approvalRules: Array<InsertRow<typeof approvalRules>>;
  approvalRuleSteps: Array<InsertRow<typeof approvalRuleSteps>>;
  approvalRequests: Array<InsertRow<typeof approvalRequests>>;
  approvalActions: Array<InsertRow<typeof approvalActions>>;
  requisitions: Array<InsertRow<typeof requisitions>>;
  requisitionLines: Array<InsertRow<typeof requisitionLines>>;
  contracts: Array<InsertRow<typeof contracts>>;
  contractLines: Array<InsertRow<typeof contractLines>>;
  contractAmendments: Array<InsertRow<typeof contractAmendments>>;
  contractExtractions: Array<InsertRow<typeof contractExtractions>>;
  contractClauses: Array<InsertRow<typeof contractClauses>>;
  contractObligations: Array<InsertRow<typeof contractObligations>>;
  documents: Array<InsertRow<typeof documents>>;
  ocrJobs: Array<InsertRow<typeof ocrJobs>>;
  purchaseOrders: Array<InsertRow<typeof purchaseOrders>>;
  poLines: Array<InsertRow<typeof poLines>>;
  poVersions: Array<InsertRow<typeof poVersions>>;
  blanketReleases: Array<InsertRow<typeof blanketReleases>>;
  goodsReceipts: Array<InsertRow<typeof goodsReceipts>>;
  goodsReceiptLines: Array<InsertRow<typeof goodsReceiptLines>>;
  invoices: Array<InsertRow<typeof invoices>>;
  invoiceLines: Array<InsertRow<typeof invoiceLines>>;
  matchResults: Array<InsertRow<typeof matchResults>>;
  rfqRequests: Array<InsertRow<typeof rfqRequests>>;
  rfqLines: Array<InsertRow<typeof rfqLines>>;
  rfqInvitations: Array<InsertRow<typeof rfqInvitations>>;
  rfqResponses: Array<InsertRow<typeof rfqResponses>>;
  rfqResponseLines: Array<InsertRow<typeof rfqResponseLines>>;
  recurringPos: Array<InsertRow<typeof recurringPos>>;
  inventoryItems: Array<InsertRow<typeof inventoryItems>>;
  inventoryMovements: Array<InsertRow<typeof inventoryMovements>>;
  requisitionTemplates: Array<InsertRow<typeof requisitionTemplates>>;
  paymentRuns: Array<InsertRow<typeof paymentRuns>>;
  paymentRunInvoices: Array<InsertRow<typeof paymentRunInvoices>>;
  paymentRunEvents: Array<InsertRow<typeof paymentRunEvents>>;
  vendorPaymentAccounts: Array<InsertRow<typeof vendorPaymentAccounts>>;
  vendorVirtualCards: Array<InsertRow<typeof vendorVirtualCards>>;
  catalogPriceProposals: Array<InsertRow<typeof catalogPriceProposals>>;
  softwareLicenses: Array<InsertRow<typeof softwareLicenses>>;
  spendGuardAlerts: Array<InsertRow<typeof spendGuardAlerts>>;
  webhookEndpoints: Array<WebhookEndpointSeedRow>;
  webhookDeliveries: Array<InsertRow<typeof webhookDeliveries>>;
  glMappings: Array<InsertRow<typeof glMappings>>;
  glExportJobs: Array<InsertRow<typeof glExportJobs>>;
  notificationPreferences: Array<InsertRow<typeof notificationPreferences>>;
  notifications: Array<InsertRow<typeof notifications>>;
  messages: Array<InsertRow<typeof messages>>;
  emailIntakeAddresses: Array<InsertRow<typeof emailIntakeAddresses>>;
  emailIntakeItems: Array<InsertRow<typeof emailIntakeItems>>;
  emailIntakeMessages: Array<InsertRow<typeof emailIntakeMessages>>;
  emailIntakeAttachments: Array<InsertRow<typeof emailIntakeAttachments>>;
  procurementPolicies: Array<InsertRow<typeof procurementPolicies>>;
  intakeConciergeSessions: Array<InsertRow<typeof intakeConciergeSessions>>;
  onboardingQuestionnaires: Array<InsertRow<typeof onboardingQuestionnaires>>;
  vendorOnboardingSubmissions: Array<InsertRow<typeof vendorOnboardingSubmissions>>;
  sanctionsScreenings: Array<InsertRow<typeof sanctionsScreenings>>;
  integrationConnections: Array<InsertRow<typeof integrationConnections>>;
  syncRecords: Array<InsertRow<typeof syncRecords>>;
  approvalDelegations: Array<InsertRow<typeof approvalDelegations>>;
  auditLog: Array<InsertRow<typeof auditLog>>;
};

export interface RandomSeedDataset extends Rows {
  options: RandomSeedOptions;
  summary: Record<keyof Rows, number>;
}

export const RANDOM_SEED_COVERAGE = {
  included: [
    'fixed Acme organization and legal entities, departments, projects, users, scoped roles',
    'vendors, catalog, onboarding, tax codes, exchange rates, sanctions screenings',
    'requisitions, approval rules/steps/requests/actions, purchase orders, receipts, invoices, matching',
    'budgets, periods, commitment events, RFQs, contracts, inventory, recurring POs, templates',
    'payments, GL mappings/export jobs, documents/OCR metadata, notifications/preferences, messages',
    'email intake metadata, procurement policies/concierge sessions, spend alerts, licenses, price proposals',
    'disabled webhooks/deliveries and revoked integration sync metadata',
  ],
  excluded: [
    'auth sessions, accounts, verifications, password reset tokens',
    'vendor portal tokens/sessions, AI credentials/OAuth state, workflow runtime rows',
    'active integrations, real secrets, network endpoints, sanctions registry state/entries',
  ],
} as const;

const ANCHOR_MS = Date.UTC(2026, 7, 25, 12, 0, 0);
const DAY_MS = 86_400_000;

export function parseRandomSeedArgs(argv: readonly string[]): RandomSeedCliOptions {
  let count = DEFAULT_RANDOM_COUNT;
  let seed = DEFAULT_RANDOM_SEED;
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') {
      help = true;
      continue;
    }
    const [flag, inlineValue] = argument.split('=', 2);
    if (flag !== '--count' && flag !== '--seed') {
      throw new Error(`Unknown option "${argument}". Use --count and --seed.`);
    }
    const value = inlineValue ?? argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
    if (flag === '--count') {
      if (!/^\d+$/.test(value)) throw new Error('--count must be a positive integer.');
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < MIN_RANDOM_COUNT || parsed > MAX_RANDOM_COUNT) {
        throw new Error(`--count must be between ${MIN_RANDOM_COUNT} and ${MAX_RANDOM_COUNT}.`);
      }
      count = parsed;
    } else {
      if (value.length > 120) throw new Error('--seed must be at most 120 characters.');
      seed = value;
    }
  }
  return { count, seed, help };
}

export function stableUuid(seed: string, kind: string, index: number): string {
  const digest = createHash('sha256').update(`${seed}\0${kind}\0${index}`).digest('hex');
  const variant = ['8', '9', 'a', 'b'][Number.parseInt(digest[16] ?? '8', 16) % 4];
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}

export function stableSeedToken(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 8);
}

export function randomSeedRequisitionPrefix(seed: string): string {
  return `REQ-${stableSeedToken(seed).toUpperCase()}-`;
}

export function stableBusinessNumber(seed: string, prefix: string, index: number): string {
  const token = stableSeedToken(seed).toUpperCase();
  return `${prefix}-${token}-${String(index + 1).padStart(6, '0')}`;
}

export function assertRandomSeedCountMatches(
  seed: string,
  requestedCount: number,
  existingCount: number,
): void {
  if (existingCount > 0 && existingCount !== requestedCount) {
    throw new Error(
      `Seed "${seed}" already has ${existingCount} generated requisitions in the Acme demo organization; requested ${requestedCount}. Reuse --count ${existingCount} or choose a new --seed.`,
    );
  }
}

export function stableDate(
  seed: string,
  kind: string,
  index: number,
  minDays: number,
  maxDays: number,
): Date {
  const digest = createHash('sha256').update(`${seed}\0${kind}\0${index}`).digest();
  const fraction = digest.readUInt32BE(0) / 0xffffffff;
  const days = Math.floor(minDays + fraction * (maxDays - minDays + 1));
  return new Date(ANCHOR_MS + days * DAY_MS);
}

function value(seed: string, kind: string, index: number): number {
  const digest = createHash('sha256').update(`${seed}\0${kind}\0${index}`).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

/** Return a deterministic date offset from a lifecycle milestone. */
function dateAfter(
  base: Date,
  seed: string,
  kind: string,
  index: number,
  minDays: number,
  maxDays: number,
): Date {
  const days = Math.floor(minDays + value(seed, kind, index) * (maxDays - minDays + 1));
  return new Date(base.getTime() + days * DAY_MS);
}

function choose<T>(items: readonly T[], seed: string, kind: string, index: number): T {
  return items[Math.floor(value(seed, kind, index) * items.length)] as T;
}

function money(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function currencyAt(index: number): string {
  return index % 11 === 0 ? 'GBP' : index % 5 === 0 ? 'EUR' : 'USD';
}

function fx(currency: string): number {
  return currency === 'GBP' ? 1.27 : currency === 'EUR' ? 1.09 : 1;
}

function emptyRows(): Rows {
  return {
    legalEntities: [],
    departments: [],
    projects: [],
    users: [],
    userRoles: [],
    vendors: [],
    catalogItems: [],
    taxCodes: [],
    exchangeRates: [],
    budgets: [],
    budgetPeriods: [],
    budgetCommitmentEvents: [],
    approvalRules: [],
    approvalRuleSteps: [],
    approvalRequests: [],
    approvalActions: [],
    requisitions: [],
    requisitionLines: [],
    contracts: [],
    contractLines: [],
    contractAmendments: [],
    contractExtractions: [],
    contractClauses: [],
    contractObligations: [],
    documents: [],
    ocrJobs: [],
    purchaseOrders: [],
    poLines: [],
    poVersions: [],
    blanketReleases: [],
    goodsReceipts: [],
    goodsReceiptLines: [],
    invoices: [],
    invoiceLines: [],
    matchResults: [],
    rfqRequests: [],
    rfqLines: [],
    rfqInvitations: [],
    rfqResponses: [],
    rfqResponseLines: [],
    recurringPos: [],
    inventoryItems: [],
    inventoryMovements: [],
    requisitionTemplates: [],
    paymentRuns: [],
    paymentRunInvoices: [],
    paymentRunEvents: [],
    vendorPaymentAccounts: [],
    vendorVirtualCards: [],
    catalogPriceProposals: [],
    softwareLicenses: [],
    spendGuardAlerts: [],
    webhookEndpoints: [],
    webhookDeliveries: [],
    glMappings: [],
    glExportJobs: [],
    notificationPreferences: [],
    notifications: [],
    messages: [],
    emailIntakeAddresses: [],
    emailIntakeItems: [],
    emailIntakeMessages: [],
    emailIntakeAttachments: [],
    procurementPolicies: [],
    intakeConciergeSessions: [],
    onboardingQuestionnaires: [],
    vendorOnboardingSubmissions: [],
    sanctionsScreenings: [],
    integrationConnections: [],
    syncRecords: [],
    approvalDelegations: [],
    auditLog: [],
  };
}

export function generateRandomSeedDataset(options: RandomSeedOptions): RandomSeedDataset {
  if (
    !Number.isSafeInteger(options.count) ||
    options.count < MIN_RANDOM_COUNT ||
    options.count > MAX_RANDOM_COUNT
  ) {
    throw new Error(`count must be between ${MIN_RANDOM_COUNT} and ${MAX_RANDOM_COUNT}.`);
  }
  if (!options.seed) throw new Error('seed must not be empty.');
  const { count, seed } = options;
  const rows = emptyRows();
  const departmentCount = Math.max(8, Math.min(40, Math.ceil(count / 25)));
  const userCount = Math.max(16, Math.min(120, Math.ceil(count / 8)));
  const vendorCount = Math.max(12, Math.min(100, Math.ceil(count / 10)));
  const catalogCount = Math.max(36, Math.min(300, vendorCount * 3));
  const entityIds: string[] = [];
  const departmentIds: string[] = [];
  const projectIds: string[] = [];
  const userIds: string[] = [];
  const vendorIds: string[] = [];
  const catalogIds: string[] = [];
  const taxIds: string[] = [];
  const budgetIds: string[] = [];
  const ruleIds: string[] = [];
  const contractIds: string[] = [];
  const allUsers = [DEMO_ADMIN_ID, DEMO_REQUESTER_ID, DEMO_APPROVER_ID];
  const allVendors: string[] = [...DEMO_VENDOR_IDS];
  const requisitionContext = new Map<
    number,
    {
      id: string;
      status: string;
      currency: string;
      totalCents: number;
      lineIds: string[];
      requesterId: string;
      vendorId: string;
      createdAt: Date;
      submittedAt?: Date;
      decisionAt?: Date;
    }
  >();
  const poContext = new Map<
    number,
    {
      id: string;
      status: string;
      currency: string;
      vendorId: string;
      subtotalCents: number;
      totalCents: number;
      lineIds: string[];
      receiptLineIds: string[];
      createdAt: Date;
      issuedAt?: Date;
      receivedAt?: Date;
    }
  >();
  const invoiceContext: Array<{
    id: string;
    status: string;
    totalCents: number;
    vendorId: string;
    index: number;
    createdAt: Date;
    approvedAt?: Date;
    paidAt?: Date;
  }> = [];

  for (let index = 0; index < 3; index += 1) {
    // These support rows have organization-level unique keys. Keep their IDs
    // stable across seeds so a second workload can safely reuse them.
    const id = stableUuid('betterspend-random-support', 'entity', index);
    entityIds.push(id);
    rows.legalEntities.push({
      id,
      organizationId: DEMO_ORG_ID,
      name: ['Acme Europe Ltd.', 'Acme Services LLC', 'Acme Labs GmbH'][index] as string,
      code: `ACME-${['EU', 'SERV', 'LAB'][index]}`,
      currency: ['EUR', 'USD', 'EUR'][index],
      glAccountPrefix: `10${index + 1}`,
      address: { city: ['Dublin', 'Denver', 'Berlin'][index], country: ['IE', 'US', 'DE'][index] },
      taxId: `DEMO-TAX-${index}`,
    });
  }
  const departmentNames = [
    'Finance',
    'Operations',
    'People',
    'Security',
    'Sales',
    'Customer Success',
    'Legal',
    'Facilities',
  ];
  for (let index = 0; index < departmentCount; index += 1) {
    const id = stableUuid(seed, 'department', index);
    departmentIds.push(id);
    rows.departments.push({
      id,
      organizationId: DEMO_ORG_ID,
      name: departmentNames[index % departmentNames.length] as string,
      code: `D${String(index + 1).padStart(3, '0')}`,
    });
  }
  for (let index = 0; index < Math.max(8, Math.min(32, Math.ceil(count / 20))); index += 1) {
    const id = stableUuid(seed, 'project', index);
    projectIds.push(id);
    rows.projects.push({
      id,
      organizationId: DEMO_ORG_ID,
      departmentId:
        index % 2 === 0 ? DEMO_ENG_DEPT_ID : departmentIds[index % departmentIds.length],
      name: `${['Cloud migration', 'Revenue operations', 'Workplace refresh', 'Customer portal'][index % 4]} ${index + 1}`,
      code: `PRJ-${String(index + 1).padStart(3, '0')}`,
      status: index % 9 === 0 ? 'completed' : 'active',
      startDate: stableDate(seed, 'project-start', index, -360, -30),
      endDate: stableDate(seed, 'project-end', index, 30, 240),
    });
  }
  const firstNames = [
    'Avery',
    'Morgan',
    'Riley',
    'Casey',
    'Taylor',
    'Jordan',
    'Quinn',
    'Cameron',
    'Skyler',
    'Drew',
    'Reese',
    'Parker',
  ];
  const lastNames = [
    'Chen',
    'Patel',
    'Martinez',
    'Williams',
    'Nguyen',
    'Johnson',
    'Kim',
    'Garcia',
    'Brown',
    'Singh',
    'Miller',
    'Davis',
  ];
  const seedToken = createHash('sha256').update(seed).digest('hex').slice(0, 8);
  for (let index = 0; index < userCount; index += 1) {
    const id = stableUuid(seed, 'user', index);
    userIds.push(id);
    allUsers.push(id);
    rows.users.push({
      id,
      organizationId: DEMO_ORG_ID,
      email: `workload-${seedToken}-${index + 1}@example.invalid`,
      name: `${firstNames[index % firstNames.length]} ${lastNames[(index * 5) % lastNames.length]}`,
      departmentId: departmentIds[index % departmentIds.length],
      managerId: index === 0 ? DEMO_ADMIN_ID : userIds[Math.floor(index / 3) - 1],
      emailVerified: true,
      createdAt: stableDate(seed, 'user-created', index, -360, -5),
      updatedAt: stableDate(seed, 'user-updated', index, -30, 0),
    });
  }
  for (let index = 0; index < userIds.length; index += 1) {
    rows.userRoles.push({
      id: stableUuid(seed, 'user-role', index),
      userId: userIds[index] as string,
      role: choose(
        ['requester', 'approver', 'receiver', 'finance', 'admin'] as const,
        seed,
        'role',
        index,
      ),
      scopeType: index % 3 === 0 ? 'department' : 'global',
      scopeId: index % 3 === 0 ? departmentIds[index % departmentIds.length] : undefined,
    });
  }
  const vendorNames = [
    'Northstar',
    'Summit',
    'Bluebird',
    'Cedar',
    'Orbit',
    'Pioneer',
    'Redwood',
    'Harbor',
    'Atlas',
    'Juniper',
  ];
  for (let index = 0; index < vendorCount; index += 1) {
    const id = stableUuid(seed, 'vendor', index);
    vendorIds.push(id);
    allVendors.push(id);
    const onboarding =
      index % 7 === 0 ? 'pending_review' : index % 13 === 0 ? 'changes_requested' : 'approved';
    const sanctions = index % 17 === 0 ? 'manually_reviewed' : 'clear';
    rows.vendors.push({
      id,
      organizationId: DEMO_ORG_ID,
      entityId: entityIds[index % entityIds.length],
      name: `${vendorNames[index % vendorNames.length]} ${['Systems', 'Supply Co.', 'Consulting', 'Industries'][index % 4]}`,
      code: `VND-${seedToken.toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
      taxId: `DEMO-VAT-${String(index + 1).padStart(6, '0')}`,
      paymentTerms: choose(['Net 15', 'Net 30', 'Net 45', 'Net 60'] as const, seed, 'terms', index),
      address: {
        street: `${index + 10} Market Street`,
        city: ['Denver', 'Austin', 'Dublin', 'Toronto'][index % 4],
        country: ['US', 'US', 'IE', 'CA'][index % 4],
      },
      contactInfo: {
        email: `billing-${index + 1}@vendor.example.invalid`,
        phone: `+1-555-${String(2000 + index).slice(-4)}`,
      },
      status: index % 19 === 0 ? 'inactive' : 'active',
      onboardingStatus: onboarding,
      onboardingRiskScore: onboarding === 'pending_review' ? 62 : 18 + (index % 20),
      onboardingRiskLevel: onboarding === 'pending_review' ? 'medium' : 'low',
      onboardingApprovedAt:
        onboarding === 'approved'
          ? stableDate(seed, 'vendor-approved', index, -300, -10)
          : undefined,
      onboardingLastSubmittedAt: stableDate(seed, 'vendor-submitted', index, -330, -2),
      punchoutEnabled: index % 11 === 0,
      diversityCategories: index % 4 === 0 ? ['small_business'] : [],
      esgRating: ['A', 'B+', 'B', 'C'][index % 4],
      carbonFootprintTons: String(80 + index * 11),
      sustainabilityCertifications: index % 3 === 0 ? ['iso14001'] : [],
      diversityVerifiedAt:
        index % 4 === 0 ? stableDate(seed, 'diversity', index, -300, -20) : undefined,
      sanctionsStatus: sanctions,
      sanctionsCheckedAt: stableDate(seed, 'sanctions', index, -90, -1),
      sanctionsNote: 'Demo screening result, no external lookup performed.',
      createdAt: stableDate(seed, 'vendor-created', index, -360, -20),
      updatedAt: stableDate(seed, 'vendor-updated', index, -40, 0),
    });
  }
  for (let index = 0; index < catalogCount; index += 1) {
    const id = stableUuid(seed, 'catalog', index);
    catalogIds.push(id);
    rows.catalogItems.push({
      id,
      organizationId: DEMO_ORG_ID,
      vendorId: allVendors[index % allVendors.length],
      sku: `SKU-${seedToken.toUpperCase()}-${String(index + 1).padStart(4, '0')}`,
      name: `${['Managed', 'Premium', 'Standard', 'Enterprise'][index % 4]} ${['license', 'laptop', 'support plan', 'safety kit', 'workshop'][index % 5]}`,
      description: `Demo catalog item ${index + 1}.`,
      category: ['Cloud', 'Office', 'Security', 'Professional services', 'Travel', 'Facilities'][
        index % 6
      ],
      unitOfMeasure: index % 8 === 0 ? 'month' : 'each',
      unitPrice: money(2_400 + ((index * 37) % 90_000)),
      currency: currencyAt(index),
      isActive: index % 23 !== 0,
      metadata: { demo: true, source: 'random-seed', index },
      createdAt: stableDate(seed, 'catalog-created', index, -360, -5),
      updatedAt: stableDate(seed, 'catalog-updated', index, -50, 0),
    });
  }
  for (const [index, code] of ['US-SALES', 'EU-VAT', 'EXEMPT'].entries()) {
    const id = stableUuid('betterspend-random-support', 'tax', index);
    taxIds.push(id);
    rows.taxCodes.push({
      id,
      orgId: DEMO_ORG_ID,
      name: code === 'EXEMPT' ? 'Exempt' : code === 'EU-VAT' ? 'EU VAT' : 'US Sales Tax',
      code,
      ratePercent: code === 'EXEMPT' ? '0' : code === 'EU-VAT' ? '20' : '8.25',
      taxType: code === 'EXEMPT' ? 'EXEMPT' : code === 'EU-VAT' ? 'VAT' : 'SALES_TAX',
      isRecoverable: code !== 'EXEMPT',
      glAccountCode: `21${index}0`,
    });
  }
  for (const [index, currency] of ['EUR', 'GBP', 'CAD'].entries()) {
    rows.exchangeRates.push({
      id: stableUuid('betterspend-random-support', 'exchange', index),
      orgId: DEMO_ORG_ID,
      fromCurrency: currency,
      toCurrency: 'USD',
      rate: currency === 'EUR' ? '1.09000000' : currency === 'GBP' ? '1.27000000' : '0.73000000',
      fetchedAt: stableDate(seed, 'exchange-fetched', index, -14, -1),
      isManual: true,
      createdAt: stableDate(seed, 'exchange-created', index, -14, -1),
    });
  }

  for (let index = 0; index < 4; index += 1) {
    const id = stableUuid(seed, 'budget', index);
    budgetIds.push(id);
    const total = 500_000 + index * 275_000;
    const scopeId =
      index % 2 === 0
        ? departmentIds[index % departmentIds.length]
        : projectIds[index % projectIds.length];
    rows.budgets.push({
      id,
      organizationId: DEMO_ORG_ID,
      entityId: entityIds[index % entityIds.length],
      name: `${index % 2 === 0 ? 'Department' : 'Project'} budget 2026`,
      budgetType: index % 2 === 0 ? 'department' : 'project',
      scopeId,
      fiscalYear: 2026,
      periodType: 'quarterly',
      totalAmount: money(total),
      allocatedAmount: money(total * 0.35),
      spentAmount: money(total * 0.12),
      currency: 'USD',
      baseCurrency: 'USD',
      exchangeRate: '1',
      baseTotalAmount: money(total),
      baseAllocatedAmount: money(total * 0.35),
      baseSpentAmount: money(total * 0.12),
      enforcementMode:
        index % 3 === 0 ? 'hard_stop' : index % 3 === 1 ? 'owner_approval' : 'visibility_only',
      pendingRequisitionPolicy: index % 2 === 0 ? 'include_pending' : 'approved_only',
      createdAt: stableDate(seed, 'budget-created', index, -360, -20),
      updatedAt: stableDate(seed, 'budget-updated', index, -45, 0),
    });
    for (let period = 0; period < 4; period += 1) {
      const start = new Date(Date.UTC(2026, period * 3, 1));
      const end = new Date(Date.UTC(2026, period * 3 + 3, 0, 23, 59, 59));
      rows.budgetPeriods.push({
        id: stableUuid(seed, 'budget-period', index * 4 + period),
        budgetId: id,
        periodStart: start,
        periodEnd: end,
        amount: money(total / 4),
        allocatedAmount: money((total * 0.35) / 4),
        spentAmount: money((total * 0.12) / 4),
        createdAt: stableDate(seed, 'budget-period-created', index * 4 + period, -300, -20),
        updatedAt: stableDate(seed, 'budget-period-updated', index * 4 + period, -30, 0),
      });
    }
  }
  for (let index = 0; index < 3; index += 1) {
    const id = stableUuid(seed, 'approval-rule', index);
    ruleIds.push(id);
    rows.approvalRules.push({
      id,
      organizationId: DEMO_ORG_ID,
      entityId: index === 2 ? entityIds[0] : undefined,
      name: ['Standard purchase approval', 'High value approval', 'Services approval'][
        index
      ] as string,
      description: 'Deterministic demo approval rule.',
      priority: (index + 1) * 10,
      isActive: true,
      conditions: JSON.stringify({
        all: [{ field: 'totalAmount', operator: 'gt', value: index === 1 ? 10000 : 0 }],
      }),
      createdAt: stableDate(seed, 'rule-created', index, -320, -30),
      updatedAt: stableDate(seed, 'rule-updated', index, -30, 0),
    });
    rows.approvalRuleSteps.push(
      {
        id: stableUuid(seed, 'approval-step', index * 2),
        approvalRuleId: id,
        stepOrder: 1,
        approverType: 'role',
        approverRole: 'approver',
        requiredCount: 1,
        createdAt: stableDate(seed, 'step-created', index * 2, -300, -20),
        updatedAt: stableDate(seed, 'step-updated', index * 2, -30, 0),
      },
      {
        id: stableUuid(seed, 'approval-step', index * 2 + 1),
        approvalRuleId: id,
        stepOrder: 2,
        approverType: 'role',
        approverRole: index === 1 ? 'finance' : 'approver',
        requiredCount: 1,
        createdAt: stableDate(seed, 'step-created', index * 2 + 1, -300, -20),
        updatedAt: stableDate(seed, 'step-updated', index * 2 + 1, -30, 0),
      },
    );
  }
  const contractCount = Math.max(10, Math.min(80, Math.ceil(count / 10)));
  for (let index = 0; index < contractCount; index += 1) {
    const id = stableUuid(seed, 'contract', index);
    contractIds.push(id);
    const status =
      index % 11 === 0
        ? 'expiring_soon'
        : index % 17 === 0
          ? 'expired'
          : index % 13 === 0
            ? 'draft'
            : 'active';
    const startDate = stableDate(seed, 'contract-start', index, -330, -20);
    const endDate = stableDate(seed, 'contract-end', index, 15, 420);
    rows.contracts.push({
      id,
      organizationId: DEMO_ORG_ID,
      contractNumber: stableBusinessNumber(seed, 'CTR', index),
      title: `${['Cloud services agreement', 'Facilities maintenance agreement', 'Professional services SOW', 'Software subscription'][index % 4]} ${index + 1}`,
      description: 'Synthetic contract for local reporting and compliance screens.',
      type: ['msa', 'sow', 'sla', 'purchase_agreement'][index % 4],
      status,
      vendorId: vendorIds[index % vendorIds.length],
      ownerId: allUsers[(index + 2) % allUsers.length],
      startDate,
      endDate,
      totalValue: money(80_000 + index * 7_500),
      currency: currencyAt(index),
      paymentTerms: 'Net 30',
      autoRenew: index % 3 !== 0,
      renewalNoticeDays: 30,
      renewalTermMonths: 12,
      terms: 'Synthetic terms. No external obligation exists.',
      internalNotes: 'Generated by the local workload seed.',
      approvedBy: status === 'active' || status === 'expiring_soon' ? DEMO_APPROVER_ID : undefined,
      approvedAt:
        status === 'active' || status === 'expiring_soon'
          ? stableDate(seed, 'contract-approved', index, -300, -10)
          : undefined,
      createdBy: DEMO_ADMIN_ID,
      createdAt: stableDate(seed, 'contract-created', index, -360, -30),
      updatedAt: stableDate(seed, 'contract-updated', index, -35, 0),
    });
    rows.contractLines.push({
      id: stableUuid(seed, 'contract-line', index),
      contractId: id,
      lineNumber: 1,
      description: 'Annual service commitment',
      quantity: '1',
      unitOfMeasure: 'year',
      unitPrice: money(10_000 + index * 250),
      totalPrice: money(10_000 + index * 250),
      createdAt: stableDate(seed, 'contract-line-created', index, -300, -10),
    });
    if (index % 5 === 0)
      rows.contractAmendments.push({
        id: stableUuid(seed, 'contract-amendment', index),
        contractId: id,
        amendmentNumber: 1,
        title: 'Annual pricing adjustment',
        description: 'Synthetic amendment.',
        effectiveDate: stableDate(seed, 'contract-amendment-date', index, -45, 45),
        valueChange: money(1_500 + index * 20),
        newEndDate: endDate,
        createdBy: DEMO_ADMIN_ID,
        createdAt: stableDate(seed, 'contract-amendment-created', index, -45, -2),
      });
    const docId = stableUuid(seed, 'contract-document', index);
    rows.documents.push({
      id: docId,
      organizationId: DEMO_ORG_ID,
      uploadedBy: DEMO_ADMIN_ID,
      filename: `${stableBusinessNumber(seed, 'CTR', index)}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 42_000 + index * 513,
      storageKey: `demo/${seedToken}/contracts/${docId}.pdf`,
      entityType: 'contract',
      entityId: id,
      createdAt: stableDate(seed, 'contract-document', index, -300, -5),
    });
    const extractionId = stableUuid(seed, 'contract-extraction', index);
    rows.contractExtractions.push({
      id: extractionId,
      organizationId: DEMO_ORG_ID,
      contractId: id,
      documentId: docId,
      sourceType: 'terms',
      sourceName: 'Generated contract PDF',
      extractedText: 'Synthetic payment and renewal terms.',
      extractedFields: { paymentTerms: 'Net 30', renewalNoticeDays: 30 },
      confidence: '0.9400',
      status: index % 4 === 0 ? 'pending_review' : 'approved',
      reviewedBy: index % 4 === 0 ? undefined : DEMO_APPROVER_ID,
      reviewedAt:
        index % 4 === 0 ? undefined : stableDate(seed, 'extraction-reviewed', index, -60, -1),
      createdBy: DEMO_ADMIN_ID,
      createdAt: stableDate(seed, 'extraction-created', index, -300, -5),
      updatedAt: stableDate(seed, 'extraction-updated', index, -30, 0),
    });
    const clauseId = stableUuid(seed, 'contract-clause', index);
    rows.contractClauses.push({
      id: clauseId,
      organizationId: DEMO_ORG_ID,
      contractId: id,
      extractionId,
      clauseType: index % 2 === 0 ? 'termination' : 'renewal',
      title: index % 2 === 0 ? 'Termination for convenience' : 'Renewal notice',
      extractedText: 'Synthetic clause text.',
      normalizedSummary: 'Written notice is required.',
      riskLevel: index % 9 === 0 ? 'medium' : 'low',
      riskReason: index % 9 === 0 ? 'Synthetic review item.' : undefined,
      confidence: '0.9100',
      sourceReference: 'page 4, section 5',
      status: index % 4 === 0 ? 'pending_review' : 'approved',
      reviewedBy: index % 4 === 0 ? undefined : DEMO_APPROVER_ID,
      reviewedAt: index % 4 === 0 ? undefined : stableDate(seed, 'clause-reviewed', index, -60, -1),
      createdAt: stableDate(seed, 'clause-created', index, -300, -5),
      updatedAt: stableDate(seed, 'clause-updated', index, -30, 0),
    });
    rows.contractObligations.push({
      id: stableUuid(seed, 'contract-obligation', index),
      organizationId: DEMO_ORG_ID,
      contractId: id,
      clauseId,
      ownerId: allUsers[index % allUsers.length],
      obligationType: index % 2 === 0 ? 'renewal_notice' : 'service_review',
      title: index % 2 === 0 ? 'Review renewal decision' : 'Complete service review',
      description: 'Synthetic obligation.',
      dueDate: stableDate(seed, 'obligation-due', index, 15, 240),
      recurrence: index % 2 === 0 ? 'annual' : 'quarterly',
      status: index % 10 === 0 ? 'completed' : 'open',
      notificationLeadDays: 30,
      sourceReference: 'page 4, section 5',
      createdAt: stableDate(seed, 'obligation-created', index, -300, -5),
      updatedAt: stableDate(seed, 'obligation-updated', index, -30, 0),
    });
  }
  const reqStatuses = [
    'draft',
    'submitted',
    'pending_approval',
    'rejected',
    'cancelled',
    'approved',
    'converted',
  ] as const;
  for (let index = 0; index < count; index += 1) {
    const id = stableUuid(seed, 'requisition', index);
    const status = reqStatuses[index % reqStatuses.length] as string;
    const currency = currencyAt(index);
    const requesterId =
      index % 5 === 0 ? DEMO_REQUESTER_ID : (allUsers[(index * 7) % allUsers.length] as string);
    const vendorId = allVendors[(index * 11) % allVendors.length] as string;
    const createdAt = stableDate(seed, 'requisition-created', index, -360, -20);
    const submittedAt =
      status === 'draft'
        ? undefined
        : dateAfter(createdAt, seed, 'requisition-submitted', index, 1, 14);
    const decisionAt = ['rejected', 'cancelled', 'approved', 'converted'].includes(status)
      ? dateAfter(submittedAt ?? createdAt, seed, 'requisition-decision', index, 1, 14)
      : undefined;
    const updatedAt = dateAfter(
      decisionAt ?? submittedAt ?? createdAt,
      seed,
      'requisition-updated',
      index,
      1,
      20,
    );
    const lineIds: string[] = [];
    let totalCents = 0;
    for (let line = 0; line < 1 + (index % 3); line += 1) {
      const lineIndex = index * 3 + line;
      const lineId = stableUuid(seed, 'requisition-line', lineIndex);
      const quantity = 1 + ((index + line) % 7);
      const unitPriceCents = 2_500 + ((index * 97 + line * 211) % 25_000);
      const lineTotal = quantity * unitPriceCents;
      totalCents += lineTotal;
      lineIds.push(lineId);
      rows.requisitionLines.push({
        id: lineId,
        requisitionId: id,
        lineNumber: line + 1,
        catalogItemId: catalogIds[lineIndex % catalogIds.length],
        description: `Requested ${['cloud capacity', 'security equipment', 'team supplies'][line % 3]} ${index + 1}.${line + 1}`,
        quantity: String(quantity),
        unitOfMeasure: line % 5 === 0 ? 'month' : 'each',
        unitPrice: money(unitPriceCents),
        totalPrice: money(lineTotal),
        vendorId,
        glAccount: `6${((index + line) % 8) + 1}00`,
        createdAt,
        updatedAt,
      });
    }
    rows.requisitions.push({
      id,
      organizationId: DEMO_ORG_ID,
      requesterId,
      departmentId:
        index % 4 === 0 ? DEMO_ENG_DEPT_ID : departmentIds[index % departmentIds.length],
      projectId: index % 3 === 0 ? projectIds[index % projectIds.length] : undefined,
      number: stableBusinessNumber(seed, 'REQ', index),
      title: `${['Infrastructure purchase', 'Team equipment', 'Professional services', 'Office replenishment'][index % 4]} ${index + 1}`,
      description: 'Synthetic requisition generated for local workflow exploration.',
      status,
      priority: ['low', 'normal', 'high', 'urgent'][index % 4],
      neededBy: stableDate(seed, 'requisition-needed', index, -10, 120),
      totalAmount: money(totalCents),
      currency,
      sourceType: index % 9 === 0 ? 'email' : index % 11 === 0 ? 'template' : 'manual',
      submittedAt,
      createdAt,
      updatedAt,
    });
    requisitionContext.set(index, {
      id,
      status,
      currency,
      totalCents,
      lineIds,
      requesterId,
      vendorId,
      createdAt,
      submittedAt,
      decisionAt,
    });
    if (status !== 'draft') {
      const approvalId = stableUuid(seed, 'approval-request', index);
      const approvalStatus =
        status === 'rejected' || status === 'cancelled'
          ? 'rejected'
          : status === 'pending_approval' || status === 'submitted'
            ? 'pending'
            : 'approved';
      const approvalCreatedAt = submittedAt ?? createdAt;
      const approvalUpdatedAt =
        decisionAt ?? dateAfter(approvalCreatedAt, seed, 'approval-request-updated', index, 1, 10);
      const approvalActionAt =
        decisionAt ?? dateAfter(approvalCreatedAt, seed, 'approval-action-acted', index, 1, 5);
      rows.approvalRequests.push({
        id: approvalId,
        organizationId: DEMO_ORG_ID,
        approvableType: 'requisition',
        approvableId: id,
        approvalRuleId: ruleIds[index % ruleIds.length],
        initiatedBy: requesterId,
        workflowContext: { generatedIndex: index },
        attempt: 1,
        currentStep: approvalStatus === 'approved' ? 2 : 1,
        status: approvalStatus,
        requiredApproverId: approvalStatus === 'pending' ? DEMO_APPROVER_ID : undefined,
        requiredApprovalStep: approvalStatus === 'pending' ? 1 : undefined,
        requiredApprovalReason:
          approvalStatus === 'pending' ? 'Synthetic approval pending.' : undefined,
        requiredApprovalKey: approvalStatus === 'pending' ? `demo:${approvalId}:1` : undefined,
        createdAt: approvalCreatedAt,
        updatedAt: approvalUpdatedAt,
      });
      rows.approvalActions.push({
        id: stableUuid(seed, 'approval-action', index),
        approvalRequestId: approvalId,
        stepOrder: 1,
        approverId: approvalStatus === 'pending' ? undefined : DEMO_APPROVER_ID,
        action:
          approvalStatus === 'approved'
            ? 'approved'
            : approvalStatus === 'rejected'
              ? 'rejected'
              : 'requested',
        comment:
          approvalStatus === 'pending'
            ? 'Awaiting synthetic approval.'
            : 'Synthetic workflow outcome.',
        nodeId: 'approval-step-1',
        metadata: { demo: true },
        actedAt: approvalActionAt,
        createdAt: approvalActionAt,
      });
    }
  }
  const poStatuses = [
    'pending_approval',
    'approved',
    'issued',
    'partially_received',
    'received',
    'partially_invoiced',
    'invoiced',
    'closed',
  ] as const;
  for (const [index, req] of requisitionContext.entries()) {
    if (req.status !== 'approved' && req.status !== 'converted') continue;
    const id = stableUuid(seed, 'purchase-order', index);
    const status = poStatuses[index % poStatuses.length] as string;
    const rate = index % 5 === 0 ? 0.2 : index % 3 === 0 ? 0.0825 : 0;
    const tax = Math.round(req.totalCents * rate);
    const poCreatedAt = dateAfter(
      req.decisionAt ?? req.submittedAt ?? req.createdAt,
      seed,
      'po-created',
      index,
      1,
      7,
    );
    const issuedAt =
      status === 'pending_approval' || status === 'approved'
        ? undefined
        : dateAfter(poCreatedAt, seed, 'po-issued', index, 1, 14);
    const poUpdatedAt = dateAfter(issuedAt ?? poCreatedAt, seed, 'po-updated', index, 1, 20);
    const lineIds: string[] = [];
    let allocatedTaxCents = 0;
    for (const [line, reqLineId] of req.lineIds.entries()) {
      const source = rows.requisitionLines.find((candidate) => candidate.id === reqLineId);
      const poLineId = stableUuid(seed, 'po-line', index * 3 + line);
      lineIds.push(poLineId);
      const quantity = Number(source?.quantity ?? '1');
      const lineTotalCents = Math.round(Number(source?.totalPrice ?? '0') * 100);
      const lineTaxCents =
        line === req.lineIds.length - 1
          ? tax - allocatedTaxCents
          : Math.round((lineTotalCents * tax) / Math.max(req.totalCents, 1));
      allocatedTaxCents += lineTaxCents;
      const received = ['partially_received', 'partially_invoiced'].includes(status)
        ? Math.max(0.5, quantity / 2)
        : ['received', 'invoiced', 'closed'].includes(status)
          ? quantity
          : 0;
      const invoiced =
        status === 'partially_invoiced'
          ? Math.max(0.5, quantity / 2)
          : ['invoiced', 'closed'].includes(status)
            ? quantity
            : 0;
      rows.poLines.push({
        id: poLineId,
        purchaseOrderId: id,
        requisitionLineId: reqLineId,
        lineNumber: line + 1,
        catalogItemId: source?.catalogItemId,
        taxCodeId: taxIds[index % taxIds.length],
        description: source?.description ?? `PO line ${line + 1}`,
        quantity: source?.quantity ?? '1',
        unitOfMeasure: source?.unitOfMeasure ?? 'each',
        unitPrice: source?.unitPrice ?? '0',
        taxAmount: money(lineTaxCents),
        taxInclusive: false,
        totalPrice: source?.totalPrice ?? '0',
        exchangeRate: fx(req.currency).toFixed(8),
        baseUnitPrice: money(Number(source?.unitPrice ?? '0') * fx(req.currency) * 100),
        baseTotalPrice: money(Number(source?.totalPrice ?? '0') * fx(req.currency) * 100),
        quantityReceived: String(received),
        quantityInvoiced: String(invoiced),
        glAccount: source?.glAccount ?? '6100',
        contractComplianceStatus: index % 9 === 0 ? 'exception' : 'compliant',
        contractComplianceDeltaPercent: index % 9 === 0 ? '6.5000' : '0.0000',
        matchedContractId: contractIds[index % contractIds.length],
        contractedUnitPrice: money(
          Math.max(1, Number(source?.unitPrice ?? '0') * 100 - (index % 4) * 10),
        ),
        createdAt: poCreatedAt,
        updatedAt: poUpdatedAt,
      });
    }
    const blanket = index % 13 === 0;
    rows.purchaseOrders.push({
      id,
      organizationId: DEMO_ORG_ID,
      entityId: entityIds[index % entityIds.length],
      requisitionId: req.id,
      vendorId: req.vendorId,
      number: stableBusinessNumber(seed, 'PO', index),
      version: index % 17 === 0 ? 2 : 1,
      poType: blanket ? 'blanket' : 'standard',
      status,
      issuedBy: issuedAt ? DEMO_APPROVER_ID : undefined,
      issuedAt,
      paymentTerms: choose(['Net 30', 'Net 45', 'Net 60'] as const, seed, 'po-terms', index),
      shippingAddress: { city: 'Denver', country: 'US' },
      billingAddress: { city: 'Denver', country: 'US' },
      subtotal: money(req.totalCents),
      taxAmount: money(tax),
      totalAmount: money(req.totalCents + tax),
      currency: req.currency,
      baseCurrency: 'USD',
      exchangeRate: fx(req.currency).toFixed(8),
      baseSubtotal: money(req.totalCents * fx(req.currency)),
      baseTaxAmount: money(tax * fx(req.currency)),
      baseTotalAmount: money((req.totalCents + tax) * fx(req.currency)),
      notes: 'Synthetic PO. No supplier notification is sent.',
      blanketStartDate: blanket ? stableDate(seed, 'blanket-start', index, -60, -1) : undefined,
      blanketEndDate: blanket ? stableDate(seed, 'blanket-end', index, 30, 180) : undefined,
      blanketTotalLimit: blanket ? money(req.totalCents * 2) : undefined,
      blanketReleasedAmount: blanket ? money(req.totalCents * 0.35) : undefined,
      createdAt: poCreatedAt,
      updatedAt: poUpdatedAt,
    });
    rows.poVersions.push({
      id: stableUuid(seed, 'po-version', index),
      purchaseOrderId: id,
      version: 1,
      changeReason: index % 17 === 0 ? 'Synthetic change order recorded.' : 'Initial version',
      changedBy: DEMO_ADMIN_ID,
      snapshot: {
        number: stableBusinessNumber(seed, 'PO', index),
        totalAmount: money(req.totalCents + tax),
      },
      diffSummary: index % 17 === 0 ? { fields: ['quantity'] } : {},
      createdAt: poCreatedAt,
    });
    if (blanket) {
      const blanketStartDate = dateAfter(poCreatedAt, seed, 'blanket-start', index, 1, 3);
      rows.blanketReleases.push({
        id: stableUuid(seed, 'blanket-release', index),
        blanketPoId: id,
        releaseNumber: 1,
        amount: money(req.totalCents * 0.35),
        description: 'Synthetic blanket release',
        status: issuedAt ? 'released' : 'draft',
        releasedBy: issuedAt ? DEMO_APPROVER_ID : undefined,
        createdAt: blanketStartDate,
        updatedAt: dateAfter(blanketStartDate, seed, 'blanket-release-updated', index, 1, 20),
      });
    }
    poContext.set(index, {
      id,
      status,
      currency: req.currency,
      vendorId: req.vendorId,
      subtotalCents: req.totalCents,
      totalCents: req.totalCents + tax,
      lineIds,
      receiptLineIds: [],
      createdAt: poCreatedAt,
      issuedAt,
    });
  }
  for (const [index, po] of poContext.entries()) {
    if (
      !['partially_received', 'received', 'partially_invoiced', 'invoiced', 'closed'].includes(
        po.status,
      )
    )
      continue;
    const receiptId = stableUuid(seed, 'goods-receipt', index);
    const receivedDate = dateAfter(
      po.issuedAt ?? po.createdAt,
      seed,
      'goods-receipt-date',
      index,
      1,
      14,
    );
    const receiptUpdatedAt = dateAfter(receivedDate, seed, 'goods-receipt-updated', index, 1, 20);
    po.receivedAt = receivedDate;
    rows.goodsReceipts.push({
      id: receiptId,
      organizationId: DEMO_ORG_ID,
      purchaseOrderId: po.id,
      number: stableBusinessNumber(seed, 'GRN', index),
      receivedBy: allUsers[(index + 3) % allUsers.length],
      receivedDate,
      status:
        po.status === 'partially_received' || po.status === 'partially_invoiced'
          ? 'partial'
          : 'received',
      notes: 'Synthetic receiving record.',
      createdAt: receivedDate,
      updatedAt: receiptUpdatedAt,
    });
    for (const [line, poLineId] of po.lineIds.entries()) {
      const source = rows.poLines.find((candidate) => candidate.id === poLineId);
      const quantity = Number(source?.quantityReceived ?? '0');
      if (quantity <= 0) continue;
      const lineId = stableUuid(seed, 'goods-receipt-line', index * 3 + line);
      po.receiptLineIds.push(lineId);
      rows.goodsReceiptLines.push({
        id: lineId,
        goodsReceiptId: receiptId,
        poLineId,
        quantityReceived: String(quantity),
        quantityRejected: index % 12 === 0 && quantity > 1 ? '1' : '0',
        rejectionReason:
          index % 12 === 0 && quantity > 1 ? 'Synthetic quality check variance.' : undefined,
        storageLocation: `WH-${String((index % 8) + 1).padStart(2, '0')}`,
        createdAt: receivedDate,
        updatedAt: dateAfter(
          receivedDate,
          seed,
          'goods-receipt-line-updated',
          index * 3 + line,
          1,
          20,
        ),
      });
    }
  }
  rows.emailIntakeAddresses.push({
    id: stableUuid('betterspend-random-support', 'email-address', 0),
    organizationId: DEMO_ORG_ID,
    token: createHash('sha256')
      .update('betterspend-random-support:email-address')
      .digest('hex')
      .slice(0, 48),
    createdAt: stableDate('betterspend-random-support', 'email-address-created', 0, -90, -1),
  });
  const emailCount = Math.max(8, Math.ceil(count / 20));
  for (let index = 0; index < emailCount; index += 1) {
    const req = requisitionContext.get(index * 2);
    const vendorId = vendorIds[index % vendorIds.length] as string;
    const itemId = stableUuid(seed, 'email-item', index);
    const converted = Boolean(req && index % 4 === 0);
    rows.emailIntakeItems.push({
      id: itemId,
      organizationId: DEMO_ORG_ID,
      sourceEmail: `inbound-${index + 1}@example.invalid`,
      subject: `Synthetic procurement email ${index + 1}`,
      body: 'Synthetic inbound email body. It is not delivered or forwarded.',
      detectedType: index % 3 === 0 ? 'invoice' : index % 3 === 1 ? 'requisition' : 'triage',
      status: converted ? 'converted' : index % 5 === 0 ? 'discarded' : 'pending_review',
      extractedVendorName: rows.vendors[index]?.name,
      extractedTotal: req ? money(req.totalCents) : '0.00',
      extractedCurrency: req?.currency ?? 'USD',
      rawPayload: { demo: true, inert: true },
      createdDraftType: converted ? 'requisition' : undefined,
      createdDraftId: converted ? req?.id : undefined,
      createdAt: stableDate(seed, 'email-item-created', index, -120, -1),
      updatedAt: stableDate(seed, 'email-item-updated', index, -30, 0),
    });
    const messageId = stableUuid(seed, 'email-message', index);
    const accepted = index % 5 !== 0;
    rows.emailIntakeMessages.push({
      id: messageId,
      organizationId: DEMO_ORG_ID,
      sesMessageId: `demo-ses-${seedToken}-${index + 1}`,
      rawStorageKey: `demo/${seedToken}/email/${messageId}.eml`,
      sourceEmail: `vendor-${index + 1}@example.invalid`,
      envelopeSource: `vendor-${index + 1}@example.invalid`,
      recipients: ['intake@example.invalid'],
      subject: `Synthetic intake ${index + 1}`,
      receivedAt: stableDate(seed, 'email-received', index, -120, -1),
      authVerdicts: { spam: 'PASS', virus: 'PASS', spf: 'PASS', dkim: 'PASS', dmarc: 'PASS' },
      senderClassification:
        index % 3 === 0 ? 'known_vendor' : index % 3 === 1 ? 'employee' : 'unknown',
      vendorId,
      riskScore: accepted ? 12 + (index % 20) : 75,
      riskSignals: accepted ? ['authenticated_sender'] : ['unknown_attachment'],
      status: accepted ? (index % 4 === 0 ? 'accepted' : 'partial') : 'rejected',
      createdAt: stableDate(seed, 'email-message-created', index, -120, -1),
    });
    rows.emailIntakeAttachments.push({
      id: stableUuid(seed, 'email-attachment', index),
      organizationId: DEMO_ORG_ID,
      messageId,
      emailIntakeItemId: itemId,
      filename: `attachment-${index + 1}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 18_000 + index * 300,
      contentHash: createHash('sha256').update(`${seed}:attachment:${index}`).digest('hex'),
      storageKey: accepted ? `demo/${seedToken}/email/${messageId}.pdf` : undefined,
      status: accepted ? 'accepted' : 'rejected',
      rejectionReason: accepted ? undefined : 'Synthetic risk threshold',
      invoiceNumberHint: accepted ? `SUP-${index + 1}` : undefined,
      createdAt: stableDate(seed, 'email-attachment-created', index, -120, -1),
    });
  }
  for (let index = 0; index < 3; index += 1) {
    rows.procurementPolicies.push({
      id: stableUuid(seed, 'policy', index),
      organizationId: DEMO_ORG_ID,
      title: ['Competitive bidding policy', 'Purchase approval policy', 'Supplier risk policy'][
        index
      ] as string,
      policyType: ['sourcing', 'approval', 'supplier_risk'][index] as string,
      status: index === 2 ? 'draft' : 'active',
      body: 'Synthetic policy text for local policy screens. It has no production effect.',
      rules: { threshold: index === 0 ? 5000 : index === 1 ? 10000 : 0, generated: true },
      createdBy: DEMO_ADMIN_ID,
      createdAt: stableDate(seed, 'policy-created', index, -240, -20),
      updatedAt: stableDate(seed, 'policy-updated', index, -30, 0),
    });
    const req = requisitionContext.get(index);
    rows.intakeConciergeSessions.push({
      id: stableUuid(seed, 'concierge', index),
      organizationId: DEMO_ORG_ID,
      requesterId: allUsers[index % allUsers.length],
      status: index === 0 ? 'converted' : index === 1 ? 'review' : 'draft',
      sourceText: 'Need a synthetic set of team supplies for the next quarter.',
      transcript: [
        {
          role: 'user',
          content: 'I need team supplies for next quarter.',
          createdAt: stableDate(seed, 'concierge-user', index, -45, -10).toISOString(),
        },
        {
          role: 'assistant',
          content: 'I drafted a synthetic requisition for review.',
          createdAt: stableDate(seed, 'concierge-assistant', index, -40, -5).toISOString(),
        },
      ],
      draft: { title: 'Synthetic team supplies', totalAmount: money(req?.totalCents ?? 5000) },
      plan: { steps: ['select vendor', 'review budget', 'submit'] },
      acceptedValues: index === 0 ? { category: 'office' } : {},
      convertedDraftType: index === 0 ? 'requisition' : undefined,
      convertedDraftId: index === 0 ? req?.id : undefined,
      createdAt: stableDate(seed, 'concierge-created', index, -60, -1),
      updatedAt: stableDate(seed, 'concierge-updated', index, -30, 0),
    });
  }
  const questionnaireId = stableUuid(seed, 'questionnaire', 0);
  rows.onboardingQuestionnaires.push({
    id: questionnaireId,
    organizationId: DEMO_ORG_ID,
    name: 'Standard supplier onboarding',
    isDefault: true,
    status: 'active',
    questions: [
      { key: 'business_type', required: true },
      { key: 'insurance_expiry', required: true },
      { key: 'diversity_status', required: false },
    ],
    scoringRules: [{ key: 'insurance_expiry', weight: 10 }],
    createdAt: stableDate(seed, 'questionnaire-created', 0, -240, -20),
    updatedAt: stableDate(seed, 'questionnaire-updated', 0, -30, 0),
  });
  for (let index = 0; index < vendorIds.length; index += 1) {
    const status =
      index % 7 === 0 ? 'changes_requested' : index % 4 === 0 ? 'submitted' : 'approved';
    rows.vendorOnboardingSubmissions.push({
      id: stableUuid(seed, 'onboarding', index),
      organizationId: DEMO_ORG_ID,
      vendorId: vendorIds[index] as string,
      questionnaireId,
      status,
      companyInfo: { legalName: rows.vendors[index]?.name ?? 'Demo vendor', country: 'US' },
      responses: { business_type: 'corporation', insurance_expiry: '2027-06-30' },
      documentLinks: {},
      bankingDetails: {},
      riskScore: String(20 + (index % 50)),
      riskLevel: index % 7 === 0 ? 'medium' : 'low',
      reviewNote:
        status === 'changes_requested' ? 'Synthetic request for updated evidence.' : undefined,
      submittedAt: stableDate(seed, 'onboarding-submitted', index, -180, -1),
      reviewedAt:
        status === 'submitted'
          ? undefined
          : stableDate(seed, 'onboarding-reviewed', index, -90, -1),
      createdAt: stableDate(seed, 'onboarding-created', index, -180, -1),
      updatedAt: stableDate(seed, 'onboarding-updated', index, -30, 0),
    });
    const result = index % 17 === 0 ? 'manually_reviewed' : index % 19 === 0 ? 'flagged' : 'clear';
    rows.sanctionsScreenings.push({
      id: stableUuid(seed, 'sanctions-screening', index),
      organizationId: DEMO_ORG_ID,
      vendorId: vendorIds[index] as string,
      result,
      matchCount: { exact: result === 'flagged' ? 1 : 0 },
      screenedBy: result === 'manually_reviewed' ? DEMO_APPROVER_ID : undefined,
      note: 'Synthetic screening result. No registry was queried.',
      createdAt: stableDate(seed, 'screening-created', index, -90, -1),
    });
  }
  for (let index = 0; index < 4; index += 1) {
    rows.recurringPos.push({
      id: stableUuid(seed, 'recurring-po', index),
      organizationId: DEMO_ORG_ID,
      createdById: allUsers[index % allUsers.length],
      vendorId: vendorIds[index % vendorIds.length],
      title: [
        'Monthly cloud support',
        'Quarterly facilities service',
        'Annual audit support',
        'Weekly office supplies',
      ][index] as string,
      description: 'Synthetic recurring purchase order template.',
      frequency: ['monthly', 'quarterly', 'annually', 'weekly'][index] as string,
      dayOfMonth: index === 3 ? undefined : 5 + index,
      nextRunAt: stableDate(seed, 'recurring-next', index, 5, 90),
      lastRunAt: stableDate(seed, 'recurring-last', index, -90, -5),
      active: index !== 3,
      totalAmount: money(2_500 + index * 750),
      currency: currencyAt(index),
      lines: [
        {
          description: 'Recurring service',
          quantity: 1,
          unitPrice: money(2_500 + index * 750),
          unitOfMeasure: 'each',
        },
      ],
      glAccount: `62${index + 1}0`,
      notes: 'Synthetic recurring order. No automatic run is scheduled.',
      runCount: index,
      maxRuns: index === 3 ? 12 : undefined,
      createdAt: stableDate(seed, 'recurring-created', index, -240, -20),
      updatedAt: stableDate(seed, 'recurring-updated', index, -30, 0),
    });
  }
  const inventoryCount = Math.max(12, Math.min(100, Math.ceil(count / 12)));
  for (let index = 0; index < inventoryCount; index += 1) {
    const id = stableUuid(seed, 'inventory-item', index);
    const opening = 50 + (index % 9) * 10;
    const issued = index % 4 === 0 ? 12 : 6;
    const po = poContext.get(index % Math.max(1, poContext.size));
    rows.inventoryItems.push({
      id,
      organizationId: DEMO_ORG_ID,
      sku: `INV-${seedToken}-${String(index + 1).padStart(4, '0')}`,
      name: `${['Laptop dock', 'Safety gloves', 'Printer toner', 'Network cable', 'Conference kit'][index % 5]} ${index + 1}`,
      description: 'Synthetic inventory item.',
      unit: 'each',
      quantityOnHand: String(opening - issued),
      quantityReserved: String(index % 5),
      reorderPoint: '20',
      reorderQuantity: '50',
      location: `WH-${String((index % 8) + 1).padStart(2, '0')}`,
      metadata: { demo: true },
      createdAt: stableDate(seed, 'inventory-created', index, -330, -20),
      updatedAt: stableDate(seed, 'inventory-updated', index, -30, 0),
    });
    rows.inventoryMovements.push(
      {
        id: stableUuid(seed, 'inventory-movement', index * 2),
        organizationId: DEMO_ORG_ID,
        inventoryItemId: id,
        movementType: 'receipt',
        quantity: String(opening),
        quantityBefore: '0',
        quantityAfter: String(opening),
        referenceType: 'goods_receipt',
        referenceId: po?.id,
        notes: 'Synthetic opening receipt.',
        createdAt: stableDate(seed, 'inventory-receipt', index, -300, -10),
      },
      {
        id: stableUuid(seed, 'inventory-movement', index * 2 + 1),
        organizationId: DEMO_ORG_ID,
        inventoryItemId: id,
        movementType: 'issue',
        quantity: String(-issued),
        quantityBefore: String(opening),
        quantityAfter: String(opening - issued),
        referenceType: 'purchase_order',
        referenceId: po?.id,
        notes: 'Synthetic issue movement.',
        createdAt: stableDate(seed, 'inventory-issue', index, -90, -1),
      },
    );
  }
  for (let index = 0; index < 4; index += 1)
    rows.requisitionTemplates.push({
      id: stableUuid(seed, 'requisition-template', index),
      organizationId: DEMO_ORG_ID,
      createdById: allUsers[index % allUsers.length],
      name: `${['New hire equipment', 'Quarterly software renewal', 'Office supplies', 'Security review'][index]} template`,
      description: 'Synthetic reusable requisition template.',
      isOrgWide: index % 2 === 0,
      templateData: {
        departmentId: departmentIds[index % departmentIds.length],
        priority: index % 2 === 0 ? 'normal' : 'high',
        lines: [
          { description: 'Template line', quantity: 1, unitPrice: '100.00', unitOfMeasure: 'each' },
        ],
      },
      createdAt: stableDate(seed, 'template-created', index, -300, -20),
      updatedAt: stableDate(seed, 'template-updated', index, -30, 0),
    });
  const integrationId = stableUuid('betterspend-random-support', 'integration', 0);
  rows.integrationConnections.push({
    id: integrationId,
    organizationId: DEMO_ORG_ID,
    provider: 'quickbooks',
    realmId: `demo-realm-${seedToken}`,
    realmName: 'Demo realm (disabled)',
    accessTokenEncrypted: undefined,
    refreshTokenEncrypted: undefined,
    status: 'revoked',
    scopes: 'accounting',
    connectedByUserId: DEMO_ADMIN_ID,
    lastSyncAt: stableDate(seed, 'integration-sync', 0, -60, -1),
    createdAt: stableDate(seed, 'integration-created', 0, -90, -30),
    updatedAt: stableDate(seed, 'integration-updated', 0, -30, 0),
  });
  for (const [index, invoice] of invoiceContext.slice(0, 5).entries())
    rows.syncRecords.push({
      id: stableUuid(seed, 'sync-record', index),
      organizationId: DEMO_ORG_ID,
      connectionId: integrationId,
      provider: 'quickbooks',
      direction: 'outbound',
      localEntity: 'invoice',
      localId: invoice.id,
      externalEntity: 'bill',
      status: 'skipped',
      attempts: 0,
      requestId: `demo-request-${index + 1}`,
      docNumber: stableBusinessNumber(seed, 'INV', invoice.index),
      errorCode: 'DISABLED',
      errorMessage: 'Synthetic integration is revoked and cannot make network calls.',
      payload: { demo: true },
      createdAt: stableDate(seed, 'sync-created', index, -60, -1),
      updatedAt: stableDate(seed, 'sync-updated', index, -30, 0),
    });
  for (let index = 0; index < 3; index += 1)
    rows.approvalDelegations.push({
      id: stableUuid(seed, 'delegation', index),
      organizationId: DEMO_ORG_ID,
      delegatorId: DEMO_APPROVER_ID,
      delegateeId: userIds[index] as string,
      startDate: stableDate(seed, 'delegation-start', index, -30, -1),
      endDate: stableDate(seed, 'delegation-end', index, 20, 90),
      reason: 'Synthetic coverage delegation.',
      active: index !== 2,
      createdAt: stableDate(seed, 'delegation-created', index, -40, -1),
    });
  for (let index = 0; index < count; index += 1) {
    const req = requisitionContext.get(index);
    if (!req) continue;
    rows.auditLog.push({
      id: stableUuid(seed, 'audit-req', index),
      organizationId: DEMO_ORG_ID,
      userId: req.requesterId,
      entityType: 'requisition',
      entityId: req.id,
      action: req.status === 'draft' ? 'created' : req.status,
      changes: { status: req.status, totalAmount: money(req.totalCents) },
      metadata: { generatedIndex: index },
      createdAt: req.createdAt,
    });
    const po = poContext.get(index);
    if (po)
      rows.auditLog.push({
        id: stableUuid(seed, 'audit-po', index),
        organizationId: DEMO_ORG_ID,
        userId: DEMO_APPROVER_ID,
        entityType: 'purchase_order',
        entityId: po.id,
        action: po.status,
        changes: { status: po.status, totalAmount: money(po.totalCents) },
        metadata: { generatedIndex: index },
        createdAt: po.createdAt,
      });
    const invoice = invoiceContext.find((candidate) => candidate.index === index);
    if (invoice)
      rows.auditLog.push({
        id: stableUuid(seed, 'audit-invoice', index),
        organizationId: DEMO_ORG_ID,
        userId: DEMO_ADMIN_ID,
        entityType: 'invoice',
        entityId: invoice.id,
        action: invoice.status,
        changes: { status: invoice.status, totalAmount: money(invoice.totalCents) },
        metadata: { generatedIndex: index },
        createdAt: invoice.createdAt,
      });
  }
  for (const [index, po] of poContext.entries()) {
    if (!['partially_invoiced', 'invoiced', 'closed'].includes(po.status)) continue;
    const id = stableUuid(seed, 'invoice', index);
    const status =
      index % 11 === 0
        ? 'rejected'
        : index % 7 === 0
          ? 'paid'
          : index % 5 === 0
            ? 'approved'
            : 'pending_match';
    const invoiceDate = dateAfter(
      po.receivedAt ?? po.issuedAt ?? po.createdAt,
      seed,
      'invoice-date',
      index,
      1,
      14,
    );
    const approvedAt =
      status === 'approved' || status === 'paid'
        ? dateAfter(invoiceDate, seed, 'invoice-approved', index, 1, 10)
        : undefined;
    const paidAt =
      status === 'paid'
        ? dateAfter(approvedAt ?? invoiceDate, seed, 'invoice-paid', index, 1, 20)
        : undefined;
    const invoiceUpdatedAt = dateAfter(
      paidAt ?? approvedAt ?? invoiceDate,
      seed,
      'invoice-updated',
      index,
      1,
      20,
    );
    const invoiceLineData = po.lineIds
      .map((poLineId, line) => {
        const source = rows.poLines.find((candidate) => candidate.id === poLineId);
        const quantity = Number(source?.quantityInvoiced ?? '0');
        return {
          poLineId,
          line,
          source,
          quantity,
          lineTotal: Math.round(quantity * Number(source?.unitPrice ?? '0') * 100),
        };
      })
      .filter((line) => line.quantity > 0);
    const invoiceSubtotalCents = invoiceLineData.reduce((sum, line) => sum + line.lineTotal, 0);
    const tax = Math.round(
      invoiceSubtotalCents * (index % 5 === 0 ? 0.2 : index % 3 === 0 ? 0.0825 : 0),
    );
    const match =
      index % 11 === 0
        ? 'exception'
        : index % 5 === 0 || status === 'paid'
          ? 'full_match'
          : 'partial_match';
    const docId = stableUuid(seed, 'invoice-document', index);
    rows.documents.push({
      id: docId,
      organizationId: DEMO_ORG_ID,
      uploadedBy: DEMO_ADMIN_ID,
      filename: `${stableBusinessNumber(seed, 'INV', index)}.pdf`,
      contentType: 'application/pdf',
      sizeBytes: 31_000 + index * 401,
      storageKey: `demo/${seedToken}/invoices/${docId}.pdf`,
      entityType: 'invoice',
      entityId: id,
      createdAt: invoiceDate,
    });
    rows.invoices.push({
      id,
      organizationId: DEMO_ORG_ID,
      entityId: entityIds[index % entityIds.length],
      purchaseOrderId: po.id,
      vendorId: po.vendorId,
      invoiceNumber: `SUP-${seedToken.toUpperCase()}-${String(index + 1).padStart(5, '0')}`,
      internalNumber: stableBusinessNumber(seed, 'INV', index),
      status,
      invoiceDate,
      dueDate: new Date(invoiceDate.getTime() + 30 * DAY_MS),
      paymentTerms: 'Net 30',
      earlyPaymentDiscountPercent: index % 4 === 0 ? '2.00' : undefined,
      earlyPaymentDiscountBy:
        index % 4 === 0 ? dateOnly(new Date(invoiceDate.getTime() + 10 * DAY_MS)) : undefined,
      paidAt,
      paymentReference:
        status === 'paid' ? `DEMO-PAY-${String(index + 1).padStart(6, '0')}` : undefined,
      subtotal: money(invoiceSubtotalCents),
      taxAmount: money(tax),
      totalAmount: money(invoiceSubtotalCents + tax),
      currency: po.currency,
      baseCurrency: 'USD',
      exchangeRate: fx(po.currency).toFixed(8),
      baseSubtotal: money(invoiceSubtotalCents * fx(po.currency)),
      baseTaxAmount: money(tax * fx(po.currency)),
      baseTotalAmount: money((invoiceSubtotalCents + tax) * fx(po.currency)),
      documentId: docId,
      matchStatus: match,
      matchDetails: { source: 'random-seed', tolerancePercent: 2 },
      submissionSource: index % 4 === 0 ? 'email' : 'legacy',
      createdBy: DEMO_REQUESTER_ID,
      approvedBy: status === 'approved' || status === 'paid' ? DEMO_APPROVER_ID : undefined,
      approvedAt,
      createdAt: invoiceDate,
      updatedAt: invoiceUpdatedAt,
    });
    let allocatedTaxCents = 0;
    for (const [taxableIndex, item] of invoiceLineData.entries()) {
      const { line, poLineId, source, quantity, lineTotal } = item;
      const lineId = stableUuid(seed, 'invoice-line', index * 3 + line);
      const lineTaxCents =
        taxableIndex === invoiceLineData.length - 1
          ? tax - allocatedTaxCents
          : Math.round((lineTotal * tax) / Math.max(invoiceSubtotalCents, 1));
      allocatedTaxCents += lineTaxCents;
      rows.invoiceLines.push({
        id: lineId,
        invoiceId: id,
        poLineId,
        lineNumber: String(line + 1),
        taxCodeId: taxIds[index % taxIds.length],
        description: source?.description ?? `Invoice line ${line + 1}`,
        quantity: String(quantity),
        unitPrice: source?.unitPrice ?? '0',
        taxAmount: money(lineTaxCents),
        taxInclusive: false,
        totalPrice: money(lineTotal),
        exchangeRate: fx(po.currency).toFixed(8),
        baseUnitPrice: money(Number(source?.unitPrice ?? '0') * fx(po.currency) * 100),
        baseTotalPrice: money(lineTotal * fx(po.currency)),
        glAccount: source?.glAccount ?? '6100',
        createdAt: invoiceDate,
        updatedAt: dateAfter(invoiceDate, seed, 'invoice-line-updated', index * 3 + line, 1, 20),
      });
      rows.matchResults.push({
        id: stableUuid(seed, 'match-result', index * 3 + line),
        invoiceLineId: lineId,
        poLineId,
        grnLineId: po.receiptLineIds[line],
        priceMatch: match === 'full_match',
        quantityMatch: match !== 'exception',
        priceVariance: match === 'exception' ? '125.00' : '0.00',
        quantityVariance: match === 'partial_match' ? '1.00' : '0.00',
        variancePct: match === 'exception' ? '5.00' : match === 'partial_match' ? '2.00' : '0.00',
        status:
          match === 'full_match'
            ? 'match'
            : match === 'partial_match'
              ? 'within_tolerance'
              : 'exception',
        toleranceApplied: match === 'full_match' ? '2.00' : undefined,
        createdAt: dateAfter(invoiceDate, seed, 'match-created', index * 3 + line, 1, 10),
      });
    }
    invoiceContext.push({
      id,
      status,
      totalCents: invoiceSubtotalCents + tax,
      vendorId: po.vendorId,
      index,
      createdAt: invoiceDate,
      approvedAt,
      paidAt,
    });
    if (index % 4 === 0)
      rows.ocrJobs.push({
        id: stableUuid(seed, 'ocr-job', index),
        organizationId: DEMO_ORG_ID,
        uploadedBy: DEMO_ADMIN_ID,
        filename: `${stableBusinessNumber(seed, 'INV', index)}-ocr.pdf`,
        contentType: 'application/pdf',
        storageKey: `demo/${seedToken}/ocr/${id}.pdf`,
        status: status === 'pending_match' ? 'done' : 'failed',
        extractedData: {
          invoiceNumber: `SUP-${index + 1}`,
          total: money(invoiceSubtotalCents + tax),
        },
        confidence: { invoiceNumber: 0.98, total: 0.96 },
        errorMessage: status === 'pending_match' ? undefined : 'Synthetic OCR review required.',
        invoiceId: id,
        createdAt: dateAfter(invoiceDate, seed, 'ocr-created', index, 1, 10),
        updatedAt: dateAfter(invoiceDate, seed, 'ocr-updated', index, 1, 20),
      });
  }
  if (rows.syncRecords.length === 0) {
    const integrationId = stableUuid('betterspend-random-support', 'integration', 0);
    for (const [index, invoice] of invoiceContext.slice(0, 5).entries())
      rows.syncRecords.push({
        id: stableUuid(seed, 'sync-record', index),
        organizationId: DEMO_ORG_ID,
        connectionId: integrationId,
        provider: 'quickbooks',
        direction: 'outbound',
        localEntity: 'invoice',
        localId: invoice.id,
        externalEntity: 'bill',
        status: 'skipped',
        attempts: 0,
        requestId: `demo-request-${index + 1}`,
        docNumber: stableBusinessNumber(seed, 'INV', invoice.index),
        errorCode: 'DISABLED',
        errorMessage: 'Synthetic integration is revoked and cannot make network calls.',
        payload: { demo: true },
        createdAt: invoice.createdAt,
        updatedAt: dateAfter(invoice.createdAt, seed, 'sync-updated', index, 1, 20),
      });
  }
  for (let index = 0; index < Math.min(12, Math.max(4, Math.ceil(count / 40))); index += 1) {
    const req = requisitionContext.get(index * 2);
    const po = poContext.get(index * 2);
    const invoice = invoiceContext.find((item) => item.index === index * 2);
    rows.budgetCommitmentEvents.push({
      id: stableUuid(seed, 'budget-event', index * 3),
      organizationId: DEMO_ORG_ID,
      budgetId: budgetIds[index % budgetIds.length],
      requisitionId: req?.id,
      purchaseOrderId: po?.id,
      invoiceId: invoice?.id,
      eventKey: `random:${seed}:${index}:reserved`,
      eventType: 'requisition_reserved',
      baseReservedDelta: money(req?.totalCents ?? 0),
      baseCommittedDelta: '0',
      baseExpendedDelta: '0',
      reason: 'Synthetic requisition reservation',
      metadata: { generated: true },
      createdAt: req
        ? dateAfter(
            req.decisionAt ?? req.submittedAt ?? req.createdAt,
            seed,
            'budget-reserved',
            index,
            1,
            5,
          )
        : stableDate(seed, 'budget-reserved', index, -260, -1),
    });
    if (po)
      rows.budgetCommitmentEvents.push({
        id: stableUuid(seed, 'budget-event', index * 3 + 1),
        organizationId: DEMO_ORG_ID,
        budgetId: budgetIds[index % budgetIds.length],
        requisitionId: req?.id,
        purchaseOrderId: po.id,
        eventKey: `random:${seed}:${index}:committed`,
        eventType: 'purchase_order_committed',
        baseReservedDelta: money(-(req?.totalCents ?? 0)),
        baseCommittedDelta: money(po.totalCents),
        baseExpendedDelta: '0',
        reason: 'Synthetic purchase order commitment',
        metadata: { generated: true },
        createdAt: dateAfter(po.issuedAt ?? po.createdAt, seed, 'budget-committed', index, 1, 5),
      });
    if (invoice && (invoice.status === 'approved' || invoice.status === 'paid'))
      rows.budgetCommitmentEvents.push({
        id: stableUuid(seed, 'budget-event', index * 3 + 2),
        organizationId: DEMO_ORG_ID,
        budgetId: budgetIds[index % budgetIds.length],
        requisitionId: req?.id,
        purchaseOrderId: po?.id,
        invoiceId: invoice.id,
        eventKey: `random:${seed}:${index}:expended`,
        eventType: 'invoice_expended',
        baseReservedDelta: '0',
        baseCommittedDelta: money(-(po?.totalCents ?? 0)),
        baseExpendedDelta: money(invoice.totalCents),
        reason: 'Synthetic invoice expenditure',
        metadata: { generated: true },
        createdAt: dateAfter(
          invoice.paidAt ?? invoice.approvedAt ?? invoice.createdAt,
          seed,
          'budget-expended',
          index,
          1,
          5,
        ),
      });
  }
  const rfqCount = Math.max(8, Math.min(100, Math.ceil(count / 8)));
  for (let index = 0; index < rfqCount; index += 1) {
    const id = stableUuid(seed, 'rfq', index);
    const awarded = index % 4 === 0;
    const status =
      index % 13 === 0 ? 'cancelled' : awarded ? 'awarded' : index % 3 === 0 ? 'closed' : 'open';
    const awardedVendorId = awarded ? vendorIds[index % vendorIds.length] : undefined;
    rows.rfqRequests.push({
      id,
      organizationId: DEMO_ORG_ID,
      requesterId: allUsers[index % allUsers.length],
      number: stableBusinessNumber(seed, 'RFQ', index),
      title: `${['Cloud capacity bid', 'Facilities services bid', 'Hardware sourcing event'][index % 3]} ${index + 1}`,
      description: 'Synthetic sourcing event.',
      status,
      dueDate: stableDate(seed, 'rfq-due', index, -60, 90),
      awardedVendorId,
      currency: currencyAt(index),
      notes: 'No vendor notification is sent.',
      createdAt: stableDate(seed, 'rfq-created', index, -250, -1),
      updatedAt: stableDate(seed, 'rfq-updated', index, -30, 0),
    });
    const lineIds: string[] = [];
    for (let line = 0; line < 2; line += 1) {
      const lineId = stableUuid(seed, 'rfq-line', index * 2 + line);
      lineIds.push(lineId);
      rows.rfqLines.push({
        id: lineId,
        rfqId: id,
        lineNumber: line + 1,
        description: `Bid line ${index + 1}.${line + 1}`,
        quantity: String(2 + ((index + line) % 8)),
        unitOfMeasure: 'each',
        targetPrice: money(3_000 + index * 100 + line * 250),
        createdAt: stableDate(seed, 'rfq-line-created', index * 2 + line, -240, -1),
      });
    }
    const invited = [
      vendorIds[index % vendorIds.length],
      vendorIds[(index + 1) % vendorIds.length],
      vendorIds[(index + 2) % vendorIds.length],
    ] as string[];
    for (let vendorIndex = 0; vendorIndex < invited.length; vendorIndex += 1) {
      const vendorId = invited[vendorIndex] as string;
      const responded = index % 5 !== 1 || vendorIndex === 0;
      rows.rfqInvitations.push({
        id: stableUuid(seed, 'rfq-invitation', index * 3 + vendorIndex),
        rfqId: id,
        vendorId,
        sentAt: stableDate(seed, 'rfq-invited', index * 3 + vendorIndex, -220, -1),
        respondedAt: responded
          ? stableDate(seed, 'rfq-responded', index * 3 + vendorIndex, -190, 0)
          : undefined,
        createdAt: stableDate(seed, 'rfq-invitation-created', index * 3 + vendorIndex, -220, -1),
      });
      if (!responded) continue;
      const responseId = stableUuid(seed, 'rfq-response', index * 3 + vendorIndex);
      const accepted = awarded && vendorId === awardedVendorId;
      rows.rfqResponses.push({
        id: responseId,
        rfqId: id,
        vendorId,
        status: accepted ? 'accepted' : vendorIndex === 0 ? 'submitted' : 'rejected',
        totalAmount: money(7_000 + index * 350 + vendorIndex * 225),
        validUntil: stableDate(seed, 'rfq-valid', index * 3 + vendorIndex, 15, 120),
        notes: 'Synthetic vendor response.',
        awarded: accepted,
        submittedAt: stableDate(seed, 'rfq-submitted', index * 3 + vendorIndex, -190, -1),
        createdAt: stableDate(seed, 'rfq-response-created', index * 3 + vendorIndex, -190, -1),
      });
      for (let line = 0; line < lineIds.length; line += 1)
        rows.rfqResponseLines.push({
          id: stableUuid(seed, 'rfq-response-line', index * 6 + vendorIndex * 2 + line),
          responseId,
          rfqLineId: lineIds[line] as string,
          unitPrice: money(3_000 + index * 100 + line * 250 + vendorIndex * 80),
          totalPrice: money(
            (2 + ((index + line) % 8)) * (3_000 + index * 100 + line * 250 + vendorIndex * 80),
          ),
          leadTimeDays: 10 + vendorIndex * 4,
          notes: 'Synthetic response line.',
          createdAt: stableDate(
            seed,
            'rfq-response-line-created',
            index * 6 + vendorIndex * 2 + line,
            -180,
            -1,
          ),
        });
    }
  }
  const payable = invoiceContext.filter(
    (invoice) => invoice.status === 'approved' || invoice.status === 'paid',
  );
  const runCount = Math.max(1, Math.ceil(payable.length / 20));
  for (let index = 0; index < runCount; index += 1) {
    const runInvoices = payable.slice(index * 20, (index + 1) * 20);
    const runId = stableUuid(seed, 'payment-run', index);
    const total = runInvoices.reduce((sum, invoice) => sum + invoice.totalCents, 0);
    const runBaseDate = runInvoices.reduce(
      (latest, invoice) => {
        const milestone = invoice.paidAt ?? invoice.approvedAt ?? invoice.createdAt;
        return milestone.getTime() > latest.getTime() ? milestone : latest;
      },
      stableDate(seed, 'payment-run-base', index, -80, -1),
    );
    const runDate = dateAfter(runBaseDate, seed, 'payment-run-date', index, 1, 14);
    const runUpdatedAt = dateAfter(runDate, seed, 'payment-run-updated', index, 1, 20);
    const paid = runInvoices.some((invoice) => invoice.status === 'paid');
    rows.paymentRuns.push({
      id: runId,
      orgId: DEMO_ORG_ID,
      entityId: entityIds[index % entityIds.length],
      status: paid ? 'paid' : index % 3 === 0 ? 'approved' : 'pending_approval',
      runDate: dateOnly(runDate),
      scheduledDate: dateOnly(new Date(runDate.getTime() + 5 * DAY_MS)),
      submittedAt: index % 3 === 0 ? new Date(runDate.getTime() + DAY_MS) : undefined,
      approvedBy: index % 3 === 0 ? DEMO_APPROVER_ID : undefined,
      approvedAt: index % 3 === 0 ? new Date(runDate.getTime() + 2 * DAY_MS) : undefined,
      paymentProvider: 'demo-manual',
      providerBatchId: `demo-batch-${seedToken}-${index + 1}`,
      currency: 'USD',
      totalAmount: money(total),
      invoiceCount: String(runInvoices.length),
      failureCount: '0',
      notes: 'Synthetic payment run. No provider is contacted.',
      createdBy: DEMO_ADMIN_ID,
      createdAt: runDate,
      updatedAt: runUpdatedAt,
    });
    for (const [offset, invoice] of runInvoices.entries())
      rows.paymentRunInvoices.push({
        id: stableUuid(seed, 'payment-run-invoice', index * 20 + offset),
        paymentRunId: runId,
        invoiceId: invoice.id,
        paymentMethod: offset % 3 === 0 ? 'ach' : offset % 3 === 1 ? 'wire' : 'manual',
        amount: money(invoice.totalCents),
        currency: 'USD',
        status: invoice.status === 'paid' ? 'paid' : 'scheduled',
        paymentReference:
          invoice.status === 'paid'
            ? `DEMO-PAY-${String(invoice.index + 1).padStart(6, '0')}`
            : undefined,
        providerPaymentId:
          invoice.status === 'paid' ? `demo-provider-${invoice.index + 1}` : undefined,
        createdAt: runDate,
        updatedAt: dateAfter(
          runDate,
          seed,
          'payment-run-invoice-updated',
          index * 20 + offset,
          1,
          20,
        ),
      });
    rows.paymentRunEvents.push({
      id: stableUuid(seed, 'payment-run-event', index),
      paymentRunId: runId,
      eventType: paid ? 'completed' : 'created',
      message: paid ? 'Synthetic payments marked complete.' : 'Synthetic payment run created.',
      metadata: { demo: true },
      createdBy: DEMO_ADMIN_ID,
      createdAt: runDate,
    });
  }
  for (let index = 0; index < allVendors.length; index += 1) {
    const vendorId = allVendors[index] as string;
    rows.vendorPaymentAccounts.push({
      id: stableUuid(seed, 'vendor-payment-account', index),
      orgId: DEMO_ORG_ID,
      vendorId,
      accountName: 'Demo settlement account',
      paymentMethod: index % 3 === 0 ? 'wire' : 'ach',
      country: 'US',
      currency: 'USD',
      maskedAccount: `****${String(1000 + index).slice(-4)}`,
      provider: 'demo-manual',
      providerAccountId: `demo-account-${seedToken}-${index + 1}`,
      verificationStatus: index % 5 === 0 ? 'pending' : 'verified',
      verifiedAt:
        index % 5 === 0 ? undefined : stableDate(seed, 'account-verified', index, -90, -1),
      metadata: { fake: true, inert: true },
      createdAt: stableDate(seed, 'account-created', index, -300, -10),
      updatedAt: stableDate(seed, 'account-updated', index, -30, 0),
    });
    if (index % 6 === 0 && invoiceContext.length > 0) {
      const invoice = invoiceContext[
        index % invoiceContext.length
      ] as (typeof invoiceContext)[number];
      rows.vendorVirtualCards.push({
        id: stableUuid(seed, 'vendor-card', index),
        orgId: DEMO_ORG_ID,
        vendorId,
        paymentRunId: rows.paymentRuns[index % rows.paymentRuns.length]?.id,
        invoiceId: invoice.id,
        status: 'cancelled',
        provider: 'demo-manual',
        providerCardId: `demo-card-${index + 1}`,
        maskedCard: `**** **** **** ${String(4000 + index).slice(-4)}`,
        limitAmount: money(invoice.totalCents),
        currency: 'USD',
        validThrough: dateOnly(stableDate(seed, 'card-valid', index, 20, 180)),
        controls: { fake: true, inert: true },
        createdBy: DEMO_ADMIN_ID,
        createdAt: stableDate(seed, 'card-created', index, -60, -1),
        updatedAt: stableDate(seed, 'card-updated', index, -20, 0),
      });
    }
  }
  for (
    let index = 0;
    index < Math.min(catalogIds.length, Math.max(12, Math.ceil(count / 12)));
    index += 1
  ) {
    const itemId = catalogIds[index] as string;
    const currentCents = Number(rows.catalogItems[index]?.unitPrice ?? '100') * 100;
    const status = index % 4 === 0 ? 'approved' : index % 5 === 0 ? 'rejected' : 'pending';
    rows.catalogPriceProposals.push({
      id: stableUuid(seed, 'price-proposal', index),
      organizationId: DEMO_ORG_ID,
      itemId,
      vendorId: allVendors[index % allVendors.length],
      proposedPrice: money(currentCents * (index % 3 === 0 ? 1.08 : 0.97)),
      currentPrice: money(currentCents),
      effectiveDate: stableDate(seed, 'proposal-effective', index, -10, 90),
      note: 'Synthetic price review proposal.',
      status,
      submittedAt: stableDate(seed, 'proposal-submitted', index, -80, -1),
      reviewedBy: status === 'pending' ? undefined : DEMO_APPROVER_ID,
      reviewedAt:
        status === 'pending' ? undefined : stableDate(seed, 'proposal-reviewed', index, -30, -1),
      reviewNote: status === 'pending' ? undefined : 'Synthetic review outcome.',
      notifiedVendor: false,
      appliedAt:
        status === 'approved' && index % 2 === 0
          ? stableDate(seed, 'proposal-applied', index, -2, 0)
          : undefined,
    });
  }
  const licenseCount = Math.max(10, Math.min(80, Math.ceil(count / 12)));
  for (let index = 0; index < licenseCount; index += 1)
    rows.softwareLicenses.push({
      id: stableUuid(seed, 'license', index),
      organizationId: DEMO_ORG_ID,
      vendorId: vendorIds[index % vendorIds.length],
      contractId: contractIds[index % contractIds.length],
      productName: `${['Analytics suite', 'Endpoint security', 'Design workspace', 'Cloud monitoring'][index % 4]} ${index + 1}`,
      status: index % 11 === 0 ? 'expired' : index % 7 === 0 ? 'renewal_due' : 'active',
      seatCount: 10 + (index % 12) * 5,
      seatsUsed: 6 + (index % 10) * 3,
      pricePerSeat: money(3_500 + index * 200),
      currency: currencyAt(index),
      billingCycle: index % 4 === 0 ? 'monthly' : 'annual',
      renewalDate: stableDate(seed, 'license-renewal', index, 10, 360),
      autoRenews: index % 5 !== 0,
      renewalLeadDays: 45,
      ownerUserId: allUsers[index % allUsers.length],
      notes: 'Synthetic license. No renewal action is scheduled.',
      renewalRefs: [],
      createdAt: stableDate(seed, 'license-created', index, -300, -10),
      updatedAt: stableDate(seed, 'license-updated', index, -30, 0),
    });
  for (let index = 0; index < Math.max(8, Math.ceil(count / 20)); index += 1) {
    const req = requisitionContext.get(index * 3);
    rows.spendGuardAlerts.push({
      id: stableUuid(seed, 'spend-alert', index),
      orgId: DEMO_ORG_ID,
      alertType:
        index % 3 === 0
          ? 'budget_threshold'
          : index % 3 === 1
            ? 'duplicate_spend'
            : 'unusual_vendor',
      severity: index % 5 === 0 ? 'high' : index % 2 === 0 ? 'medium' : 'low',
      recordType: 'requisition',
      recordId: req?.id ?? stableUuid(seed, 'requisition', index * 3),
      details: { thresholdPercent: 80 + (index % 3) * 5, generated: true },
      status: index % 4 === 0 ? 'resolved' : 'open',
      note: 'Synthetic spend guard alert.',
      createdAt: stableDate(seed, 'spend-alert-created', index, -120, -1),
      updatedAt: stableDate(seed, 'spend-alert-updated', index, -30, 0),
      resolvedAt:
        index % 4 === 0 ? stableDate(seed, 'spend-alert-resolved', index, -30, -1) : undefined,
      resolvedBy: index % 4 === 0 ? DEMO_ADMIN_ID : undefined,
    });
  }
  const webhookId = stableUuid(seed, 'webhook', 0);
  rows.webhookEndpoints.push({
    id: webhookId,
    organizationId: DEMO_ORG_ID,
    url: 'https://example.invalid/betterspend-demo-webhook',
    events: ['requisition.created', 'purchase_order.issued', 'invoice.approved'],
    isActive: false,
    createdAt: stableDate(seed, 'webhook-created', 0, -120, -30),
    updatedAt: stableDate(seed, 'webhook-updated', 0, -30, 0),
  });
  for (let index = 0; index < 3; index += 1)
    rows.webhookDeliveries.push({
      id: stableUuid(seed, 'webhook-delivery', index),
      webhookEndpointId: webhookId,
      eventType: ['requisition.created', 'purchase_order.issued', 'invoice.approved'][
        index
      ] as string,
      payload: { demo: true },
      responseStatus: 410,
      responseBody: 'Demo endpoint disabled.',
      attempts: 1,
      status: 'failed',
      createdAt: stableDate(seed, 'webhook-delivery-created', index, -80, -1),
      updatedAt: stableDate(seed, 'webhook-delivery-updated', index, -20, 0),
    });
  for (const [index, glAccount] of ['6100', '6200', '6300', '6400', '6500'].entries())
    rows.glMappings.push({
      id: stableUuid(seed, 'gl-mapping', index),
      organizationId: DEMO_ORG_ID,
      glAccount,
      glAccountName: [
        'Cloud services',
        'Facilities',
        'Travel',
        'Professional services',
        'Equipment',
      ][index] as string,
      targetSystem: index % 2 === 0 ? 'qbo' : 'xero',
      externalAccountCode: `DEMO-${glAccount}`,
      externalAccountName: `Demo ${glAccount}`,
      isActive: true,
      createdAt: stableDate(seed, 'gl-mapping-created', index, -300, -20),
      updatedAt: stableDate(seed, 'gl-mapping-updated', index, -30, 0),
    });
  for (const [index, invoice] of invoiceContext.entries()) {
    if (invoice.status === 'approved' || invoice.status === 'paid') {
      const exportBaseDate = invoice.approvedAt ?? invoice.createdAt;
      const exportedAt =
        invoice.status === 'paid'
          ? dateAfter(exportBaseDate, seed, 'gl-exported', index, 1, 10)
          : undefined;
      rows.glExportJobs.push({
        id: stableUuid(seed, 'gl-export', index),
        organizationId: DEMO_ORG_ID,
        invoiceId: invoice.id,
        targetSystem: index % 2 === 0 ? 'qbo' : 'xero',
        status: invoice.status === 'paid' ? 'exported' : 'pending',
        attempts: invoice.status === 'paid' ? 1 : 0,
        exportedAt,
        payload: { invoiceId: invoice.id, demo: true },
        externalId: invoice.status === 'paid' ? `demo-gl-${index + 1}` : undefined,
        createdAt: exportBaseDate,
        updatedAt: dateAfter(exportedAt ?? exportBaseDate, seed, 'gl-export-updated', index, 1, 20),
      });
    }
  }
  for (const [index, userId] of allUsers.entries())
    rows.notificationPreferences.push({
      id: stableUuid(seed, 'notification-preference', index),
      organizationId: DEMO_ORG_ID,
      userId,
      emailEnabled: index % 7 !== 0,
      frequency: index % 5 === 0 ? 'daily' : 'instant',
      enabledTypes: ['approval_request', 'po_issued', 'invoice_exception', 'invoice_approved'],
      createdAt: stableDate(seed, 'notification-preference-created', index, -180, -10),
      updatedAt: stableDate(seed, 'notification-preference-updated', index, -30, 0),
    });
  for (let index = 0; index < count; index += 1) {
    const req = requisitionContext.get(index);
    if (!req) continue;
    const notificationCreatedAt = dateAfter(
      req.submittedAt ?? req.createdAt,
      seed,
      'notification-created',
      index,
      1,
      20,
    );
    rows.notifications.push({
      id: stableUuid(seed, 'notification', index),
      organizationId: DEMO_ORG_ID,
      userId: req.requesterId,
      type:
        req.status === 'pending_approval'
          ? 'approval_request'
          : req.status === 'rejected'
            ? 'approval_rejected'
            : 'requisition_updated',
      title:
        req.status === 'pending_approval'
          ? 'Approval needed for requisition'
          : `Requisition ${stableBusinessNumber(seed, 'REQ', index)} updated`,
      body: 'Synthetic notification.',
      entityType: 'requisition',
      entityId: req.id,
      readAt:
        index % 4 === 0
          ? dateAfter(notificationCreatedAt, seed, 'notification-read', index, 1, 20)
          : undefined,
      createdAt: notificationCreatedAt,
    });
  }
  for (const [index, invoice] of invoiceContext.entries()) {
    const notificationCreatedAt = dateAfter(
      invoice.approvedAt ?? invoice.createdAt,
      seed,
      'invoice-notification-created',
      index,
      1,
      20,
    );
    rows.notifications.push({
      id: stableUuid(seed, 'invoice-notification', index),
      organizationId: DEMO_ORG_ID,
      userId: DEMO_ADMIN_ID,
      type: invoice.status === 'pending_match' ? 'invoice_exception' : 'invoice_approved',
      title:
        invoice.status === 'pending_match' ? 'Invoice match requires review' : 'Invoice approved',
      body: 'Synthetic invoice notification.',
      entityType: 'invoice',
      entityId: invoice.id,
      readAt:
        invoice.status === 'pending_match'
          ? undefined
          : dateAfter(notificationCreatedAt, seed, 'invoice-notification-read', index, 1, 20),
      createdAt: notificationCreatedAt,
    });
  }
  for (const [index, po] of poContext.entries()) {
    const created = dateAfter(po.createdAt, seed, 'message-created', index, 1, 10);
    rows.messages.push(
      {
        id: stableUuid(seed, 'message-user', index),
        organizationId: DEMO_ORG_ID,
        threadType: 'po',
        threadId: po.id,
        senderType: 'user',
        senderId: DEMO_REQUESTER_ID,
        authorName: 'Jane Requester',
        body: 'Please confirm the synthetic delivery window.',
        attachments: [],
        createdAt: created,
      },
      {
        id: stableUuid(seed, 'message-vendor', index),
        organizationId: DEMO_ORG_ID,
        threadType: 'po',
        threadId: po.id,
        senderType: 'vendor',
        vendorId: po.vendorId,
        authorName: 'Demo supplier contact',
        body: 'Synthetic supplier reply. No email was sent.',
        attachments: [],
        createdAt: new Date(created.getTime() + 2 * DAY_MS),
      },
    );
  }
  const summary = Object.fromEntries(
    Object.entries(rows).map(([key, rowsForTable]) => [key, rowsForTable.length]),
  ) as Record<keyof Rows, number>;
  return { options, ...rows, summary };
}
