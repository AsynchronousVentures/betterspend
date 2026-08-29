import type { CreateRequisitionInput } from '@betterspend/shared';

interface ApprovalSummary {
  id: string;
  currentStep: number;
  status: string;
}

interface BudgetCommitmentSummary {
  id: string;
  budgetId: string;
  budget: { id: string; name: string } | null;
}

export interface BudgetEnforcementDecision {
  action: 'allow' | 'block' | 'require_approval';
  withinBudget: boolean;
  reason: 'no_department' | 'no_budget' | 'within_budget' | 'overrun' | 'owner_missing';
  budgetId?: string;
  budgetName?: string;
  currency?: string;
  mode?: 'hard_stop' | 'owner_approval' | 'visibility_only';
  pendingPolicy?: 'approved_only' | 'include_pending';
  ownerUserId?: string;
  allocated?: string;
  spent?: string;
  committed?: string;
  remainingBefore?: string;
  remainingAfter?: string;
  requested?: string;
  overrun?: string;
  message: string;
}

export interface RequisitionLine {
  id: string;
  requisitionId: string;
  lineNumber: number;
  catalogItemId: string | null;
  description: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  totalPrice: string;
  vendorId: string | null;
  glAccount: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequisitionRecord {
  id: string;
  organizationId: string;
  requesterId: string;
  departmentId: string | null;
  projectId: string | null;
  number: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  neededBy: string | null;
  totalAmount: string;
  currency: string;
  sourceType: string;
  sourceDocumentId: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequisitionListItem extends RequisitionRecord {
  lines: RequisitionLine[];
}

export interface RequisitionDetail extends RequisitionListItem {
  purchaseOrders: Array<{ id: string; number: string; status: string }>;
  commitmentEvents: BudgetCommitmentSummary[];
  activeApproval: ApprovalSummary | null;
}

export interface RequisitionSubmission extends RequisitionDetail {
  budgetEnforcement: BudgetEnforcementDecision;
}

export interface RequisitionsApi {
  list(): Promise<RequisitionListItem[]>;
  get(id: string): Promise<RequisitionDetail>;
  create(data: CreateRequisitionInput): Promise<RequisitionDetail>;
  submit(id: string): Promise<RequisitionSubmission>;
  cancel(id: string): Promise<RequisitionRecord>;
}

export interface PurchaseOrderInput {
  entityId?: string;
  vendorId: string;
  requisitionId?: string;
  paymentTerms?: string;
  currency?: string;
  exchangeRate?: number;
  notes?: string;
  poType?: 'standard' | 'blanket';
  shippingAddress?: Record<string, unknown>;
  billingAddress?: Record<string, unknown>;
  blanketStartDate?: string;
  blanketEndDate?: string;
  blanketTotalLimit?: number;
  lines: Array<{
    description: string;
    quantity: number;
    unitOfMeasure?: string;
    unitPrice: number;
    glAccount?: string;
    taxCodeId?: string;
    taxInclusive?: boolean;
    catalogItemId?: string;
    requisitionLineId?: string;
  }>;
}

export interface PurchaseOrderChangeInput {
  changeReason: string;
  lines?: Array<{
    id?: string;
    description: string;
    quantity: number;
    unitOfMeasure?: string;
    unitPrice: number;
    glAccount?: string;
    taxCodeId?: string;
    taxInclusive?: boolean;
  }>;
  notes?: string;
  paymentTerms?: string;
}

interface VendorSummary {
  id: string;
  name: string;
}

interface EntitySummary {
  id: string;
  name: string;
  code: string;
  currency: string;
}

interface TaxCodeSummary {
  id: string;
  code: string;
  name: string;
  ratePercent: string;
  isRecoverable: boolean;
}

export interface PurchaseOrderLineRecord {
  id: string;
  purchaseOrderId: string;
  requisitionLineId: string | null;
  lineNumber: number;
  catalogItemId: string | null;
  taxCodeId: string | null;
  description: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  taxAmount: string;
  taxInclusive: boolean;
  totalPrice: string;
  exchangeRate: string;
  baseUnitPrice: string;
  baseTotalPrice: string;
  quantityReceived: string;
  quantityInvoiced: string;
  glAccount: string | null;
  contractComplianceStatus: string | null;
  contractComplianceDeltaPercent: string | null;
  matchedContractId: string | null;
  contractedUnitPrice: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderLine extends PurchaseOrderLineRecord {
  taxCode: TaxCodeSummary | null;
}

export interface PurchaseOrderDetailLine extends PurchaseOrderLine {
  matchedContract: { id: string; contractNumber: string; title: string } | null;
}

export interface PurchaseOrderRecord {
  id: string;
  organizationId: string;
  entityId: string | null;
  requisitionId: string | null;
  recurringPoId: string | null;
  vendorId: string;
  number: string;
  version: number;
  poType: string;
  status: string;
  issuedBy: string | null;
  issuedAt: string | null;
  paymentTerms: string | null;
  shippingAddress: unknown;
  billingAddress: unknown;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  baseCurrency: string;
  exchangeRate: string;
  baseSubtotal: string;
  baseTaxAmount: string;
  baseTotalAmount: string;
  notes: string | null;
  pdfDocumentId: string | null;
  blanketStartDate: string | null;
  blanketEndDate: string | null;
  blanketTotalLimit: string | null;
  blanketReleasedAmount: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderListItem extends PurchaseOrderRecord {
  vendor: VendorSummary | null;
  entity: EntitySummary | null;
  lines: PurchaseOrderLine[];
}

export interface PurchaseOrderVersion {
  id: string;
  purchaseOrderId: string;
  version: number;
  changeReason: string | null;
  changedBy: string;
  snapshot: unknown;
  diffSummary: unknown;
  createdAt: string;
}

export interface BlanketRelease {
  id: string;
  blanketPoId: string;
  releaseNumber: number;
  amount: string;
  description: string | null;
  status: string;
  releasedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderDetail extends PurchaseOrderRecord {
  vendor: VendorSummary | null;
  entity: EntitySummary | null;
  lines: PurchaseOrderDetailLine[];
  versions: PurchaseOrderVersion[];
  requisition: { id: string; number: string } | null;
  goodsReceipts: Array<{ id: string; number: string; status: string }>;
  invoices: Array<{
    id: string;
    internalNumber: string;
    invoiceNumber: string;
    status: string;
  }>;
  commitmentEvents: BudgetCommitmentSummary[];
  activeApproval: ApprovalSummary | null;
}

export interface PurchaseOrderResponse extends PurchaseOrderDetail {
  sanctionsWarning?: unknown;
}

export type PurchaseOrderIssueResponse = (PurchaseOrderRecord | PurchaseOrderDetail) & {
  budgetEnforcement: BudgetEnforcementDecision;
};

export interface PurchaseOrderReceivingLine {
  poLineId: string;
  lineNumber: number;
  description: string;
  orderedQty: string;
  uom: string;
  receivedQty: string;
  rejectedQty: string;
  outstandingQty: string;
  receivedPct: string;
  grnCount: number;
}

export interface PurchaseOrderComplianceResult {
  status: 'compliant' | 'deviation' | 'no_contract' | 'exempt';
  deltaPercent: number | null;
  contractId: string | null;
  contractedUnitPrice: number | null;
  contractNumber?: string | null;
  deviationAction?: string;
  deviationThreshold?: number;
  contractRiskLevel?: 'none' | 'low' | 'medium' | 'high';
  intelligenceWarnings?: string[];
}

export interface PurchaseOrderComplianceReport {
  purchaseOrderId: string;
  number: string;
  summary: {
    totalLines: number;
    compliantLines: number;
    deviationLines: number;
    noContractLines: number;
  };
  lines: Array<{
    id: string;
    lineNumber: number;
    description: string;
    unitPrice: string;
    contractComplianceStatus: string;
    contractComplianceDeltaPercent: string | null;
    matchedContractId: string | null;
    contractedUnitPrice: string | null;
  }>;
}

export interface PurchaseOrdersApi {
  list(): Promise<PurchaseOrderListItem[]>;
  get(id: string): Promise<PurchaseOrderDetail>;
  create(data: PurchaseOrderInput): Promise<PurchaseOrderResponse>;
  issue(id: string): Promise<PurchaseOrderIssueResponse>;
  cancel(id: string): Promise<PurchaseOrderRecord>;
  changeOrder(id: string, data: PurchaseOrderChangeInput): Promise<PurchaseOrderDetail>;
  versions(id: string): Promise<PurchaseOrderVersion[]>;
  releases(id: string): Promise<BlanketRelease[]>;
  createRelease(
    id: string,
    data: { amount: number; description?: string },
  ): Promise<BlanketRelease>;
  cancelRelease(id: string, releaseId: string): Promise<BlanketRelease>;
  receivingSummary(id: string): Promise<PurchaseOrderReceivingLine[]>;
  complianceReport(id: string): Promise<PurchaseOrderComplianceReport>;
  checkCompliance(data: {
    vendorId: string;
    unitPrice: number;
    catalogItemId?: string;
    description?: string;
  }): Promise<PurchaseOrderComplianceResult>;
  pdf(id: string): Promise<Response>;
}

export interface InvoiceInput {
  entityId?: string;
  purchaseOrderId?: string;
  vendorId: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  paymentTerms?: string;
  earlyPaymentDiscountPercent?: number;
  earlyPaymentDiscountBy?: string;
  currency?: string;
  exchangeRate?: number;
  lines: Array<{
    poLineId?: string;
    lineNumber: number;
    description: string;
    quantity: number;
    unitPrice: number;
    glAccount?: string;
    taxCodeId?: string;
    taxInclusive?: boolean;
  }>;
}

export interface InvoiceRecord {
  id: string;
  organizationId: string;
  entityId: string | null;
  purchaseOrderId: string | null;
  vendorId: string;
  invoiceNumber: string;
  internalNumber: string;
  status: string;
  invoiceDate: string;
  dueDate: string | null;
  paymentTerms: string | null;
  earlyPaymentDiscountPercent: string | null;
  earlyPaymentDiscountBy: string | null;
  paidAt: string | null;
  paymentReference: string | null;
  subtotal: string;
  taxAmount: string;
  totalAmount: string;
  currency: string;
  baseCurrency: string;
  exchangeRate: string;
  baseSubtotal: string;
  baseTaxAmount: string;
  baseTotalAmount: string;
  documentId: string | null;
  matchStatus: string;
  matchDetails: unknown;
  submissionSource: string;
  createdBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceListItem extends InvoiceRecord {
  vendor: VendorSummary | null;
  purchaseOrder: PurchaseOrderRecord | null;
  entity: EntitySummary | null;
}

export interface InvoiceMatchResult {
  id: string;
  invoiceLineId: string;
  poLineId: string;
  grnLineId: string | null;
  priceMatch: boolean;
  quantityMatch: boolean;
  priceVariance: string;
  quantityVariance: string;
  variancePct: string;
  status: string;
  toleranceApplied: string | null;
  createdAt: string;
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  poLineId: string | null;
  lineNumber: string;
  taxCodeId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  taxAmount: string;
  taxInclusive: boolean;
  totalPrice: string;
  exchangeRate: string;
  baseUnitPrice: string;
  baseTotalPrice: string;
  glAccount: string | null;
  createdAt: string;
  updatedAt: string;
  matchResults: InvoiceMatchResult[];
  taxCode: TaxCodeSummary | null;
}

export interface InvoiceDetail extends InvoiceRecord {
  vendor: VendorSummary | null;
  entity: EntitySummary | null;
  purchaseOrder:
    | (PurchaseOrderRecord & {
        lines: PurchaseOrderLineRecord[];
        requisition?: { id: string; number: string } | null;
        goodsReceipts?: Array<{ id: string; number: string; status: string }>;
      })
    | null;
  lines: InvoiceLine[];
  paymentRuns?: Array<{ id: string; status: string }>;
  activeApproval?: ApprovalSummary | null;
}

export interface InvoiceMatchResponse {
  matchStatus: string;
  lineResults: Array<{
    invoiceLineId: string;
    poLineId: string | null;
    priceMatch: boolean;
    quantityMatch: boolean;
    status: string;
  }>;
}

export interface InvoiceBulkApprovalResult {
  id: string;
  success: boolean;
  error?: string;
}

export interface InvoiceAgingBucket {
  count: number;
  totalAmount: string;
}

export interface InvoiceAgingReport {
  current: InvoiceAgingBucket;
  days_1_30: InvoiceAgingBucket;
  days_31_60: InvoiceAgingBucket;
  days_61_90: InvoiceAgingBucket;
  days_90_plus: InvoiceAgingBucket;
}

export interface InvoiceCashFlowWeek {
  weekStart: string;
  totalAmount: string;
}

export interface InvoicesApi {
  list(): Promise<InvoiceListItem[]>;
  get(id: string): Promise<InvoiceDetail>;
  create(data: InvoiceInput): Promise<InvoiceDetail>;
  approve(id: string): Promise<InvoiceDetail>;
  resolveException(id: string, data?: { reason?: string }): Promise<InvoiceDetail>;
  bulkApprove(ids: string[]): Promise<InvoiceBulkApprovalResult[]>;
  markPaid(
    id: string,
    data: { paymentReference: string; paymentDate: string; paymentMethod: string },
  ): Promise<InvoiceDetail>;
  rerunMatch(id: string): Promise<InvoiceMatchResponse>;
  aging(): Promise<InvoiceAgingReport>;
  cashFlowForecast(): Promise<InvoiceCashFlowWeek[]>;
  earlyPaymentOpportunities(): Promise<Array<InvoiceRecord & { vendor: VendorSummary | null }>>;
}
