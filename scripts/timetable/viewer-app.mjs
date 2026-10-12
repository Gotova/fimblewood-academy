/**
 * Fimblewood Academy — Timetable viewer
 *
 * Read-only window for players (and the GM) showing one week of courses at
 * a time: a "This Week" / "Next Week" toggle switches between the two
 * buffers the GM has filled in, resolved live off Simple Calendar's current
 * date (see data.mjs's currentBufferKey/nextBufferKey) — so the toggle
 * always means what it says, even as the in-game calendar advances.
 *
 * Below the courses sit two rows for the afternoon and evening, holding the
 * appointments (clubs, jobs, ...) of one chosen character — picked from the
 * "Plan for" dropdown, which lists the user's own PCs (every PC for the
 * GM). Unlike courses these belong to real dates, and a PC's owners can
 * add, edit and invite others to them right here (see afternoon.mjs).
 *
 * Follows the JukeboxApp/DragonchessBoardApp pattern: ApplicationV2 without
 * the Handlebars mixin, markup built as a template-literal string in
 * _renderHTML(), a single delegated click listener wired once in
 * _replaceHTML() dispatching through a small action map.
 */

import { getWeekdays, currentDateDisplay, timestampForColumn, shortDateForTimestamp, currentWeekdayIndex, dayNumberForTimestamp } from "./calendar.mjs";
import { getSchedule, getCourses, currentBufferKey, nextBufferKey, currentPeriod, TIMESLOTS_PER_DAY, TIMESLOTS, LUNCH_BREAK_AFTER_SLOT } from "./data.mjs";
import {
  AFTERNOON_SLOT_COUNT, getAppointments, getAppointment, appointmentsFor, plannableActors,
  canEdit, canPlanFor, requestAfternoonChange, organiserName, DM_ORGANISER
} from "./afternoon.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/** The PCs this user may pick in "Plan for": their own player characters, or every one for the GM. */
function selectableActors() {
  const actors = plannableActors();
  return game.user.isGM ? actors : actors.filter((a) => a.isOwner);
}

export class TimetableViewerApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-timetable-viewer",
    tag: "div",
    window: { title: "FIMBLEWOOD.Timetable.ViewerTitle", icon: "fas fa-calendar-week", resizable: true },
    position: { width: 780, height: 680 },
    classes: ["fimblewood-timetable-app"]
  };

  static #ACTIONS = {
    tabCurrent: "_onTabCurrent", tabNext: "_onTabNext", viewDetails: "_onViewDetails",
    addAppointment: "_onAddAppointment", viewAppointment: "_onViewAppointment"
  };

  constructor(options) {
    super(options);
    this.viewMode = "current"; // "current" | "next" — persists across renders/date flips
    this.actorId = null; // whose courses are highlighted and whose afternoons are shown
  }

  #resolveBufferKey(schedule) {
    return this.viewMode === "next" ? nextBufferKey(schedule) : currentBufferKey(schedule);
  }

  #weeksAhead() {
    return this.viewMode === "next" ? 1 : 0;
  }

  /** Keeps `this.actorId` pointing at a selectable PC, preferring the user's assigned character. */
  #resolveActor(actors) {
    if (actors.some((a) => a.id === this.actorId)) return;
    const own = game.user.character;
    this.actorId = (own && actors.some((a) => a.id === own.id)) ? own.id : (actors[0]?.id ?? null);
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
    const actors = selectableActors();
    this.#resolveActor(actors);
    const highlight = new Set(this.actorId ? [this.actorId] : []);
    const weeksAhead = this.#weeksAhead();
    const todayIdx = currentWeekdayIndex(weekdays);
    const period = weeksAhead === 0 ? currentPeriod() : null; // only "this week" can contain the live moment

    const rows = [];
    for (let slot = 0; slot < TIMESLOTS_PER_DAY; slot++) {
      const cells = weekdays.map((day, idx) => {
        const here = courses.filter((c) => c.weekdayId === day.id && c.slot === slot);
        const isToday = weeksAhead === 0 && idx === todayIdx;
        const isNow = isToday && period === slot;
        return `<td class="fw-tt-cell ${isToday ? "is-today" : ""} ${isNow ? "is-current-slot" : ""}">${here.map((c) => this.#courseCard(c, highlight)).join("")}</td>`;
      });
      rows.push(`<tr><th class="fw-tt-slot-label">${this.#slotLabel(slot)}</th>${cells.join("")}</tr>`);
      if (slot === LUNCH_BREAK_AFTER_SLOT) rows.push(this.#lunchRow(weekdays.length, period === "lunch"));
    }
    rows.push(...this.#afternoonRows(weekdays, weeksAhead, todayIdx));

    const headerCells = weekdays.map((day, idx) => {
      const isToday = weeksAhead === 0 && idx === todayIdx;
      const date = shortDateForTimestamp(timestampForColumn(idx, weeksAhead, weekdays));
      return `<th class="${isToday ? "is-today" : ""}">${date ? `<div class="fw-tt-col-date">${esc(date)}</div>` : ""}<div>${esc(day.name)}</div></th>`;
    });

    return `
      ${this.#renderTabs()}
      ${this.#renderActorPicker(actors)}
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

  #renderActorPicker(actors) {
    if (!actors.length) {
      return `<div class="fw-tt-plan-for"><em>${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.NoCharacter")}</em></div>`;
    }
    const options = actors.map((a) => `<option value="${a.id}" ${a.id === this.actorId ? "selected" : ""}>${esc(a.name)}</option>`).join("");
    return `
      <div class="fw-tt-plan-for">
        <label>${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.PlanFor")}
          <select name="planFor" ${actors.length > 1 ? "" : "disabled"}>${options}</select>
        </label>
      </div>`;
  }

  /** A separator plus one row per afternoon slot, showing the selected character's appointments. */
  #afternoonRows(weekdays, weeksAhead, todayIdx) {
    const appointments = getAppointments();
    const mayPlan = !!this.actorId && canPlanFor(this.actorId);
    const days = weekdays.map((_, idx) => dayNumberForTimestamp(timestampForColumn(idx, weeksAhead, weekdays)));

    const rows = [`<tr class="fw-tt-afternoon-sep"><td colspan="${weekdays.length + 1}">${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.Separator")}</td></tr>`];
    for (let slot = 0; slot < AFTERNOON_SLOT_COUNT; slot++) {
      const cells = weekdays.map((_, idx) => {
        const isToday = weeksAhead === 0 && idx === todayIdx;
        const day = days[idx];
        const here = (this.actorId && day != null) ? appointmentsFor(this.actorId, day, slot, appointments) : [];
        const cards = here.map((a) => this.#appointmentCard(a, here.length > 1)).join("");
        const add = (mayPlan && day != null && !here.length)
          ? `<button type="button" class="fw-tt-add-btn" data-action="addAppointment" data-day="${day}" data-slot="${slot}" data-col="${idx}"><i class="fas fa-plus"></i> ${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.Add")}</button>`
          : "";
        return `<td class="fw-tt-cell ${isToday ? "is-today" : ""}">${cards}${add}</td>`;
      });
      rows.push(`<tr class="fw-tt-afternoon-row"><th class="fw-tt-slot-label"></th>${cells.join("")}</tr>`);
    }
    return rows;
  }

  #appointmentCard(appointment, clashes) {
    const invited = appointment.ownerId !== this.actorId;
    const invitedBy = invited
      ? `<div class="fw-tt-course-professor">${game.i18n.format("FIMBLEWOOD.Timetable.Afternoon.InvitedBy", { name: esc(organiserName(appointment.ownerId)) })}</div>`
      : "";
    const others = [appointment.ownerId, ...appointment.invitees].filter((id) => id && id !== this.actorId).length;
    const group = others
      ? `<span class="fw-tt-note-indicator" title="${game.i18n.format("FIMBLEWOOD.Timetable.Afternoon.WithOthers", { count: others })}"><i class="fas fa-user-group"></i></span>`
      : "";
    const conflict = clashes
      ? `<span class="fw-tt-conflict" title="${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.ClashHint")}"><i class="fas fa-triangle-exclamation"></i></span>`
      : "";
    return `
      <div class="fw-tt-course fw-tt-appointment is-clickable ${invited ? "is-invited" : "is-mine"}" data-action="viewAppointment" data-appointment-id="${appointment.id}">
        <div class="fw-tt-course-header">
          <span class="fw-tt-course-name">${esc(appointment.title)}</span>
          ${conflict}${group}
        </div>
        ${invitedBy}
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
      content.addEventListener("change", (event) => {
        if (event.target.name !== "planFor") return;
        this.actorId = event.target.value;
        this.render();
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

  /** "Monday, 12th June" for a column of the week currently shown. */
  #columnLabel(colIndex) {
    const weekdays = getWeekdays();
    const date = shortDateForTimestamp(timestampForColumn(colIndex, this.#weeksAhead(), weekdays));
    return [weekdays[colIndex]?.name, date].filter(Boolean).join(", ");
  }

  async _onAddAppointment(event, target) {
    if (!this.actorId) return;
    const { AppointmentEditApp } = await import("./appointment-edit-app.mjs");
    // The GM organises as the DM by default, with the shown PC taking part; players plan for their PC.
    const asDM = game.user.isGM;
    new AppointmentEditApp({
      ownerId: asDM ? DM_ORGANISER : this.actorId,
      invitees: asDM ? [this.actorId] : [],
      day: Number(target.dataset.day),
      slot: Number(target.dataset.slot),
      dateLabel: this.#columnLabel(Number(target.dataset.col))
    }).render(true);
  }

  async _onViewAppointment(event, target) {
    const appointment = getAppointment(target.dataset.appointmentId);
    if (!appointment) return;
    const i18n = (key) => game.i18n.localize(`FIMBLEWOOD.Timetable.Afternoon.${key}`);
    const name = (id) => esc(game.actors.get(id)?.name ?? game.i18n.localize("FIMBLEWOOD.Timetable.UnknownActor"));

    const content = `
      <p><strong>${i18n("Organiser")}:</strong> ${esc(organiserName(appointment.ownerId))}</p>
      <p><strong>${i18n("Invitees")}:</strong> ${appointment.invitees.length ? appointment.invitees.map(name).join(", ") : `<em>${i18n("NoInvitees")}</em>`}</p>
      <p><strong>${i18n("Description")}:</strong><br>${
        appointment.description ? esc(appointment.description).replace(/\n/g, "<br>") : `<em>${i18n("NoDescription")}</em>`
      }</p>`;

    const buttons = [];
    if (canEdit(appointment)) {
      buttons.push({ action: "edit", label: i18n("Edit"), icon: "fas fa-pen", type: "button" });
      buttons.push({ action: "delete", label: i18n("Delete"), icon: "fas fa-trash", type: "button" });
    }
    if (appointment.invitees.includes(this.actorId) && canPlanFor(this.actorId)) {
      buttons.push({ action: "leave", label: i18n("Leave"), icon: "fas fa-door-open", type: "button" });
    }
    buttons.push({ action: "close", label: game.i18n.localize("FIMBLEWOOD.Timetable.Close"), type: "button", default: true });

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: appointment.title },
      content,
      buttons,
      rejectClose: false
    });

    if (choice === "edit") {
      const { AppointmentEditApp } = await import("./appointment-edit-app.mjs");
      const weekdays = getWeekdays();
      const col = weekdays.findIndex((_, idx) => dayNumberForTimestamp(timestampForColumn(idx, this.#weeksAhead(), weekdays)) === appointment.day);
      new AppointmentEditApp({ appointmentId: appointment.id, dateLabel: col === -1 ? "" : this.#columnLabel(col) }).render(true);
    } else if (choice === "delete") {
      const confirmed = await foundry.applications.api.DialogV2.confirm({
        window: { title: i18n("DeleteTitle") },
        content: `<p>${game.i18n.format("FIMBLEWOOD.Timetable.Afternoon.DeleteBody", { title: esc(appointment.title) })}</p>`,
        rejectClose: false
      });
      if (confirmed) requestAfternoonChange({ op: "delete", id: appointment.id });
    } else if (choice === "leave") {
      requestAfternoonChange({ op: "leave", id: appointment.id, actorId: this.actorId });
    }
  }
}
