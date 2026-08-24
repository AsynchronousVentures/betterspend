# Email AP intake

## Channel contract

Each organization receives one random 160-bit local part from `GET /api/v1/email-intake/address`. The address uses `EMAIL_INTAKE_DOMAIN` and cannot be chosen by an admin or inferred from the organization slug.

AWS SES writes raw MIME objects to the application S3 bucket under `EMAIL_INTAKE_RAW_PREFIX`. The API merges a 90-day expiration rule for that prefix with the bucket's existing lifecycle rules. Its AWS credentials need `s3:GetObject`, `s3:GetLifecycleConfiguration`, and `s3:PutLifecycleConfiguration` access.

After the S3 receipt action, a Lambda or API Gateway integration posts the SES receipt event to:

```text
POST /api/v1/email-intake/ses-receipt
X-Email-Intake-Secret: <EMAIL_INTAKE_WEBHOOK_SECRET>
```

Set `rawStorageKey` on the event to `EMAIL_INTAKE_RAW_PREFIX + mail.messageId`. The endpoint also accepts `messageId`, `source`, `recipients`, `subject`, `receivedAt`, `rawStorageKey`, and a `verdicts` object directly. It queues work and returns HTTP 202. It never follows SNS subscription URLs.

Use this receipt-rule order:

1. S3 action with the configured raw prefix.
2. Lambda action that forwards the receipt metadata and derived object key through the secret-authenticated endpoint.

## Processing rules

The `email-intake` worker parses raw MIME and considers non-inline attachments only. It accepts PDF, PNG, JPG, and WebP bytes, regardless of a misleading declared content type. It rejects archives, encrypted PDFs, files over 25 MB, and attachments after the first 10. Archive and encrypted-PDF rejections produce a sender reply when organization SMTP is configured.

SES spam, virus, SPF, DKIM, and DMARC verdicts are stored as risk signals. Authentication failures raise risk but do not reject the message. Sender trust is ranked as known vendor domain, employee domain, then unknown domain.

Accepted file hashes are deduplicated exactly within the organization. A normalized vendor and invoice-number match against existing invoices is recorded as a fuzzy duplicate risk signal and remains in human review.

## Durable records

- `email_intake_messages` stores the raw object key, envelope and header sender, recipients, SES verdicts, risk decision, and final attachment counts. A database trigger blocks updates and deletes.
- `email_intake_attachments` stores one accepted, duplicate, or rejected outcome for every non-inline attachment.
- Accepted attachments create the existing `email_intake_items` review records and are stored under `email-intake/attachments/`.
- The message and its audit entry are committed together. Uploaded attachment objects are deleted if that transaction fails.

The channel never creates vendors, invoices, or requisitions automatically. Extraction and draft conversion remain separate stages behind human review.
