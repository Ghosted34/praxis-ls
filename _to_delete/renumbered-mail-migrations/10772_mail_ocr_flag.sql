-- PR-4 §8.6 — attachment field extraction gets its OWN switch.
--
-- Not folded into `mail.ai`, and that is the whole point of a separate row.
-- Drafting sends a thread's TEXT to a language model. Extraction sends a
-- SCANNED SUPPLIER INVOICE — bank details, amounts, signatures — to a vision
-- vendor. A tenant can reasonably want the first and refuse the second, and
-- with one flag for both that choice does not exist.
--
-- Defaults OFF like every other `mail.*` key (Q5: on for Smart Logistics, off
-- for every other tenant), and `ocr.enqueue.js` fails closed when the row is
-- missing or unreadable — so a tenant mid-migration is never billed for a
-- vision call nobody switched on.
INSERT INTO feature_state (feature_key, state, source) VALUES
  ('mail.ocr', 'off', 'default')
ON CONFLICT (feature_key) DO NOTHING;
-- DOWN
--   DELETE FROM feature_state WHERE feature_key = 'mail.ocr';
