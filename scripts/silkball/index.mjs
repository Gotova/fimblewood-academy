/** Fimblewood Academy — Silkball */

const MODULE_ID = "fimblewood-academy";

/** The Silkball tool item. dnd5e resolves tool ids through compendia only, so it lives in a module pack. */
export const SILKBALL_TOOL_UUID = `Compendium.${MODULE_ID}.silkball.Item.W0eoBl9ZxbaHnjEX`;

export function registerSilkball() {
  // Registers "Silkball" as a tool so it shows in the sheet's Tools box (like a gaming set).
  // Each character's own ability (their spellcasting ability) and Silkball value (the tool's
  // check bonus) live in system.tools.silkball; "cha" is only the default for new entries.
  const tools = CONFIG.DND5E?.tools;
  if (tools && !tools.silkball) tools.silkball = { ability: "cha", id: SILKBALL_TOOL_UUID };
}
