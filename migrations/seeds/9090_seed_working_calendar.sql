-- ============================================================================
-- TENANT SEED — 9090 Default working calendar + Cameroon public holidays.
--
-- WHY A CALENDAR AT ALL. The milestone engine schedules in WORKING time, not
-- elapsed time. "Customs clearance takes eight hours" means eight hours of a
-- day when the customs counter is actually open — a declaration lodged at 15:00
-- on a Friday is not due at 23:00 on the Friday, it is due mid-morning on the
-- Monday. Without a calendar the engine produces due dates on Sundays and on
-- 20 May, promises them to a client, and then reports itself late.
--
-- ONE TENANT-WIDE DEFAULT (entity_id IS NULL). Per-entity calendars are the
-- point of the table — a Douala branch and a N'Djamena branch do not keep the
-- same hours — but a tenant that has never opened the settings screen still has
-- to compute working time correctly on day one. So the default exists from
-- provisioning and entity calendars override it when someone creates them.
--
-- HOURS. Mon–Fri 07:30–17:00 and Sat 08:00–13:00 is the ordinary rhythm of a
-- Douala forwarding office; Sunday is absent, which is how a closed day is
-- expressed (no row). These are a starting point a tenant edits, not a claim
-- about any particular company.
--
-- THE TWO KINDS OF HOLIDAY, and why the table needs both:
--
--   FIXED (is_recurring = true) — 1 January, 11 February, 1 May, 20 May,
--   15 August, 1 October, 25 December. The year stored is a sample; only the
--   month and day matter, and the engine matches on those.
--
--   MOVABLE (is_recurring = false) — Good Friday and Ascension move with
--   Easter; Eid al-Fitr and Eid al-Adha move with the lunar calendar AND are
--   fixed locally by moon sighting, so they are not computable years ahead with
--   certainty. Real dates are seeded for 2026–2027 and marked non-recurring so
--   nobody mistakes them for a rule. THEY MUST BE CONFIRMED ANNUALLY in
--   Settings → Working calendar; the Islamic dates in particular are the
--   published estimates and can shift by a day when the announcement comes.
--
-- Idempotent: guarded on the default calendar's existence, and every insert
-- carries ON CONFLICT.
-- ============================================================================

-- ── The default calendar ────────────────────────────────────────────────────
INSERT INTO working_calendar (name, timezone, entity_id, is_default, is_active)
SELECT 'Calendrier de travail par défaut', 'Africa/Douala', NULL, true, true
 WHERE NOT EXISTS (SELECT 1 FROM working_calendar WHERE entity_id IS NULL AND is_default)
ON CONFLICT DO NOTHING;

-- ── Opening hours (weekday 0 = Sunday; Sunday is absent = closed) ───────────
INSERT INTO working_calendar_day (working_calendar_id, weekday, opens_at, closes_at)
SELECT c.working_calendar_id, d.weekday, d.opens_at, d.closes_at
  FROM working_calendar c
  CROSS JOIN (VALUES
      (1, TIME '07:30', TIME '17:00'),
      (2, TIME '07:30', TIME '17:00'),
      (3, TIME '07:30', TIME '17:00'),
      (4, TIME '07:30', TIME '17:00'),
      (5, TIME '07:30', TIME '17:00'),
      (6, TIME '08:00', TIME '13:00')
  ) AS d(weekday, opens_at, closes_at)
 WHERE c.entity_id IS NULL AND c.is_default
ON CONFLICT (working_calendar_id, weekday) DO NOTHING;

-- ── Fixed public holidays (month/day is what matters) ───────────────────────
INSERT INTO working_calendar_holiday (working_calendar_id, holiday_date, is_recurring, name_fr, name_en, is_system)
SELECT c.working_calendar_id, h.d, true, h.fr, h.en, true
  FROM working_calendar c
  CROSS JOIN (VALUES
      (DATE '2026-01-01', 'Jour de l''An',            'New Year''s Day'),
      (DATE '2026-02-11', 'Fête de la Jeunesse',      'Youth Day'),
      (DATE '2026-05-01', 'Fête du Travail',          'Labour Day'),
      (DATE '2026-05-20', 'Fête Nationale',           'National Day'),
      (DATE '2026-08-15', 'Assomption',               'Assumption'),
      (DATE '2026-10-01', 'Fête de l''Unité',         'Unity Day'),
      (DATE '2026-12-25', 'Noël',                     'Christmas Day')
  ) AS h(d, fr, en)
 WHERE c.entity_id IS NULL AND c.is_default
ON CONFLICT (working_calendar_id, holiday_date) DO NOTHING;

-- ── Movable feasts, 2026–2027 — CONFIRM ANNUALLY (see header) ───────────────
INSERT INTO working_calendar_holiday (working_calendar_id, holiday_date, is_recurring, name_fr, name_en, is_system)
SELECT c.working_calendar_id, h.d, false, h.fr, h.en, true
  FROM working_calendar c
  CROSS JOIN (VALUES
      (DATE '2026-04-03', 'Vendredi Saint',           'Good Friday'),
      (DATE '2026-05-14', 'Ascension',                'Ascension Day'),
      (DATE '2026-03-20', 'Fête du Ramadan (estimée)','Eid al-Fitr (estimated)'),
      (DATE '2026-05-27', 'Fête du Mouton (estimée)', 'Eid al-Adha (estimated)'),
      (DATE '2027-03-26', 'Vendredi Saint',           'Good Friday'),
      (DATE '2027-05-06', 'Ascension',                'Ascension Day'),
      (DATE '2027-03-10', 'Fête du Ramadan (estimée)','Eid al-Fitr (estimated)'),
      (DATE '2027-05-16', 'Fête du Mouton (estimée)', 'Eid al-Adha (estimated)')
  ) AS h(d, fr, en)
 WHERE c.entity_id IS NULL AND c.is_default
ON CONFLICT (working_calendar_id, holiday_date) DO NOTHING;

-- DOWN
-- DELETE FROM working_calendar_holiday WHERE is_system;
-- DELETE FROM working_calendar_day WHERE working_calendar_id IN
--   (SELECT working_calendar_id FROM working_calendar WHERE entity_id IS NULL AND is_default);
-- DELETE FROM working_calendar WHERE entity_id IS NULL AND is_default;
