/**
 * Fimblewood Academy — Timetable course editor (GM only)
 *
 * A small standalone window for creating or editing a single course: name,
 * professor, note, and its attendee roster. Attendees can be added either
 * by picking any actor from the dropdown here, or by dragging an actor
 * straight onto this window — both paths funnel through the same
 * #addActor(), so a conflict warning (another course at the same day+slot
 * already has that actor) shows up identically either way.
 */

import { getWeekdays } from "./calendar.mjs";
import { getCourse, conflictingAttendees, upsertCourse } from "./data.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

export class CourseEditApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-timetable-course-edit",
    tag: "div",
    window: { title: "FIMBLEWOOD.Timetable.CourseEditTitle", icon: "fas fa-chalkboard-user", resizable: true },
    position: { width: 420, height: "auto" },
    classes: ["fimblewood-timetable-app", "is-course-edit"]
  };

  static #ACTIONS = { addAttendee: "_onAddAttendee", removeAttendee: "_onRemoveAttendee", save: "_onSave", cancel: "_onCancel" };

  constructor({ bufferKey, weekdayId, slot, courseId = null, initialAttendees = [], onSaved = null }) {
    super({});
    this.bufferKey = bufferKey;
    this.onSaved = onSaved;

    const existing = courseId ? getCourse(bufferKey, courseId) : null;
    this.draft = existing
      ? foundry.utils.deepClone(existing)
      : { id: foundry.utils.randomID(), weekdayId, slot, name: "", professor: "", note: "", attendees: [...initialAttendees] };
  }

  #weekday() {
    return getWeekdays().find((d) => d.id === this.draft.weekdayId) ?? null;
  }

  async _renderHTML() {
    const weekday = this.#weekday();
    const conflicts = conflictingAttendees(this.bufferKey, this.draft);

    const attendeeRows = this.draft.attendees.map((actorId) => {
      const actor = game.actors.get(actorId);
      const name = actor?.name ?? game.i18n.localize("FIMBLEWOOD.Timetable.UnknownActor");
      const warn = conflicts.has(actorId)
        ? `<span class="fw-tt-conflict" title="${game.i18n.format("FIMBLEWOOD.Timetable.ConflictWith", { courses: esc(conflicts.get(actorId).join(", ")) })}"><i class="fas fa-triangle-exclamation"></i></span>`
        : "";
      return `
        <li class="fw-tt-attendee-row">
          <span>${esc(name)}</span> ${warn}
          <button type="button" class="fw-tt-remove-btn" data-action="removeAttendee" data-actor-id="${actorId}"><i class="fas fa-xmark"></i></button>
        </li>`;
    }).join("");

    const availableActors = game.actors.contents
      .filter((a) => !this.draft.attendees.includes(a.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    const options = availableActors.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");

    return `
      <div class="fw-tt-course-edit-body">
        <p class="fw-tt-slot-summary">
          ${game.i18n.format("FIMBLEWOOD.Timetable.SlotSummary", { day: esc(weekday?.name ?? "?"), slot: this.draft.slot + 1 })}
        </p>
        <label>${game.i18n.localize("FIMBLEWOOD.Timetable.CourseName")}
          <input type="text" name="name" value="${esc(this.draft.name)}" placeholder="${game.i18n.localize("FIMBLEWOOD.Timetable.CourseNamePlaceholder")}">
        </label>
        <label>${game.i18n.localize("FIMBLEWOOD.Timetable.Professor")}
          <input type="text" name="professor" value="${esc(this.draft.professor)}">
        </label>
        <label>${game.i18n.localize("FIMBLEWOOD.Timetable.Note")}
          <textarea name="note" rows="3">${esc(this.draft.note)}</textarea>
        </label>
        <fieldset class="fw-tt-attendees">
          <legend>${game.i18n.localize("FIMBLEWOOD.Timetable.Attendees")}</legend>
          <p class="fw-tt-drop-hint">${game.i18n.localize("FIMBLEWOOD.Timetable.DropHint")}</p>
          <ul class="fw-tt-attendee-list">${attendeeRows || `<li class="fw-tt-empty-list">${game.i18n.localize("FIMBLEWOOD.Timetable.NoAttendees")}</li>`}</ul>
          <div class="fw-tt-add-attendee">
            <select name="newAttendee">${options || `<option value="">${game.i18n.localize("FIMBLEWOOD.Timetable.NoActors")}</option>`}</select>
            <button type="button" data-action="addAttendee" ${options ? "" : "disabled"}>${game.i18n.localize("FIMBLEWOOD.Timetable.Add")}</button>
          </div>
        </fieldset>
        <div class="fw-tt-course-edit-actions">
          <button type="button" data-action="save" class="fw-tt-btn-primary">${game.i18n.localize("FIMBLEWOOD.Timetable.Save")}</button>
          <button type="button" data-action="cancel">${game.i18n.localize("FIMBLEWOOD.Timetable.Cancel")}</button>
        </div>
      </div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    content.addEventListener("click", (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const handlerName = CourseEditApp.#ACTIONS[target.dataset.action];
      if (handlerName) this[handlerName](event, target);
    });
    content.addEventListener("dragover", (event) => event.preventDefault());
    content.addEventListener("drop", (event) => this.#onDrop(event));
    return content;
  }

  #readFormFields() {
    const root = this.element;
    this.draft.name = root.querySelector('[name="name"]')?.value.trim() ?? this.draft.name;
    this.draft.professor = root.querySelector('[name="professor"]')?.value.trim() ?? this.draft.professor;
    this.draft.note = root.querySelector('[name="note"]')?.value.trim() ?? this.draft.note;
  }

  #addActor(actorId) {
    if (!actorId || this.draft.attendees.includes(actorId)) return;
    this.draft.attendees.push(actorId);
    const conflicts = conflictingAttendees(this.bufferKey, this.draft);
    if (conflicts.has(actorId)) {
      const actor = game.actors.get(actorId);
      ui.notifications.warn(game.i18n.format("FIMBLEWOOD.Timetable.ConflictWarning", { actor: actor?.name ?? actorId, other: conflicts.get(actorId).join(", ") }));
    }
    this.render();
  }

  #onDrop(event) {
    event.preventDefault();
    let data;
    try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return; }
    if (data?.type !== "Actor" || !data.uuid) return;
    const actor = fromUuidSync(data.uuid);
    if (!actor) return;
    this.#readFormFields();
    this.#addActor(actor.id);
  }

  _onAddAttendee() {
    this.#readFormFields();
    const select = this.element.querySelector('[name="newAttendee"]');
    this.#addActor(select?.value);
  }

  _onRemoveAttendee(event, target) {
    this.#readFormFields();
    this.draft.attendees = this.draft.attendees.filter((id) => id !== target.dataset.actorId);
    this.render();
  }

  async _onSave() {
    this.#readFormFields();
    if (!this.draft.name) {
      ui.notifications.warn(game.i18n.localize("FIMBLEWOOD.Timetable.NameRequired"));
      return;
    }
    await upsertCourse(this.bufferKey, this.draft);
    this.onSaved?.();
    this.close();
  }

  _onCancel() { this.close(); }
}
