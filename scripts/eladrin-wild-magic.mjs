/**
 * Eladrin Wild Magic (house-rule Sorcerer subclass).
 *
 * The subclass item carries `flags.fimblewood-academy.isEladrinWildMagic`; nothing here is keyed to an
 * actor id, and every hook first checks that flag, so other wild magic subclasses (e.g. Circle of Wild
 * Magic) are never touched.
 *
 * State lives in one actor flag, `flags.fimblewood-academy.ewm`:
 *   ring        "on" | "off" | "drained"   (drained lasts until the next short rest)
 *   containment 0..20                      (the sinking counter; shown on the sheet, the token and in chat)
 *   season      "winter"|"spring"|"summer"|"autumn"|"pact"  (ring on: winter; a surge sets it)
 *   lastSurge   { roll, season } | null    (what a Surge Reroll replaces)
 *
 * Spell-point spending is detected by watching the Spell Points item of the `dnd5e-spellpoints`
 * ("Advanced Magic") module: that module fires no hook after spending, but it always writes
 * `system.uses.spent` on that item. A `dnd5e.preUseActivity` marker on a level 1+ spell tells a real
 * cast apart from a manual edit of the bar; cantrips cost no points, so they never get that far.
 */

const MODULE_ID = "fimblewood-academy";
const FLAG = "ewm";
const MAX_CONTAINMENT = 20;
const TABLE_NAME = "Lilians Wild Magic (d100)";
const TABLE_PACK = `${MODULE_ID}.rolltables`;
const CAST_MARKER_MS = 20000;
const SEASONS = ["winter", "spring", "summer", "autumn"];
const RING_STATES = ["on", "off", "drained"];

const DEFAULT_STATE = { ring: "on", containment: MAX_CONTAINMENT, season: "winter", voluntaryTurn: null, tickTurn: null, lastSurge: null };

const i18n = (key, data) => data
  ? game.i18n.format(`FIMBLEWOOD.EladrinWildMagic.${key}`, data)
  : game.i18n.localize(`FIMBLEWOOD.EladrinWildMagic.${key}`);
const setting = (key) => game.settings.get(MODULE_ID, key);

/* -------------------------------------------- */
/*  State                                        */
/* -------------------------------------------- */

export function hasEladrinWildMagic(actor) {
  return actor?.type === "character"
    && actor.items.some(i => i.type === "subclass" && i.flags?.[MODULE_ID]?.isEladrinWildMagic);
}

export function getState(actor) {
  return foundry.utils.mergeObject(foundry.utils.deepClone(DEFAULT_STATE), actor.getFlag(MODULE_ID, FLAG) ?? {}, { inplace: false });
}

function patchState(actor, patch) {
  const update = {};
  for (const [k, v] of Object.entries(patch)) update[`flags.${MODULE_ID}.${FLAG}.${k}`] = v;
  return actor.update(update);
}

function getFeature(actor, key) {
  return actor.items.find(i => i.flags?.[MODULE_ID]?.[key]);
}

function post(actor, content, extra = {}) {
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: `<div class="fw-ewm-chat">${content}</div>`, ...extra });
}

function turnKey() {
  const combat = game.combat;
  return combat?.started ? `${combat.id}:${combat.round}:${combat.turn}` : null;
}

function seasonForRoll(total) {
  if (total <= 24) return "winter";
  if (total <= 48) return "spring";
  if (total <= 72) return "summer";
  if (total <= 96) return "autumn";
  return "pact";
}

/* -------------------------------------------- */
/*  Containment                                  */
/* -------------------------------------------- */

/** Set Containment, clamped to 0..20, and post `Containment 20 → 19` when it changed. */
const containmentLine = (from, to, reason = "") =>
  `<strong>${i18n("Containment")}</strong> ${from} → ${to}${reason ? ` <em>(${reason})</em>` : ""}`;

/** With `silent`, the caller puts the change into its own chat message. */
export async function setContainment(actor, value, reason = "", { silent = false } = {}) {
  const from = getState(actor).containment;
  const to = Math.clamp(Math.round(value), 0, MAX_CONTAINMENT);
  if (to === from) return from;
  await patchState(actor, { containment: to });
  if (!silent) await post(actor, containmentLine(from, to, reason));
  return to;
}

/** Sink Containment for one spell. Returns the chat line for the change, or "" if nothing changed. */
async function tickContainment(actor) {
  const s = getState(actor);
  const key = turnKey();
  if (setting("tickMode") === "turn" && key && s.tickTurn === key) return "";
  const floor = Math.clamp(setting("floor"), 0, MAX_CONTAINMENT);
  const to = await setContainment(actor, Math.max(floor, s.containment - 1), "", { silent: true });
  if (key) await patchState(actor, { tickTurn: key });
  return to === s.containment ? "" : containmentLine(s.containment, to);
}

/* -------------------------------------------- */
/*  Ring state machine                           */
/* -------------------------------------------- */

function chaChanges() {
  const penalty = Number(setting("chaPenalty")) || 0;
  return penalty ? [{ key: "system.abilities.cha.value", mode: 2, value: String(-Math.abs(penalty)), priority: 20 }] : [];
}

async function syncRingEffects(actor, state) {
  const ring = getFeature(actor, "isEwmRing");
  if (!ring) return;
  const updates = [];
  for (const effect of ring.effects) {
    const own = effect.flags?.[MODULE_ID]?.ewmRingState;
    if (!own) continue;
    const disabled = own !== state;
    const changes = own === "off" ? [] : chaChanges();
    if (effect.disabled !== disabled || JSON.stringify(effect.changes) !== JSON.stringify(changes)) {
      updates.push({ _id: effect.id, disabled, changes });
    }
  }
  if (updates.length) await ring.updateEmbeddedDocuments("ActiveEffect", updates);
}

/**
 * Switch the ring. Putting it on or draining it fixes her season to Winter; a surge can still
 * override that afterwards. `keepSeason` is for the reroll, which sets a new season right after.
 */
export async function setRingState(actor, state, { keepSeason = false, silent = false } = {}) {
  if (!hasEladrinWildMagic(actor) || !RING_STATES.includes(state)) return;
  const from = getState(actor).ring;
  await patchState(actor, { ring: state });
  await syncRingEffects(actor, state);
  if (!silent && from !== state) {
    const costKey = state === "on" ? { action: "CostAction", bonus: "CostBonus", free: "CostFree" }[setting("ringCost")] : null;
    await post(actor, `<strong>${i18n("Ring")}:</strong> ${i18n(`Ring_${from}`)} → <strong>${i18n(`Ring_${state}`)}</strong>${costKey ? ` <em>(${i18n(costKey)})</em>` : ""}`);
  }
  if (state === "on" && !keepSeason) await patchState(actor, { season: "winter" });
  await syncFace(actor);
}

/** Sheet / HUD entry point: enforces who may switch what. */
export async function requestRingState(actor, state) {
  const current = getState(actor).ring;
  if (current === state) return;
  if (!game.user.isGM && (current === "drained" || state === "drained")) {
    ui.notifications.warn(i18n("WarnDrainedLocked"));
    return;
  }
  await setRingState(actor, state);
}

/* -------------------------------------------- */
/*  Season and Visage                            */
/* -------------------------------------------- */

function warn(message) {
  console.warn(`${MODULE_ID} | ${message}`);
  ui.notifications.warn(message);
}

/**
 * Switch her Visage face. `key` is "default" or a season. Faces are resolved by label so reordering
 * them is harmless; a blank Default label means the token's own base appearance (Visage revert).
 */
async function switchVisage(actor, key) {
  const api = game.modules.get("visage")?.api;
  if (!api) return warn(i18n("WarnNoVisage"));
  const token = actor.getActiveTokens().find(t => t.controlled) ?? actor.getActiveTokens()[0];
  if (!token) return warn(i18n("WarnNoToken", { actor: actor.name }));

  const label = String(setting(`face_${key}`)).trim().toLowerCase();
  if (key === "default" && !label) return api.revert(token.id);
  const faces = api.getAvailable(token.id);
  const exact = faces.filter(f => String(f.label).trim().toLowerCase() === label);
  const loose = faces.filter(f => String(f.label).toLowerCase().includes(label));
  const face = exact[0] ?? (loose.length === 1 ? loose[0] : null);
  if (!face) return warn(i18n("WarnNoFace", { actor: actor.name, label: setting(`face_${key}`) }));
  if (api.isActive(token.id, face.id)) return;
  await api.apply(token.id, face.id);
}

/**
 * Bring her face in line with the state: with the ring on she always shows her Default form. With
 * the ring off or drained (its magic no longer shields her from the chaos) she shows the season of her last surge (until the next long rest), or
 * Default if she has not surged. The Pact has no face and leaves the current one alone.
 */
export async function syncFace(actor) {
  const s = getState(actor);
  let key = "default";
  if (s.ring !== "on" && s.lastSurge?.season) {
    if (s.lastSurge.season === "pact") return;
    key = s.lastSurge.season;
  }
  try {
    await switchVisage(actor, key);
  } catch (err) {
    console.error(`${MODULE_ID} | Visage switch failed:`, err);
    ui.notifications.error(i18n("WarnVisageFailed"));
  }
}

/** Store the season on the actor and update her face. */
export async function applySeason(actor, season) {
  await patchState(actor, { season });
  await syncFace(actor);
}

/* -------------------------------------------- */
/*  Surge                                        */
/* -------------------------------------------- */

async function getTable() {
  const pack = game.packs.get(TABLE_PACK);
  const entry = pack?.index.find(e => e.name === TABLE_NAME);
  return (entry ? await pack.getDocument(entry._id) : null) ?? game.tables.getName(TABLE_NAME);
}

/**
 * Roll the d100 table and set the season. Posts one compact message: the roll, the effect text and,
 * if given, the Containment change line. Returns the d100 total.
 */
async function drawSurge(actor, extraLine = "") {
  const table = await getTable();
  if (!table) {
    warn(i18n("WarnNoTable", { name: TABLE_NAME }));
    return null;
  }
  const { roll, results } = await table.draw({ displayChat: false });
  const total = roll.total;
  const effect = results[0]?.description ?? results[0]?.text ?? "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="fw-ewm-chat"><h4>${i18n("SurgeResult", { roll: total })}</h4><p>${effect}</p>${extraLine ? `<p>${extraLine}</p>` : ""}</div>`,
    rolls: [roll],
    sound: CONFIG.sounds.dice
  });
  const season = seasonForRoll(total);
  await patchState(actor, { lastSurge: { roll: total, season } });
  await applySeason(actor, season);
  return total;
}

/** `c` is the Containment the roll is made against; `change` is the chat line of a Containment tick, if any. */
async function rollSurge(actor, spellName, c, change = "") {
  const d20 = await new Roll("1d20").evaluate();
  const surge = d20.total >= c;
  await d20.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${i18n("SurgeCheck", { spell: spellName, c })} — <strong>${surge ? i18n("SurgeYes") : i18n("SurgeNo")}</strong>${!surge && change ? `<br>${change}` : ""}`
  });
  if (!surge) return;
  await drawSurge(actor, change);
  // A surge restores Tides of Chaos.
  const tides = getFeature(actor, "isEwmTides");
  if (tides?.system.uses?.spent) await tides.update({ "system.uses.spent": 0 });
}

/** Everything that happens after she spent spell points on a level 1+ spell. */
async function onQualifyingSpell(actor, spellName) {
  const s = getState(actor);
  const key = turnKey();
  if (s.ring === "on") {
    if (key && s.voluntaryTurn === key) return;
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: i18n("VolunteerTitle") },
      content: `<p>${i18n("VolunteerText", { spell: spellName, c: s.containment })}</p>`
    });
    if (!yes) return;
    if (key) await patchState(actor, { voluntaryTurn: key });
    await rollSurge(actor, spellName, s.containment); // the ring soaks the cost: Containment stays put
    return;
  }
  const change = await tickContainment(actor); // rolled against the value before this spell's tick
  await rollSurge(actor, spellName, s.containment, change);
}

/** Surge Reroll: drains the ring and replaces the last d100 result. */
async function doReroll(actor) {
  await setRingState(actor, "drained", { keepSeason: true });
  await post(actor, `<strong>${i18n("Reroll")}</strong>`);
  await drawSurge(actor);
}

/* -------------------------------------------- */
/*  Spell Points detection                       */
/* -------------------------------------------- */

const castMarkers = new Map(); // actor id -> { name, at }
const spentBefore = new Map(); // item id -> spent before the pending update

function isSpellPointsItem(item) {
  const actor = item.parent;
  if (!actor || actor.documentName !== "Actor" || !hasEladrinWildMagic(actor)) return false;
  if (actor.flags?.dnd5espellpoints?.item === item.id) return true;
  return item.type === "feat"
    && (item.name === setting("spellPointsItem") || item.system?.source?.custom === setting("spellPointsItem"));
}

/* -------------------------------------------- */
/*  Character sheet bar                          */
/* -------------------------------------------- */

function containmentColors(c) {
  const floor = Math.clamp(setting("floor"), 0, MAX_CONTAINMENT - 1);
  const t = Math.clamp((c - floor) / (MAX_CONTAINMENT - floor), 0, 1);
  const hue = 180 * t; // ice cyan at 20, amber in the middle, red at the floor
  const col = (h, l) => foundry.utils.Color.fromHSL([h / 360, 0.85, l]).css;
  return { left: col(hue, 0.28), right: col(hue, 0.5), solid: foundry.utils.Color.fromHSL([hue / 360, 0.9, 0.5]).valueOf() };
}

function injectBar(app, html) {
  const actor = app.actor;
  if (!hasEladrinWildMagic(actor)) return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (root.querySelector(".fw-ewm-group")) return;
  const anchor = root.querySelector(".sp-bar") ?? root.querySelector(".hit-dice")?.closest(".meter-group");
  if (!anchor) return;

  const s = getState(actor);
  const { left, right } = containmentColors(s.containment);
  const pct = Math.clamp((s.containment / MAX_CONTAINMENT) * 100, 0, 100);
  const canEdit = game.user.isGM;
  const buttons = RING_STATES.map(st => {
    const locked = st === "drained" ? !game.user.isGM : (s.ring === "drained" && !game.user.isGM);
    return `<button type="button" class="fw-ewm-ring-btn ${s.ring === st ? "active" : ""}" data-ring="${st}" ${locked || !actor.isOwner ? "disabled" : ""}>${i18n(`Ring_${st}`)}</button>`;
  }).join("");

  const group = document.createElement("div");
  group.className = "meter-group fw-ewm-group";
  group.innerHTML = `
    <div class="label roboto-condensed-upper"><span>${i18n("Containment")}</span></div>
    <div class="meter fw-ewm-meter" data-tooltip="${canEdit ? i18n("TooltipGM") : i18n("Tooltip")}">
      <div class="progress" role="meter" aria-valuemin="0" aria-valuenow="${s.containment}" aria-valuemax="${MAX_CONTAINMENT}"
           style="--fw-pct: ${pct}%; --fw-left: ${left}; --fw-right: ${right}">
        <div class="label"><span class="value">${s.containment}</span><span class="separator"> / </span><span class="max">${MAX_CONTAINMENT}</span></div>
        <input type="number" class="fw-ewm-input" min="0" max="${MAX_CONTAINMENT}" value="${s.containment}" hidden>
      </div>
    </div>
    <div class="fw-ewm-ring-buttons">${buttons}</div>`;

  anchor.insertAdjacentElement("afterend", group);
  // Advanced Magic may inject its bar after this hook ran; sit right behind it either way.
  setTimeout(() => {
    const sp = root.querySelector(".sp-bar");
    if (sp && sp.nextElementSibling !== group) sp.insertAdjacentElement("afterend", group);
  }, 0);

  for (const btn of group.querySelectorAll(".fw-ewm-ring-btn")) {
    btn.addEventListener("click", () => requestRingState(actor, btn.dataset.ring));
  }
  if (canEdit) {
    const progress = group.querySelector(".progress");
    const label = progress.querySelector(".label");
    const input = progress.querySelector(".fw-ewm-input");
    label.addEventListener("click", () => {
      label.hidden = true;
      input.hidden = false;
      input.focus();
      input.select();
    });
    const commit = async () => {
      const v = Number(input.value);
      input.hidden = true;
      label.hidden = false;
      if (Number.isFinite(v)) await setContainment(actor, v, i18n("ReasonManual"));
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") input.blur(); });
  }
}

/* -------------------------------------------- */
/*  Token gauge                                  */
/* -------------------------------------------- */

const GAUGE = "_fwEwmGauge";

/**
 * A PIXI arc around the token, drawn from the synced actor flag on every client. The dnd5e dynamic
 * token ring cannot show an arbitrary fill amount, so it is not used here.
 */
function refreshGauge(token) {
  const actor = token.actor;
  let g = token[GAUGE];
  if (!actor || !hasEladrinWildMagic(actor)) {
    if (g && !g.destroyed) g.destroy();
    token[GAUGE] = null;
    return;
  }
  if (!g || g.destroyed) {
    g = token.addChild(new PIXI.Graphics());
    g.eventMode = "none";
    token[GAUGE] = g;
  }
  const c = getState(actor).containment;
  const { w, h } = token;
  const sig = `${c}|${w}|${h}|${canvas.grid.size}|${setting("floor")}`;
  if (g._fwSig === sig) return;
  g._fwSig = sig;

  const stroke = Math.max(5, canvas.grid.size * 0.09);
  const cx = w / 2;
  const cy = h / 2;
  // Sits well outside the token art (the token's corners included), so the token stays fully visible.
  const r = (Math.min(w, h) + Math.hypot(w, h)) / 4 + stroke / 2 + canvas.grid.size * 0.03;
  const floor = Math.clamp(setting("floor"), 0, MAX_CONTAINMENT - 1);
  const frac = Math.clamp((MAX_CONTAINMENT - c) / (MAX_CONTAINMENT - floor), 0, 1); // empty at 20, full at the floor

  g.clear();
  if (frac > 0) {
    g.lineStyle({ width: stroke, color: containmentColors(c).solid, alpha: 0.6, cap: PIXI.LINE_CAP.ROUND });
    const start = -Math.PI / 2; // from the top, clockwise; the arc's end advances clockwise as Containment drops
    if (frac >= 0.999) g.drawCircle(cx, cy, r);
    else {
      g.moveTo(cx + r * Math.cos(start), cy + r * Math.sin(start));
      g.arc(cx, cy, r, start, start + Math.PI * 2 * frac);
    }
  }
}

function refreshActorTokens(actor) {
  for (const token of actor.getActiveTokens()) refreshGauge(token);
}

/* -------------------------------------------- */
/*  Registration                                 */
/* -------------------------------------------- */

function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, {
    scope: "world", config: true,
    name: `FIMBLEWOOD.EladrinWildMagic.Settings.${key}.name`,
    hint: `FIMBLEWOOD.EladrinWildMagic.Settings.${key}.hint`,
    ...data
  });
  // Open decisions from the design brief: each is a setting with a marked default.
  reg("chaPenalty", {
    type: Number, default: 0, range: { min: 0, max: 5, step: 1 },
    onChange: () => { if (game.user.isGM) for (const a of game.actors) if (hasEladrinWildMagic(a)) syncRingEffects(a, getState(a).ring); }
  });
  reg("tickMode", { type: String, default: "spell", choices: { spell: "FIMBLEWOOD.EladrinWildMagic.Settings.tickMode.spell", turn: "FIMBLEWOOD.EladrinWildMagic.Settings.tickMode.turn" } });
  reg("floor", { type: Number, default: 11, range: { min: 1, max: 20, step: 1 } });
  reg("ringCost", { type: String, default: "action", choices: { action: "FIMBLEWOOD.EladrinWildMagic.CostAction", bonus: "FIMBLEWOOD.EladrinWildMagic.CostBonus", free: "FIMBLEWOOD.EladrinWildMagic.CostFree" } });
  reg("spellPointsItem", { type: String, default: "Spell Points" });
  reg("face_default", { type: String, default: "" });
  for (const s of SEASONS) reg(`face_${s}`, { type: String, default: s.charAt(0).toUpperCase() + s.slice(1) });
}

export function registerEladrinWildMagic() {
  registerSettings();

  Hooks.on("renderCharacterActorSheet", (app, html) => injectBar(app, html));

  Hooks.on("renderTokenHUD", (hud, html) => {
    const actor = hud.object?.actor;
    if (!hasEladrinWildMagic(actor) || !actor.isOwner) return;
    const root = html instanceof HTMLElement ? html : html[0];
    const col = root.querySelector(".col.right");
    if (!col || col.querySelector(".fw-ewm-hud")) return;
    const ring = getState(actor).ring;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `control-icon fw-ewm-hud ${ring === "on" ? "active" : ""}`;
    btn.dataset.tooltip = `${i18n("Ring")}: ${i18n(`Ring_${ring}`)}`;
    btn.innerHTML = '<i class="fa-solid fa-ring"></i>';
    btn.addEventListener("click", async () => {
      await requestRingState(actor, getState(actor).ring === "on" ? "off" : "on");
      hud.render();
    });
    col.appendChild(btn);
  });

  // Gauge: draw on token draw/refresh; redraw when the flag changes without touching the token.
  Hooks.on("drawToken", refreshGauge);
  Hooks.on("refreshToken", refreshGauge);
  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAG}`)) refreshActorTokens(actor);
  });
  Hooks.on("createItem", (item) => { if (item.parent?.documentName === "Actor") refreshActorTokens(item.parent); });
  Hooks.on("deleteItem", (item) => { if (item.parent?.documentName === "Actor") refreshActorTokens(item.parent); });

  // Cast detection.
  Hooks.on("dnd5e.preUseActivity", (activity) => {
    const item = activity.item;
    const actor = item?.actor;
    if (!hasEladrinWildMagic(actor)) return;
    if (item.flags?.[MODULE_ID]?.isEwmReroll) {
      if (!getState(actor).lastSurge) {
        ui.notifications.warn(i18n("WarnNoSurgeToReroll"));
        return false;
      }
      return;
    }
    if (item.type === "spell" && item.system.level >= 1) castMarkers.set(actor.id, { name: item.name, at: Date.now() });
  });

  Hooks.on("preUpdateItem", (item, changes) => {
    if (foundry.utils.hasProperty(changes, "system.uses.spent") && isSpellPointsItem(item)) {
      spentBefore.set(item.id, item.system.uses.spent);
    }
  });

  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (userId !== game.user.id) return;
    const before = spentBefore.get(item.id);
    if (before === undefined) return;
    spentBefore.delete(item.id);
    if (!(item.system.uses.spent > before)) return;
    const actor = item.parent;
    const marker = castMarkers.get(actor.id);
    if (!marker || Date.now() - marker.at > CAST_MARKER_MS) return;
    castMarkers.delete(actor.id);
    onQualifyingSpell(actor, marker.name).catch(err => console.error(`${MODULE_ID} | Wild Magic Surge failed:`, err));
  });

  Hooks.on("dnd5e.postUseActivity", async (activity) => {
    const item = activity.item;
    const actor = item?.actor;
    if (!hasEladrinWildMagic(actor)) return;
    try {
      if (item.flags?.[MODULE_ID]?.isEwmReroll) await doReroll(actor);
      else if (item.name === "Fey Step") await postFeyStepRider(actor);
    } catch (err) {
      console.error(`${MODULE_ID} | Eladrin Wild Magic use hook failed:`, err);
    }
  });

  // Recovery: +1 Containment per round while the ring is on. Only one GM client does the work.
  Hooks.on("updateCombat", async (combat, changes, options) => {
    if (!("round" in changes) || (options?.direction ?? 1) < 0) return;
    if (game.users.activeGM !== game.user) return;
    const actors = new Set(combat.combatants.map(c => c.actor).filter(a => hasEladrinWildMagic(a)));
    for (const actor of actors) {
      const s = getState(actor);
      if (s.ring === "on" && s.containment < MAX_CONTAINMENT) await setContainment(actor, s.containment + 1, i18n("ReasonRound"));
    }
  });

  Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
    if (!hasEladrinWildMagic(actor)) return;
    try {
      if (getState(actor).ring === "drained") await setRingState(actor, "on");
      if (config?.type === "long") {
        await setContainment(actor, MAX_CONTAINMENT, i18n("ReasonLongRest"));
        await patchState(actor, { lastSurge: null, voluntaryTurn: null, tickTurn: null });
        await applySeason(actor, "winter");
      }
    } catch (err) {
      console.error(`${MODULE_ID} | Eladrin Wild Magic rest handling failed:`, err);
    }
  });
}

/** Fey Step (Season Rider): follows her current season flag; only Winter is defined so far. */
async function postFeyStepRider(actor) {
  if (!getFeature(actor, "isEwmFeyRider")) return;
  const s = getState(actor);
  const season = s.ring === "on" ? "winter" : s.season; // with the ring worn it is always Winter
  const dc = actor.system.attributes?.spell?.dc ?? "?";
  const body = season === "winter"
    ? i18n("FeyWinter", { dc })
    : i18n("FeyOther", { season: i18n(`Season_${season}`) });
  await post(actor, `<strong>${i18n("FeyStepRider")}</strong> — ${i18n(`Season_${season}`)}<br>${body}<br><em>${i18n("FeyProposal")}</em>`);
}
