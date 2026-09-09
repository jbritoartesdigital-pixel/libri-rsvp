-- =========================================================
-- LIBRI RSVP
-- MIGRAÇÃO V3
--
-- Limites por composição para LISTA FLEXÍVEL:
-- - máximo de adultos por confirmação/família
-- - máximo de crianças por confirmação/família
--
-- Compatibilidade:
-- - famílias antigas continuam usando max_people_allowed
-- - NULL significa "sem limite específico por este tipo"
-- - 0 é permitido para bloquear totalmente aquele tipo
-- =========================================================

ALTER TABLE guests
ADD COLUMN max_adults_allowed INTEGER
CHECK (
  max_adults_allowed IS NULL
  OR (
    max_adults_allowed >= 0
    AND max_adults_allowed <= 100
  )
);

ALTER TABLE guests
ADD COLUMN max_children_allowed INTEGER
CHECK (
  max_children_allowed IS NULL
  OR (
    max_children_allowed >= 0
    AND max_children_allowed <= 100
  )
);

