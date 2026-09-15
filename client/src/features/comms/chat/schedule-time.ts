export function scheduleInstant(value: string): string | null {
  const d = new Date(value);
  if (!value || !Number.isFinite(d.getTime()) || d.getTime() <= Date.now())
    return null;
  // Refuse nonexistent local wall-clock times during a daylight-saving jump.
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return local === value ? d.toISOString() : null;
}
