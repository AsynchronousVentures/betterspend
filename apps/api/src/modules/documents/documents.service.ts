import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { documents } from '@betterspend/db';
import { StorageService } from '../../common/storage/storage.service';

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  async upload(
    orgId: string,
    userId: string,
    file: Express.Multer.File,
    entityType: string,
    entityId: string,
  ) {
    const key = `${orgId}/${entityType}/${Date.now()}-${file.originalname}`;

    await this.storage.upload(key, file.buffer, file.mimetype);

    const [doc] = await this.db
      .insert(documents)
      .values({
        organizationId: orgId,
        uploadedBy: userId,
        filename: file.originalname,
        contentType: file.mimetype,
        sizeBytes: file.size,
        storageKey: key,
        entityType,
        entityId,
      })
      .returning();

    return doc;
  }

  async list(orgId: string, entityType?: string, entityId?: string) {
    return this.db.query.documents.findMany({
      where: (d, { and: qand, eq: qeq }) => {
        const conditions = [qeq(d.organizationId, orgId)];
        if (entityType) conditions.push(qeq(d.entityType, entityType));
        if (entityId) conditions.push(qeq(d.entityId, entityId));
        return conditions.length === 1 ? conditions[0] : qand(...(conditions as [any, ...any[]]));
      },
      orderBy: (d, { desc }) => desc(d.createdAt),
    });
  }

  async getDownloadUrl(orgId: string, documentId: string): Promise<{ url: string }> {
    const doc = await this.db.query.documents.findFirst({
      where: (d, { and: qand, eq: qeq }) =>
        qand(qeq(d.id, documentId), qeq(d.organizationId, orgId)),
    });

    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

    const url = await this.storage.getPresignedUrl(doc.storageKey);
    return { url };
  }

  async getTextContent(orgId: string, documentId: string): Promise<string | null> {
    const doc = await this.db.query.documents.findFirst({
      where: (d, { and: qand, eq: qeq }) =>
        qand(qeq(d.id, documentId), qeq(d.organizationId, orgId)),
    });

    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);
    const textLike = /^(text\/|application\/(json|xml|csv|x-ndjson))/i.test(doc.contentType);
    if (!textLike) return null;

    const buffer = await this.storage.getBuffer(doc.storageKey);
    return buffer.toString('utf8');
  }

  async delete(orgId: string, documentId: string): Promise<void> {
    const doc = await this.db.query.documents.findFirst({
      where: (d, { and: qand, eq: qeq }) =>
        qand(qeq(d.id, documentId), qeq(d.organizationId, orgId)),
    });

    if (!doc) throw new NotFoundException(`Document ${documentId} not found`);

    await this.storage.delete(doc.storageKey);

    await this.db
      .delete(documents)
      .where(and(eq(documents.id, documentId), eq(documents.organizationId, orgId)));
  }
}
