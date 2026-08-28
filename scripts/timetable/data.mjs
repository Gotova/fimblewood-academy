/**
 * Fimblewood Academy — Timetable data
 *
 * A single world setting holds the whole schedule: which in-game day the
 * current two-week rotation started on (`termStartTimestamp`), and the two
 * week buffers ("A"/"B") the GM edits ahead of time. Which buffer counts as
 * "this week" vs. "next week" is never stored — it's derived on the fly
 * from Simple Calendar's current date (see calendar.mjs's
 * currentWeekParity), so nothing needs renumbering or migrating as time
 * passes: the GM just keeps both buffers filled a week or two ahead, and
 * whichever one the calendar says we're in right now is "current".
 *
 * Only the GM ever writes this setting (see the isGM guards below) — Foundry
 * replicates the write to every client and fires each one's onChange
 * callback, which is what keeps every open Timetable window in sync.
 */

import { currentWeekParity } from "./calendar.mjs";

const MODULE_ID = "fimblewood-academy";
export const TIMETABLE_SETTING = "timetable";
export const TIMESLOTS_PER_DAY = 4;

/** Fixed real-world start/end times for each of the 4 daily periods; a lunch break separates periods 2 and 3. */
export const TIMESLOTS = [
  { start: "08:00", end: "09:30" },
  { start: "10:00", end: "11:30" },
  { start: "13:00", end: "14:30" },
  { start: "15:00", end: "16:30" }
];
export const LUNCH_BREAK_AFTER_SLOT = 1; // the break renders after this slot index (i.e. between periods 2 and 3)

function emptySchedule() {
  return { termStartTimestamp: null, buffers: { A: [], B: [] } };
}

export function getSchedule() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, TIMETABLE_SETTING));
}

async function setSchedule(schedule) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, TIMETABLE_SETTING, schedule);
}

/* -------------------------------------------- */
/*  Which buffer is "current" / "next"           */
/* -------------------------------------------- */

export function currentBufferKey(schedule = getSchedule()) {
  return currentWeekParity(schedule.termStartTimestamp) ?? "A";
}

export function nextBufferKey(schedule = getSchedule()) {
  return currentBufferKey(schedule) === "A" ? "B" : "A";
}

/* -------------------------------------------- */
/*  Term start                                   */
/* -------------------------------------------- */

export async function setTermStart(timestamp) {
  const schedule = getSchedule();
  schedule.termStartTimestamp = timestamp;
  await setSchedule(schedule);
}

/* -------------------------------------------- */
/*  Course CRUD                                  */
/* -------------------------------------------- */

export function getCourses(bufferKey, schedule = getSchedule()) {
  return schedule.buffers[bufferKey] ?? [];
}

export function getCoursesAt(bufferKey, weekdayId, slot, schedule = getSchedule()) {
  return getCourses(bufferKey, schedule).filter((c) => c.weekdayId === weekdayId && c.slot === slot);
}

export function getCourse(bufferKey, courseId, schedule = getSchedule()) {
  return getCourses(bufferKey, schedule).find((c) => c.id === courseId) ?? null;
}

/**
 * Actor ids attending `course` that are also attending a *different* course
 * in the same weekday+slot of the same buffer. Returns a Map of
 * actorId -> [names of the clashing courses]. `course` need not be saved
 * yet (see course-edit-app.mjs), only its id, weekdayId, slot and attendees
 * are used.
 */
export function conflictingAttendees(bufferKey, course, schedule = getSchedule()) {
  const siblings = getCoursesAt(bufferKey, course.weekdayId, course.slot, schedule).filter((c) => c.id !== course.id);
  const conflicts = new Map();
  for (const actorId of course.attendees) {
    const clashing = siblings.filter((c) => c.attendees.includes(actorId));
    if (clashing.length) conflicts.set(actorId, clashing.map((c) => c.name));
  }
  return conflicts;
}

export async function upsertCourse(bufferKey, course) {
  const schedule = getSchedule();
  const list = schedule.buffers[bufferKey] ?? (schedule.buffers[bufferKey] = []);
  const index = list.findIndex((c) => c.id === course.id);
  if (index === -1) list.push(course);
  else list[index] = course;
  await setSchedule(schedule);
}

export async function deleteCourse(bufferKey, courseId) {
  const schedule = getSchedule();
  schedule.buffers[bufferKey] = getCourses(bufferKey, schedule).filter((c) => c.id !== courseId);
  await setSchedule(schedule);
}

/** Adds `actorId` to a course's roster (no-op if already there) and returns the updated course. */
export async function addAttendee(bufferKey, courseId, actorId) {
  const schedule = getSchedule();
  const course = getCourse(bufferKey, courseId, schedule);
  if (!course) return null;
  if (!course.attendees.includes(actorId)) {
    course.attendees.push(actorId);
    await setSchedule(schedule);
  }
  return course;
}

/* -------------------------------------------- */
/*  Change notifications                         */
/* -------------------------------------------- */

const _listeners = new Set();
/** Subscribe to schedule changes (from any client, including this one). Returns an unsubscribe function. */
export function onScheduleChange(callback) {
  _listeners.add(callback);
  return () => _listeners.delete(callback);
}

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

export function registerTimetableData() {
  game.settings.register(MODULE_ID, TIMETABLE_SETTING, {
    scope: "world", config: false, type: Object, default: emptySchedule(),
    onChange: (schedule) => {
      for (const cb of _listeners) {
        try { cb(schedule); } catch (err) { console.error("fimblewood-academy | Timetable listener failed", err); }
      }
    }
  });
}
