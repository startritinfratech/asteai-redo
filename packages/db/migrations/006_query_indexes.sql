-- Migration: 006_query_indexes.sql
-- Indexes for queries added or tightened in the API security pass.
-- Runs inside a transaction (packages/db/migrate.mjs), so no CONCURRENTLY.

-- Email worker: reclaiming rows stuck in 'sending' after a crash looks them up by claimed_at.
CREATE INDEX IF NOT EXISTS idx_email_outbox_sending
  ON email_outbox (claimed_at) WHERE status = 'sending';

-- Integrity queue: open flags oldest first, and the tenant filter joins on result_id.
CREATE INDEX IF NOT EXISTS idx_integrity_queue_status_created
  ON integrity_queue (status, created_at);
CREATE INDEX IF NOT EXISTS idx_integrity_queue_result
  ON integrity_queue (result_id);

-- Applications by assessment result: employer access to results and the integrity
-- queue tenant filter (applications a ON a.result_id = ... AND a.tenant_id = ...).
CREATE INDEX IF NOT EXISTS idx_applications_result
  ON applications (result_id) WHERE result_id IS NOT NULL;
