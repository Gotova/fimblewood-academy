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

function secondsPerDay() {
  const cfg = SimpleCalendar.api.getTimeConfiguration();
  return cfg.hoursInDay * cfg.minutesInHour * cfg.secondsInMinute;
}

/** Fixed-length day number (days since the calendar's epoch) for the given timestamp, or now if omitted. */
function absoluteDay(timestamp) {
  const ts = timestamp ?? SimpleCalendar.api.timestamp();
  return Math.floor(ts / secondsPerDay());
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
