-- Optional age per child. Existing guests and events remain unchanged.
-- 0 means less than one completed year; unknown stays NULL.
ALTER TABLE guest_members ADD COLUMN child_age INTEGER
 CHECK (child_age IS NULL OR (child_age BETWEEN 0 AND 17));
CREATE INDEX IF NOT EXISTS idx_guest_members_child_age
 ON guest_members(event_id,attendance_status,person_type,child_age)
 WHERE deleted_at IS NULL;
