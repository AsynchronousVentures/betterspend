import { relations } from 'drizzle-orm';
import { organizations, departments, projects } from './schema/organizations';
import { users, userRoles } from './schema/users';
import { requisitionTemplates } from './schema/requisition-templates';
import { vendors, catalogItems } from './schema/vendors';
import { requisitions, requisitionLines } from './schema/requisitions';
import { purchaseOrders, poLines, poVersions, blanketReleases } from './schema/purchase-orders';
import { goodsReceipts, goodsReceiptLines } from './schema/receiving';
import { invoices, invoiceLines, matchResults } from './schema/invoices';
import { budgets, budgetPeriods } from './schema/budgets';
import { approvalRules, approvalRuleSteps, approvalRequests, approvalActions } from './schema/approvals';
import { webhookEndpoints, webhookDeliveries } from './schema/webhooks';
import { glMappings, glExportJobs } from './schema/gl';
import { ocrJobs } from './schema/ocr';
import { authSessions, authAccounts } from './schema/auth';
import { contracts, contractLines, contractAmendments } from './schema/contracts';
import { systemSettings } from './schema/system-settings';
import { vendorPortalTokens } from './schema/vendor-portal-tokens';
import { notifications } from './schema/notifications';
import { paymentRuns, paymentRunInvoices } from './schema/payment-runs';


export const organizationsRelations = relations(organizations, ({ many }) => ({
  departments: many(departments),
  users: many(users),
  vendors: many(vendors),
  requisitions: many(requisitions),
  purchaseOrders: many(purchaseOrders),
  budgets: many(budgets),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  organization: one(organizations, { fields: [departments.organizationId], references: [organizations.id] }),
  parent: one(departments, { fields: [departments.parentId], references: [departments.id], relationName: 'parent' }),
  children: many(departments, { relationName: 'parent' }),
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, { fields: [users.organizationId], references: [organizations.id] }),
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  userRoles: many(userRoles),
  notifications: many(notifications),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
}));

export const vendorsRelations = relations(vendors, ({ one, many }) => ({
  organization: one(organizations, { fields: [vendors.organizationId], references: [organizations.id] }),
  catalogItems: many(catalogItems),
}));

export const catalogItemsRelations = relations(catalogItems, ({ one }) => ({
  organization: one(organizations, { fields: [catalogItems.organizationId], references: [organizations.id] }),
  vendor: one(vendors, { fields: [catalogItems.vendorId], references: [vendors.id] }),
}));

export const requisitionsRelations = relations(requisitions, ({ one, many }) => ({
  organization: one(organizations, { fields: [requisitions.organizationId], references: [organizations.id] }),
  requester: one(users, { fields: [requisitions.requesterId], references: [users.id] }),
  department: one(departments, { fields: [requisitions.departmentId], references: [departments.id] }),
  lines: many(requisitionLines),
}));

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  organization: one(organizations, { fields: [purchaseOrders.organizationId], references: [organizations.id] }),
  vendor: one(vendors, { fields: [purchaseOrders.vendorId], references: [vendors.id] }),
  requisition: one(requisitions, { fields: [purchaseOrders.requisitionId], references: [requisitions.id] }),
  lines: many(poLines),
  versions: many(poVersions),
  releases: many(blanketReleases),
  goodsReceipts: many(goodsReceipts),
  invoices: many(invoices),
}));

export const requisitionLinesRelations = relations(requisitionLines, ({ one }) => ({
  requisition: one(requisitions, { fields: [requisitionLines.requisitionId], references: [requisitions.id] }),
  vendor: one(vendors, { fields: [requisitionLines.vendorId], references: [vendors.id] }),
}));

export const poLinesRelations = relations(poLines, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [poLines.purchaseOrderId], references: [purchaseOrders.id] }),
}));

export const poVersionsRelations = relations(poVersions, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, { fields: [poVersions.purchaseOrderId], references: [purchaseOrders.id] }),
}));

export const blanketReleasesRelations = relations(blanketReleases, ({ one }) => ({
  blanketPo: one(purchaseOrders, { fields: [blanketReleases.blanketPoId], references: [purchaseOrders.id], relationName: 'releases' }),
}));

export const approvalRulesRelations = relations(approvalRules, ({ one, many }) => ({
  organization: one(organizations, { fields: [approvalRules.organizationId], references: [organizations.id] }),
  steps: many(approvalRuleSteps),
  requests: many(approvalRequests),
}));

export const approvalRuleStepsRelations = relations(approvalRuleSteps, ({ one }) => ({
  rule: one(approvalRules, { fields: [approvalRuleSteps.approvalRuleId], references: [approvalRules.id] }),
}));

export const approvalRequestsRelations = relations(approvalRequests, ({ one, many }) => ({
  rule: one(approvalRules, { fields: [approvalRequests.approvalRuleId], references: [approvalRules.id] }),
  actions: many(approvalActions),
}));

export const approvalActionsRelations = relations(approvalActions, ({ one }) => ({
  request: one(approvalRequests, { fields: [approvalActions.approvalRequestId], references: [approvalRequests.id] }),
}));

export const goodsReceiptsRelations = relations(goodsReceipts, ({ one, many }) => ({
  organization: one(organizations, { fields: [goodsReceipts.organizationId], references: [organizations.id] }),
  purchaseOrder: one(purchaseOrders, { fields: [goodsReceipts.purchaseOrderId], references: [purchaseOrders.id] }),
  lines: many(goodsReceiptLines),
}));

export const goodsReceiptLinesRelations = relations(goodsReceiptLines, ({ one }) => ({
  goodsReceipt: one(goodsReceipts, { fields: [goodsReceiptLines.goodsReceiptId], references: [goodsReceipts.id] }),
  poLine: one(poLines, { fields: [goodsReceiptLines.poLineId], references: [poLines.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  organization: one(organizations, { fields: [invoices.organizationId], references: [organizations.id] }),
  purchaseOrder: one(purchaseOrders, { fields: [invoices.purchaseOrderId], references: [purchaseOrders.id] }),
  vendor: one(vendors, { fields: [invoices.vendorId], references: [vendors.id] }),
  lines: many(invoiceLines),
}));

export const invoiceLinesRelations = relations(invoiceLines, ({ one, many }) => ({
  invoice: one(invoices, { fields: [invoiceLines.invoiceId], references: [invoices.id] }),
  poLine: one(poLines, { fields: [invoiceLines.poLineId], references: [poLines.id] }),
  matchResults: many(matchResults),
}));

export const matchResultsRelations = relations(matchResults, ({ one }) => ({
  invoiceLine: one(invoiceLines, { fields: [matchResults.invoiceLineId], references: [invoiceLines.id] }),
  poLine: one(poLines, { fields: [matchResults.poLineId], references: [poLines.id] }),
  grnLine: one(goodsReceiptLines, { fields: [matchResults.grnLineId], references: [goodsReceiptLines.id] }),
}));

export const budgetsRelations = relations(budgets, ({ one, many }) => ({
  organization: one(organizations, { fields: [budgets.organizationId], references: [organizations.id] }),
  periods: many(budgetPeriods),
}));

export const budgetPeriodsRelations = relations(budgetPeriods, ({ one }) => ({
  budget: one(budgets, { fields: [budgetPeriods.budgetId], references: [budgets.id] }),
}));

export const webhookEndpointsRelations = relations(webhookEndpoints, ({ one, many }) => ({
  organization: one(organizations, { fields: [webhookEndpoints.organizationId], references: [organizations.id] }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  endpoint: one(webhookEndpoints, { fields: [webhookDeliveries.webhookEndpointId], references: [webhookEndpoints.id] }),
}));

export const glMappingsRelations = relations(glMappings, ({ one }) => ({
  organization: one(organizations, { fields: [glMappings.organizationId], references: [organizations.id] }),
}));

export const glExportJobsRelations = relations(glExportJobs, ({ one }) => ({
  organization: one(organizations, { fields: [glExportJobs.organizationId], references: [organizations.id] }),
  invoice: one(invoices, { fields: [glExportJobs.invoiceId], references: [invoices.id] }),
}));

export const ocrJobsRelations = relations(ocrJobs, ({ one }) => ({
  organization: one(organizations, { fields: [ocrJobs.organizationId], references: [organizations.id] }),
}));

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, { fields: [authSessions.userId], references: [users.id] }),
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, { fields: [authAccounts.userId], references: [users.id] }),
}));

export const contractsRelations = relations(contracts, ({ one, many }) => ({
  organization: one(organizations, { fields: [contracts.organizationId], references: [organizations.id] }),
  vendor: one(vendors, { fields: [contracts.vendorId], references: [vendors.id] }),
  owner: one(users, { fields: [contracts.ownerId], references: [users.id], relationName: 'contractOwner' }),
  createdByUser: one(users, { fields: [contracts.createdBy], references: [users.id], relationName: 'contractCreatedBy' }),
  lines: many(contractLines),
  amendments: many(contractAmendments),
}));

export const contractLinesRelations = relations(contractLines, ({ one }) => ({
  contract: one(contracts, { fields: [contractLines.contractId], references: [contracts.id] }),
}));

export const contractAmendmentsRelations = relations(contractAmendments, ({ one }) => ({
  contract: one(contracts, { fields: [contractAmendments.contractId], references: [contracts.id] }),
  createdByUser: one(users, { fields: [contractAmendments.createdBy], references: [users.id] }),
}));

export const systemSettingsRelations = relations(systemSettings, ({ one }) => ({
  organization: one(organizations, { fields: [systemSettings.organizationId], references: [organizations.id] }),
}));

export const vendorPortalTokensRelations = relations(vendorPortalTokens, ({ one }) => ({
  vendor: one(vendors, { fields: [vendorPortalTokens.vendorId], references: [vendors.id] }),
}));

export const requisitionTemplatesRelations = relations(requisitionTemplates, ({ one }) => ({
  organization: one(organizations, { fields: [requisitionTemplates.organizationId], references: [organizations.id] }),
  createdBy: one(users, { fields: [requisitionTemplates.createdById], references: [users.id] }),
}));

export const paymentRunsRelations = relations(paymentRuns, ({ one, many }) => ({
  organization: one(organizations, { fields: [paymentRuns.orgId], references: [organizations.id] }),
  createdByUser: one(users, { fields: [paymentRuns.createdBy], references: [users.id] }),
  paymentRunInvoices: many(paymentRunInvoices),
}));

export const paymentRunInvoicesRelations = relations(paymentRunInvoices, ({ one }) => ({
  paymentRun: one(paymentRuns, { fields: [paymentRunInvoices.paymentRunId], references: [paymentRuns.id] }),
  invoice: one(invoices, { fields: [paymentRunInvoices.invoiceId], references: [invoices.id] }),
}));
