import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  GetBucketLifecycleConfigurationCommand,
  HeadBucketCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';
import type { LifecycleRule } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly publicClient: S3Client;
  private readonly bucket: string;

  constructor() {
    const endpoint =
      process.env.MINIO_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:9000';
    const publicEndpoint =
      process.env.MINIO_PUBLIC_ENDPOINT ?? process.env.S3_PUBLIC_ENDPOINT ?? endpoint;
    const accessKeyId = process.env.MINIO_ACCESS_KEY ?? process.env.S3_ACCESS_KEY ?? 'minioadmin';
    const secretAccessKey =
      process.env.MINIO_SECRET_KEY ?? process.env.S3_SECRET_KEY ?? 'minioadmin';
    const region = process.env.MINIO_REGION ?? process.env.S3_REGION ?? 'us-east-1';
    this.bucket = process.env.MINIO_BUCKET ?? process.env.S3_BUCKET ?? 'betterspend';

    this.client = new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // required for MinIO
    });
    this.publicClient = new S3Client({
      endpoint: publicEndpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  async onModuleInit() {
    await this.ensureBucket();
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket "${this.bucket}" already exists`);
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket "${this.bucket}" created`);
      } catch (err: any) {
        // BucketAlreadyOwnedByYou is fine — another process may have created it concurrently
        if (err?.Code !== 'BucketAlreadyOwnedByYou') {
          this.logger.error(`Failed to create bucket "${this.bucket}": ${err?.message}`);
        }
      }
    }
  }

  async upload(key: string, buffer: Buffer, mimetype: string): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      }),
    );
    return key;
  }

  async getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.publicClient, command, { expiresIn });
  }

  async getBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = response.Body;
    if (!body) return Buffer.alloc(0);
    if ('transformToByteArray' in body && typeof body.transformToByteArray === 'function') {
      return Buffer.from(await body.transformToByteArray());
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Merge a prefix-specific expiry rule without replacing unrelated bucket lifecycle rules. */
  async ensureExpirationRule(id: string, prefix: string, days: number): Promise<void> {
    let rules: LifecycleRule[] = [];
    try {
      const current = await this.client.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: this.bucket }),
      );
      rules = current.Rules ?? [];
    } catch (error: unknown) {
      const name = error instanceof Error ? error.name : '';
      if (name !== 'NoSuchLifecycleConfiguration' && name !== 'NoSuchConfiguration') {
        throw error;
      }
    }

    const desired = {
      ID: id,
      Status: 'Enabled' as const,
      Filter: { Prefix: prefix },
      Expiration: { Days: days },
    };
    const existing = rules.find((rule) => rule.ID === id);
    if (
      existing?.Status === desired.Status &&
      existing.Filter?.Prefix === prefix &&
      existing.Expiration?.Days === days
    ) {
      return;
    }

    await this.client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: this.bucket,
        LifecycleConfiguration: {
          Rules: [...rules.filter((rule) => rule.ID !== id), desired],
        },
      }),
    );
  }
}
