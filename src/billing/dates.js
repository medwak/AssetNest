// Dates are ISO strings (YYYY-MM-DD) and all arithmetic is done in UTC so
// results never depend on the server's time zone.

const DAY_MS = 86_400_000;

export function parseDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`Invalid date "${iso}", expected YYYY-MM-DD`);
  }
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new Error(`Invalid date "${iso}"`);
  }
  return date;
}

export function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

export function today() {
  return formatDate(new Date());
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// month is 1-12.
export function monthPeriod(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid billing period ${year}-${month}`);
  }
  const mm = String(month).padStart(2, '0');
  return {
    year,
    month,
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}`,
    days: daysInMonth(year, month),
  };
}

export function addDays(iso, days) {
  return formatDate(new Date(parseDate(iso).getTime() + days * DAY_MS));
}

// Inclusive day count between two dates; 0 when end is before start.
export function daysBetweenInclusive(startIso, endIso) {
  const diff = (parseDate(endIso) - parseDate(startIso)) / DAY_MS;
  return diff < 0 ? 0 : diff + 1;
}

export function minDate(...dates) {
  return dates.filter(Boolean).sort()[0] ?? null;
}

export function maxDate(...dates) {
  return dates.filter(Boolean).sort().at(-1) ?? null;
}

// Whole months from `fromIso` to `toIso`, counting a month only once the
// same day-of-month has been reached.
export function wholeMonthsBetween(fromIso, toIso) {
  const a = parseDate(fromIso);
  const b = parseDate(toIso);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

// Day `day` of the given month, clamped to the month's length.
export function dayOfMonth(year, month, day) {
  const d = Math.min(Math.max(1, day), daysInMonth(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
