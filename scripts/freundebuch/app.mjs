/**
 * Fimblewood Academy — Amans Freundebuch window
 *
 * Two tabs: the animal forms (actors in "Aman Formen") and the people in the
 * book. Clicking a card transforms Aman; the header shows his current form
 * and the "change back" button. The GM and Aman can strike people out.
 *
 * Renders an HTML string and wires delegated listeners itself, like the
 * garden and the alchemy window. Action names are prefixed "fw".
 */

import {
  FORMS_FOLDER, animalForms, bookOwner, currentForm, findBook, getFriends,
  removeFriend, revert, transformToAnimal, transformToFriend
} from "./data.mjs";

const t = (key, data) => data
  ? game.i18n.format(`FIMBLEWOOD.Freundebuch.${key}`, data)
  : game.i18n.localize(`FIMBLEWOOD.Freundebuch.${key}`);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

export class FreundebuchApp extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "fimblewood-freundebuch",
    tag: "div",
    window: { title: "FIMBLEWOOD.Freundebuch.WindowTitle", icon: "fas fa-book", resizable: true },
    position: { width: 520, height: 560 },
    classes: ["fimblewood-freundebuch-app"]
  };

  tab = "animals";
  busy = false;

  #card({ action, id, img, name, active, removable }) {
    return `
      <div class="fw-fb-card ${active ? "is-active" : ""}" data-action="${action}" data-id="${esc(id)}" title="${esc(name)}">
        <img src="${esc(img)}" alt="">
        <span class="fw-fb-name">${esc(name)}</span>
        ${removable ? `<button type="button" class="fw-fb-remove" data-action="fwRemove" data-id="${esc(id)}" data-tooltip="${esc(t("Remove"))}"><i class="fas fa-xmark"></i></button>` : ""}
      </div>`;
  }

  async _renderHTML() {
    const book = findBook();
    const aman = bookOwner();
    if (!book || !aman) return `<div class="fw-fb-empty">${t("NoBook")}</div>`;

    const form = currentForm(aman);
    const status = form ? t("CurrentlyAs", { name: esc(form.name) }) : t("OwnShape");
    const canEdit = game.user.isGM || book.isOwner;

    let body;
    if (this.tab === "animals") {
      const forms = animalForms();
      body = forms.length
        ? forms.map((a) => this.#card({
          action: "fwAnimal", id: a.id, img: a.prototypeToken.texture.src || a.img, name: a.name,
          active: form?.kind === "animal" && form.id === a.id
        })).join("")
        : `<div class="fw-fb-empty">${t("NoForms", { folder: esc(FORMS_FOLDER) })}</div>`;
    } else {
      const friends = getFriends(book).slice().sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
      body = friends.length
        ? friends.map((f) => this.#card({
          action: "fwFriend", id: f.id, img: f.token.src || f.img, name: f.name,
          active: form?.kind === "person" && form.id === f.id, removable: canEdit
        })).join("")
        : `<div class="fw-fb-empty">${t(game.user.isGM ? "NoFriendsGm" : "NoFriends")}</div>`;
    }

    const tabBtn = (id, icon) => `
      <button type="button" class="fw-fb-tab ${this.tab === id ? "is-active" : ""}" data-action="fwTab" data-tab="${id}">
        <i class="fas ${icon}"></i> ${t(`Tab.${id}`)}
      </button>`;

    return `
      <div class="fw-fb-header">
        <img class="fw-fb-portrait" src="${esc(aman.img)}" alt="">
        <div class="fw-fb-status"><strong>${esc(aman.name)}</strong><span>${status}</span></div>
        <button type="button" data-action="fwRevert" ${form ? "" : "disabled"}><i class="fas fa-rotate-left"></i> ${t("Revert")}</button>
      </div>
      <nav class="fw-fb-tabs">${tabBtn("animals", "fa-paw")}${tabBtn("people", "fa-user-group")}</nav>
      <div class="fw-fb-grid ${this.busy ? "is-busy" : ""}">${body}</div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    if (!content.dataset.fwFbWired) {
      content.dataset.fwFbWired = "1";
      content.addEventListener("click", (event) => this.#onClick(event));
    }
    return content;
  }

  async #onClick(event) {
    const el = event.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const { action, id } = el.dataset;
    if (action === "fwTab") {
      this.tab = el.dataset.tab;
      return this.render();
    }
    if (this.busy) return;
    const run = {
      fwAnimal: () => transformToAnimal(id),
      fwFriend: () => transformToFriend(id),
      fwRevert: () => revert(),
      fwRemove: () => removeFriend(id)
    }[action];
    if (!run) return;
    event.stopPropagation();
    this.busy = true;
    this.render();
    try {
      await run();
    } finally {
      this.busy = false;
      if (this.rendered) this.render();
    }
  }
}
