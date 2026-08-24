import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { NUMBER_PREFIXES } from '@betterspend/shared';

type EntityType = 'requisition' | 'purchase_order' | 'goods_receipt' | 'invoice';

@Injectable()
export class SequenceService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async next(organizationId: string, entityType: EntityType): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = {
      requisition: NUMBER_PREFIXES.REQUISITION,
      purchase_order: NUMBER_PREFIXES.PURCHASE_ORDER,
      goods_receipt: NUMBER_PREFIXES.GOODS_RECEIPT,
      invoice: NUMBER_PREFIXES.INVOICE,
    }[entityType];

    const rows = await this.db.execute(sql`
      INSERT INTO sequences (id, organization_id, entity_type, year, last_value, updated_at)
      VALUES (gen_random_uuid(), ${organizationId}, ${entityType}, ${year}, 1, now())
      ON CONFLICT (organization_id, entity_type, year)
      DO UPDATE SET
        last_value = sequences.last_value + 1,
        updated_at = now()
      RETURNING last_value
    `);
    const result = Number((rows as unknown as Array<{ last_value: number }>)[0]?.last_value);
    if (!Number.isInteger(result) || result < 1) {
      throw new Error(`Failed to generate ${entityType} sequence`);
    }

    const seq = String(result).padStart(4, '0');
    return `${prefix}-${year}-${seq}`;
  }
}
