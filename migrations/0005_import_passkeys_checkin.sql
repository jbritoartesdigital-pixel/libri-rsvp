-- Libri RSVP | funções opcionais, sem impacto em eventos antigos
ALTER TABLE events ADD COLUMN checkin_mode TEXT NOT NULL DEFAULT 'off' CHECK(checkin_mode IN ('off','family','individual'));
ALTER TABLE events ADD COLUMN max_capacity INTEGER CHECK(max_capacity IS NULL OR (max_capacity BETWEEN 1 AND 100000));
ALTER TABLE events ADD COLUMN waitlist_enabled INTEGER NOT NULL DEFAULT 0 CHECK(waitlist_enabled IN (0,1));
ALTER TABLE guests ADD COLUMN qr_token TEXT;
ALTER TABLE guest_members ADD COLUMN qr_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_libri_guest_qr ON guests(qr_token) WHERE qr_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_libri_member_qr ON guest_members(qr_token) WHERE qr_token IS NOT NULL;
CREATE TABLE IF NOT EXISTS admin_passkeys (
  id TEXT PRIMARY KEY, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]', label TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  id TEXT PRIMARY KEY, challenge TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('register','login')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS import_batches(
  id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),
  file_name TEXT NOT NULL,source_type TEXT NOT NULL,created_at TEXT NOT NULL,
  undone_at TEXT
);
CREATE TABLE IF NOT EXISTS import_batch_items(
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  guest_id TEXT NOT NULL REFERENCES guests(id),
  PRIMARY KEY(batch_id,guest_id)
);
CREATE INDEX IF NOT EXISTS idx_import_batches_event ON import_batches(event_id,created_at);
CREATE TABLE IF NOT EXISTS waitlist_entries(
  id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),
  guest_id TEXT,request_json TEXT NOT NULL,display_name TEXT NOT NULL,
  people_count INTEGER NOT NULL,created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','promoted','cancelled')),
  promoted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_waitlist_event ON waitlist_entries(event_id,status,created_at);
CREATE TABLE IF NOT EXISTS reception_access (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),
 token_hash TEXT NOT NULL UNIQUE,label TEXT NOT NULL,
 created_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS event_checkins (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES events(id),
 guest_id TEXT NOT NULL REFERENCES guests(id),member_id TEXT,
 subject_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,source TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkins_event ON event_checkins(event_id,created_at);
-- Contagem inclui toda pessoa com status 'yes' e não excluída, de qualquer origem.
CREATE TRIGGER IF NOT EXISTS capacity_insert BEFORE INSERT ON guest_members
WHEN NEW.deleted_at IS NULL AND NEW.attendance_status='yes' AND
 (SELECT max_capacity FROM events WHERE id=NEW.event_id) IS NOT NULL AND
 (SELECT COUNT(*) FROM guest_members m JOIN guests g ON g.id=m.guest_id
  WHERE m.event_id=NEW.event_id AND m.deleted_at IS NULL AND g.deleted_at IS NULL
    AND m.attendance_status='yes') >= (SELECT max_capacity FROM events WHERE id=NEW.event_id)
BEGIN SELECT RAISE(ABORT,'CAPACITY_FULL'); END;
CREATE TRIGGER IF NOT EXISTS capacity_update BEFORE UPDATE OF attendance_status,deleted_at ON guest_members
WHEN NEW.deleted_at IS NULL AND NEW.attendance_status='yes' AND
 (OLD.deleted_at IS NOT NULL OR OLD.attendance_status<>'yes') AND
 (SELECT max_capacity FROM events WHERE id=NEW.event_id) IS NOT NULL AND
 (SELECT COUNT(*) FROM guest_members m JOIN guests g ON g.id=m.guest_id
  WHERE m.event_id=NEW.event_id AND m.deleted_at IS NULL AND g.deleted_at IS NULL
    AND m.attendance_status='yes') >= (SELECT max_capacity FROM events WHERE id=NEW.event_id)
BEGIN SELECT RAISE(ABORT,'CAPACITY_FULL'); END;
CREATE TRIGGER IF NOT EXISTS capacity_event BEFORE UPDATE OF max_capacity ON events
WHEN NEW.max_capacity IS NOT NULL AND NEW.max_capacity <
 (SELECT COUNT(*) FROM guest_members m JOIN guests g ON g.id=m.guest_id
   WHERE m.event_id=NEW.id AND m.deleted_at IS NULL AND g.deleted_at IS NULL
     AND m.attendance_status='yes')
BEGIN SELECT RAISE(ABORT,'CAPACITY_BELOW_CONFIRMED'); END;
CREATE TRIGGER IF NOT EXISTS revoke_guest_qr AFTER UPDATE OF response_status,deleted_at ON guests
WHEN NEW.response_status<>'yes' OR NEW.deleted_at IS NOT NULL
BEGIN
 UPDATE guests SET qr_token=NULL WHERE id=NEW.id;
 UPDATE guest_members SET qr_token=NULL WHERE guest_id=NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS revoke_member_qr AFTER UPDATE OF attendance_status,deleted_at ON guest_members
WHEN NEW.attendance_status<>'yes' OR NEW.deleted_at IS NOT NULL
BEGIN UPDATE guest_members SET qr_token=NULL WHERE id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS revoke_event_qr AFTER UPDATE OF checkin_mode,status,archived_at ON events
WHEN NEW.checkin_mode<>OLD.checkin_mode OR NEW.status<>'active' OR NEW.archived_at IS NOT NULL
BEGIN
 UPDATE guests SET qr_token=NULL WHERE event_id=NEW.id;
 UPDATE guest_members SET qr_token=NULL WHERE event_id=NEW.id;
END;