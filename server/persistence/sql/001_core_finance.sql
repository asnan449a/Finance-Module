CREATE TABLE IF NOT EXISTS finance_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  allowed_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS finance_users_role_idx ON finance_users (role);

CREATE TABLE IF NOT EXISTS finance_approval_matrix_versions (
  id TEXT PRIMARY KEY,
  version_number INTEGER NOT NULL,
  effective_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS finance_approval_matrix_versions_version_idx ON finance_approval_matrix_versions (version_number DESC);

CREATE TABLE IF NOT EXISTS finance_approval_events (
  id TEXT PRIMARY KEY,
  document_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS finance_approval_events_link_idx ON finance_approval_events (entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS finance_evidence_records (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  status TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS finance_evidence_link_idx ON finance_evidence_records (entity_type, entity_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS finance_journals (
  id TEXT PRIMARY KEY,
  journal_number TEXT NULL,
  entity TEXT NULL,
  status TEXT NOT NULL,
  posting_date DATE NULL,
  period_key TEXT NULL,
  journal_type TEXT NULL,
  source_type TEXT NULL,
  source_id TEXT NULL,
  source_root_type TEXT NULL,
  source_root_id TEXT NULL,
  consolidation_only BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS finance_journals_posting_idx ON finance_journals (posting_date DESC, journal_number);
CREATE INDEX IF NOT EXISTS finance_journals_source_idx ON finance_journals (source_type, source_id);
CREATE INDEX IF NOT EXISTS finance_journals_root_idx ON finance_journals (source_root_type, source_root_id);

CREATE TABLE IF NOT EXISTS finance_close_periods (
  period_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  closed_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS finance_close_periods_status_idx ON finance_close_periods (status, period_key DESC);
