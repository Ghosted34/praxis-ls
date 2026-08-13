-- ============================================================================
-- TENANT DB — 0666 Marks tokens: how a container type prints on a B/L line.
--
-- WHY THIS EXISTS
--
-- Legacy generated "Marks & Numbers" from the container lines and made the
-- field read-only: 1 × 20' Reefer and 2 × 40' HC printed as `01*20'RF, 02*40'HC`
-- (operations-registry.php:641). That string is read by the final invoice, the
-- transit order, the delivery note and both costing packages — five documents
-- that would change what they print if we invented a new vocabulary. We are not
-- inventing marks; we are recovering a generator we regressed into a free-text
-- box.
--
-- The generator needs one thing the registry does not carry: the token legacy
-- prints for each type. `20HC` (the rate-lookup key in `extra.size`) is not
-- `20'HC` (what a B/L line says), and `REEFER` is not `RF`. Deriving it every
-- time would work for the seeded rows and guess for tenant-created ones, so the
-- token is stored where the type is.
--
-- THE VOCABULARY IS LEGACY'S, NOT A BETTER ONE
--
-- Sizes 20' / 40' / 45'; types DC / HC / OT / FR / RF, plus TK / VT / BU for the
-- kinds legacy never had. That has one consequence worth stating: a 40' HC
-- REEFER prints `40'RF`, the same as a 40' standard reefer, because legacy's
-- five type codes cannot say both "high cube" and "reefer" at once. A file
-- carrying both prints `02*40'RF, 01*40'RF`. Distinguishing them would mean a
-- token legacy never emitted, and the whole point of matching byte-for-byte is
-- that an old file and a new file print the same way. A tenant who prefers the
-- distinction edits the token — that is why it is a registry value and not a
-- rule in code.
--
-- The size-less legacy rows (FLATRACK, OPENTOP, REEFER, …) get the bare type
-- code. Most were retired by 9092 in favour of sized variants, but a tenant who
-- priced a rate against one keeps it, and a retired type still has to print.
-- ============================================================================

-- Sized dry: the HC is part of the TYPE in legacy's vocabulary, not the size.
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"20''DC"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FT20'   AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"20''HC"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FT20HC' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"40''DC"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FT40'   AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"40''HC"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FT40HC' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"45''HC"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FT45HC' AND NOT (extra ? 'marks_token');

-- Reefer. RF40HC collapses onto 40'RF — see the header.
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"20''RF"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'RF20'   AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"40''RF"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code IN ('RF40','RF40HC') AND NOT (extra ? 'marks_token');

-- Flat rack, open top, ISO tank, ventilated.
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"20''FR"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FR20' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"40''FR"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FR40' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"20''OT"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'OT20' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"40''OT"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'OT40' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"20''TK"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'TK20' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"40''TK"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'TK40' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"20''VT"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'VT20' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"40''VT"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'VT40' AND NOT (extra ? 'marks_token');

-- The size-less legacy rows: a bare type code, because there is no size to
-- print. Mostly retired by 9092, but a retired type still appears on the files
-- that used it.
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"FR"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'FLATRACK'   AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"OT"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'OPENTOP'    AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"RF"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'REEFER'     AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"TK"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'ISOTANK'    AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"VT"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'VENTILATED' AND NOT (extra ? 'marks_token');
UPDATE dictionary_ref SET extra = extra || '{"marks_token":"BU"}'::jsonb
 WHERE kind = 'CONTAINER_TYPE' AND code = 'BULK'       AND NOT (extra ? 'marks_token');

-- Sanity: every seeded type must print as something. A tenant-created type with
-- no token is fine — the generator derives one from size + family — but a
-- SEEDED one with none means this list fell out of step with the registry.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(code, ', ') INTO bad
    FROM dictionary_ref
   WHERE kind = 'CONTAINER_TYPE' AND is_system AND NOT (extra ? 'marks_token');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION '0666: seeded container type(s) with no marks_token — %', bad;
  END IF;
END $$;

-- DOWN
-- Removes the tokens; the generator falls back to deriving from size + family,
-- which is close but not byte-identical for the sized dry variants (40'HC would
-- derive correctly, but a 45' HC would not).
--
--   UPDATE dictionary_ref SET extra = extra - 'marks_token'
--    WHERE kind = 'CONTAINER_TYPE';
