-- =========================================================
-- LIBRI RSVP
-- MIGRAÇÃO V1
--
-- Novidades:
-- - prazo de confirmação
-- - limite de pessoas por confirmação
-- - arquivamento de eventos
-- - mensagem carinhosa
-- - pessoas individuais por confirmação
-- - adulto / criança identificado individualmente
-- =========================================================


-- =========================================================
-- EVENTOS
-- =========================================================

ALTER TABLE events
ADD COLUMN rsvp_deadline TEXT;

ALTER TABLE events
ADD COLUMN max_people_per_rsvp INTEGER;

ALTER TABLE events
ADD COLUMN archived_at TEXT;


-- =========================================================
-- CONFIRMAÇÕES
-- =========================================================

ALTER TABLE guests
ADD COLUMN love_message TEXT;


-- =========================================================
-- PESSOAS VINCULADAS À CONFIRMAÇÃO
--
-- Uma confirmação poderá ter:
--
-- Maria Ferreira  | adulto | principal
-- João Ferreira   | adulto
-- Pedro Ferreira  | criança
--
-- Em vez de armazenar acompanhantes em texto.
-- =========================================================

CREATE TABLE IF NOT EXISTS guest_members (
  id TEXT PRIMARY KEY,

  guest_id TEXT NOT NULL,

  event_id TEXT NOT NULL,

  name TEXT NOT NULL,

  normalized_name TEXT NOT NULL,

  person_type TEXT NOT NULL DEFAULT 'adult'
    CHECK (
      person_type IN (
        'adult',
        'child'
      )
    ),

  is_primary INTEGER NOT NULL DEFAULT 0
    CHECK (
      is_primary IN (
        0,
        1
      )
    ),

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,

  updated_at TEXT NOT NULL,

  deleted_at TEXT,

  FOREIGN KEY (guest_id)
    REFERENCES guests(id)
    ON DELETE CASCADE,

  FOREIGN KEY (event_id)
    REFERENCES events(id)
    ON DELETE CASCADE
);


-- =========================================================
-- ÍNDICES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_guest_members_guest
ON guest_members(guest_id);

CREATE INDEX IF NOT EXISTS idx_guest_members_event
ON guest_members(event_id);

CREATE INDEX IF NOT EXISTS idx_guest_members_event_type
ON guest_members(
  event_id,
  person_type
);

CREATE INDEX IF NOT EXISTS idx_guest_members_event_name
ON guest_members(
  event_id,
  normalized_name
);

CREATE INDEX IF NOT EXISTS idx_guest_members_deleted
ON guest_members(
  guest_id,
  deleted_at
);

CREATE INDEX IF NOT EXISTS idx_events_archived
ON events(archived_at);

CREATE INDEX IF NOT EXISTS idx_events_rsvp_deadline
ON events(rsvp_deadline);


-- =========================================================
-- MIGRAÇÃO DOS REGISTROS ANTIGOS
--
-- Para cada confirmação já existente,
-- preservamos o titular como uma pessoa adulta principal.
--
-- Não inventamos nomes para antigos acompanhantes que
-- existiam apenas como quantidade ou texto.
-- =========================================================

INSERT INTO guest_members (
  id,
  guest_id,
  event_id,
  name,
  normalized_name,
  person_type,
  is_primary,
  sort_order,
  created_at,
  updated_at,
  deleted_at
)

SELECT
  'member_' || lower(hex(randomblob(16))),
  g.id,
  g.event_id,
  g.primary_name,
  g.normalized_name,
  'adult',
  1,
  0,
  g.created_at,
  g.updated_at,
  g.deleted_at

FROM guests g

WHERE NOT EXISTS (
  SELECT 1
  FROM guest_members gm
  WHERE gm.guest_id = g.id
    AND gm.is_primary = 1
);


-- =========================================================
-- FIM DA MIGRAÇÃO V1
-- =========================================================
