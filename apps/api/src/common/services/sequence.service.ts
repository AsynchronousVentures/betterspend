import { Injectable, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { NUMBER_PREFIXES } from '@betterspend/shared';

type EntityType = 'requisition' | 'purchase_order' | 'goods_receipt' | 'invoice' | 'rfq';
type SequenceExecutor = Pick<Db, 'execute'>;

@Injectable()
export class SequenceService {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  async next(
    organizationId: string,
    entityType: EntityType,
    executor?: SequenceExecutor,
  ): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = {
      requisition: NUMBER_PREFIXES.REQUISITION,
      purchase_order: NUMBER_PREFIXES.PURCHASE_ORDER,
      goods_receipt: NUMBER_PREFIXES.GOODS_RECEIPT,
      invoice: NUMBER_PREFIXES.INVOICE,
      rfq: NUMBER_PREFIXES.RFQ,
    }[entityType];

    const generate = async (connection: SequenceExecutor) => {
      await connection.execute(sql`
        INSERT INTO sequences (id, organization_id, entity_type, year, last_value, updated_at)
        VALUES (gen_random_uuid(), ${organizationId}, ${entityType}, ${year}, 0, now())
        ON CONFLICT (organization_id, entity_type, year) DO NOTHING
      `);
      const rows = await connection.execute(sql`
        SELECT id, last_value FROM sequences
        WHERE organization_id = ${organizationId}
          AND entity_type = ${entityType}
          AND year = ${year}
        FOR UPDATE
      `);
      const row = (rows as unknown as Array<{ id: string; last_value: number }>)[0];
      if (!row) throw new Error(`Failed to lock ${entityType} sequence`);
      const nextValue = Number(row.last_value) + 1;
      await connection.execute(sql`
        UPDATE sequences SET last_value = ${nextValue}, updated_at = now()
        WHERE id = ${row.id}
      `);
      return nextValue;
    };
    const result = executor
      ? await generate(executor)
      : await this.db.transaction((tx) => generate(tx));
    if (!Number.isInteger(result) || result < 1) {
      throw new Error(`Failed to generate ${entityType} sequence`);
    }

    const seq = String(result).padStart(4, '0');
    return `${prefix}-${year}-${seq}`;
  }
}
