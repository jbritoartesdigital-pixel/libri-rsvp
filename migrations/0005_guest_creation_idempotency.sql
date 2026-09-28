-- =========================================================
-- LIBRI RSVP
-- MIGRAÇÃO V4
-- Arquivo: migrations/0005_guest_creation_idempotency.sql
--
-- Impede que a MESMA tentativa de criação gere duas famílias.
-- A chave é da requisição, não do nome.
-- Homônimos continuam permitidos.
-- =========================================================

ALTER TABLE guests
ADD COLUMN creation_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_event_creation_request
ON guests (
  event_id,
  creation_request_id
)
WHERE creation_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_guests_creation_request
ON guests (
  creation_request_id
)
WHERE creation_request_id IS NOT NULL;
