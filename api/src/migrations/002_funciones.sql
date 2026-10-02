-- Quita tildes sin depender de la extensión unaccent (conserva la Ñ)
CREATE OR REPLACE FUNCTION unaccent_simple(t TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT translate(t, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu')
$$;
