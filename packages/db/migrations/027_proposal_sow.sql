-- Statements of work on proposals: scope, deliverables, a milestone plan (amounts summing
-- to the bid price), assumptions, exclusions and revision rounds. When the buyer awards
-- the bid, GET /proposals/:id/contract-draft turns the plan into escrow milestones.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sow JSONB;
