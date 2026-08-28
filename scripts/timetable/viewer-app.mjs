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

import { getWeekdays, currentDateDisplay, timestampForColumn, shortDateForTimestamp, currentWeekdayIndex } from "./calendar.mjs";
import { getSchedule, getCourses, currentBufferKey, nextBufferKey, TIMESLOTS_PER_DAY, TIMESLOTS, LUNCH_BREAK_AFTER_SLOT } from "./data.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/** The actor the highlight should follow: the user's assigned character, falling back to any owned PC (e.g. for the GM, or a player with none assigned). */
function highlightActorIds() {
  const character = game.user.character;
  if (character) return new Set([character.id]);
  return new Set(game.actors.filter((a) => a.isOwner && a.type === "character").map((a) => a.id));
}

export class TimetableViewerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-timetable-viewer",
    tag: "div",
    window: { title: "FIMBLEWOOD.Timetable.ViewerTitle", icon: "fas fa-calendar-week", resizable: true },
    position: { width: 780, height: 560 },
    classes: ["fimblewood-timetable-app"]
  };

  static #ACTIONS = { tabCurrent: "_onTabCurrent", tabNext: "_onTabNext", viewDetails: "_onViewDetails" };

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
    const highlight = highlightActorIds();
    const weeksAhead = this.viewMode === "next" ? 1 : 0;
    const todayIdx = currentWeekdayIndex(weekdays);

    const rows = [];
    for (let slot = 0; slot < TIMESLOTS_PER_DAY; slot++) {
      const cells = weekdays.map((day, idx) => {
        const here = courses.filter((c) => c.weekdayId === day.id && c.slot === slot);
        const isToday = weeksAhead === 0 && idx === todayIdx;
        return `<td class="fw-tt-cell ${isToday ? "is-today" : ""}">${here.map((c) => this.#courseCard(c, highlight)).join("")}</td>`;
      });
      rows.push(`<tr><th class="fw-tt-slot-label">${this.#slotLabel(slot)}</th>${cells.join("")}</tr>`);
      if (slot === LUNCH_BREAK_AFTER_SLOT) rows.push(this.#lunchRow(weekdays.length));
    }

    const headerCells = weekdays.map((day, idx) => {
      const isToday = weeksAhead === 0 && idx === todayIdx;
      const date = shortDateForTimestamp(timestampForColumn(idx, weeksAhead, weekdays));
      return `<th class="${isToday ? "is-today" : ""}">${date ? `<div class="fw-tt-col-date">${esc(date)}</div>` : ""}<div>${esc(day.name)}</div></th>`;
    });

    return `
      ${this.#renderTabs()}
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

  #lunchRow(columnCount) {
    return `<tr class="fw-tt-lunch-row"><td colspan="${columnCount + 1}">${game.i18n.localize("FIMBLEWOOD.Timetable.LunchBreakLabel")}</td></tr>`;
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

  #courseCard(course, highlight) {
    const isMine = course.attendees.some((id) => highlight.has(id));
    const classes = ["fw-tt-course", "is-clickable", isMine ? "is-mine" : ""].filter(Boolean).join(" ");
    const noteIndicator = course.note
      ? `<span class="fw-tt-note-indicator" title="${game.i18n.localize("FIMBLEWOOD.Timetable.HasNoteHint")}"><i class="fas fa-note-sticky"></i></span>`
      : "";
    return `
      <div class="${classes}" data-action="viewDetails" data-course-id="${course.id}">
        <div class="fw-tt-course-header">
          <span class="fw-tt-course-name">${esc(course.name)}</span>
          ${noteIndicator}
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

  _onViewDetails(event, target) {
    const schedule = getSchedule();
    const bufferKey = this.#resolveBufferKey(schedule);
    const course = getCourses(bufferKey, schedule).find((c) => c.id === target.dataset.courseId);
    if (!course) return;

    const parts = [];
    if (course.professor) {
      parts.push(`<p><strong>${game.i18n.localize("FIMBLEWOOD.Timetable.Professor")}:</strong> ${esc(course.professor)}</p>`);
    }
    parts.push(`<p><strong>${game.i18n.localize("FIMBLEWOOD.Timetable.Note")}:</strong><br>${
      course.note ? esc(course.note).replace(/\n/g, "<br>") : `<em>${game.i18n.localize("FIMBLEWOOD.Timetable.NoNote")}</em>`
    }</p>`);

    foundry.applications.api.DialogV2.wait({
      window: { title: course.name },
      content: parts.join(""),
      buttons: [{ action: "close", label: game.i18n.localize("FIMBLEWOOD.Timetable.Close"), type: "button", callback: () => true }],
      rejectClose: false
    });
  }
}
