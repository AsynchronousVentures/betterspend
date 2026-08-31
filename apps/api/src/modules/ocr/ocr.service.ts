import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { DB_TOKEN } from '../../database/database.module';
import type { Db } from '@betterspend/db';
import { invoices, ocrJobs } from '@betterspend/db';
import { AiRuntimeService } from '../ai-providers/ai-runtime.service';
import { InvoiceReviewsService } from '../invoice-reviews/invoice-reviews.service';
import { InvoiceReviewProvenanceService } from '../invoice-reviews/invoice-review-provenance.service';

export interface OcrExtractedLine {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  glAccount: string | null;
}

export interface OcrExtractedData {
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // ISO date string
  dueDate: string | null;
  currency: string | null;
  subtotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  lines: OcrExtractedLine[];
}

export interface OcrConfidence {
  vendorName: number;
  invoiceNumber: number;
  invoiceDate: number;
  dueDate: number;
  totalAmount: number;
  lines: number;
  overall: number;
}

function isOcrConfidence(value: unknown): value is OcrConfidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every((score) => typeof score === 'number' && Number.isFinite(score));
}

function ocrSignalStatus(status: string): 'pending' | 'processing' | 'done' | 'failed' {
  if (status === 'pending' || status === 'processing' || status === 'done' || status === 'failed') {
    return status;
  }
  return 'processing';
}

const EXTRACTION_PROMPT = `You are an invoice data extraction expert. Analyze this invoice image and extract all structured data.

Return a JSON object with exactly this structure (use null for missing fields):
{
  "vendorName": string | null,
  "invoiceNumber": string | null,
  "invoiceDate": "YYYY-MM-DD" | null,
  "dueDate": "YYYY-MM-DD" | null,
  "currency": "USD" | "EUR" | "GBP" | ... | null,
  "subtotal": number | null,
  "taxAmount": number | null,
  "totalAmount": number | null,
  "lines": [
    {
      "description": string,
      "quantity": number,
      "unitPrice": number,
      "totalPrice": number,
      "glAccount": string | null
    }
  ],
  "confidence": {
    "vendorName": 0.0-1.0,
    "invoiceNumber": 0.0-1.0,
    "invoiceDate": 0.0-1.0,
    "dueDate": 0.0-1.0,
    "totalAmount": 0.0-1.0,
    "lines": 0.0-1.0,
    "overall": 0.0-1.0
  }
}

Return ONLY the JSON object with no additional text or markdown.`;

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    @Inject(DB_TOKEN) private readonly db: Db,
    @InjectQueue('ocr') private readonly ocrQueue: Queue,
    private readonly aiRuntime: AiRuntimeService,
    private readonly invoiceReviews: InvoiceReviewsService,
    private readonly invoiceProvenance: InvoiceReviewProvenanceService,
  ) {}

  async createJob(input: {
    organizationId: string;
    uploadedBy: string;
    filename: string;
    contentType: string;
    storageKey: string;
    base64Data?: string;
  }) {
    const { base64Data, ...jobData } = input;
    const [job] = await this.db
      .insert(ocrJobs)
      .values({
        ...jobData,
        status: 'pending',
        // Temporarily store base64 in extractedData until extraction runs
        ...(base64Data
          ? { extractedData: { _rawBase64: base64Data, _contentType: input.contentType } as any }
          : {}),
      })
      .returning();

    // Enqueue extraction job via BullMQ
    await this.ocrQueue.add(
      'extract',
      { jobId: job.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    return job;
  }

  async findJob(id: string, organizationId: string) {
    const job = await this.db.query.ocrJobs.findFirst({
      where: (j, { and, eq }) => and(eq(j.id, id), eq(j.organizationId, organizationId)),
    });
    if (!job) throw new NotFoundException(`OCR job ${id} not found`);
    return job;
  }

  async findAll(organizationId: string) {
    return this.db.query.ocrJobs.findMany({
      where: (j, { eq }) => eq(j.organizationId, organizationId),
      orderBy: (j, { desc }) => desc(j.createdAt),
      limit: 50,
    });
  }

  async linkToInvoice(jobId: string, invoiceId: string, organizationId: string) {
    const linkedAt = new Date();
    const job = await this.db.transaction(async (tx) => {
      const [currentJob] = await tx
        .select()
        .from(ocrJobs)
        .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.organizationId, organizationId)))
        .for('update');
      if (!currentJob) throw new NotFoundException(`OCR job ${jobId} not found`);
      const [invoice] = await tx
        .select({ id: invoices.id })
        .from(invoices)
        .where(and(eq(invoices.id, invoiceId), eq(invoices.organizationId, organizationId)))
        .limit(1);
      if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);
      const extractionCompletedAt = currentJob.status === 'done' ? currentJob.updatedAt : null;
      const [updated] = await tx
        .update(ocrJobs)
        .set({ invoiceId, updatedAt: linkedAt })
        .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.organizationId, organizationId)))
        .returning();
      return {
        ...(updated ?? { ...currentJob, invoiceId, updatedAt: linkedAt }),
        extractionCompletedAt,
      };
    });
    await this.recordReviewObservation(job, linkedAt);
  }

  async runExtractionById(jobId: string): Promise<void> {
    const initialJob = await this.db.query.ocrJobs.findFirst({
      where: (j, { eq }) => eq(j.id, jobId),
    });
    if (!initialJob) throw new NotFoundException(`OCR job ${jobId} not found`);
    const startedAt = new Date();
    await this.db
      .update(ocrJobs)
      .set({ status: 'processing', updatedAt: startedAt })
      .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.organizationId, initialJob.organizationId)));

    try {
      // Retrieve the job to get stored base64 data
      const job = await this.db.query.ocrJobs.findFirst({
        where: (j, { and, eq }) =>
          and(eq(j.id, jobId), eq(j.organizationId, initialJob.organizationId)),
      });

      const storedData = job?.extractedData as any;
      const rawBase64: string | undefined = storedData?._rawBase64;
      const contentType: string = storedData?._contentType ?? 'image/jpeg';

      let extracted: OcrExtractedData;
      let confidence: OcrConfidence;

      if (job && rawBase64) {
        const result = await this.runAiExtraction(job.organizationId, rawBase64, contentType);
        if (result) {
          extracted = result.extracted;
          confidence = result.confidence;
        } else {
          extracted = this.stubExtractedData();
          confidence = this.stubConfidence();
          this.logger.warn(`OCR job ${jobId}: no AI provider configured, using stub`);
        }
      } else {
        // Stub fallback
        extracted = this.stubExtractedData();
        confidence = this.stubConfidence();
        this.logger.warn(`OCR job ${jobId}: no image data provided`);
      }

      const completedAt = new Date();
      await this.db
        .update(ocrJobs)
        .set({
          status: 'done',
          extractedData: extracted as unknown as Record<string, unknown>,
          confidence: confidence as unknown as Record<string, unknown>,
          updatedAt: completedAt,
        })
        .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.organizationId, initialJob.organizationId)));
      const latestJob = await this.db.query.ocrJobs.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, jobId), eq(record.organizationId, initialJob.organizationId)),
      });
      const completedJob = latestJob ?? job;
      if (completedJob?.invoiceId) {
        await this.recordReviewObservation(
          {
            ...completedJob,
            status: 'done',
            extractedData: extracted,
            confidence,
            updatedAt: completedAt,
          },
          completedAt,
        );
      }
    } catch (err: unknown) {
      const failedAt = new Date();
      await this.db
        .update(ocrJobs)
        .set({ status: 'failed', errorMessage: String(err), updatedAt: failedAt })
        .where(and(eq(ocrJobs.id, jobId), eq(ocrJobs.organizationId, initialJob.organizationId)));
      const latestJob = await this.db.query.ocrJobs.findFirst({
        where: (record, { and, eq }) =>
          and(eq(record.id, jobId), eq(record.organizationId, initialJob.organizationId)),
      });
      const failedJob = latestJob ?? initialJob;
      if (failedJob.invoiceId) {
        await this.recordReviewObservation(
          {
            ...failedJob,
            status: 'failed',
            errorMessage: String(err),
            updatedAt: failedAt,
          },
          failedAt,
        );
      }
      throw err;
    }
  }

  private async recordReviewObservation(
    job: {
      organizationId: string;
      invoiceId: string | null;
      id: string;
      status: string;
      extractedData?: unknown;
      confidence?: unknown;
      updatedAt?: Date;
      extractionCompletedAt?: Date | null;
      errorMessage?: string | null;
    },
    observedAt: Date,
  ): Promise<void> {
    if (!job.invoiceId) return;
    if (job.status === 'done') {
      try {
        await this.invoiceProvenance.recordOcrProvenance({
          organizationId: job.organizationId,
          invoiceId: job.invoiceId,
          sourceRecordId: job.id,
          extractedData: job.extractedData,
          confidence: job.confidence,
          sourceTimestamp: job.extractionCompletedAt ?? observedAt,
          observedAt,
        });
      } catch (error: unknown) {
        this.logger.warn(
          `Could not record OCR provenance for job ${job.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    try {
      await this.invoiceReviews.recordOcrReviewSignal({
        organizationId: job.organizationId,
        invoiceId: job.invoiceId,
        sourceRecordId: job.id,
        status: ocrSignalStatus(job.status),
        confidence: isOcrConfidence(job.confidence) ? job.confidence : undefined,
        observedAt,
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Could not record invoice review observation for OCR job ${job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async runAiExtraction(
    organizationId: string,
    base64Data: string,
    contentType: string,
  ): Promise<{ extracted: OcrExtractedData; confidence: OcrConfidence } | null> {
    const text = await this.aiRuntime.generateVision(
      organizationId,
      EXTRACTION_PROMPT,
      base64Data,
      contentType,
      2048,
    );
    if (!text) return null;

    // Strip markdown code blocks if present
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    const parsed = JSON.parse(json);

    const extracted: OcrExtractedData = {
      vendorName: parsed.vendorName ?? null,
      invoiceNumber: parsed.invoiceNumber ?? null,
      invoiceDate: parsed.invoiceDate ?? null,
      dueDate: parsed.dueDate ?? null,
      currency: parsed.currency ?? 'USD',
      subtotal: parsed.subtotal != null ? Number(parsed.subtotal) : null,
      taxAmount: parsed.taxAmount != null ? Number(parsed.taxAmount) : null,
      totalAmount: parsed.totalAmount != null ? Number(parsed.totalAmount) : null,
      lines: Array.isArray(parsed.lines)
        ? parsed.lines.map((l: any) => ({
            description: String(l.description ?? ''),
            quantity: Number(l.quantity ?? 1),
            unitPrice: Number(l.unitPrice ?? 0),
            totalPrice: Number(l.totalPrice ?? 0),
            glAccount: l.glAccount ?? null,
          }))
        : [],
    };

    const conf = parsed.confidence ?? {};
    const confidence: OcrConfidence = {
      vendorName: Number(conf.vendorName ?? 0),
      invoiceNumber: Number(conf.invoiceNumber ?? 0),
      invoiceDate: Number(conf.invoiceDate ?? 0),
      dueDate: Number(conf.dueDate ?? 0),
      totalAmount: Number(conf.totalAmount ?? 0),
      lines: Number(conf.lines ?? 0),
      overall: Number(conf.overall ?? 0),
    };

    return { extracted, confidence };
  }

  private stubExtractedData(): OcrExtractedData {
    return {
      vendorName: null,
      invoiceNumber: null,
      invoiceDate: null,
      dueDate: null,
      currency: 'USD',
      subtotal: null,
      taxAmount: null,
      totalAmount: null,
      lines: [],
    };
  }

  private stubConfidence(): OcrConfidence {
    return {
      vendorName: 0,
      invoiceNumber: 0,
      invoiceDate: 0,
      dueDate: 0,
      totalAmount: 0,
      lines: 0,
      overall: 0,
    };
  }
}
