import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const endpoint = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
    const accessKeyId = process.env.MINIO_ACCESS_KEY ?? 'minioadmin';
    const secretAccessKey = process.env.MINIO_SECRET_KEY ?? 'minioadmin';
    this.bucket = process.env.MINIO_BUCKET ?? 'betterspend';

    this.client = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // required for MinIO
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
    return getSignedUrl(this.client, command, { expiresIn });
  }

  async getBuffer(key: string): Promise<Buffer> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
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
}
