import { Injectable, Inject, Logger, BadRequestException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { vendors } from '@betterspend/db';
import type {
  PunchOutSetupRequest,
  PunchOutSetupResponse,
  PunchOutOrderMessage,
  CxmlCartItem,
} from './cxml.types';
import type { AccessPolicy } from '../auth/access-policy';
import { scopedVendorPredicate } from '../auth/operational-access';

// In-memory session store (replace with Redis in production)
const sessions = new Map<
  string,
  { vendorId: string; buyerCookie: string; returnUrl: string; createdAt: Date }
>();

@Injectable()
export class PunchoutService {
  private readonly logger = new Logger(PunchoutService.name);

  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  /**
   * Handles a PunchOutSetupRequest from a buyer system.
   * Creates a session token and returns a start-page URL.
   *
   * Phase 5b: validate sharedSecret HMAC, serve a real hosted catalog page.
   */
  async handleSetupRequest(
    vendorId: string,
    organizationId: string,
    request: PunchOutSetupRequest,
    access?: AccessPolicy,
  ): Promise<PunchOutSetupResponse> {
    const vendor = await this.db.query.vendors.findFirst({
      where: (v, { and, eq }) =>
        and(
          eq(v.id, vendorId),
          eq(v.organizationId, organizationId),
          scopedVendorPredicate(this.db, organizationId, access, 'catalog', 'catalog:view', v.id),
        ),
    });

    if (!vendor) {
      throw new BadRequestException(`Vendor ${vendorId} not found`);
    }

    if (!vendor.punchoutEnabled) {
      throw new BadRequestException(`Punchout is not enabled for vendor ${vendor.name}`);
    }

    const sessionToken = randomBytes(32).toString('hex');
    sessions.set(sessionToken, {
      vendorId,
      buyerCookie: request.buyerCookie,
      returnUrl: request.browserFormPost.url,
      createdAt: new Date(),
    });

    // In production: URL points to hosted catalog page, includes sessionToken
    const startPageUrl = `${process.env.WEB_URL ?? 'http://localhost:3100'}/punchout/catalog?session=${sessionToken}&vendor=${vendorId}`;

    this.logger.log(`Punchout session created: ${sessionToken} for vendor ${vendor.name}`);

    return {
      status: { code: 200, text: 'OK' },
      startPage: { url: startPageUrl },
    };
  }

  /**
   * Handles the OrderMessage POST when the user returns from the vendor catalog.
   * Converts cart items to requisition line format.
   *
   * Phase 5b: validate session, create a draft requisition from the cart.
   */
  async handleOrderReturn(
    sessionToken: string,
    message: PunchOutOrderMessage,
  ): Promise<{ sessionToken: string; vendorId: string; lines: ReturnType<typeof mapCartItem>[] }> {
    const session = sessions.get(sessionToken);
    if (!session) {
      throw new BadRequestException(`Invalid or expired punchout session`);
    }

    const lines = message.itemIn.map(mapCartItem);

    this.logger.log(
      `Punchout return: session ${sessionToken}, ${lines.length} items, buyer cookie ${message.buyerCookie}`,
    );

    // Clean up session
    sessions.delete(sessionToken);

    return { sessionToken, vendorId: session.vendorId, lines };
  }

  getSession(token: string) {
    return sessions.get(token) ?? null;
  }
}

function mapCartItem(item: CxmlCartItem) {
  return {
    description: item.description,
    quantity: item.quantity,
    unitOfMeasure: item.unitOfMeasure ?? 'each',
    unitPrice: item.unitPrice,
    vendorPartId: item.supplierPartId ?? null,
    extrinsic: item.extrinsic ?? {},
  };
}
