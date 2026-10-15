/**
 * Fimblewood Academy — Potion effects that need code
 *
 * Most potion effects are plain dnd5e activities and Active Effects (see
 * potions.mjs). One cannot be: a tier III Trank des Wilden Wachstums makes
 * the drinker grow by one size category (Medium becomes Large), but an
 * Active Effect can only set a size, not raise it. So when such a potion is
 * used, this adds an Active Effect to the actor that sets the next size up.
 *
 * Using the potion on a garden bed goes through the garden app instead, so
 * it never triggers this.
 */

const MODULE_ID = "fimblewood-academy";
const SIZES = ["tiny", "sm", "med", "lg", "huge", "grg"];
const DURATION = 3600;
const OVERRIDE = 5;

async function growActor(activity) {
  const item = activity.item;
  const actor = activity.actor;
  if (!item || !actor?.isOwner) return;
  if (item.getFlag(MODULE_ID, "potionEffect") !== "wildes-wachstum" || item.getFlag(MODULE_ID, "potionTier") !== 3) return;

  // Always one step up from the actor's own size, so drinking twice does not stack.
  const base = actor._source.system.traits?.size ?? "med";
  const index = SIZES.indexOf(base);
  if (index < 0 || index === SIZES.length - 1) return;
  const next = SIZES[index + 1];

  const old = actor.effects.filter((e) => e.getFlag(MODULE_ID, "wildGrowthSize"));
  if (old.length) await actor.deleteEmbeddedDocuments("ActiveEffect", old.map((e) => e.id));
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize("FIMBLEWOOD.Botany.Potion.GrownEffect"),
    img: item.img,
    origin: item.uuid,
    changes: [{ key: "system.traits.size", mode: OVERRIDE, value: next, priority: null }],
    duration: { seconds: DURATION },
    flags: { [MODULE_ID]: { wildGrowthSize: true } }
  }]);
  const size = game.i18n.localize(CONFIG.DND5E.actorSizes?.[next]?.label ?? next);
  ui.notifications.info(game.i18n.format("FIMBLEWOOD.Botany.Potion.Grown", { actor: actor.name, size }));
}

export function registerPotionEffects() {
  Hooks.on("dnd5e.postUseActivity", (activity) => {
    growActor(activity).catch((err) => console.error(`${MODULE_ID} | Wildes Wachstum: growing the actor failed`, err));
  });
}
