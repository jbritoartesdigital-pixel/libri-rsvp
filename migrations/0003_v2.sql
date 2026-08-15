-- =========================================================
-- LIBRI RSVP
-- MIGRAÇÃO V2
--
-- V2:
-- - nova personalização visual
-- - fundo por imagem ou vídeo
-- - textos públicos personalizáveis
-- - permissões configuráveis para a cliente
-- - lista fechada estrita ou flexível
-- - limite individual por família
-- - nome opcional do grupo/família
-- - presença individual por pessoa
-- - distinção entre pessoa pré-cadastrada e adicionada pelo convidado
-- - armazenamento de mídias enviadas ao R2
-- =========================================================


-- =========================================================
-- EVENTOS
-- =========================================================

ALTER TABLE events
ADD COLUMN background_type TEXT NOT NULL DEFAULT 'none'
CHECK (
  background_type IN (
    'none',
    'image',
    'video'
  )
);


ALTER TABLE events
ADD COLUMN background_video_url TEXT;


ALTER TABLE events
ADD COLUMN appearance_settings TEXT NOT NULL DEFAULT '{}';


ALTER TABLE events
ADD COLUMN public_texts TEXT NOT NULL DEFAULT '{}';


ALTER TABLE events
ADD COLUMN client_permissions TEXT NOT NULL DEFAULT '{}';


ALTER TABLE events
ADD COLUMN list_behavior TEXT NOT NULL DEFAULT 'strict'
CHECK (
  list_behavior IN (
    'strict',
    'flexible'
  )
);


-- Eventos antigos que já possuem imagem de fundo
-- continuam usando essa imagem na V2.

UPDATE events

SET background_type = 'image'

WHERE
  background_image_url IS NOT NULL
  AND trim(background_image_url) <> '';


-- =========================================================
-- CONFIRMAÇÕES / FAMÍLIAS
-- =========================================================

ALTER TABLE guests
ADD COLUMN group_label TEXT;


ALTER TABLE guests
ADD COLUMN normalized_group_label TEXT;


ALTER TABLE guests
ADD COLUMN max_people_allowed INTEGER
CHECK (
  max_people_allowed IS NULL
  OR (
    max_people_allowed >= 1
    AND max_people_allowed <= 100
  )
);


ALTER TABLE guests
ADD COLUMN responded_at TEXT;


-- =========================================================
-- PESSOAS INDIVIDUAIS
-- =========================================================

ALTER TABLE guest_members
ADD COLUMN attendance_status TEXT NOT NULL DEFAULT 'pending'
CHECK (
  attendance_status IN (
    'pending',
    'yes',
    'no'
  )
);


ALTER TABLE guest_members
ADD COLUMN is_preapproved INTEGER NOT NULL DEFAULT 1
CHECK (
  is_preapproved IN (
    0,
    1
  )
);


-- =========================================================
-- MIGRAÇÃO DOS STATUS JÁ EXISTENTES
--
-- Se uma confirmação antiga já estava confirmada,
-- seus membros existentes passam a aparecer como confirmados.
--
-- Se estava pendente, continuam pendentes.
-- =========================================================

UPDATE guest_members

SET attendance_status =
  COALESCE(
    (
      SELECT
        CASE

          WHEN g.response_status = 'yes'
          THEN 'yes'

          WHEN g.response_status = 'no'
          THEN 'no'

          ELSE 'pending'

        END

      FROM guests g

      WHERE g.id = guest_members.guest_id

      LIMIT 1
    ),
    'pending'
  );


-- =========================================================
-- MÍDIAS DO EVENTO
--
-- Registro das imagens e vídeos enviados ao Cloudflare R2.
-- O arquivo físico ficará no R2.
-- Esta tabela guarda os dados necessários para administrá-lo.
-- =========================================================

CREATE TABLE IF NOT EXISTS event_media (
  id TEXT PRIMARY KEY,

  event_id TEXT NOT NULL,

  object_key TEXT NOT NULL UNIQUE,

  public_url TEXT NOT NULL,

  media_kind TEXT NOT NULL
    CHECK (
      media_kind IN (
        'background_image',
        'background_video',
        'cover',
        'logo',
        'other'
      )
    ),

  mime_type TEXT NOT NULL,

  original_name TEXT,

  size_bytes INTEGER NOT NULL DEFAULT 0,

  created_at TEXT NOT NULL,

  deleted_at TEXT,

  FOREIGN KEY (event_id)
    REFERENCES events(id)
    ON DELETE CASCADE
);


-- =========================================================
-- ÍNDICES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_event_media_event
ON event_media(event_id);


CREATE INDEX IF NOT EXISTS idx_event_media_deleted
ON event_media(
  event_id,
  deleted_at
);


CREATE INDEX IF NOT EXISTS idx_guests_event_group
ON guests(
  event_id,
  normalized_group_label
);


CREATE INDEX IF NOT EXISTS idx_guests_event_responded
ON guests(
  event_id,
  responded_at
);


CREATE INDEX IF NOT EXISTS idx_guest_members_event_attendance
ON guest_members(
  event_id,
  attendance_status
);


CREATE INDEX IF NOT EXISTS idx_guest_members_event_preapproved
ON guest_members(
  event_id,
  is_preapproved
);
