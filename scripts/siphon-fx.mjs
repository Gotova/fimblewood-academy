/**
 * Unblooded Sorcery: siphon animation.
 *
 * A short, purely cosmetic PIXI effect drawn on the canvas between a caster's
 * token and an Unblooded Sorcery actor's token when Resonance is actually
 * drained from them — a curved "tether" with glowing motes travelling along
 * it toward the sorcerer, shifting from the caster's spell-school colour to
 * Resonance violet as they arrive, ending in a small pulse on the sorcerer's
 * token.
 *
 * `dnd5e.postUseActivity` (where this is triggered from) only fires on the
 * client that used the activity, so this is the module's first user of
 * sockets for this feature: `playSiphon()` renders locally *and* broadcasts,
 * following the same fire-and-forget `module.${MODULE_ID}` pattern used by
 * the Draw Pad and Jukebox.
 */

const MODULE_ID = "fimblewood-academy";
const CHANNEL = `module.${MODULE_ID}`;
const SETTING_SHOW = "showSiphonFx";

/** Every client times its own animation to these same constants so they settle in step. */
const SIPHON_ACTIVE_MS = 900;
const SIPHON_PASSIVE_MS = 600;
/** How long the arrival pulse on the sorcerer's token lingers after the last mote lands. */
const RING_DURATION_MS = 350;

// dnd5e system spell-school keys (abbreviated). CONFIG.DND5E.spellSchools carries labels/icons
// but no colours, so this mapping is ours; picked to read distinctly from RESONANCE_COLOR.
const SCHOOL_COLORS = {
  abj: 0x4fa8e0, // Abjuration — protective blue
  con: 0x4fe08a, // Conjuration — summoning green
  div: 0xe0c94f, // Divination — pale gold
  enc: 0xe04f8a, // Enchantment — charm pink
  evo: 0xe0604f, // Evocation — fire orange-red
  ill: 0x4fe0d8, // Illusion — cyan
  nec: 0x5c8a52, // Necromancy — murky green
  trs: 0xd8974f  // Transmutation — amber
};
const DEFAULT_SCHOOL_COLOR = 0xcccccc;
const RESONANCE_COLOR = 0xa24fe0; // matches the resonance meter gradient's bright end (module.css)
const RING_COLOR = 0xc084fc; // matches the resonance meter's text glow

/** Active-animation controllers, so a scene change can tear all of them down instead of leaking. */
const _active = new Set();

/* -------------------------------------------- */
/*  Colour / geometry helpers                    */
/* -------------------------------------------- */

function schoolColor(school) {
  return SCHOOL_COLORS[school] ?? DEFAULT_SCHOOL_COLOR;
}

function lerpColor(c1, c2, t) {
  const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
  const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return (r << 16) | (g << 8) | b;
}

/** Quadratic bezier from `from` to `to`, bowed perpendicular to the line by `bow`. */
function makeCurve(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const bow = Math.clamp(dist * 0.18, 20, 90);
  const mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
  // Perpendicular unit vector, sign picked deterministically from the pair so a given
  // caster/target combination always bows the same way.
  const nx = -dy / dist, ny = dx / dist;
  const sign = ((from.x + to.y) % 2 === 0) ? 1 : -1;
  const cx = mx + nx * bow * sign, cy = my + ny * bow * sign;

  return {
    control: { x: cx, y: cy },
    pointAt(t) {
      const u = 1 - t;
      return {
        x: u * u * from.x + 2 * u * t * cx + t * t * to.x,
        y: u * u * from.y + 2 * u * t * cy + t * t * to.y
      };
    }
  };
}

function drawCircle(g, x, y, radius, color, alpha) {
  g.beginFill(color, alpha);
  g.drawCircle(x, y, radius);
  g.endFill();
}

/* -------------------------------------------- */
/*  Rendering                                    */
/* -------------------------------------------- */

/**
 * Local-only renderer: draws the tether and tears itself down. Does not touch the network —
 * both the originating client (via playSiphon) and every receiving client (via the socket
 * handler below) call this directly.
 */
function _render({ sceneId, fromTokenId, toTokenId, school, motes = 1, variant = "active" }) {
  if (!game.settings.get(MODULE_ID, SETTING_SHOW)) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (!canvas.ready || canvas.scene?.id !== sceneId) return;

  const fromToken = canvas.tokens.get(fromTokenId);
  const toToken = canvas.tokens.get(toTokenId);
  if (!fromToken || !toToken) return;

  const isActive = variant !== "passive";
  const totalMs = isActive ? SIPHON_ACTIVE_MS : SIPHON_PASSIVE_MS;
  const moteCount = Math.clamp(Math.round(motes) || 1, 1, isActive ? 6 : 3);
  const color = schoolColor(school);
  const curve = makeCurve(fromToken.center, toToken.center);
  const toRadius = Math.max(toToken.w, toToken.h) / 2;

  const container = new PIXI.Container();
  canvas.interface.addChild(container);

  const strand = new PIXI.Graphics();
  container.addChild(strand);
  {
    const samples = 40;
    const jitter = isActive ? 0 : 3;
    const alpha = isActive ? 0.45 : 0.16;
    strand.lineStyle(isActive ? 2.5 : 1.5, color, alpha);
    for (let i = 0; i <= samples; i++) {
      // Passive: broken into short dashes with a bit of jitter for a "scraped, not pulled" feel.
      if (!isActive && (i % 4 >= 2)) continue;
      const p = curve.pointAt(i / samples);
      const jx = jitter ? (Math.random() - 0.5) * jitter : 0;
      const jy = jitter ? (Math.random() - 0.5) * jitter : 0;
      if (isActive ? i === 0 : (i % 4 === 0)) strand.moveTo(p.x + jx, p.y + jy);
      else strand.lineTo(p.x + jx, p.y + jy);
    }
  }

  const moteDurationMs = totalMs * 0.5;
  const spreadMs = Math.max(totalMs - moteDurationMs, 1);
  const motesState = Array.from({ length: moteCount }, (_, i) => ({
    delay: moteCount > 1 ? (i / (moteCount - 1)) * spreadMs : 0,
    arrived: false,
    graphic: new PIXI.Graphics()
  }));
  for (const m of motesState) container.addChild(m.graphic);

  const startTime = performance.now();
  let ringSpawnedAt = null;
  const ring = new PIXI.Graphics();
  container.addChild(ring);

  const controller = { cleanup: null };
  const tick = () => {
    const elapsed = performance.now() - startTime;

    if (!fromToken.parent || !toToken.parent) return controller.cleanup();

    for (const m of motesState) {
      const local = elapsed - m.delay;
      const raw = Math.clamp(local / moteDurationMs, 0, 1);
      m.graphic.clear();
      if (local <= 0 || (raw >= 1 && m.arrived)) continue;

      const eased = raw * raw; // ease-in: accelerates as it nears the sorcerer
      const pos = curve.pointAt(eased);
      const tint = lerpColor(color, RESONANCE_COLOR, raw);
      drawCircle(m.graphic, pos.x, pos.y, 9, tint, 0.22); // halo
      drawCircle(m.graphic, pos.x, pos.y, 4, tint, 0.95); // core

      if (raw >= 1 && !m.arrived) {
        m.arrived = true;
        ringSpawnedAt = ringSpawnedAt ?? elapsed;
      }
    }

    if (ringSpawnedAt !== null) {
      const ringT = Math.clamp((elapsed - ringSpawnedAt) / RING_DURATION_MS, 0, 1);
      ring.clear();
      if (ringT < 1) {
        const r = toRadius * (0.4 + ringT * 0.9);
        ring.lineStyle(3, RING_COLOR, 0.8 * (1 - ringT));
        ring.drawCircle(toToken.center.x, toToken.center.y, r);
      }
    }

    const allDone = motesState.every(m => m.arrived) && ringSpawnedAt !== null
      && (elapsed - ringSpawnedAt) >= RING_DURATION_MS;
    if (allDone) controller.cleanup();
  };

  controller.cleanup = () => {
    canvas.app.ticker.remove(tick);
    _active.delete(controller);
    if (!container.destroyed) container.destroy({ children: true });
  };

  canvas.app.ticker.add(tick);
  _active.add(controller);
}

function _teardownAll() {
  for (const controller of Array.from(_active)) controller.cleanup();
}

/* -------------------------------------------- */
/*  Public API                                   */
/* -------------------------------------------- */

/**
 * Play the siphon tether from `fromTokenId` to `toTokenId` on this client, and broadcast it to
 * everyone else. `school` is a dnd5e spell-school key (e.g. "evo"); `variant` is "active" or
 * "passive"; `motes` scales the mote count (spell level for Active Siphon).
 */
export function playSiphon(opts) {
  const payload = {
    sceneId: opts.sceneId ?? canvas.scene?.id,
    fromTokenId: opts.fromTokenId,
    toTokenId: opts.toTokenId,
    school: opts.school,
    motes: opts.motes,
    variant: opts.variant
  };
  if (!payload.sceneId || !payload.fromTokenId || !payload.toTokenId) return;
  _render(payload);
  game.socket.emit(CHANNEL, { type: "siphonFx", ...payload });
}

export function registerSiphonFx() {
  game.settings.register(MODULE_ID, SETTING_SHOW, {
    scope: "client", config: true, type: Boolean, default: true,
    name: "Show Siphon Animation",
    hint: "Show the on-canvas siphon animation on your own screen when Unblooded Sorcery drains Resonance from a spell. This only affects your own view — turning it off doesn't hide the animation from other players. (An Unblooded Sorcery character can hide it from everyone via the toggle on their own sheet.)"
  });

  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, (data) => {
      if (data.type === "siphonFx") _render(data);
    });
  });

  // A scene change can strand an in-flight animation's container on the old scene; tear
  // everything down rather than leak it.
  Hooks.on("canvasReady", _teardownAll);
}

/**
 * Console self-test: plays the tether between the currently targeted token (source) and the
 * currently selected token (destination), cycling every spell school and both variants. Select
 * one token and target another, then run:
 *   game.modules.get("fimblewood-academy").api.siphonFx.selftest()
 */
export async function selftest() {
  const toToken = canvas.tokens?.controlled[0];
  const fromToken = Array.from(game.user.targets)[0];
  if (!toToken || !fromToken) {
    ui.notifications.warn("Siphon FX self-test: select one token and target another first.");
    return;
  }

  const schools = Object.keys(SCHOOL_COLORS);
  let i = 0;
  const step = () => {
    if (i >= schools.length * 2) {
      ui.notifications.info("Siphon FX self-test complete.");
      return;
    }
    const school = schools[Math.floor(i / 2) % schools.length];
    const variant = i % 2 === 0 ? "active" : "passive";
    playSiphon({
      sceneId: canvas.scene.id,
      fromTokenId: fromToken.id,
      toTokenId: toToken.id,
      school,
      motes: variant === "active" ? 3 : 1,
      variant
    });
    i++;
    setTimeout(step, (variant === "active" ? SIPHON_ACTIVE_MS : SIPHON_PASSIVE_MS) + 250);
  };
  step();
}
