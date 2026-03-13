import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './database/database.module';
import { QueueModule } from './common/queue/queue.module';
import { CommonServicesModule } from './common/services/common-services.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { UsersModule } from './modules/users/users.module';
import { RequisitionsModule } from './modules/requisitions/requisitions.module';
import { PurchaseOrdersModule } from './modules/purchase-orders/purchase-orders.module';
import { ApprovalRulesModule } from './modules/approval-rules/approval-rules.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { BudgetsModule } from './modules/budgets/budgets.module';
import { ReceivingModule } from './modules/receiving/receiving.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { GlModule } from './modules/gl/gl.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { PunchoutModule } from './modules/punchout/punchout.module';
import { HealthModule } from './modules/health/health.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AuthModule } from './modules/auth/auth.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AuditModule } from './modules/audit/audit.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { SettingsModule } from './modules/settings/settings.module';
import { PasswordResetModule } from './modules/password-reset/password-reset.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { StorageModule } from './common/storage/storage.module';
import { VendorPortalModule } from './modules/vendor-portal/vendor-portal.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SupplierScorecardModule } from './modules/supplier-scorecard/supplier-scorecard.module';
import { ApprovalDelegationsModule } from './modules/approval-delegations/approval-delegations.module';
import { RfqModule } from './modules/rfq/rfq.module';
import { RecurringPoModule } from './modules/recurring-po/recurring-po.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { RequisitionTemplatesModule } from './modules/requisition-templates/requisition-templates.module';
import { ExportModule } from './modules/export/export.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    QueueModule,
    StorageModule,
    NotificationsModule,
    AuthModule,
    CommonServicesModule,
    WebhooksModule,
    GlModule,
    HealthModule,
    VendorsModule,
    UsersModule,
    CatalogModule,
    RequisitionsModule,
    PurchaseOrdersModule,
    ApprovalRulesModule,
    ApprovalsModule,
    BudgetsModule,
    ReceivingModule,
    InvoicesModule,
    OcrModule,
    PunchoutModule,
    AnalyticsModule,
    DepartmentsModule,
    ProjectsModule,
    AuditModule,
    ReportsModule,
    SearchModule,
    ContractsModule,
    SettingsModule,
    PasswordResetModule,
    DocumentsModule,
    VendorPortalModule,
    SupplierScorecardModule,
    ApprovalDelegationsModule,
    RfqModule,
    RecurringPoModule,
    InventoryModule,
    RequisitionTemplatesModule,
    ExportModule,
  ],
})
export class AppModule {}
