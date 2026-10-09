-- Optional post-event privacy controls and auditable reversal of check-in.
ALTER TABLE events ADD COLUMN retention_days INTEGER
 CHECK(retention_days IS NULL OR retention_days BETWEEN 1 AND 3650);
ALTER TABLE events ADD COLUMN guest_data_purged_at TEXT;
CREATE TABLE IF NOT EXISTS checkin_reversals(
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id),
 checkin_id TEXT NOT NULL UNIQUE,
 guest_id TEXT NOT NULL,
 member_id TEXT,
 subject_key TEXT NOT NULL,
 original_created_at TEXT NOT NULL,
 original_source TEXT NOT NULL,
 reason TEXT NOT NULL,
 actor TEXT NOT NULL,
 reversed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checkin_reversals_event ON checkin_reversals(event_id,reversed_at);
