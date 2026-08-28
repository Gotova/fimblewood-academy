/**
 * Fimblewood Academy — Timetable / Simple Calendar bridge
 *
 * Thin wrapper around Simple Calendar Reborn's public API
 * (https://github.com/Fireblight-Studios/foundryvtt-simple-calendar). The
 * Timetable hard-requires Simple Calendar — every function here degrades to
 * returning null/empty rather than throwing when it isn't active, so
 * callers (index.mjs) can show one clear warning instead of the feature
 * failing piecemeal.
 */

export function isCalendarAvailable() {
  return typeof SimpleCalendar !== "undefined" && !!SimpleCalendar.api;
}

/** All weekdays of the active calendar, in order — {id, name, numericRepresentation, ...} each. */
export function getWeekdays() {
  if (!isCalendarAvailable()) return [];
  try {
    return SimpleCalendar.api.getAllWeekdays() ?? [];
  } catch (err) {
    console.error("fimblewood-academy | Timetable: failed to read Simple Calendar's weekdays", err);
    return [];
  }
}

export function currentTimestamp() {
  if (!isCalendarAvailable()) return null;
  try {
    return SimpleCalendar.api.timestamp();
  } catch (err) {
    console.error("fimblewood-academy | Timetable: failed to read Simple Calendar's current timestamp", err);
    return null;
  }
}

export function currentDateDisplay() {
  if (!isCalendarAvailable()) return null;
  try {
    return SimpleCalendar.api.currentDateTimeDisplay()?.date ?? null;
  } catch (err) {
    console.error("fimblewood-academy | Timetable: failed to read Simple Calendar's current date display", err);
    return null;
  }
}

export function formatTimestamp(timestamp) {
  if (!isCalendarAvailable() || timestamp == null) return null;
  try {
    return SimpleCalendar.api.timestampToDate(timestamp)?.display?.date ?? null;
  } catch (err) {
    console.error("fimblewood-academy | Timetable: failed to format a Simple Calendar timestamp", err);
    return null;
  }
}

/** Compact "12th June" style date for a timestamp, meant to sit above a weekday column header. */
export function shortDateForTimestamp(timestamp) {
  if (!isCalendarAvailable() || timestamp == null) return null;
  try {
    const display = SimpleCalendar.api.timestampToDate(timestamp)?.display;
    if (!display) return null;
    return `${display.day}${display.daySuffix ?? ""} ${display.monthName}`;
  } catch (err) {
    console.error("fimblewood-academy | Timetable: failed to format a short date", err);
    return null;
  }
}

function secondsPerDay() {
  const cfg = SimpleCalendar.api.getTimeConfiguration();
  return cfg.hoursInDay * cfg.minutesInHour * cfg.secondsInMinute;
}

/** Fixed-length day number (days since the calendar's epoch) for the given timestamp, or now if omitted. */
function absoluteDay(timestamp) {
  const ts = timestamp ?? SimpleCalendar.api.timestamp();
  return Math.floor(ts / secondsPerDay());
}

/** Index of `weekdayId` within `weekdays` (array order = column order in the grid), or -1 if not found. */
export function weekdayIndex(weekdayId, weekdays = getWeekdays()) {
  return weekdays.findIndex((d) => d.id === weekdayId);
}

/** Column index of today's weekday, or null if Simple Calendar isn't available. */
export function currentWeekdayIndex(weekdays = getWeekdays()) {
  if (!isCalendarAvailable()) return null;
  try {
    const id = SimpleCalendar.api.getCurrentWeekday()?.id;
    const idx = weekdayIndex(id, weekdays);
    return idx === -1 ? null : idx;
  } catch (err) {
    console.error("fimblewood-academy | Timetable: failed to read Simple Calendar's current weekday", err);
    return null;
  }
}

/**
 * Timestamp for the given weekday column, in the real-calendar week that is
 * `weeksAhead` full weeks from the week containing today (0 = this week,
 * 1 = next week) — i.e. the actual date a "This Week"/"Next Week" column
 * represents, regardless of which schedule buffer ("A"/"B") is shown there.
 */
export function timestampForColumn(colIndex, weeksAhead, weekdays = getWeekdays()) {
  if (!isCalendarAvailable()) return null;
  const todayIdx = currentWeekdayIndex(weekdays);
  if (todayIdx == null || !weekdays.length) return null;
  try {
    const dayOffset = (colIndex - todayIdx) + weeksAhead * weekdays.length;
    return SimpleCalendar.api.timestamp() + dayOffset * secondsPerDay();
  } catch (err) {
    console.error("fimblewood-academy | Timetable: failed to compute a column's date", err);
    return null;
  }
}

/**
 * Which of the two week buffers ("A"/"B") is "current" right now, given a
 * fixed term-start timestamp: parity alternates every `daysPerWeek` in-game
 * days counted from that anchor (Simple Calendar's own weekday count, so it
 * follows whatever week length the active calendar defines). Returns null
 * if Simple Calendar isn't available or no term start has been set yet —
 * callers should treat that as "can't tell, default to A".
 */
export function currentWeekParity(termStartTimestamp) {
  if (!isCalendarAvailable() || termStartTimestamp == null) return null;
  try {
    const daysPerWeek = getWeekdays().length;
    if (!daysPerWeek) return null;
    const daysElapsed = absoluteDay() - absoluteDay(termStartTimestamp);
    const weekIndex = Math.floor(daysElapsed / daysPerWeek);
    return weekIndex % 2 === 0 ? "A" : "B";
  } catch (err) {
    console.error("fimblewood-academy | Timetable: failed to compute the current week", err);
    return null;
  }
}

/** Registers a callback for Simple Calendar's date-change hook. No-ops if Simple Calendar isn't active. */
export function onDateChange(callback) {
  if (typeof SimpleCalendar === "undefined") return;
  Hooks.on(SimpleCalendar.Hooks.DateTimeChange, () => callback());
}
