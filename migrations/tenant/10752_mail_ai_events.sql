INSERT INTO event_type (key, module_key, name, description) VALUES
  ('mail.ai.drafted', 'MOD-72', 'AI draft', 'An AI draft was generated. It landed in the composer. Nothing was sent.'),
  ('mail.ai.summarised', 'MOD-72', 'AI summary', 'An executive thread summary was generated on demand.'),
  ('mail.ocr.extracted', 'MOD-72', 'OCR extracted', 'Attachment fields were extracted into a staging row. Nothing was written to a business table.')
ON CONFLICT (key) DO NOTHING;
-- DOWN
--   DELETE FROM event_type WHERE key IN ('mail.ai.drafted','mail.ai.summarised','mail.ocr.extracted');
