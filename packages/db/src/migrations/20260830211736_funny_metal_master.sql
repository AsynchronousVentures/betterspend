-- Expand-only: leave any legacy negative values untouched; the reminder scan excludes them until a controlled validation pass.
ALTER TABLE "contract_obligations" ADD CONSTRAINT "contract_obligations_notification_lead_days_check" CHECK ("contract_obligations"."notification_lead_days" >= 0) NOT VALID;
