const MODULE_ID = "fimblewood-academy";
const FLAG_RESONANCE = "resonance";
const SIPHONED_FLAG = "siphonedSpells";

/* -------------------------------------------- */
/*  Helpers                                      */
/* -------------------------------------------- */

function getSubclassItem(actor) {
  return actor?.items?.find(i => i.type === "subclass" && i.flags?.[MODULE_ID]?.isUnbloodedSorcery);
}

export function hasUnbloodedSorcery(actor) {
  return !!getSubclassItem(actor);
}

function getFeature(actor, key) {
  return actor?.items?.find(i => i.flags?.[MODULE_ID]?.[key]);
}

export function getResonanceValue(actor) {
  return actor?.getFlag(MODULE_ID, `${FLAG_RESONANCE}.value`) ?? 0;
}

export function getResonanceMax(actor) {
  return 2 * (actor?.system?.attributes?.prof ?? 0);
}

async function setResonance(actor, value) {
  const max = getResonanceMax(actor);
  const surging = actor.getFlag(MODULE_ID, "manaSurgeActive");
  const clamped = surging ? Math.max(0, value) : Math.clamp(value, 0, max);
  await actor.setFlag(MODULE_ID, `${FLAG_RESONANCE}.value`, clamped);
  return clamped;
}

export async function addResonance(actor, amount, { flavor }={}) {
  if (!hasUnbloodedSorcery(actor) || !Number.isFinite(amount)) return null;
  const before = getResonanceValue(actor);
  const after = await setResonance(actor, before + amount);
  if (flavor && after !== before) {
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor }),
      content: `<p>${flavor} (${before} &rarr; ${after} Resonance)</p>`
    });
  }
  return after;
}

async function spendResonance(actor, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  const before = getResonanceValue(actor);
  if (before < amount) return false;
  await setResonance(actor, before - amount);
  return true;
}

function tokensWithinFeet(originToken, feet) {
  if (!originToken || !canvas.ready) return [];
  return canvas.tokens.placeables.filter(t => {
    if (t === originToken || !t.actor) return false;
    try {
      const { distance } = canvas.grid.measurePath([originToken.center, t.center]);
      return distance <= feet;
    } catch (err) {
      return false;
    }
  });
}

function tokenForActor(actor) {
  return canvas.tokens?.placeables.find(t => t.actor === actor) ?? actor?.getActiveTokens?.(true, false)?.[0];
}

/* -------------------------------------------- */
/*  Resonance bar UI                             */
/* -------------------------------------------- */

function injectResonanceBar(app, html) {
  const actor = app.actor;
  if (!hasUnbloodedSorcery(actor)) return;

  const root = html instanceof jQuery ? html[0] : html;
  const hdGroup = root.querySelector(".hit-dice")?.closest(".meter-group");
  if (!hdGroup || root.querySelector(".fimblewood-resonance-group")) return;

  const value = getResonanceValue(actor);
  const max = Math.max(getResonanceMax(actor), 1);
  const pct = Math.clamp((value / max) * 100, 0, 100);

  const group = document.createElement("div");
  group.className = "meter-group fimblewood-resonance-group";
  group.innerHTML = `
    <div class="label roboto-condensed-upper"><span>Resonance</span></div>
    <div class="meter progress fimblewood-resonance" role="meter"
         aria-valuemin="0" aria-valuenow="${value}" aria-valuemax="${max}"
         style="--bar-percentage: ${pct}%">
      <div class="label">
        <span class="value">${value}</span>
        <span class="separator">/</span>
        <span class="max">${max}</span>
      </div>
    </div>`;
  hdGroup.insertAdjacentElement("afterend", group);

  group.querySelector(".fimblewood-resonance").addEventListener("click", async (event) => {
    const delta = event.shiftKey ? -1 : 1;
    await addResonance(actor, delta);
  });
}

/* -------------------------------------------- */
/*  Resonant Reserve thresholds                  */
/* -------------------------------------------- */

async function updateResonantReserveEffects(actor) {
  const feature = getFeature(actor, "isResonantReserve");
  if (!feature) return;
  const value = getResonanceValue(actor);

  for (const effect of feature.effects) {
    const threshold = effect.flags?.[MODULE_ID]?.resonanceThreshold;
    if (threshold === undefined) continue;
    const shouldBeActive = value >= threshold;
    if (effect.disabled === shouldBeActive) {
      await effect.update({ disabled: !shouldBeActive });
    }
  }
}

/* -------------------------------------------- */
/*  Unblooded Magic: Resonant Sundering           */
/* -------------------------------------------- */

const RESONANT_SUNDERING_FLAG = "flags.midi-qol.grants.disadvantage.save.con";

async function syncResonantSundering(actor, shouldBeActive) {
  if (!getFeature(actor, "isUnbloodedMagic")) return;
  const current = foundry.utils.getProperty(actor, RESONANT_SUNDERING_FLAG);
  if (!!current === shouldBeActive) return;
  if (shouldBeActive) await actor.setFlag("midi-qol", "grants.disadvantage.save.con", true);
  else await actor.unsetFlag("midi-qol", "grants.disadvantage.save.con");
}

/* -------------------------------------------- */
/*  Active Siphon / Passive Siphon               */
/* -------------------------------------------- */

async function offerActiveSiphon(sorcererActor, spellLevel, casterName) {
  const siphonItem = getFeature(sorcererActor, "isManaSiphon");
  if (!siphonItem || (siphonItem.system.uses?.value ?? 0) <= 0) return;

  const gain = spellLevel; // Resonance = spell level (per campaign ruling)
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Mana Siphon" },
    content: `<p><strong>${sorcererActor.name}:</strong> ${casterName} just cast a level ${spellLevel} spell within 60 ft.
      Use Active Siphon to gain ${gain} Resonance? (${siphonItem.system.uses.value} use${siphonItem.system.uses.value === 1 ? "" : "s"} remaining)</p>`,
    rejectClose: false
  });
  if (!confirmed) return;

  await siphonItem.update({ "system.uses.spent": (siphonItem.system.uses.spent ?? 0) + 1 });
  await addResonance(sorcererActor, gain, { flavor: `${sorcererActor.name} siphons ${casterName}'s spell (Active Siphon)` });
}

async function offerPassiveSiphon(sorcererActor, spellItem, reason) {
  const key = `${SIPHONED_FLAG}.${spellItem.uuid ?? spellItem.id}`;
  if (sorcererActor.getFlag(MODULE_ID, key)) return;

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Passive Siphon" },
    content: `<p><strong>${sorcererActor.name}:</strong> you ${reason} from <em>${spellItem.name}</em>.
      Use your Reaction to gain 1 Resonance?</p>`,
    rejectClose: false
  });
  if (!confirmed) return;

  await sorcererActor.setFlag(MODULE_ID, key, true);
  await addResonance(sorcererActor, 1, { flavor: `${sorcererActor.name} siphons ${spellItem.name} (Passive Siphon)` });
}

/* -------------------------------------------- */
/*  Bend Magic / Redirect Magic prompts          */
/* -------------------------------------------- */

async function offerBendMagic(sorcererActor, spellItem, casterName) {
  const feature = getFeature(sorcererActor, "isBendMagic");
  if (!feature) return;

  const max = getResonanceValue(sorcererActor);
  if (max <= 0) return;

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: "Bend Magic" },
    content: `<p><strong>${sorcererActor.name}:</strong> ${casterName} cast <em>${spellItem.name}</em> within 60 ft.
      Spend Resonance to bend it? (you have ${max})</p>
      <label>Resonance to spend (min 1): <input type="number" name="amount" value="1" min="1" max="${max}" style="width:4em"/></label>`,
    buttons: [
      { action: "skew", label: "Skew the Roll", callback: (event, button) => ({ effect: "skew", amount: Number(button.form.elements.amount.value) }) },
      { action: "crook", label: "Crook the Strike", callback: (event, button) => ({ effect: "crook", amount: Number(button.form.elements.amount.value) }) },
      { action: "cancel", label: "Cancel", callback: () => null }
    ],
    rejectClose: false
  });
  if (!choice) return;

  const amount = Math.clamp(Number.isFinite(choice.amount) ? choice.amount : 1, 1, max);
  if (!(await spendResonance(sorcererActor, amount))) {
    ui.notifications.warn(`${sorcererActor.name} couldn't spend Resonance for Bend Magic (insufficient Resonance or invalid amount).`);
    return;
  }

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sorcererActor }),
    content: `<p><strong>${sorcererActor.name}</strong> spends ${amount} Resonance to
      ${choice.effect === "skew" ? "Skew the Roll" : "Crook the Strike"} on <em>${spellItem.name}</em>.
      ${choice.effect === "skew"
        ? `Choose Advantage/Disadvantage (your choice each) for the first save of up to ${amount} affected creature(s) against this spell.`
        : `Set up to ${amount} damage dice from this spell's damage roll to their maximum or minimum (your choice each).`}
      Apply this manually to the roll/targets &mdash; automatic per-die/per-target adjustment isn't wired up.</p>`
  });
}

async function offerRedirectMagic(sorcererActor, spellItem, casterName, spellLevel) {
  const feature = getFeature(sorcererActor, "isRedirectMagic");
  if (!feature) return;
  if (spellItem.system.range?.units === "self") return; // cannot redirect

  const value = getResonanceValue(sorcererActor);
  if (value < spellLevel) return;

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Redirect Magic" },
    content: `<p><strong>${sorcererActor.name}:</strong> ${casterName} cast <em>${spellItem.name}</em> (level ${spellLevel}) within 60 ft.
      Spend ${spellLevel} Resonance to redirect it? Choosing new target(s)/origin is resolved manually with your GM.</p>`,
    rejectClose: false
  });
  if (!confirmed) return;
  if (!(await spendResonance(sorcererActor, spellLevel))) return;

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sorcererActor }),
    content: `<p><strong>${sorcererActor.name}</strong> spends ${spellLevel} Resonance to redirect <em>${spellItem.name}</em>.
      Choose new target(s) or a new area origin within the spell's normal range from ${sorcererActor.name}'s position (GM adjudicates).</p>`
  });
}

/* -------------------------------------------- */
/*  Drain Magic / Improved Drain Magic           */
/* -------------------------------------------- */

async function handleDrainMagic(sorcererActor, improved) {
  const targetToken = Array.from(game.user.targets)[0];
  if (!targetToken?.actor) {
    ui.notifications.warn("Target a willing creature first, then use Drain Magic again.");
    return;
  }
  const target = targetToken.actor;
  const maxDrainLevel = improved ? 3 : 2;

  const spellEffects = target.effects.filter(e => {
    const origin = e.origin ? fromUuidSync(e.origin) : null;
    return origin?.type === "spell" && origin.system.level >= 1 && origin.system.level <= maxDrainLevel;
  });

  if (spellEffects.length) {
    const effect = spellEffects[0];
    const origin = fromUuidSync(effect.origin);
    await effect.delete();
    const restoreLevel = await promptSlotLevel(target, 1, maxDrainLevel);
    if (restoreLevel) {
      await target.update({ [`system.spells.spell${restoreLevel}.value`]: (target.system.spells[`spell${restoreLevel}`]?.value ?? 0) + 1 });
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: sorcererActor }),
        content: `<p><strong>${sorcererActor.name}</strong> uses Drain Magic to end <em>${origin?.name ?? "an ongoing spell"}</em> on ${target.name},
          who recovers a level ${restoreLevel} spell slot.</p>`
      });
    }
    return;
  }

  const maxResonance = improved ? 3 : 2;
  const available = Math.min(maxResonance, getResonanceValue(sorcererActor));
  if (available < 1) {
    ui.notifications.warn(`${target.name} has no ongoing spell to drain, and ${sorcererActor.name} has no Resonance to spend instead.`);
    return;
  }
  const amount = await promptSlotLevel(sorcererActor, 1, available, "Resonance to spend");
  if (!amount) return;
  if (!(await spendResonance(sorcererActor, amount))) return;
  await target.update({ [`system.spells.spell${amount}.value`]: (target.system.spells[`spell${amount}`]?.value ?? 0) + 1 });
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: sorcererActor }),
    content: `<p><strong>${sorcererActor.name}</strong> spends ${amount} Resonance (Drain Magic) so ${target.name} recovers a level ${amount} spell slot.</p>`
  });
}

async function promptSlotLevel(actor, min, max, label = "Spell slot level") {
  if (min >= max) return max;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: "Drain Magic" },
    content: `<label>${label}: <input type="number" name="level" value="${min}" min="${min}" max="${max}" style="width:4em"/></label>`,
    buttons: [
      { action: "ok", label: "Confirm", default: true, callback: (event, button) => Number(button.form.elements.level.value) },
      { action: "cancel", label: "Cancel", callback: () => null }
    ],
    rejectClose: false
  });
  return Number.isFinite(result) ? Math.clamp(result, min, max) : null;
}

/* -------------------------------------------- */
/*  Casting via Resonance (no spell slots)       */
/* -------------------------------------------- */

async function promptSpellLevel(actor, baseLevel, maxLevel) {
  if (maxLevel <= baseLevel) return baseLevel;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: "Cast via Resonance" },
    content: `<p>Cast at what level? (base ${baseLevel}, max ${maxLevel}, you have ${getResonanceValue(actor)} Resonance)</p>
      <label>Level: <input type="number" name="level" value="${baseLevel}" min="${baseLevel}" max="${maxLevel}" style="width:4em"/></label>`,
    buttons: [
      { action: "ok", label: "Cast", default: true, callback: (event, button) => Number(button.form.elements.level.value) },
      { action: "cancel", label: "Cancel", callback: () => null }
    ],
    rejectClose: false
  });
  return Number.isFinite(result) ? Math.clamp(result, baseLevel, maxLevel) : (result === null ? null : baseLevel);
}

async function handleResonanceCast(activity) {
  const item = activity.item;
  const actor = item.actor;
  if (item.type !== "spell" || item.system.level < 1) return true;
  if (!hasUnbloodedSorcery(actor)) return true;

  // Occult Shroud: first free Nondetection cast per long rest
  if (item.name === "Nondetection" && getFeature(actor, "isOccultShroud") && !actor.getFlag(MODULE_ID, "occultShroudUsed")) {
    await actor.setFlag(MODULE_ID, "occultShroudUsed", true);
    ui.notifications.info(`${item.name} cast for free (Occult Shroud).`);
    return true;
  }

  const reserve = getFeature(actor, "isResonantReserve");
  const chargedFocus = reserve?.effects?.find(e => e.flags?.[MODULE_ID]?.resonanceThreshold === 6 && !e.disabled);

  const casterLevel = actor.items.find(i => i.type === "class" && i.system.identifier === "sorcerer")?.system.levels ?? 0;
  const maxSpellLevel = CONFIG.DND5E.SPELL_SLOT_TABLE[casterLevel - 1]?.length ?? item.system.level;
  const chosenLevel = await promptSpellLevel(actor, item.system.level, Math.max(item.system.level, maxSpellLevel));
  if (!chosenLevel) return false;

  const cost = Math.max(1, chosenLevel - (chargedFocus ? 1 : 0));
  const current = getResonanceValue(actor);
  if (current < cost) {
    ui.notifications.warn(`${actor.name} doesn't have enough Resonance to cast ${item.name} (needs ${cost}, has ${current}).`);
    return false;
  }

  await spendResonance(actor, cost);
  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${actor.name}</strong> spends ${cost} Resonance to cast <em>${item.name}</em>${chosenLevel > item.system.level ? ` at level ${chosenLevel}` : ""}.</p>`
  });
  return true;
}

/* -------------------------------------------- */
/*  Hooks registration                           */
/* -------------------------------------------- */

export function registerUnbloodedSorcery() {
  Hooks.on("renderCharacterActorSheet", (app, html) => injectResonanceBar(app, html));

  Hooks.on("updateActor", (actor, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAG_RESONANCE}.value`)) {
      updateResonantReserveEffects(actor);
      actor.sheet?.render();
    }
  });

  Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
    if (!hasUnbloodedSorcery(actor)) return;
    if (config?.type === "long") {
      await setResonance(actor, 0);
      await actor.unsetFlag(MODULE_ID, SIPHONED_FLAG);
      await actor.unsetFlag(MODULE_ID, "occultShroudUsed");
    }
  });

  // Cancel default activity flow for spell casts by Unblooded Sorcery actors; spend Resonance instead.
  Hooks.on("dnd5e.preUseActivity", (activity, usageConfig, dialogConfig, messageConfig) => {
    if (usageConfig.fimblewoodResonanceHandled) return true; // avoid recursing into our own re-invocation
    const item = activity.item;
    if (item?.type !== "spell" || item.system.level < 1 || !hasUnbloodedSorcery(item.actor)) return true;
    handleResonanceCast(activity).then(ok => {
      if (ok) {
        activity.use(
          { ...usageConfig, fimblewoodResonanceHandled: true, consume: { spellSlot: false } },
          { ...dialogConfig, configure: false },
          messageConfig
        );
      }
    });
    return false;
  });

  // Perform the actual Drain Magic effect after the feature's own use/charge is resolved.
  Hooks.on("dnd5e.postUseActivity", (activity) => {
    const item = activity.item;
    if (!item?.flags?.[MODULE_ID]?.isDrainMagic) return;
    const improved = !!getFeature(item.actor, "isImprovedDrainMagic");
    handleDrainMagic(item.actor, improved);
  });

  // Detect nearby spellcasting for Active Siphon / Bend Magic / Redirect Magic.
  Hooks.on("dnd5e.postUseActivity", async (activity) => {
    try {
      const item = activity.item;
      if (item?.type !== "spell" || item.system.level < 1) return;
      const casterToken = tokenForActor(item.actor);
      if (!casterToken) return;

      const nearby = tokensWithinFeet(casterToken, 60).filter(t => t.actor !== item.actor && hasUnbloodedSorcery(t.actor));
      for (const t of nearby) {
        if (item.actor === t.actor) continue;
        await offerActiveSiphon(t.actor, item.system.level, item.actor.name);
        await offerBendMagic(t.actor, item, item.actor.name);
        await offerRedirectMagic(t.actor, item, item.actor.name, item.system.level);
      }
    } catch (err) {
      console.error("fimblewood-academy | Error in Unblooded Sorcery postUseActivity hook:", err);
    }
  });

  // Turn-start automation: Echo Ward temp HP, Mana Surge bonus Resonance.
  Hooks.on("combatTurn", async (combat, updateData, updateOptions) => {
    const combatant = combat.combatants.get(combat.current.combatantId ?? combat.combatant?.id);
    const actor = combatant?.actor;
    if (!actor || !hasUnbloodedSorcery(actor)) return;

    const reserve = getFeature(actor, "isResonantReserve");
    const echoWard = reserve?.effects?.find(e => e.flags?.[MODULE_ID]?.resonanceThreshold === 8 && !e.disabled);
    if (echoWard) {
      const prof = actor.system.attributes.prof ?? 0;
      const currentTemp = actor.system.attributes.hp.temp ?? 0;
      if (currentTemp < prof) await actor.update({ "system.attributes.hp.temp": prof });
    }

    const innateActive = actor.effects.some(e => e.name === "Innate Sorcery" && !e.disabled);
    if (innateActive) {
      const unbloodedMagic = getFeature(actor, "isUnbloodedMagic");
      if (unbloodedMagic) {
        const prof = actor.system.attributes.prof ?? 0;
        const gain = Math.max(1, Math.floor(prof / 2));
        await actor.setFlag(MODULE_ID, "manaSurgeActive", true);
        await addResonance(actor, gain, { flavor: `${actor.name} gains Resonance from Mana Surge` });
      }
    } else if (actor.getFlag(MODULE_ID, "manaSurgeActive")) {
      await actor.unsetFlag(MODULE_ID, "manaSurgeActive");
      const max = getResonanceMax(actor);
      if (getResonanceValue(actor) > max) await setResonance(actor, max);
    }

    await syncResonantSundering(actor, innateActive);
  });

  // Resonant Sundering also needs to toggle the instant an Innate Sorcery effect is added/removed mid-turn.
  const syncOnEffectChange = (effect) => {
    if (effect.name !== "Innate Sorcery" || !effect.parent) return;
    const actor = effect.parent;
    if (!hasUnbloodedSorcery(actor) || !getFeature(actor, "isUnbloodedMagic")) return;
    syncResonantSundering(actor, actor.effects.some(e => e.name === "Innate Sorcery" && !e.disabled));
  };
  Hooks.on("createActiveEffect", syncOnEffectChange);
  Hooks.on("deleteActiveEffect", syncOnEffectChange);

  // Midi QoL integration (optional): Passive Siphon, Mana Resistance, Resonant Sundering, Absorb Magic bonus.
  if (game.modules.get("midi-qol")?.active) {
    Hooks.on("midi-qol.RollComplete", async (workflow) => {
      const item = workflow.item;
      if (!item || item.type !== "spell" || item.system.level < 1) return;

      const failedSaveTokens = workflow.failedSaves ?? new Set();
      const damagedActors = (workflow.damageList ?? []).map(d => d.actorUuid ? fromUuidSync(d.actorUuid) : null).filter(Boolean);

      const affectedActors = new Set([
        ...Array.from(failedSaveTokens).map(t => t.actor),
        ...damagedActors
      ].filter(a => a && hasUnbloodedSorcery(a) && a !== item.actor));

      for (const actor of affectedActors) {
        const reason = Array.from(failedSaveTokens).some(t => t.actor === actor)
          ? "fail a save against a spell" : "take damage from a spell";
        await offerPassiveSiphon(actor, item, reason);
      }

      // Absorb Magic: bonus sorcery points when a target fails the save against the sorcerer's Counterspell.
      if (item.name === "Counterspell" && hasUnbloodedSorcery(item.actor) && failedSaveTokens.size) {
        const fontOfMagic = item.actor.items.find(i => i.name === "Font of Magic");
        if (fontOfMagic) {
          const roll = await new Roll("1d4").evaluate();
          const spent = fontOfMagic.system.uses?.spent ?? 0;
          await fontOfMagic.update({ "system.uses.spent": Math.max(0, spent - roll.total) });
          ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor: item.actor }),
            content: `<p><strong>${item.actor.name}</strong> regains ${roll.total} Sorcery Points (Absorb Magic).</p>`,
            rolls: [roll]
          });
        }
      }
    });
  }
}
