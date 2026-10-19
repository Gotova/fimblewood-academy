/**
 * Fimblewood Academy — Quests: the dock
 *
 * A small floating panel at the top right, next to the sidebar, listing the
 * active quests this user can see. Each quest folds open to show its
 * objectives, which can be ticked off right there. The header can be dragged
 * (double-click it to put the dock back next to the sidebar), and the dock
 * folds down to its header. Players hide single quests from it in the quest
 * log; position, folding and hidden quests are stored per browser.
 */

import {
  MODULE_ID, SETTINGS, t, esc, getQuests, questData, canSee, can, canCreate,
  visibleObjectives, progress, requestQuestOp
} from "./data.mjs";

const NEXT_STATE = { open: "done", done: "failed", failed: "open" };
const STATE_ICON = { open: "far fa-square", done: "fas fa-square-check", failed: "fas fa-square-xmark" };

let dock = null;

const get = (key) => game.settings.get(MODULE_ID, key);
const set = (key, value) => game.settings.set(MODULE_ID, key, value);

export function renderDock() {
  if (!game.ready) return;
  if (!get(SETTINGS.dockEnabled)) {
    dock?.remove();
    dock = null;
    return;
  }
  if (!dock) {
    dock = document.createElement("section");
    dock.id = "fw-quest-dock";
    document.body.append(dock);
    wire(dock);
  }

  const hidden = new Set(get(SETTINGS.dockHidden));
  const expanded = new Set(get(SETTINGS.dockExpanded));
  const collapsed = get(SETTINGS.dockCollapsed);
  const quests = getQuests().filter((e) => canSee(e) && questData(e).status === "active" && !hidden.has(e.id));

  const rows = quests.map((entry) => {
    const q = questData(entry);
    const open = expanded.has(entry.id);
    const prog = progress(q);
    const check = can(entry, "checkObjectives");
    const objectives = open ? visibleObjectives(q).map((o) => `
      <li class="fw-quest-dock-objective is-${o.state} ${o.secret ? "is-secret" : ""}" style="--depth: ${o.depth}" data-objective-id="${o.id}">
        <button type="button" data-action="cycle" ${check ? "" : "disabled"}><i class="${STATE_ICON[o.state]}"></i></button>
        <span>${esc(o.text)}</span>
      </li>`).join("") : "";
    return `
      <li class="fw-quest-dock-quest ${open ? "is-open" : ""}" data-quest-id="${entry.id}">
        <div class="fw-quest-dock-row">
          <button type="button" class="fw-quest-dock-fold" data-action="fold"><i class="fas fa-chevron-${open ? "down" : "right"}"></i></button>
          ${q.image ? `<img class="fw-quest-dock-thumb" src="${esc(q.image)}" alt="">` : ""}
          <a class="fw-quest-dock-title" data-action="open" data-tooltip="${esc(t(`Category.${q.category}`))}">${esc(entry.name)}</a>
          ${prog.total ? `<span class="fw-quest-dock-progress">${prog.done}/${prog.total}</span>` : ""}
        </div>
        ${open ? `<ul class="fw-quest-dock-objectives">${objectives || `<li class="fw-quest-empty">${esc(t("Sheet.NoObjectives"))}</li>`}</ul>` : ""}
      </li>`;
  }).join("");

  dock.classList.toggle("is-collapsed", collapsed);
  dock.innerHTML = `
    <header class="fw-quest-dock-header" data-tooltip="${esc(t("Dock.DragHint"))}">
      <i class="fas fa-scroll"></i>
      <span class="fw-quest-dock-heading">${esc(t("Dock.Title"))}${collapsed && quests.length ? ` (${quests.length})` : ""}</span>
      ${canCreate() ? `<button type="button" data-action="create" data-tooltip="${esc(t("Log.New"))}"><i class="fas fa-plus"></i></button>` : ""}
      <button type="button" data-action="log" data-tooltip="${esc(t("Log.Title"))}"><i class="fas fa-book"></i></button>
      <button type="button" data-action="collapse" data-tooltip="${esc(t(collapsed ? "Dock.Expand" : "Dock.Collapse"))}">
        <i class="fas fa-${collapsed ? "chevron-down" : "minus"}"></i></button>
    </header>
    ${collapsed ? "" : `<ul class="fw-quest-dock-list">${rows || `<li class="fw-quest-empty">${esc(t("Dock.Empty"))}</li>`}</ul>`}`;
  place();
}

/** Puts the dock where the user dragged it, or just left of the sidebar. */
function place() {
  if (!dock) return;
  const pos = get(SETTINGS.dockPos);
  let top = pos?.top;
  let right = pos?.right;
  if (top == null || right == null) {
    const sidebar = document.getElementById("sidebar")?.getBoundingClientRect();
    top = 8;
    right = sidebar?.width ? window.innerWidth - sidebar.left + 8 : 320;
  }
  const maxRight = Math.max(0, window.innerWidth - dock.offsetWidth);
  const maxTop = Math.max(0, window.innerHeight - 40);
  dock.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
  dock.style.right = `${Math.min(Math.max(0, right), maxRight)}px`;
}

function wire(el) {
  el.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const questId = button.closest("[data-quest-id]")?.dataset.questId;
    const api = game.modules.get(MODULE_ID).api.quests;
    switch (button.dataset.action) {
      case "collapse":
        await set(SETTINGS.dockCollapsed, !get(SETTINGS.dockCollapsed));
        renderDock();
        break;
      case "log":
        api.openLog();
        break;
      case "create":
        api.create();
        break;
      case "open":
        api.open(questId);
        break;
      case "fold": {
        const expanded = new Set(get(SETTINGS.dockExpanded));
        if (expanded.has(questId)) expanded.delete(questId);
        else expanded.add(questId);
        await set(SETTINGS.dockExpanded, [...expanded]);
        renderDock();
        break;
      }
      case "cycle": {
        const objectiveId = button.closest("[data-objective-id]").dataset.objectiveId;
        const entry = game.journal.get(questId);
        const obj = entry && questData(entry).objectives.find((o) => o.id === objectiveId);
        if (obj) requestQuestOp({ type: "setObjective", id: questId, objectiveId, state: NEXT_STATE[obj.state] });
        break;
      }
    }
  });

  // Drag by the header.
  el.addEventListener("pointerdown", (event) => {
    const header = event.target.closest(".fw-quest-dock-header");
    if (!header || event.target.closest("button") || event.button !== 0) return;
    event.preventDefault();
    const rect = el.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startRight = window.innerWidth - rect.right;
    const startTop = rect.top;
    let moved = false;
    const move = (e) => {
      moved = true;
      el.style.right = `${Math.max(0, startRight - (e.clientX - startX))}px`;
      el.style.top = `${Math.max(0, startTop + (e.clientY - startY))}px`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      el.classList.remove("is-dragging");
      if (moved) set(SETTINGS.dockPos, { top: parseFloat(el.style.top), right: parseFloat(el.style.right) });
    };
    el.classList.add("is-dragging");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  el.addEventListener("dblclick", async (event) => {
    if (!event.target.closest(".fw-quest-dock-header") || event.target.closest("button")) return;
    await set(SETTINGS.dockPos, {});
    place();
  });
}

export function registerDock() {
  Hooks.once("ready", () => renderDock());
  window.addEventListener("resize", () => place());
  Hooks.on("collapseSidebar", () => setTimeout(place, 250));
}
