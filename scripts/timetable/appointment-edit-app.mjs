/**
 * Fimblewood Academy — Timetable appointment editor
 *
 * Small window for creating or editing one afternoon/evening appointment:
 * title, description, and the other PCs invited to it. Opened from the
 * viewer by players for their own character, or by the GM on a player's
 * behalf; saving goes through afternoon.mjs's requestAfternoonChange, so
 * the active GM does the actual write.
 */

import { DM_ORGANISER, organiserName, getAppointment, conflictingParticipants, plannableActors, requestAfternoonChange } from "./afternoon.mjs";

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

export class AppointmentEditApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-timetable-appointment-edit",
    tag: "div",
    window: { title: "FIMBLEWOOD.Timetable.Afternoon.EditTitle", icon: "fas fa-people-group", resizable: true },
    position: { width: 420, height: "auto" },
    classes: ["fimblewood-timetable-app", "is-course-edit"]
  };

  static #ACTIONS = { addInvitee: "_onAddInvitee", removeInvitee: "_onRemoveInvitee", save: "_onSave", cancel: "_onCancel" };

  /** `dateLabel` is display-only ("Monday, 12th June"); `day`/`slot` are what's stored. */
  constructor({ ownerId, day, slot, invitees = [], dateLabel = "", appointmentId = null }) {
    super({});
    this.dateLabel = dateLabel;
    const existing = appointmentId ? getAppointment(appointmentId) : null;
    this.draft = existing ?? { id: foundry.utils.randomID(), day, slot, ownerId, title: "", description: "", invitees: [...invitees] };
  }

  async _renderHTML() {
    const conflicts = conflictingParticipants(this.draft);
    const conflictMark = (actorId) => conflicts.has(actorId)
      ? `<span class="fw-tt-conflict" title="${game.i18n.format("FIMBLEWOOD.Timetable.Afternoon.ConflictWith", { titles: esc(conflicts.get(actorId).join(", ")) })}"><i class="fas fa-triangle-exclamation"></i></span>`
      : "";

    const inviteeRows = this.draft.invitees.map((actorId) => {
      const name = game.actors.get(actorId)?.name ?? game.i18n.localize("FIMBLEWOOD.Timetable.UnknownActor");
      return `
        <li class="fw-tt-attendee-row">
          <span>${esc(name)}</span> ${conflictMark(actorId)}
          <button type="button" class="fw-tt-remove-btn" data-action="removeInvitee" data-actor-id="${actorId}"><i class="fas fa-xmark"></i></button>
        </li>`;
    }).join("");

    const options = plannableActors()
      .filter((a) => a.id !== this.draft.ownerId && !this.draft.invitees.includes(a.id))
      .map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("");

    return `
      <div class="fw-tt-course-edit-body">
        <p class="fw-tt-slot-summary">
          ${esc(this.dateLabel || "?")}
        </p>
        ${this.#organiserField(conflictMark)}
        <label>${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.Title")}
          <input type="text" name="title" maxlength="100" value="${esc(this.draft.title)}" placeholder="${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.TitlePlaceholder")}">
        </label>
        <label>${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.Description")}
          <textarea name="description" rows="4" maxlength="2000">${esc(this.draft.description)}</textarea>
        </label>
        <fieldset class="fw-tt-attendees">
          <legend>${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.Invitees")}</legend>
          <ul class="fw-tt-attendee-list">${inviteeRows || `<li class="fw-tt-empty-list">${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.NoInvitees")}</li>`}</ul>
          <div class="fw-tt-add-attendee">
            <select name="newInvitee">${options || `<option value="">${game.i18n.localize("FIMBLEWOOD.Timetable.NoActors")}</option>`}</select>
            <button type="button" data-action="addInvitee" ${options ? "" : "disabled"}>${game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.Invite")}</button>
          </div>
        </fieldset>
        <div class="fw-tt-course-edit-actions">
          <button type="button" data-action="save" class="fw-tt-btn-primary">${game.i18n.localize("FIMBLEWOOD.Timetable.Save")}</button>
          <button type="button" data-action="cancel">${game.i18n.localize("FIMBLEWOOD.Timetable.Cancel")}</button>
        </div>
      </div>`;
  }

  /** The GM picks the organiser: the DM, or a relevant PC to plan in a player's name. Players always organise as their PC. */
  #organiserField(conflictMark) {
    const label = game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.Organiser");
    if (!game.user.isGM) {
      return `<p><strong>${label}:</strong> ${esc(organiserName(this.draft.ownerId))} ${conflictMark(this.draft.ownerId)}</p>`;
    }
    const choices = [{ id: DM_ORGANISER, name: organiserName(DM_ORGANISER) }, ...plannableActors()];
    if (!choices.some((c) => c.id === this.draft.ownerId)) choices.push({ id: this.draft.ownerId, name: organiserName(this.draft.ownerId) });
    const options = choices.map((c) => `<option value="${c.id}" ${c.id === this.draft.ownerId ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    return `
      <label>${label} ${conflictMark(this.draft.ownerId)}
        <select name="organiser">${options}</select>
      </label>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwTtWired) {
      content.dataset.fwTtWired = "1";
      content.addEventListener("click", (event) => {
        const target = event.target.closest("[data-action]");
        if (!target) return;
        const handlerName = AppointmentEditApp.#ACTIONS[target.dataset.action];
        if (handlerName) this[handlerName](event, target);
      });
      content.addEventListener("change", (event) => {
        if (event.target.name === "organiser") this.#changeOrganiser(event.target.value);
      });
    }
    return content;
  }

  #readFormFields() {
    const root = this.element;
    this.draft.title = root.querySelector('[name="title"]')?.value.trim() ?? this.draft.title;
    this.draft.description = root.querySelector('[name="description"]')?.value.trim() ?? this.draft.description;
  }

  /** A PC handing over the organiser role stays in as an invitee; the new organiser leaves the invitee list. */
  #changeOrganiser(ownerId) {
    this.#readFormFields();
    const previous = this.draft.ownerId;
    this.draft.invitees = this.draft.invitees.filter((id) => id !== ownerId);
    if (previous !== DM_ORGANISER && previous !== ownerId) this.draft.invitees.unshift(previous);
    this.draft.ownerId = ownerId;
    this.render();
  }

  _onAddInvitee() {
    this.#readFormFields();
    const actorId = this.element.querySelector('[name="newInvitee"]')?.value;
    if (!actorId || this.draft.invitees.includes(actorId)) return;
    this.draft.invitees.push(actorId);
    const conflicts = conflictingParticipants(this.draft);
    if (conflicts.has(actorId)) {
      ui.notifications.warn(game.i18n.format("FIMBLEWOOD.Timetable.Afternoon.ConflictWarning", {
        actor: game.actors.get(actorId)?.name ?? actorId, titles: conflicts.get(actorId).join(", ")
      }));
    }
    this.render();
  }

  _onRemoveInvitee(event, target) {
    this.#readFormFields();
    this.draft.invitees = this.draft.invitees.filter((id) => id !== target.dataset.actorId);
    this.render();
  }

  async _onSave() {
    this.#readFormFields();
    if (!this.draft.title) {
      ui.notifications.warn(game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.TitleRequired"));
      return;
    }
    if (this.draft.ownerId === DM_ORGANISER && !this.draft.invitees.length) {
      ui.notifications.warn(game.i18n.localize("FIMBLEWOOD.Timetable.Afternoon.ParticipantRequired"));
      return;
    }
    if (await requestAfternoonChange({ op: "upsert", appointment: this.draft })) this.close();
  }

  _onCancel() { this.close(); }
}
