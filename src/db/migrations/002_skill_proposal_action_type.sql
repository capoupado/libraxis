ALTER TABLE skill_proposals
ADD COLUMN action_type TEXT NOT NULL DEFAULT 'improve' CHECK(action_type IN ('improve','archive'));

CREATE INDEX IF NOT EXISTS ix_skill_proposals_status_action
  ON skill_proposals(status, action_type, created_at DESC);
