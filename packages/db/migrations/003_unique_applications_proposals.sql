-- One application per candidate per requisition, one proposal per expert per project.
-- Until now both were only de-duplicated in application code, which two concurrent
-- requests could slip past. The services now rely on these indexes (ON CONFLICT).
--
-- Stops with a clear error if duplicates already exist, instead of deleting anything.
-- Find them with:
--   SELECT requisition_id, candidate_id, COUNT(*) FROM applications GROUP BY 1, 2 HAVING COUNT(*) > 1;
--   SELECT project_id, expert_id, COUNT(*) FROM proposals GROUP BY 1, 2 HAVING COUNT(*) > 1;
--
-- The index builds lock writes on these two tables for the length of the build
-- (migrate.mjs runs each file in a transaction, so CONCURRENTLY is not available).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM applications GROUP BY requisition_id, candidate_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'applications has duplicate (requisition_id, candidate_id) rows; resolve them before this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM proposals GROUP BY project_id, expert_id HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'proposals has duplicate (project_id, expert_id) rows; resolve them before this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_applications_req_candidate ON applications (requisition_id, candidate_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposals_project_expert   ON proposals (project_id, expert_id);
