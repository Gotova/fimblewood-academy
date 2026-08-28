/**
 * Fimblewood Academy — Timetable viewer
 *
 * Read-only window for players (and the GM) showing one week of courses at
 * a time: a "This Week" / "Next Week" toggle switches between the two
 * buffers the GM has filled in, resolved live off Simple Calendar's current
 * date (see data.mjs's currentBufferKey/nextBufferKey) — so the toggle
 * always means what it says, even as the in-game calendar advances.
 *
 * Follows the JukeboxApp/DragonchessBoardApp pattern: ApplicationV2 without
 * the Handlebars mixin, markup built as a template-literal string in
 * _renderHTML(), a single delegated click listener wired once in
 * _replaceHTML() dispatching through a small action map.
 */

import { getWeekdays, currentDateDisplay } from "./calendar.mjs";
import { getSchedule, getCourses, currentBufferKey, nextBufferKey, TIMESLOTS_PER_DAY } from "./data.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function myActorIds() {
  return new Set(game.actors.filter((a) => a.isOwner).map((a) => a.id));
}

export class TimetableViewerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-timetable-viewer",
    tag: "div",
    window: { title: "FIMBLEWOOD.Timetable.ViewerTitle", icon: "fas fa-calendar-week" },
    position: { width: 780, height: 560 },
    classes: ["fimblewood-timetable-app"]
  };

  static #ACTIONS = { tabCurrent: "_onTabCurrent", tabNext: "_onTabNext", viewNote: "_onViewNote" };

  constructor(options) {
    super(options);
    this.viewMode = "current"; // "current" | "next" — persists across renders/date flips
  }

  #resolveBufferKey(schedule) {
    return this.viewMode === "next" ? nextBufferKey(schedule) : currentBufferKey(schedule);
  }

  async _renderHTML() {
    const weekdays = getWeekdays();
    if (!weekdays.length) {
      return `<div class="fw-tt-empty">${game.i18n.localize("FIMBLEWOOD.Timetable.RequiresCalendar")}</div>`;
    }

    const schedule = getSchedule();
    if (schedule.termStartTimestamp == null) {
      return `${this.#renderTabs()}<div class="fw-tt-empty">${game.i18n.localize("FIMBLEWOOD.Timetable.NotSetUp")}</div>`;
    }

    const bufferKey = this.#resolveBufferKey(schedule);
    const courses = getCourses(bufferKey, schedule);
    const mine = myActorIds();

    const rows = [];
    for (let slot = 0; slot < TIMESLOTS_PER_DAY; slot++) {
      const cells = weekdays.map((day) => {
        const here = courses.filter((c) => c.weekdayId === day.id && c.slot === slot);
        return `<td class="fw-tt-cell">${here.map((c) => this.#courseCard(c, mine)).join("")}</td>`;
      });
      rows.push(`<tr><th class="fw-tt-slot-label">${slot + 1}</th>${cells.join("")}</tr>`);
    }

    return `
      ${this.#renderTabs()}
      <div class="fw-tt-grid-wrap">
        <table class="fw-tt-grid">
          <thead><tr><th></th>${weekdays.map((d) => `<th>${esc(d.name)}</th>`).join("")}</tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>`;
  }

  #renderTabs() {
    const today = currentDateDisplay();
    return `
      <div class="fw-tt-tabs">
        <button type="button" class="fw-tt-tab ${this.viewMode === "current" ? "is-active" : ""}" data-action="tabCurrent">
          ${game.i18n.localize("FIMBLEWOOD.Timetable.ThisWeek")}
        </button>
        <button type="button" class="fw-tt-tab ${this.viewMode === "next" ? "is-active" : ""}" data-action="tabNext">
          ${game.i18n.localize("FIMBLEWOOD.Timetable.NextWeek")}
        </button>
        ${today ? `<span class="fw-tt-today">${game.i18n.format("FIMBLEWOOD.Timetable.TodayIs", { date: esc(today) })}</span>` : ""}
      </div>`;
  }

  #courseCard(course, mine) {
    const isMine = course.attendees.some((id) => mine.has(id));
    const classes = ["fw-tt-course", isMine ? "is-mine" : ""].filter(Boolean).join(" ");
    const note = course.note
      ? `<button type="button" class="fw-tt-note-btn" data-action="viewNote" data-course-id="${course.id}" title="${game.i18n.localize("FIMBLEWOOD.Timetable.ViewNote")}"><i class="fas fa-note-sticky"></i></button>`
      : "";
    return `
      <div class="${classes}">
        <div class="fw-tt-course-header">
          <span class="fw-tt-course-name">${esc(course.name)}</span>
          ${note}
        </div>
        ${course.professor ? `<div class="fw-tt-course-professor">${esc(course.professor)}</div>` : ""}
      </div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwTtWired) {
      content.dataset.fwTtWired = "1";
      content.addEventListener("click", (event) => {
        const target = event.target.closest("[data-action]");
        if (!target) return;
        const handlerName = TimetableViewerApp.#ACTIONS[target.dataset.action];
        if (handlerName) this[handlerName](event, target);
      });
    }
    return content;
  }

  _onTabCurrent() { this.viewMode = "current"; this.render(); }
  _onTabNext() { this.viewMode = "next"; this.render(); }

  _onViewNote(event, target) {
    const schedule = getSchedule();
    const bufferKey = this.#resolveBufferKey(schedule);
    const course = getCourses(bufferKey, schedule).find((c) => c.id === target.dataset.courseId);
    if (!course) return;
    foundry.applications.api.DialogV2.wait({
      window: { title: course.name },
      content: `<p>${esc(course.note).replace(/\n/g, "<br>")}</p>`,
      buttons: [{ action: "close", label: game.i18n.localize("FIMBLEWOOD.Timetable.Close"), type: "button", callback: () => true }],
      rejectClose: false
    });
  }
}
