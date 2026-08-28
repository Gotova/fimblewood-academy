/**
 * Fimblewood Academy — Timetable editor (GM only)
 *
 * Same week-grid layout as the viewer, but every cell is editable: click
 * "+ Add" to create a course from scratch, click an existing course card to
 * edit it, or drag an actor from the sidebar straight onto a cell/card to
 * enrol them (see data.mjs's addAttendee / conflictingAttendees and
 * course-edit-app.mjs for the actual course form).
 */

import {
  getWeekdays, currentDateDisplay, isCalendarAvailable, currentTimestamp, formatTimestamp,
  timestampForColumn, shortDateForTimestamp, currentWeekdayIndex
} from "./calendar.mjs";
import {
  getSchedule, getCourses, getCoursesAt, conflictingAttendees,
  currentBufferKey, nextBufferKey, currentPeriod, setTermStart, addAttendee, deleteCourse,
  TIMESLOTS_PER_DAY, TIMESLOTS, LUNCH_BREAK_AFTER_SLOT
} from "./data.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

export class TimetableEditorApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-timetable-editor",
    tag: "div",
    window: { title: "FIMBLEWOOD.Timetable.EditorTitle", icon: "fas fa-calendar-pen", resizable: true },
    position: { width: 900, height: 640 },
    classes: ["fimblewood-timetable-app", "is-editor"]
  };

  static #ACTIONS = {
    tabCurrent: "_onTabCurrent", tabNext: "_onTabNext",
    addCourse: "_onAddCourse", editCourse: "_onEditCourse", deleteCourse: "_onDeleteCourse",
    setTermStart: "_onSetTermStart"
  };

  constructor(options) {
    super(options);
    this.viewMode = "current"; // "current" | "next"
  }

  #resolveBufferKey(schedule) {
    return this.viewMode === "next" ? nextBufferKey(schedule) : currentBufferKey(schedule);
  }

  async _renderHTML() {
    if (!isCalendarAvailable()) {
      return `<div class="fw-tt-empty">${game.i18n.localize("FIMBLEWOOD.Timetable.RequiresCalendar")}</div>`;
    }

    const weekdays = getWeekdays();
    const schedule = getSchedule();
    const bufferKey = this.#resolveBufferKey(schedule);
    const courses = getCourses(bufferKey, schedule);
    const weeksAhead = this.viewMode === "next" ? 1 : 0;
    const todayIdx = currentWeekdayIndex(weekdays);
    const period = weeksAhead === 0 ? currentPeriod() : null; // only "this week" can contain the live moment

    const rows = [];
    for (let slot = 0; slot < TIMESLOTS_PER_DAY; slot++) {
      const cells = weekdays.map((day, idx) => {
        const here = getCoursesAt(bufferKey, day.id, slot, schedule);
        const cards = here.map((c) => this.#courseCard(c, bufferKey, schedule)).join("");
        const isToday = weeksAhead === 0 && idx === todayIdx;
        const isNow = isToday && period === slot;
        return `
          <td class="fw-tt-cell ${isToday ? "is-today" : ""} ${isNow ? "is-current-slot" : ""}" data-weekday="${day.id}" data-slot="${slot}">
            ${cards}
            <button type="button" class="fw-tt-add-btn" data-action="addCourse" data-weekday="${day.id}" data-slot="${slot}">
              <i class="fas fa-plus"></i> ${game.i18n.localize("FIMBLEWOOD.Timetable.AddCourse")}
            </button>
          </td>`;
      });
      rows.push(`<tr><th class="fw-tt-slot-label">${this.#slotLabel(slot)}</th>${cells.join("")}</tr>`);
      if (slot === LUNCH_BREAK_AFTER_SLOT) rows.push(this.#lunchRow(weekdays.length, period === "lunch"));
    }

    const headerCells = weekdays.map((day, idx) => {
      const isToday = weeksAhead === 0 && idx === todayIdx;
      const date = shortDateForTimestamp(timestampForColumn(idx, weeksAhead, weekdays));
      return `<th class="${isToday ? "is-today" : ""}">${date ? `<div class="fw-tt-col-date">${esc(date)}</div>` : ""}<div>${esc(day.name)}</div></th>`;
    });

    return `
      ${this.#renderHeader(schedule)}
      <div class="fw-tt-grid-wrap">
        <table class="fw-tt-grid">
          <thead><tr><th></th>${headerCells.join("")}</tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>`;
  }

  #slotLabel(slot) {
    const t = TIMESLOTS[slot];
    return `<div class="fw-tt-slot-number">${slot + 1}</div>${t ? `<div class="fw-tt-slot-time">${t.start}–${t.end}</div>` : ""}`;
  }

  #lunchRow(columnCount, isNow) {
    return `<tr class="fw-tt-lunch-row ${isNow ? "is-current-slot" : ""}"><td colspan="${columnCount + 1}">${game.i18n.localize("FIMBLEWOOD.Timetable.LunchBreakLabel")}</td></tr>`;
  }

  #renderHeader(schedule) {
    const today = currentDateDisplay();
    const termStartDisplay = formatTimestamp(schedule.termStartTimestamp);
    return `
      <div class="fw-tt-tabs">
        <button type="button" class="fw-tt-tab ${this.viewMode === "current" ? "is-active" : ""}" data-action="tabCurrent">
          ${game.i18n.localize("FIMBLEWOOD.Timetable.ThisWeek")}
        </button>
        <button type="button" class="fw-tt-tab ${this.viewMode === "next" ? "is-active" : ""}" data-action="tabNext">
          ${game.i18n.localize("FIMBLEWOOD.Timetable.NextWeek")}
        </button>
        ${today ? `<span class="fw-tt-today">${game.i18n.format("FIMBLEWOOD.Timetable.TodayIs", { date: esc(today) })}</span>` : ""}
        <span class="fw-tt-term-start">
          ${schedule.termStartTimestamp == null
            ? game.i18n.localize("FIMBLEWOOD.Timetable.TermNotSet")
            : game.i18n.format("FIMBLEWOOD.Timetable.TermStartedOn", { date: esc(termStartDisplay ?? "?") })}
          <button type="button" class="fw-tt-btn-small" data-action="setTermStart">
            ${game.i18n.localize("FIMBLEWOOD.Timetable.SetTermStartNow")}
          </button>
        </span>
      </div>`;
  }

  #courseCard(course, bufferKey, schedule) {
    const conflicts = conflictingAttendees(bufferKey, course, schedule);
    const warning = conflicts.size
      ? `<span class="fw-tt-conflict" title="${game.i18n.format("FIMBLEWOOD.Timetable.ConflictTooltip", { count: conflicts.size })}"><i class="fas fa-triangle-exclamation"></i></span>`
      : "";
    return `
      <div class="fw-tt-course is-editable" data-course-id="${course.id}" data-action="editCourse">
        <div class="fw-tt-course-header">
          <span class="fw-tt-course-name">${esc(course.name)}</span>
          ${warning}
          <button type="button" class="fw-tt-course-delete" data-action="deleteCourse" data-course-id="${course.id}" title="${game.i18n.localize("FIMBLEWOOD.Timetable.DeleteCourse")}">
            <i class="fas fa-trash"></i>
          </button>
        </div>
        ${course.professor ? `<div class="fw-tt-course-professor">${esc(course.professor)}</div>` : ""}
        <div class="fw-tt-course-count">${game.i18n.format("FIMBLEWOOD.Timetable.AttendeeCount", { count: course.attendees.length })}</div>
      </div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwTtWired) {
      content.dataset.fwTtWired = "1";
      content.addEventListener("click", (event) => {
        const target = event.target.closest("[data-action]");
        if (!target) return;
        const handlerName = TimetableEditorApp.#ACTIONS[target.dataset.action];
        if (handlerName) this[handlerName](event, target);
      });
      content.addEventListener("dragover", (event) => {
        if (event.target.closest("[data-weekday]")) event.preventDefault();
      });
      content.addEventListener("drop", (event) => this._onDrop(event));
    }
    return content;
  }

  _onTabCurrent() { this.viewMode = "current"; this.render(); }
  _onTabNext() { this.viewMode = "next"; this.render(); }

  async _onAddCourse(event, target) {
    const { CourseEditApp } = await import("./course-edit-app.mjs");
    const schedule = getSchedule();
    const bufferKey = this.#resolveBufferKey(schedule);
    new CourseEditApp({
      bufferKey, weekdayId: target.dataset.weekday, slot: Number(target.dataset.slot),
      onSaved: () => this.render()
    }).render(true);
  }

  async _onEditCourse(event, target) {
    const { CourseEditApp } = await import("./course-edit-app.mjs");
    const schedule = getSchedule();
    const bufferKey = this.#resolveBufferKey(schedule);
    const course = getCourses(bufferKey, schedule).find((c) => c.id === target.dataset.courseId);
    if (!course) return;
    new CourseEditApp({ bufferKey, courseId: course.id, onSaved: () => this.render() }).render(true);
  }

  async _onDeleteCourse(event, target) {
    const schedule = getSchedule();
    const bufferKey = this.#resolveBufferKey(schedule);
    const course = getCourses(bufferKey, schedule).find((c) => c.id === target.dataset.courseId);
    if (!course) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("FIMBLEWOOD.Timetable.DeleteCourseTitle") },
      content: `<p>${game.i18n.format("FIMBLEWOOD.Timetable.DeleteCourseBody", { name: esc(course.name) })}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await deleteCourse(bufferKey, course.id);
    this.render();
  }

  async _onSetTermStart() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("FIMBLEWOOD.Timetable.SetTermStartTitle") },
      content: `<p>${game.i18n.localize("FIMBLEWOOD.Timetable.SetTermStartBody")}</p>`,
      rejectClose: false
    });
    if (!confirmed) return;
    await setTermStart(currentTimestamp());
    this.render();
  }

  async _onDrop(event) {
    const cell = event.target.closest("[data-weekday]");
    if (!cell) return;
    event.preventDefault();

    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Actor" || !data.uuid) return;
    const actor = fromUuidSync(data.uuid);
    if (!actor) return;

    const schedule = getSchedule();
    const bufferKey = this.#resolveBufferKey(schedule);
    const weekdayId = cell.dataset.weekday;
    const slot = Number(cell.dataset.slot);

    const cardTarget = event.target.closest("[data-course-id]");
    if (cardTarget) {
      const course = await addAttendee(bufferKey, cardTarget.dataset.courseId, actor.id);
      this.#warnIfConflicted(bufferKey, course, actor);
      this.render();
      return;
    }

    const here = getCoursesAt(bufferKey, weekdayId, slot, schedule);
    if (here.length === 1) {
      const course = await addAttendee(bufferKey, here[0].id, actor.id);
      this.#warnIfConflicted(bufferKey, course, actor);
      this.render();
    } else if (here.length === 0) {
      const { CourseEditApp } = await import("./course-edit-app.mjs");
      new CourseEditApp({ bufferKey, weekdayId, slot, initialAttendees: [actor.id], onSaved: () => this.render() }).render(true);
    } else {
      ui.notifications.warn(game.i18n.localize("FIMBLEWOOD.Timetable.DropAmbiguous"));
    }
  }

  #warnIfConflicted(bufferKey, course, actor) {
    if (!course) return;
    const conflicts = conflictingAttendees(bufferKey, course);
    if (conflicts.has(actor.id)) {
      ui.notifications.warn(game.i18n.format("FIMBLEWOOD.Timetable.ConflictWarning", { actor: actor.name, other: conflicts.get(actor.id).join(", ") }));
    }
  }
}
