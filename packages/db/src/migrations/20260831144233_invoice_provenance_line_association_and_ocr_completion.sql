ALTER TABLE "invoice_field_provenance" DROP CONSTRAINT "invoice_field_provenance_field_path_check";--> statement-breakpoint
ALTER TABLE "ocr_jobs" ADD COLUMN "extraction_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_field_provenance" ADD CONSTRAINT "invoice_field_provenance_field_path_check" CHECK ((
        ("invoice_field_provenance"."field_path" IN ('vendor', 'invoiceNumber', 'invoiceDate', 'dueDate', 'currency', 'exchangeRate', 'subtotal', 'taxAmount', 'totalAmount') AND "invoice_field_provenance"."invoice_line_id" IS NULL)
        OR ("invoice_field_provenance"."field_path" ~ '^lines\.[^.]+\.(description|quantity|unitPrice|poLineId|taxCodeId|glAccount|taxInclusive)$' AND "invoice_field_provenance"."invoice_line_id" IS NOT NULL)
      )
      );