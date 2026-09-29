/**
 * Owner prompts: run a decision dialog on the clients of an actor's owners instead of on
 * whichever client happened to trigger it.
 *
 * Hooks like `dnd5e.postUseActivity` or `midi-qol.RollComplete` fire on the client that cast the
 * spell — usually the GM when an NPC casts. Reactions such as Mana Siphon belong to the player who
 * owns the reacting character, so `promptOwners()` forwards the whole decision flow (a registered
 * handler) over the module socket to every active non-GM owner, falling back to the active GM when
 * none of them is online.
 *
 * With several owners, all of them see the dialog; the first to answer takes over the rest of the
 * flow and the dialog closes on everyone else's screen.
 */

const MODULE_ID = "fimblewood-academy";
const CHANNEL = `module.${MODULE_ID}`;

const handlers = new Map();
const openDialogs = new Map(); // requestId -> DialogV2
const answeredElsewhere = new Set(); // requestIds another owner has taken over

class AnsweredElsewhere extends Error {}

/** Active players with Owner permission on the actor; the active GM if there are none. */
export function promptRecipients(actor) {
  const players = game.users.filter(u => u.active && !u.isGM && actor.testUserPermission(u, "OWNER"));
  if (players.length) return players;
  const gm = game.users.activeGM;
  return gm ? [gm] : [];
}

/**
 * Register a flow that can be run on an owner's client.
 * @param {string} name
 * @param {(data: object, ask: (method: "confirm"|"wait", config: object) => Promise<any>) => Promise<void>} fn
 *   `ask` opens a DialogV2 via `DialogV2[method](config)`; always use it instead of DialogV2 directly
 *   so the dialog is shared between owners.
 */
export function registerOwnerPromptHandler(name, fn) {
  handlers.set(name, fn);
}

/** Run the named handler on the clients of the actor's owners. `data` must be JSON-serializable. */
export async function promptOwners(actor, handler, data) {
  const recipients = promptRecipients(actor).map(u => u.id);
  if (!recipients.length) return;
  const message = { type: "ownerPrompt", requestId: foundry.utils.randomID(), handler, recipients, data };
  if (recipients.some(id => id !== game.user.id)) game.socket.emit(CHANNEL, message);
  if (recipients.includes(game.user.id)) await runHandler(message);
}

async function runHandler({ requestId, handler, recipients, data }) {
  const fn = handlers.get(handler);
  if (!fn) return;
  const shared = recipients.length > 1;

  const ask = async (method, config) => {
    if (answeredElsewhere.has(requestId)) throw new AnsweredElsewhere();
    const result = await foundry.applications.api.DialogV2[method]({
      ...config,
      rejectClose: false,
      render: (event, dialog) => openDialogs.set(requestId, dialog)
    });
    openDialogs.delete(requestId);
    if (answeredElsewhere.has(requestId)) throw new AnsweredElsewhere();
    if (shared) game.socket.emit(CHANNEL, { type: "ownerPromptAnswered", requestId });
    return result;
  };

  try {
    await fn(data, ask);
  } catch (err) {
    if (!(err instanceof AnsweredElsewhere)) console.error(`${MODULE_ID} | Owner prompt "${handler}" failed:`, err);
  } finally {
    answeredElsewhere.delete(requestId);
  }
}

export function registerOwnerPrompts() {
  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, (msg) => {
      if (msg.type === "ownerPrompt") {
        if (msg.recipients.includes(game.user.id)) runHandler(msg);
      } else if (msg.type === "ownerPromptAnswered") {
        answeredElsewhere.add(msg.requestId);
        openDialogs.get(msg.requestId)?.close();
      }
    });
  });
}
