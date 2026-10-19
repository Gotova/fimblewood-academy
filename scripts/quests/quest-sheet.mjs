/**
 * Fimblewood Academy — Quests: the quest window
 *
 * A banner with the quest picture and title, then four tabs: overview
 * (description and objectives), notes (co-edited live), reward and, for those
 * who may edit the quest, settings.
 *
 * The window renders its panels itself instead of replacing all of its HTML:
 * the notes panel holds a collaborative <prose-mirror> editor, and removing it
 * from the page ends the editing session. So the notes panel is built once
 * and only rebuilt when this user's right to write notes changes; every other
 * panel is refreshed on each render.
 */

import {
  STATUSES, CATEGORIES, MAX_DEPTH, t, tf, esc,
  getQuest, questData, pageOf, can, canSee, visibleObjectives, progress, players,
  requestQuestOp, cleanObjective, parseObjectives, stringifyObjectives
} from "./data.mjs";
import * as qm from "./quartermaster.mjs";

const NEXT_STATE = { open: "done", done: "failed", failed: "open" };
const STATE_ICON = { open: "far fa-square", done: "fas fa-square-check", failed: "fas fa-square-xmark" };

export class QuestSheet extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    tag: "div",
    window: { icon: "fas fa-scroll", resizable: true },
    position: { width: 560, height: 720 },
    classes: ["fimblewood-quest-app", "fimblewood-quest-sheet"]
  };

  constructor(entryId, options = {}) {
    super({ ...options, id: `fimblewood-quest-${entryId}` });
    this.entryId = entryId;
    this.tab = "overview";
    this.textMode = false;
    this._notesFor = null;
    this._editingUsers = [];
  }

  get entry() {
    return getQuest(this.entryId);
  }

  get title() {
    return this.entry?.name ?? t("Title");
  }

  /* -------------------------------------------- */

  async _renderHTML() {
    const entry = this.entry;
    if (!entry || !canSee(entry)) return null;
    const q = questData(entry);
    const edit = can(entry, "editQuest");
    return {
      banner: this.#banner(entry, q, edit),
      tabs: this.#tabs(edit),
      ...(await this.#overview(entry, q, edit)),
      rewards: await this.#rewards(entry, q),
      settings: edit ? this.#settings(entry, q) : "",
      notesAllowed: can(entry, "editNotes")
    };
  }

  #banner(entry, q, edit) {
    const prog = progress(q);
    // Set inline: a url() inside a CSS variable would resolve relative to the stylesheet, not the page.
    const bg = q.image ? `style="background-image: linear-gradient(to bottom, rgba(0, 0, 0, 0) 20%, rgba(10, 6, 14, 0.85)), url('${esc(q.image)}')"` : "";
    return `
      <div class="fw-quest-banner ${q.image ? "has-image" : ""}" ${bg}>
        ${edit ? `<div class="fw-quest-banner-tools">
          <button type="button" data-action="pick-image" data-tooltip="${esc(t("Sheet.PickImage"))}"><i class="fas fa-image"></i></button>
          ${q.image ? `<button type="button" data-action="clear-image" data-tooltip="${esc(t("Sheet.ClearImage"))}"><i class="fas fa-xmark"></i></button>` : ""}
        </div>` : ""}
        <div class="fw-quest-banner-text">
          <div class="fw-quest-chips">
            <span class="fw-quest-chip is-${q.status}">${esc(t(`Status.${q.status}`))}</span>
            <span class="fw-quest-chip is-category">${esc(t(`Category.${q.category}`))}</span>
            ${prog.total ? `<span class="fw-quest-chip">${prog.done}/${prog.total}</span>` : ""}
          </div>
          ${edit
            ? `<input type="text" class="fw-quest-title-input" name="title" value="${esc(entry.name)}" placeholder="${esc(t("Sheet.TitlePlaceholder"))}">`
            : `<h1 class="fw-quest-title">${esc(entry.name)}</h1>`}
        </div>
      </div>`;
  }

  #tabs(edit) {
    const tabs = ["overview", "notes", "rewards", ...(edit ? ["settings"] : [])];
    const icons = { overview: "fa-book-open", notes: "fa-feather", rewards: "fa-gem", settings: "fa-gear" };
    return tabs.map((id) => `
      <a class="fw-quest-tab ${this.tab === id ? "active" : ""}" data-tab="${id}">
        <i class="fas ${icons[id]}"></i> ${esc(t(`Tabs.${id[0].toUpperCase()}${id.slice(1)}`))}
      </a>`).join("");
  }

  async #overview(entry, q, edit) {
    const description = pageOf(entry, "description")?.text.content ?? "";
    const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(description, { relativeTo: entry });
    const descriptionHTML = edit
      ? `<div class="fw-quest-description-slot"></div>`
      : (description ? `<div class="fw-quest-description">${enriched}</div>` : "");
    this._descriptionValue = { value: description, enriched };

    const objectives = visibleObjectives(q);
    const check = can(entry, "checkObjectives");
    let list;
    if (edit && this.textMode) {
      list = `
        <textarea class="fw-quest-textmode" rows="10" placeholder="${esc(t("Sheet.TextModeHint"))}">${esc(stringifyObjectives(objectives))}</textarea>
        <p class="fw-quest-hint">${esc(t("Sheet.TextModeHint"))}</p>
        <div class="fw-quest-actions"><button type="button" data-action="apply-text"><i class="fas fa-check"></i> ${esc(t("Sheet.ApplyText"))}</button></div>`;
    } else {
      const rows = objectives.map((o) => `
        <li class="fw-quest-objective is-${o.state} ${o.secret ? "is-secret" : ""} ${o.optional ? "is-optional" : ""}" data-objective-id="${o.id}" style="--depth: ${o.depth}">
          ${edit ? `<span class="fw-quest-grip" draggable="true" data-tooltip="${esc(t("Sheet.DragHint"))}"><i class="fas fa-grip-vertical"></i></span>` : ""}
          <button type="button" class="fw-quest-state" data-action="cycle-state" ${check ? "" : "disabled"}
            data-tooltip="${esc(t(`State.${o.state}`))}"><i class="${STATE_ICON[o.state]}"></i></button>
          ${edit
            ? `<input type="text" class="fw-quest-objective-text" value="${esc(o.text)}" placeholder="${esc(t("Sheet.ObjectivePlaceholder"))}">`
            : `<span class="fw-quest-objective-text">${esc(o.text)}</span>`}
          ${o.optional ? `<span class="fw-quest-tag">${esc(t("Sheet.Optional"))}</span>` : ""}
          ${o.secret ? `<i class="fas fa-eye-slash fw-quest-secret-icon" data-tooltip="${esc(t("Sheet.Secret"))}"></i>` : ""}
          ${edit ? `<button type="button" class="fw-quest-icon-btn" data-action="objective-menu" data-tooltip="${esc(t("Sheet.ObjectiveOptions"))}"><i class="fas fa-ellipsis-vertical"></i></button>` : ""}
          ${edit && this._menuFor === o.id ? this.#objectiveMenu(o) : ""}
        </li>`).join("");
      list = `
        <ul class="fw-quest-objectives">${rows || `<li class="fw-quest-empty">${esc(t("Sheet.NoObjectives"))}</li>`}</ul>
        ${edit ? `<div class="fw-quest-actions">
          <button type="button" data-action="add-objective"><i class="fas fa-plus"></i> ${esc(t("Sheet.AddObjective"))}</button>
          <span class="fw-quest-hint">${esc(t("Sheet.KeyHint"))}</span>
        </div>` : ""}`;
    }

    return { description: descriptionHTML, descriptionKey: `${edit}|${description}`, objectives: `
      <h3 class="fw-quest-heading">
        <span>${esc(t("Sheet.Objectives"))}</span>
        ${edit ? `<button type="button" class="fw-quest-icon-btn" data-action="toggle-text" data-tooltip="${esc(t("Sheet.TextMode"))}">
          <i class="fas ${this.textMode ? "fa-list-check" : "fa-align-left"}"></i></button>` : ""}
      </h3>
      ${list}` };
  }

  /** The options of one objective, folded out under its row. */
  #objectiveMenu(o) {
    const toggle = (action, on, icon, label) => `
      <button type="button" data-action="${action}" class="${on ? "is-on" : ""}"><i class="fas ${icon}"></i> ${esc(t(label))}</button>`;
    const states = ["open", "done", "failed"].map((s) => `
      <button type="button" data-action="set-state" data-state="${s}" class="${o.state === s ? "is-on" : ""}"><i class="${STATE_ICON[s]}"></i> ${esc(t(`State.${s}`))}</button>`).join("");
    return `
      <div class="fw-quest-objective-menu">
        <div class="fw-quest-menu-group">${states}</div>
        <div class="fw-quest-menu-group">
          ${toggle("toggle-optional", o.optional, "fa-circle-half-stroke", "Sheet.MarkOptional")}
          ${game.user.isGM ? toggle("toggle-secret", o.secret, "fa-eye-slash", "Sheet.MarkSecret") : ""}
          <button type="button" data-action="remove-objective" class="is-danger"><i class="fas fa-trash"></i> ${esc(t("Sheet.RemoveObjective"))}</button>
        </div>
      </div>`;
  }

  async #rewards(entry, q) {
    const r = q.rewards;
    const gm = game.user.isGM;
    const edit = can(entry, "editQuest");
    const parts = [];

    if (edit) {
      parts.push(`
        <label class="fw-quest-field"><span>${esc(t("Rewards.Text"))}</span>
          <textarea name="rewardText" rows="3">${esc(r.text)}</textarea></label>
        <label class="fw-quest-field is-inline"><span>${esc(t("Rewards.Xp"))}</span>
          <input type="number" name="rewardXp" min="0" step="1" value="${Number(r.xp) || 0}"></label>`);
    } else if (r.text || r.xp) {
      parts.push(`<div class="fw-quest-reward-text">${r.text ? `<p>${esc(r.text).replace(/\n/g, "<br>")}</p>` : ""}
        ${r.xp ? `<p><strong>${esc(t("Rewards.Xp"))}:</strong> ${Number(r.xp)}</p>` : ""}</div>`);
    }

    if (qm.isAvailable()) {
      parts.push(`<h3 class="fw-quest-heading"><span><i class="fas fa-sack"></i> ${esc(t("Rewards.Loot"))}</span></h3>`);
      if (r.awarded) {
        parts.push(`<p class="fw-quest-hint"><i class="fas fa-check"></i> ${esc(t("Rewards.Awarded"))}</p>${lootList(r.awardedItems)}`);
      } else if (gm) {
        const folders = qm.getFolders();
        const folder = r.qmFolderId ? folders.find((f) => f.id === r.qmFolderId) : null;
        const options = [`<option value="">${esc(t("Rewards.NoFolder"))}</option>`,
          ...folders.map((f) => `<option value="${esc(f.id)}" ${f.id === r.qmFolderId ? "selected" : ""}>${esc(f.name)}</option>`)].join("");
        parts.push(`
          <label class="fw-quest-field"><span>${esc(t("Rewards.Folder"))}</span><select name="qmFolder">${options}</select></label>
          ${r.qmFolderId && !folder ? `<p class="fw-quest-warning">${esc(t("Rewards.FolderMissing"))}</p>` : ""}
          ${folder ? lootList(qm.folderContents(folder.id)) : ""}
          <label class="fw-quest-check"><input type="checkbox" name="autoAward" ${r.autoAward ? "checked" : ""}> ${esc(t("Rewards.AutoAward"))}</label>
          <div class="fw-quest-actions">
            <button type="button" data-action="award" ${folder ? "" : "disabled"}><i class="fas fa-hand-holding-heart"></i> ${esc(t("Rewards.Award"))}</button>
            <button type="button" data-action="open-qm"><i class="fas fa-box-open"></i> ${esc(t("Rewards.OpenQm"))}</button>
          </div>`);
      } else if (r.qmFolderId) {
        parts.push(`<p class="fw-quest-hint"><i class="fas fa-question"></i> ${esc(t("Rewards.Hidden"))}</p>`);
      }
    }

    return parts.join("") || `<p class="fw-quest-empty">${esc(t("Rewards.None"))}</p>`;
  }

  #settings(entry, q) {
    const gm = game.user.isGM;
    const select = (name, values, current, prefix) => `<select name="${name}">${values
      .filter((v) => gm || v !== "draft")
      .map((v) => `<option value="${v}" ${v === current ? "selected" : ""}>${esc(t(`${prefix}.${v}`))}</option>`).join("")}</select>`;
    const all = q.visibleTo === "all";
    const playerBoxes = players().map((u) => `
      <label class="fw-quest-check"><input type="checkbox" name="visibleUser" value="${u.id}" ${all || q.visibleTo.includes(u.id) ? "checked" : ""} ${all ? "disabled" : ""}>
        <span class="fw-quest-dot" style="background:${esc(u.color?.css ?? u.color)}"></span>${esc(u.name)}</label>`).join("");
    const perm = (key) => `<label class="fw-quest-check"><input type="checkbox" name="perm-${key}" ${q.perms[key] ? "checked" : ""}> ${esc(t(`Perms.${key}`))}</label>`;

    return `
      <div class="fw-quest-grid">
        <label class="fw-quest-field"><span>${esc(t("Sheet.Status"))}</span>${select("status", STATUSES, q.status, "Status")}</label>
        <label class="fw-quest-field"><span>${esc(t("Sheet.Category"))}</span>${select("category", CATEGORIES, q.category, "Category")}</label>
      </div>
      ${gm ? `
        <h3 class="fw-quest-heading"><span><i class="fas fa-eye"></i> ${esc(t("Sheet.Visibility"))}</span></h3>
        <label class="fw-quest-check"><input type="checkbox" name="visibleAll" ${all ? "checked" : ""}> ${esc(t("Sheet.VisibleAll"))}</label>
        <div class="fw-quest-players">${playerBoxes || `<span class="fw-quest-hint">${esc(t("Sheet.NoPlayers"))}</span>`}</div>
        ${q.status === "draft" ? `<p class="fw-quest-hint">${esc(t("Sheet.DraftHint"))}</p>` : ""}
        <h3 class="fw-quest-heading"><span><i class="fas fa-user-lock"></i> ${esc(t("Sheet.Permissions"))}</span></h3>
        ${perm("checkObjectives")}${perm("editNotes")}${perm("editQuest")}` : ""}
      <div class="fw-quest-actions is-danger">
        <button type="button" data-action="delete"><i class="fas fa-trash"></i> ${esc(t("Sheet.Delete"))}</button>
      </div>`;
  }

  /* -------------------------------------------- */

  async _replaceHTML(result, content) {
    if (!result) {
      content.innerHTML = `<p class="fw-quest-empty">${esc(t("Notice.Missing"))}</p>`;
      return;
    }
    if (!content.querySelector(".fw-quest-body")) {
      content.innerHTML = `
        <div class="fw-quest-banner-slot"></div>
        <nav class="fw-quest-tabs"></nav>
        <div class="fw-quest-body">
          <section class="fw-quest-panel" data-panel="overview">
            <div class="fw-quest-description-box"></div>
            <div class="fw-quest-objectives-box"></div>
          </section>
          <section class="fw-quest-panel" data-panel="notes"></section>
          <section class="fw-quest-panel" data-panel="rewards"></section>
          <section class="fw-quest-panel" data-panel="settings"></section>
        </div>`;
      this.#wire(content);
    }

    const focus = this.#captureFocus(content);
    content.querySelector(".fw-quest-banner-slot").innerHTML = result.banner;
    content.querySelector(".fw-quest-tabs").innerHTML = result.tabs;
    // The description is only rebuilt when it changed, and never while someone is writing in it.
    const descriptionBox = content.querySelector(".fw-quest-description-box");
    if (this._descriptionKey !== result.descriptionKey && !descriptionBox.querySelector("prose-mirror.active")) {
      this._descriptionKey = result.descriptionKey;
      descriptionBox.innerHTML = result.description;
      this.#mountDescription(content);
    }
    content.querySelector(".fw-quest-objectives-box").innerHTML = result.objectives;
    content.querySelector('[data-panel="rewards"]').innerHTML = result.rewards;
    content.querySelector('[data-panel="settings"]').innerHTML = result.settings;
    if (this._notesFor !== result.notesAllowed) this.#mountNotes(content, result.notesAllowed);
    else this.#refreshReadonlyNotes(content);
    if (!result.settings && this.tab === "settings") this.tab = "overview";
    this.#showTab(content);
    this.#restoreFocus(content, focus);
  }

  #showTab(content = this.element) {
    for (const panel of content.querySelectorAll(".fw-quest-panel")) panel.classList.toggle("active", panel.dataset.panel === this.tab);
    for (const tab of content.querySelectorAll(".fw-quest-tab")) tab.classList.toggle("active", tab.dataset.tab === this.tab);
  }

  /** The description editor: a toggled, non-collaborative editor, saved through the GM relay. */
  #mountDescription(content) {
    const slot = content.querySelector(".fw-quest-description-slot");
    if (!slot) return;
    const { HTMLProseMirrorElement } = foundry.applications.elements;
    const editor = HTMLProseMirrorElement.create({
      name: "description",
      value: this._descriptionValue.value,
      enriched: this._descriptionValue.enriched || `<p class="fw-quest-placeholder">${esc(t("Sheet.DescriptionPlaceholder"))}</p>`,
      toggled: true
    });
    editor.classList.add("fw-quest-description");
    editor.addEventListener("change", () => requestQuestOp({ type: "setDescription", id: this.entryId, html: editor.value }));
    slot.replaceWith(editor);
  }

  /** The notes: a live, collaborative editor for those who may write, plain enriched text for the rest. */
  #mountNotes(content, allowed) {
    const panel = content.querySelector('[data-panel="notes"]');
    const page = pageOf(this.entry, "notes");
    this._notesFor = allowed;
    if (!page) {
      panel.innerHTML = `<p class="fw-quest-empty">${esc(t("Notice.Missing"))}</p>`;
      return;
    }
    if (!allowed || !page.isOwner) {
      panel.innerHTML = `<div class="fw-quest-notes-readonly"></div>`;
      this.#refreshReadonlyNotes(content);
      return;
    }
    panel.innerHTML = `<div class="fw-quest-editing" hidden></div>`;
    const { HTMLProseMirrorElement } = foundry.applications.elements;
    const editor = HTMLProseMirrorElement.create({
      name: "text.content",
      value: page.text.content ?? "",
      documentUUID: page.uuid,
      collaborate: true
    });
    editor.classList.add("fw-quest-notes");
    // Saved on Ctrl+S / the save button and when the editor leaves the page; the server autosaves in between.
    editor.addEventListener("change", () => requestQuestOp({ type: "saveNotes", id: this.entryId, html: editor.value }));
    panel.append(editor);
    this.#showEditingUsers();
  }

  async #refreshReadonlyNotes(content) {
    const box = content.querySelector(".fw-quest-notes-readonly");
    if (!box) return;
    const html = pageOf(this.entry, "notes")?.text.content ?? "";
    box.innerHTML = html
      ? await foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { relativeTo: this.entry })
      : `<p class="fw-quest-empty">${esc(t("Sheet.NoNotes"))}</p>`;
  }

  /** Called by the pm.usersEditing listener in index.mjs. */
  setEditingUsers(userIds) {
    this._editingUsers = userIds;
    this.#showEditingUsers();
  }

  #showEditingUsers() {
    const box = this.element?.querySelector(".fw-quest-editing");
    if (!box) return;
    const others = this._editingUsers.filter((id) => id !== game.user.id).map((id) => game.users.get(id)).filter(Boolean);
    box.hidden = !others.length;
    box.innerHTML = others.length ? `<i class="fas fa-keyboard"></i> ${esc(tf("Sheet.Editing", {
      names: others.map((u) => u.name).join(", ")
    }))}` : "";
  }

  /* -------------------------------------------- */
  /*  Focus across re-renders                      */
  /* -------------------------------------------- */

  #captureFocus(content) {
    const el = content.querySelector(".fw-quest-objective-text:focus, .fw-quest-title-input:focus");
    if (!el) return null;
    return {
      objectiveId: el.closest("[data-objective-id]")?.dataset.objectiveId ?? null,
      title: el.classList.contains("fw-quest-title-input"),
      value: el.value,
      start: el.selectionStart,
      end: el.selectionEnd
    };
  }

  #restoreFocus(content, focus) {
    const pending = this._focusAfterRender;
    this._focusAfterRender = null;
    if (pending) focus = { objectiveId: pending, start: 0, end: 0 };
    if (!focus) return;
    const el = focus.title
      ? content.querySelector(".fw-quest-title-input")
      : content.querySelector(`[data-objective-id="${focus.objectiveId}"] .fw-quest-objective-text`);
    if (!el || el.tagName !== "INPUT") return;
    // Keep what was being typed, which the update that caused this render may not contain yet.
    if (focus.value !== undefined && !pending) el.value = focus.value;
    el.focus();
    el.setSelectionRange(focus.start ?? el.value.length, focus.end ?? el.value.length);
  }

  /* -------------------------------------------- */
  /*  Events                                       */
  /* -------------------------------------------- */

  #wire(content) {
    content.addEventListener("click", (event) => {
      const tab = event.target.closest(".fw-quest-tab");
      if (tab) {
        this.tab = tab.dataset.tab;
        this.#showTab();
        return;
      }
      const button = event.target.closest("[data-action]");
      if (button && !button.disabled) this.#onAction(button.dataset.action, button, event);
    });
    content.addEventListener("contextmenu", (event) => {
      const button = event.target.closest('[data-action="cycle-state"]');
      if (!button || !game.user.isGM) return;
      event.preventDefault();
      this.#editObjectives((list, i) => { list[i].secret = !list[i].secret; }, button);
    });
    content.addEventListener("change", (event) => this.#onChange(event));
    this.#wireObjectiveDrag(content);
    content.addEventListener("keydown", (event) => this.#onKeyDown(event));
    content.addEventListener("focusout", (event) => {
      const input = event.target.closest(".fw-quest-objective-text");
      if (input?.tagName === "INPUT") this.#commitObjectiveText(input);
      if (event.target.classList.contains("fw-quest-title-input")) this.#commitTitle(event.target);
    });
  }

  /**
   * Objectives are dragged by their grip. An objective moves together with its
   * sub-objectives; dropped onto the upper half of a row it goes before it, onto
   * the lower half after it, and takes the depth of the row it lands next to.
   */
  #wireObjectiveDrag(content) {
    let dragId = null;
    const clear = () => content.querySelectorAll(".fw-quest-objective.drop-before, .fw-quest-objective.drop-after")
      .forEach((el) => el.classList.remove("drop-before", "drop-after"));

    content.addEventListener("dragstart", (event) => {
      const grip = event.target.closest?.(".fw-quest-grip");
      if (!grip) return;
      const row = grip.closest("[data-objective-id]");
      dragId = row.dataset.objectiveId;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", "");
      event.dataTransfer.setDragImage(row, 10, row.offsetHeight / 2);
      row.classList.add("is-dragging");
    });
    content.addEventListener("dragover", (event) => {
      const row = dragId && event.target.closest(".fw-quest-objective[data-objective-id]");
      if (!row) return;
      event.preventDefault();
      clear();
      if (row.dataset.objectiveId === dragId) return;
      const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      row.classList.add(after ? "drop-after" : "drop-before");
    });
    content.addEventListener("dragend", () => {
      clear();
      content.querySelector(".fw-quest-objective.is-dragging")?.classList.remove("is-dragging");
      dragId = null;
    });
    content.addEventListener("drop", (event) => {
      const row = dragId && event.target.closest(".fw-quest-objective[data-objective-id]");
      if (!row) return;
      event.preventDefault();
      const after = row.classList.contains("drop-after");
      const targetId = row.dataset.objectiveId;
      const movedId = dragId;
      clear();
      if (targetId === movedId) return;
      this.#editObjectives((list) => moveObjective(list, movedId, targetId, after));
    });
  }

  async #onAction(action, button) {
    const entry = this.entry;
    if (!entry) return;
    const q = questData(entry);
    switch (action) {
      case "cycle-state": {
        const id = button.closest("[data-objective-id]").dataset.objectiveId;
        const obj = q.objectives.find((o) => o.id === id);
        if (obj) await requestQuestOp({ type: "setObjective", id: this.entryId, objectiveId: id, state: NEXT_STATE[obj.state] });
        break;
      }
      case "add-objective":
        await this.#insertObjective(q.objectives.length - 1, q.objectives.at(-1)?.depth ?? 0);
        break;
      case "remove-objective":
        this._menuFor = null;
        await this.#editObjectives((list, i) => list.splice(i, 1), button);
        break;
      case "objective-menu": {
        const id = button.closest("[data-objective-id]").dataset.objectiveId;
        this._menuFor = this._menuFor === id ? null : id;
        this.render();
        break;
      }
      case "set-state": {
        const id = button.closest("[data-objective-id]").dataset.objectiveId;
        await requestQuestOp({ type: "setObjective", id: this.entryId, objectiveId: id, state: button.dataset.state });
        break;
      }
      case "toggle-optional":
        await this.#editObjectives((list, i) => { list[i].optional = !list[i].optional; }, button);
        break;
      case "toggle-secret":
        await this.#editObjectives((list, i) => { list[i].secret = !list[i].secret; }, button);
        break;
      case "toggle-text":
        this.textMode = !this.textMode;
        this.render();
        break;
      case "apply-text": {
        const text = this.element.querySelector(".fw-quest-textmode")?.value ?? "";
        // Secret objectives stay hidden from players in text mode, so keep them out of reach of the parser.
        const visible = visibleObjectives(q);
        const objectives = parseObjectives(text, visible);
        if (!game.user.isGM) objectives.push(...q.objectives.filter((o) => o.secret));
        this.textMode = false;
        await requestQuestOp({ type: "update", id: this.entryId, changes: { objectives } });
        this.render();
        break;
      }
      case "pick-image":
        new foundry.applications.apps.FilePicker.implementation({
          type: "image",
          current: q.image,
          callback: (path) => requestQuestOp({ type: "update", id: this.entryId, changes: { image: path } })
        }).render(true);
        break;
      case "clear-image":
        await requestQuestOp({ type: "update", id: this.entryId, changes: { image: "" } });
        break;
      case "award":
        await requestQuestOp({ type: "awardLoot", id: this.entryId });
        break;
      case "open-qm":
        qm.openLootPrep();
        break;
      case "delete": {
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: t("Sheet.Delete") },
          content: `<p>${esc(tf("Sheet.DeleteConfirm", { name: entry.name }))}</p>`
        });
        if (confirmed) {
          const result = await requestQuestOp({ type: "delete", id: this.entryId });
          if (result?.ok) this.close();
        }
        break;
      }
    }
  }

  async #onChange(event) {
    const el = event.target;
    if (el.closest("prose-mirror")) return;
    const q = questData(this.entry);
    const update = (changes) => requestQuestOp({ type: "update", id: this.entryId, changes });
    switch (el.name) {
      case "status":
      case "category":
        return update({ [el.name]: el.value });
      case "rewardText":
        return update({ rewards: { text: el.value } });
      case "rewardXp":
        return update({ rewards: { xp: Math.max(0, Number(el.value) || 0) } });
      case "qmFolder":
        return update({ rewards: { qmFolderId: el.value || null } });
      case "autoAward":
        return update({ rewards: { autoAward: el.checked } });
      case "visibleAll":
        return update({ visibleTo: el.checked ? "all" : players().map((u) => u.id) });
      case "visibleUser": {
        const ids = [...this.element.querySelectorAll('input[name="visibleUser"]:checked')].map((b) => b.value);
        return update({ visibleTo: ids });
      }
    }
    if (el.name?.startsWith("perm-")) return update({ perms: { ...q.perms, [el.name.slice(5)]: el.checked } });
  }

  #onKeyDown(event) {
    const input = event.target;
    if (input.classList.contains("fw-quest-title-input") && event.key === "Enter") {
      event.preventDefault();
      input.blur();
      return;
    }
    if (input.tagName !== "INPUT" || !input.classList.contains("fw-quest-objective-text")) return;
    const id = input.closest("[data-objective-id]").dataset.objectiveId;
    const q = questData(this.entry);
    const index = q.objectives.findIndex((o) => o.id === id);
    if (index < 0) return;

    if (event.key === "Enter") {
      event.preventDefault();
      this.#insertObjective(index, q.objectives[index].depth, input.value);
    } else if (event.key === "Tab") {
      event.preventDefault();
      const before = index > 0 ? q.objectives[index - 1].depth : -1;
      const depth = q.objectives[index].depth + (event.shiftKey ? -1 : 1);
      if (depth < 0 || depth > Math.min(MAX_DEPTH, before + 1)) return;
      this._focusAfterRender = id;
      this.#editObjectives((list) => {
        list[index].depth = depth;
        list[index].text = input.value;
      });
    } else if (event.key === "Backspace" && input.value === "") {
      event.preventDefault();
      const prev = visibleObjectives(q).filter((o) => q.objectives.indexOf(o) < index).at(-1);
      if (prev) this._focusAfterRender = prev.id;
      this.#editObjectives((list) => list.splice(index, 1));
    }
  }

  /** Adds an empty objective after `index` and puts the cursor in it. */
  async #insertObjective(index, depth, currentText) {
    const fresh = cleanObjective({ depth });
    this._focusAfterRender = fresh.id;
    await this.#editObjectives((list) => {
      if (currentText !== undefined && list[index]) list[index].text = currentText;
      list.splice(index + 1, 0, fresh);
    });
  }

  /** Runs `fn(list, index)` on a copy of all objectives and sends the result. */
  async #editObjectives(fn, button) {
    const q = questData(this.entry);
    const list = foundry.utils.deepClone(q.objectives);
    const id = button?.closest("[data-objective-id]")?.dataset.objectiveId;
    const index = id ? list.findIndex((o) => o.id === id) : -1;
    if (id && index < 0) return;
    fn(list, index);
    // Players never see secret objectives; data.mjs keeps them, so send only what this user sees.
    const objectives = game.user.isGM ? list : list.filter((o) => !o.secret);
    await requestQuestOp({ type: "update", id: this.entryId, changes: { objectives } });
  }

  #commitObjectiveText(input) {
    const id = input.closest("[data-objective-id]")?.dataset.objectiveId;
    const obj = questData(this.entry)?.objectives.find((o) => o.id === id);
    if (!obj || obj.text === input.value) return;
    this.#editObjectives((list, i) => { list[i].text = input.value; }, input);
  }

  #commitTitle(input) {
    const name = input.value.trim();
    if (!name || name === this.entry?.name) return;
    requestQuestOp({ type: "update", id: this.entryId, name, changes: {} });
  }
}

function lootList(items = []) {
  if (!items.length) return `<p class="fw-quest-empty">${esc(t("Rewards.EmptyFolder"))}</p>`;
  return `<ul class="fw-quest-loot">${items.map((i) => `
    <li>${i.img ? `<img src="${esc(i.img)}" alt="">` : `<i class="fas fa-coins"></i>`}
      <span>${esc(i.name)}</span>${i.qty > 1 ? `<span class="fw-quest-qty">×${i.qty}</span>` : ""}</li>`).join("")}</ul>`;
}

/** Moves an objective (with its sub-objectives) before or after another one, in place. */
function moveObjective(list, movedId, targetId, after) {
  const from = list.findIndex((o) => o.id === movedId);
  if (from < 0) return;
  let end = from + 1;
  while (end < list.length && list[end].depth > list[from].depth) end++;
  const block = list.slice(from, end);
  if (block.some((o) => o.id === targetId)) return;
  list.splice(from, end - from);

  let at = list.findIndex((o) => o.id === targetId);
  if (at < 0) return list.splice(from, 0, ...block);
  const targetDepth = list[at].depth;
  if (after) {
    // After a row means after its sub-objectives too.
    at++;
    while (at < list.length && list[at].depth > targetDepth) at++;
  }
  const shift = targetDepth - block[0].depth;
  for (const o of block) o.depth = Math.max(0, Math.min(MAX_DEPTH, o.depth + shift));
  list.splice(at, 0, ...block);

  // No objective may sit more than one level below the one before it.
  for (let i = 0; i < list.length; i++) list[i].depth = Math.min(list[i].depth, i ? list[i - 1].depth + 1 : 0);
}
