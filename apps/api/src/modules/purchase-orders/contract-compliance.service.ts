import { Injectable, Inject } from '@nestjs/common';
import { and, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { contracts, contractLines } from '@betterspend/db';
import { SettingsService } from '../settings/settings.service';

export interface ComplianceResult {
  status: 'compliant' | 'deviation' | 'no_contract' | 'exempt';
  deltaPercent: number | null;
  contractId: string | null;
  contractedUnitPrice: number | null;
  contractNumber?: string | null;
  /** deviation action from settings: 'warn' | 'block' */
  deviationAction?: string;
  /** deviation threshold from settings (%) */
  deviationThreshold?: number;
}

@Injectable()
export class ContractComplianceService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly settingsService: SettingsService,
  ) {}

  async checkCompliance(
    orgId: string,
    vendorId: string,
    unitPrice: number,
    catalogItemId?: string | null,
    description?: string | null,
  ): Promise<ComplianceResult> {
    const now = new Date();

    // Find active contracts for this vendor
    const activeContracts = await this.db.query.contracts.findMany({
      where: (c, { and, eq, or, gte }) =>
        and(
          eq(c.organizationId, orgId),
          eq(c.vendorId, vendorId),
          or(eq(c.status, 'active'), eq(c.status, 'expiring_soon')),
        ),
      with: { lines: true },
      orderBy: (c, { desc }) => desc(c.createdAt),
    });

    if (activeContracts.length === 0) {
      return { status: 'no_contract', deltaPercent: null, contractId: null, contractedUnitPrice: null };
    }

    // Filter out expired contracts (end_date < now)
    const validContracts = activeContracts.filter(
      (c) => !c.endDate || new Date(c.endDate) >= now,
    );

    if (validContracts.length === 0) {
      return { status: 'no_contract', deltaPercent: null, contractId: null, contractedUnitPrice: null };
    }

    // Try to find a matching line across all valid contracts
    let matchedContract: (typeof validContracts)[0] | null = null;
    let matchedLine: { unitPrice: string | null } | null = null;

    for (const contract of validContracts) {
      const lines = (contract as any).lines as Array<{
        id: string;
        catalogItemId?: string | null;
        description: string;
        unitPrice: string | null;
      }>;

      if (!lines || lines.length === 0) continue;

      // First: try to match by catalog item ID
      if (catalogItemId) {
        const byItem = lines.find((l) => (l as any).catalogItemId === catalogItemId);
        if (byItem) {
          matchedContract = contract;
          matchedLine = byItem;
          break;
        }
      }

      // Second: try to match by description (case-insensitive contains)
      if (description) {
        const descLower = description.toLowerCase();
        const byDesc = lines.find(
          (l) => l.description && l.description.toLowerCase().includes(descLower),
        );
        if (byDesc) {
          matchedContract = contract;
          matchedLine = byDesc;
          break;
        }
      }
    }

    if (!matchedContract || !matchedLine || matchedLine.unitPrice == null) {
      return { status: 'no_contract', deltaPercent: null, contractId: null, contractedUnitPrice: null };
    }

    const contractedPrice = parseFloat(matchedLine.unitPrice);
    if (isNaN(contractedPrice) || contractedPrice === 0) {
      return { status: 'no_contract', deltaPercent: null, contractId: null, contractedUnitPrice: null };
    }

    const deltaPercent = Math.abs(((unitPrice - contractedPrice) / contractedPrice) * 100);

    // Load settings for threshold and action
    const [thresholdStr, deviationAction] = await Promise.all([
      this.settingsService.get(orgId, 'contract_price_deviation_threshold'),
      this.settingsService.get(orgId, 'contract_price_deviation_action'),
    ]);
    const threshold = parseFloat(thresholdStr || '5');

    const status = deltaPercent === 0 ? 'compliant' : 'deviation';

    return {
      status,
      deltaPercent: parseFloat(deltaPercent.toFixed(4)),
      contractId: matchedContract.id,
      contractedUnitPrice: contractedPrice,
      contractNumber: matchedContract.contractNumber,
      deviationAction,
      deviationThreshold: threshold,
    };
  }
}
