SET LOCAL lock_timeout = '5s';--> statement-breakpoint
SET LOCAL statement_timeout = '30s';--> statement-breakpoint
ALTER TABLE "budget_commitment_events" DROP CONSTRAINT "budget_commitment_events_budget_id_budgets_id_fk";
--> statement-breakpoint
ALTER TABLE "budget_commitment_events" DROP CONSTRAINT "budget_commitment_events_requisition_id_requisitions_id_fk";
--> statement-breakpoint
ALTER TABLE "budget_commitment_events" DROP CONSTRAINT "budget_commitment_events_purchase_order_id_purchase_orders_id_fk";
--> statement-breakpoint
ALTER TABLE "budget_commitment_events" DROP CONSTRAINT "budget_commitment_events_invoice_id_invoices_id_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "requisitions_id_organization_id_unique" ON "requisitions" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_id_organization_id_unique" ON "purchase_orders" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_id_organization_id_unique" ON "invoices" USING btree ("id","organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_id_organization_id_unique" ON "budgets" USING btree ("id","organization_id");--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_budget_org_fk" FOREIGN KEY ("budget_id","organization_id") REFERENCES "public"."budgets"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_requisition_org_fk" FOREIGN KEY ("requisition_id","organization_id") REFERENCES "public"."requisitions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_purchase_order_org_fk" FOREIGN KEY ("purchase_order_id","organization_id") REFERENCES "public"."purchase_orders"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_invoice_org_fk" FOREIGN KEY ("invoice_id","organization_id") REFERENCES "public"."invoices"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_commitment_events" ADD CONSTRAINT "budget_commitment_events_event_type_check" CHECK ("budget_commitment_events"."event_type" in ('requisition_reserved', 'requisition_released', 'purchase_order_committed', 'purchase_order_reduced', 'purchase_order_released', 'invoice_expended', 'legacy_commitment_backfill', 'legacy_reservation_backfill'));
