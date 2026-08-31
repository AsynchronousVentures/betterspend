ALTER TABLE "invoice_field_provenance" DROP CONSTRAINT "invoice_field_provenance_field_path_check";--> statement-breakpoint
ALTER TABLE "invoice_field_provenance" ADD CONSTRAINT "invoice_field_provenance_field_path_check" CHECK ((
        ("invoice_field_provenance"."field_path" IN ('vendor', 'invoiceNumber', 'invoiceDate', 'dueDate', 'currency', 'exchangeRate', 'subtotal', 'taxAmount', 'totalAmount') AND "invoice_field_provenance"."invoice_line_id" IS NULL)
        OR (
          "invoice_field_provenance"."field_path" ~ '^lines\.[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-8][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}\.(description|quantity|unitPrice|poLineId|taxCodeId|glAccount|taxInclusive)$'
          AND "invoice_field_provenance"."invoice_line_id" IS NOT NULL
          AND lower(split_part("invoice_field_provenance"."field_path", '.', 2)) = "invoice_field_provenance"."invoice_line_id"::text
        )
      )
      );