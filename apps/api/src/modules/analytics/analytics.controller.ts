import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentOrgId } from '../../common/decorators/current-org-id.decorator';
import { CurrentAccess } from '../auth/current-access.decorator';
import type { AccessPolicy } from '../auth/access-policy';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('kpis')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'High-level KPI summary' })
  kpis(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.kpis(orgId, access?.scopeFor('report', 'reports:view'));
  }

  @Get('spend/by-vendor')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Spend breakdown by vendor (approved invoices)' })
  spendByVendor(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.spendByVendor(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('spend/by-department')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Spend breakdown by department (active POs)' })
  spendByDepartment(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.spendByDepartment(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('spend/monthly')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Monthly spend trend (last 12 months)' })
  monthlySpend(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.monthlySpend(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('invoice-aging')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Invoice aging by due-date bucket' })
  invoiceAging(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.invoiceAging(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('po-cycle-time')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Average PO cycle time (draft → issued)' })
  poCycleTime(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.poCycleTime(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('pending-items')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Count of items requiring action (approvals, exceptions, etc.)' })
  pendingItems(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.pendingItems(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('vendor-performance')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Vendor performance metrics (exception rate, avg days to approve, spend)' })
  vendorPerformance(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.vendorPerformance(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('budget-utilization')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Budget utilization for current fiscal year' })
  budgetUtilization(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.budgetUtilization(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('recent-activity')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Recent audit log activity (last 20 events)' })
  recentActivity(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.recentActivity(
      orgId,
      20,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('spend/by-category')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Spend breakdown by catalog category (approved invoices)' })
  spendByCategory(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.spendByCategory(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('spend/anomalies')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Vendors with spend anomalies (>2x rolling average)' })
  spendAnomalies(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.spendAnomalies(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }

  @Get('spend/category-trend')
  @Permissions('reports:view')
  @ApiOperation({ summary: 'Category spend: current quarter vs previous quarter' })
  categoryTrend(@CurrentOrgId() orgId: string, @CurrentAccess() access?: AccessPolicy) {
    return this.analyticsService.categoryTrend(
      orgId,
      access?.scopeFor('report', 'reports:view'),
    );
  }
}
