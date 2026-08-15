PRAGMA foreign_keys = ON;

-- =========================================================
-- EVENTOS
-- =========================================================

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,

  event_date TEXT,
  event_time TEXT,

  rsvp_mode TEXT NOT NULL DEFAULT 'free'
    CHECK (rsvp_mode IN ('free', 'list')),

  welcome_message TEXT,

  primary_color TEXT NOT NULL DEFAULT '#6f4f5f',
  accent_color TEXT NOT NULL DEFAULT '#f4e8ed',
  background_image_url TEXT,

  extra_fields TEXT NOT NULL DEFAULT '{}',

  client_token TEXT UNIQUE,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_slug
ON events(slug);

CREATE INDEX IF NOT EXISTS idx_events_client_token
ON events(client_token);

CREATE INDEX IF NOT EXISTS idx_events_status
ON events(status);


-- =========================================================
-- CONVIDADOS / CONFIRMAÇÕES
-- =========================================================

CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,

  event_id TEXT NOT NULL,

  primary_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,

  response_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (response_status IN ('pending', 'yes', 'no')),

  phone TEXT,

  adults INTEGER NOT NULL DEFAULT 1
    CHECK (adults >= 0),

  children INTEGER NOT NULL DEFAULT 0
    CHECK (children >= 0),

  companions TEXT NOT NULL DEFAULT '[]',

  dietary TEXT,
  notes TEXT,

  source TEXT NOT NULL DEFAULT 'public'
    CHECK (source IN ('public', 'client', 'admin', 'import')),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  deleted_at TEXT,

  FOREIGN KEY (event_id)
    REFERENCES events(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_guests_event
ON guests(event_id);

CREATE INDEX IF NOT EXISTS idx_guests_event_status
ON guests(event_id, response_status);

CREATE INDEX IF NOT EXISTS idx_guests_event_name
ON guests(event_id, normalized_name);

CREATE INDEX IF NOT EXISTS idx_guests_deleted
ON guests(event_id, deleted_at);


-- =========================================================
-- HISTÓRICO DE ALTERAÇÕES
-- =========================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,

  event_id TEXT NOT NULL,

  guest_id TEXT,

  actor_role TEXT NOT NULL
    CHECK (actor_role IN ('admin', 'client', 'public', 'system')),

  action TEXT NOT NULL,

  details TEXT,

  created_at TEXT NOT NULL,

  FOREIGN KEY (event_id)
    REFERENCES events(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_event
ON audit_logs(event_id);

CREATE INDEX IF NOT EXISTS idx_audit_event_created
ON audit_logs(event_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_guest
ON audit_logs(guest_id);
