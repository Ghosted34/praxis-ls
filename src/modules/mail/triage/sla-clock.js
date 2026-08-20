/**
 * SLA clocks on tenant business hours. PURE given hours, holidays, and now.
 *
 * A thread arriving Friday 16:30 with a 4-business-hour SLA is due Monday
 * 10:30, not Saturday. PENDING pauses. First outbound stops the first-response
 * clock.
 */
"use strict";

function isHoliday(date, holidays = []) {
  const key = date.toISOString().slice(0, 10);
  return holidays.some((h) => String(h.holiday_on).slice(0, 10) === key);
}

function hoursFor(date, hours = []) {
  const dow = date.getDay(); // 0 Sun
  return hours.find((h) => Number(h.day_of_week) === dow) || null;
}

function parseHm(t) {
  const s = String(t);
  const [h, m] = s.split(":").map(Number);
  return { h: h || 0, m: m || 0 };
}

/**
 * Add `minutes` of business time to `from`.
 */
function addBusinessMinutes(from, minutes, { hours = [], holidays = [] } = {}) {
  let left = minutes;
  let cursor = new Date(from);
  let guard = 0;
  while (left > 0 && guard < 400) {
    guard += 1;
    const slot = hoursFor(cursor, hours);
    if (!slot || isHoliday(cursor, holidays)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const open = parseHm(slot.opens_at);
    const close = parseHm(slot.closes_at);
    const openAt = new Date(cursor); openAt.setHours(open.h, open.m, 0, 0);
    const closeAt = new Date(cursor); closeAt.setHours(close.h, close.m, 0, 0);
    if (cursor < openAt) cursor = openAt;
    if (cursor >= closeAt) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
      continue;
    }
    const avail = Math.round((closeAt - cursor) / 60000);
    const take = Math.min(avail, left);
    cursor = new Date(cursor.getTime() + take * 60000);
    left -= take;
  }
  return cursor;
}

function dueAt(arrivedAt, policy, ctx) {
  const mins = policy.applies_to_vip ? policy.first_response_minutes : policy.first_response_minutes;
  if (!policy.business_hours_only) {
    return new Date(new Date(arrivedAt).getTime() + mins * 60000);
  }
  return addBusinessMinutes(arrivedAt, mins, ctx);
}

module.exports = { addBusinessMinutes, dueAt, isHoliday, hoursFor };
