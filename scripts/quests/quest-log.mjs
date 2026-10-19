/**
 * Fimblewood Academy — Quests: the quest log
 *
 * Every quest this user can see, filtered by status and grouped by category,
 * with a search box. The eye button shows or hides a quest in this user's
 * dock; the GM reorders quests by dragging them and can import the quests of
 * the Simpler Quests module.
 */

import {
  MODULE_ID, SETTINGS, STATUSES, CATEGORIES, t, tf, esc, getQuests, questData, canSee, canCreate,
  progress, requestQuestOp
} from "./data.mjs";
import { renderDock } from "./dock.mjs";
import { simplerQuestsData, importSimplerQuests } from "./import-simpler-quests.mjs";

export class QuestLog extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-quest-log",
    tag: "div",
    window: { title: "FIMBLEWOOD.Quests.Log.Title", icon: "fas fa-book", resizable: true },
    position: { width: 460, height: 640 },
    classes: ["fimblewood-quest-app", "fimblewood-quest-log"]
  };

  status = "active";
  search = "";

  async _renderHTML() {
    const gm = game.user.isGM;
    const hidden = new Set(game.settings.get(MODULE_ID, SETTINGS.dockHidden));
    const visible = getQuests().filter((e) => canSee(e));
    const statuses = STATUSES.filter((s) => gm || s !== "draft");
    const tabs = statuses.map((s) => {
      const count = visible.filter((e) => questData(e).status === s).length;
      return `<a class="fw-quest-tab ${this.status === s ? "active" : ""}" data-status="${s}">${esc(t(`Status.${s}`))}${count ? ` <span class="fw-quest-count">${count}</span>` : ""}</a>`;
    }).join("");

    const quests = visible.filter((e) => questData(e).status === this.status);
    const groups = CATEGORIES.map((category) => {
      const list = quests.filter((e) => questData(e).category === category);
      if (!list.length) return "";
      return `
        <h3 class="fw-quest-heading"><span>${esc(t(`Category.${category}`))}</span></h3>
        <ul class="fw-quest-log-list" data-category="${category}">${list.map((entry) => {
          const q = questData(entry);
          const prog = progress(q);
          const inDock = !hidden.has(entry.id);
          return `
            <li class="fw-quest-log-row" data-quest-id="${entry.id}" data-search="${esc(entry.name.toLowerCase())}" ${gm ? `draggable="true"` : ""}>
              ${q.image ? `<img class="fw-quest-log-thumb" src="${esc(q.image)}" alt="">` : `<span class="fw-quest-log-thumb is-empty"><i class="fas fa-scroll"></i></span>`}
              <a class="fw-quest-log-title" data-action="open">${esc(entry.name)}</a>
              ${gm && q.visibleTo !== "all" ? `<i class="fas fa-user-lock fw-quest-hint" data-tooltip="${esc(t("Log.Restricted"))}"></i>` : ""}
              ${prog.total ? `<span class="fw-quest-dock-progress">${prog.done}/${prog.total}</span>` : ""}
              ${q.status === "active" ? `<button type="button" class="fw-quest-icon-btn ${inDock ? "" : "is-off"}" data-action="dock"
                data-tooltip="${esc(t(inDock ? "Log.HideFromDock" : "Log.ShowInDock"))}"><i class="fas fa-${inDock ? "eye" : "eye-slash"}"></i></button>` : ""}
            </li>`;
        }).join("")}</ul>`;
    }).join("");

    const sq = gm ? simplerQuestsData() : null;
    const toImport = sq?.filter((s) => !getQuests().some((e) => questData(e).importedFrom === s.id)).length ?? 0;

    return `
      <div class="fw-quest-log-toolbar">
        <input type="search" class="fw-quest-search" placeholder="${esc(t("Log.Search"))}" value="${esc(this.search)}">
        ${canCreate() ? `<button type="button" data-action="create"><i class="fas fa-plus"></i> ${esc(t("Log.New"))}</button>` : ""}
      </div>
      <nav class="fw-quest-tabs is-status">${tabs}</nav>
      <div class="fw-quest-log-body">${groups || `<p class="fw-quest-empty">${esc(t("Log.Empty"))}</p>`}</div>
      ${toImport ? `<div class="fw-quest-actions fw-quest-import">
        <button type="button" data-action="import"><i class="fas fa-file-import"></i> ${esc(tf("Log.Import", { count: toImport }))}</button>
      </div>` : ""}`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    this.#applySearch(content);
    if (content.dataset.fwQuestWired) return;
    content.dataset.fwQuestWired = "1";

    content.addEventListener("click", async (event) => {
      const tab = event.target.closest("[data-status]");
      if (tab) {
        this.status = tab.dataset.status;
        return this.render();
      }
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const id = button.closest("[data-quest-id]")?.dataset.questId;
      const api = game.modules.get(MODULE_ID).api.quests;
      switch (button.dataset.action) {
        case "open": return api.open(id);
        case "create": return api.create();
        case "import": {
          button.disabled = true;
          await importSimplerQuests();
          return this.render();
        }
        case "dock": {
          const hidden = new Set(game.settings.get(MODULE_ID, SETTINGS.dockHidden));
          if (hidden.has(id)) hidden.delete(id);
          else hidden.add(id);
          await game.settings.set(MODULE_ID, SETTINGS.dockHidden, [...hidden]);
          renderDock();
          return this.render();
        }
      }
    });

    content.addEventListener("input", (event) => {
      if (!event.target.classList.contains("fw-quest-search")) return;
      this.search = event.target.value;
      this.#applySearch(content);
    });

    // GM: drag a quest within the list to reorder.
    let dragged = null;
    content.addEventListener("dragstart", (event) => {
      dragged = event.target.closest?.(".fw-quest-log-row");
      if (dragged) event.dataTransfer.effectAllowed = "move";
    });
    content.addEventListener("dragover", (event) => {
      const row = event.target.closest(".fw-quest-log-row");
      if (!dragged || !row || row === dragged || row.parentElement !== dragged.parentElement) return;
      event.preventDefault();
      const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      row.parentElement.insertBefore(dragged, after ? row.nextSibling : row);
    });
    content.addEventListener("dragend", () => {
      if (!dragged) return;
      dragged = null;
      // The new order of every quest: the ones shown, in their new order, then all others as they were.
      const shown = [...content.querySelectorAll(".fw-quest-log-row")].map((r) => r.dataset.questId);
      const all = getQuests().map((e) => e.id);
      const ids = [];
      for (const id of all) {
        if (!shown.includes(id)) ids.push(id);
        else if (id === shown[0]) ids.push(...shown);
      }
      requestQuestOp({ type: "reorder", ids });
    });
  }

  #applySearch(content) {
    const term = this.search.trim().toLowerCase();
    for (const row of content.querySelectorAll(".fw-quest-log-row")) row.hidden = !!term && !row.dataset.search.includes(term);
  }
}
