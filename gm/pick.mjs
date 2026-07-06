// Deterministic "memory of the day": djb2-xor hash of the local date string.
// Changing this hash desyncs the two phones mid-day — don't.
export function hashDate(dateStr) {
  let h = 5381;
  for (const c of dateStr) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h;
}

export function pickOfDay(ids, dateStr) {
  if (!ids.length) return null;
  return ids[hashDate(dateStr) % ids.length];
}

export function todayStr(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
