# Email AP intake

## Channel contract

Each organization receives one random 160-bit local part from `GET /api/v1/email-intake/address`. The address uses `EMAIL_INTAKE_DOMAIN` and cannot be chosen by an admin or inferred from the organization slug.

AWS SES writes raw MIME objects to the application S3 bucket under `EMAIL_INTAKE_RAW_PREFIX`. The API merges a 90-day expiration rule for that prefix with the bucket's existing lifecycle rules. Its AWS credentials need `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:GetLifecycleConfiguration`, and `s3:PutLifecycleConfiguration` access.

After the S3 receipt action, a Lambda or API Gateway integration posts the SES receipt event to:

```text
POST /api/v1/email-intake/ses-receipt
X-Email-Intake-Secret: <EMAIL_INTAKE_WEBHOOK_SECRET>
```

Set `rawStorageKey` on the event to `EMAIL_INTAKE_RAW_PREFIX + mail.messageId`. The endpoint also accepts `messageId`, `source`, `recipients`, `subject`, `receivedAt`, `rawStorageKey`, and a `verdicts` object directly. It queues work and returns HTTP 202. It never follows SNS subscription URLs. The endpoint HMAC-signs the normalized receipt, and the worker rejects modified Redis payloads.

Rejected-attachment replies use the operator-controlled `EMAIL_INTAKE_SMTP_*` relay only. Tenant SMTP settings are not used for this public ingress path. Leave `EMAIL_INTAKE_SMTP_HOST` empty to disable replies.

Use this receipt-rule order:

1. S3 action with the configured raw prefix.
2. Lambda action that forwards the receipt metadata and derived object key through the secret-authenticated endpoint.

## Processing rules

The `email-intake` worker parses raw MIME and considers non-inline attachments only. It accepts PDF, PNG, JPG, and WebP bytes, regardless of a misleading declared content type. It rejects archives, encrypted PDFs, files over 25 MB, and attachments after the first 10. Archive and encrypted-PDF rejections produce a sender reply when the fixed intake relay is configured and SPF, DMARC, and auto-submission checks pass.

SES spam, virus, SPF, DKIM, and DMARC verdicts are stored as risk signals. Authentication failures raise risk but do not reject the message. Attachments are promoted only after a `PASS` virus verdict; otherwise the raw message remains quarantined and its attachment outcomes are rejected. Sender trust is ranked as known vendor domain, employee domain, then unknown domain.

Accepted file hashes are deduplicated exactly within the organization. A normalized vendor and invoice-number match against existing invoices is recorded as a fuzzy duplicate risk signal and remains in human review.

## Durable records

- `email_intake_messages` stores the raw object key, envelope and header sender, recipients, SES verdicts, risk decision, and final attachment counts. A database trigger blocks updates and deletes.
- `email_intake_attachments` stores one pending, accepted, duplicate, or rejected outcome for every non-inline attachment.
- Accepted attachments create the existing `email_intake_items` review records and are stored under `email-intake/attachments/`.
- The message, pending attachment intents, and audit entry are committed together before attachment upload. A pending attachment becomes accepted and creates a review item only after its deterministic S3 object exists. Upload failures remain retryable and do not participate in exact-hash deduplication.

The channel never creates vendors, invoices, or requisitions automatically. Extraction and draft conversion remain separate stages behind human review.
