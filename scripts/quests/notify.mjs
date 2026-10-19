/**
 * Fimblewood Academy — Quests: notifications
 *
 * The active GM applies every quest change (data.mjs) and compares the quest
 * before and after. New quests, finished objectives and finished quests are
 * sent to the players who can see the quest: a banner with the quest
 * picture, an optional sound, and (for new and finished quests) an optional
 * whispered chat card.
 */

import { MODULE_ID, CHANNEL, SETTINGS, t, tf, esc, questData, canSee, players, getQuest, visibleObjectives } from "./data.mjs";

/** Events for one change: [{ kind, text, users }] */
function diff(entry, before, after, actingUser) {
  const events = [];
  const seesNow = (u) => canSee(entry, u);
  const audience = players().filter(seesNow);
  const wasVisible = (u) => {
    if (!before || before.status === "draft") return false;
    return before.visibleTo === "all" || before.visibleTo.includes(u.id);
  };

  const fresh = audience.filter((u) => !wasVisible(u));
  if (fresh.length) events.push({ kind: "new", text: t("Notify.New"), users: fresh });
  if (!before) return events;
  const known = audience.filter((u) => wasVisible(u));

  if (before.status !== after.status && ["completed", "failed"].includes(after.status)) {
    events.push({ kind: after.status, text: t(`Notify.${after.status}`), users: known });
  } else {
    for (const o of after.objectives) {
      if (o.secret || o.state !== "done") continue;
      const old = before.objectives.find((b) => b.id === o.id);
      if (old && old.state !== "done") events.push({ kind: "objective", text: tf("Notify.Objective", { text: o.text }), users: known });
    }
    // Objectives players see for the first time: unlocked, no longer secret, or newly added.
    const player = { isGM: false };
    const seenBefore = new Set(visibleObjectives(before, player).filter((o) => o.text.trim()).map((o) => o.id));
    for (const o of visibleObjectives(after, player)) {
      if (!seenBefore.has(o.id) && o.text.trim()) events.push({ kind: "objective", text: tf("Notify.NewObjective", { text: o.text }), users: known });
    }
  }
  return events.map((e) => ({ ...e, users: e.users.filter((u) => u.id !== actingUser?.id) }));
}

function send(entry, event) {
  const q = questData(entry);
  const payload = {
    type: "questNotify",
    users: event.users.map((u) => u.id),
    questId: entry.id,
    kind: event.kind,
    title: entry.name,
    text: event.text,
    image: q.image
  };
  game.socket.emit(CHANNEL, payload);
  if (payload.users.includes(game.user.id)) show(payload);

  if (game.settings.get(MODULE_ID, SETTINGS.chat) && event.kind !== "objective" && payload.users.length) {
    ChatMessage.create({
      whisper: [...payload.users, ...game.users.filter((u) => u.isGM).map((u) => u.id)],
      speaker: { alias: t("Title") },
      content: `
        <div class="fw-quest-chat is-${event.kind}">
          ${q.image ? `<img src="${esc(q.image)}" alt="">` : ""}
          <div><strong>${esc(event.text)}</strong><br>
            <a class="fw-quest-chat-link" data-quest-id="${entry.id}">${esc(entry.name)}</a></div>
        </div>`
    });
  }
}

/** The banner on this client. */
export function show(payload) {
  let stack = document.getElementById("fw-quest-toasts");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "fw-quest-toasts";
    document.body.append(stack);
  }
  const toast = document.createElement("div");
  toast.className = `fw-quest-toast is-${payload.kind}`;
  toast.innerHTML = `
    ${payload.image ? `<img src="${esc(payload.image)}" alt="">` : `<i class="fas fa-scroll"></i>`}
    <div><span class="fw-quest-toast-kind">${esc(payload.text)}</span><strong>${esc(payload.title)}</strong></div>`;
  toast.addEventListener("click", () => {
    game.modules.get(MODULE_ID).api?.quests?.open(payload.questId);
    toast.remove();
  });
  stack.append(toast);
  setTimeout(() => toast.classList.add("is-leaving"), 5500);
  setTimeout(() => toast.remove(), 6200);

  const sound = game.settings.get(MODULE_ID, SETTINGS.sound);
  if (sound) foundry.audio.AudioHelper.play({ src: sound, volume: 0.6, loop: false }, false);
}

export function registerQuestNotifications() {
  Hooks.on("fimblewoodQuestChanged", async (entry, before, after, { user } = {}) => {
    if (!game.users.activeGM?.isSelf) return;
    for (const event of diff(entry, before, after, user)) {
      if (event.users.length) send(entry, event);
    }
    // Loot can be handed out by itself when the quest is completed.
    if (before && before.status !== "completed" && after.status === "completed"
      && after.rewards.autoAward && after.rewards.qmFolderId && !after.rewards.awarded) {
      const { awardQuestLoot } = await import("./quartermaster.mjs");
      const result = await awardQuestLoot(entry);
      if (!result.ok && result.message) ui.notifications.warn(result.message);
    }
  });

  Hooks.on("fimblewoodQuestLootAwarded", (entry, items) => {
    const audience = players().filter((u) => canSee(entry, u));
    if (!audience.length) return;
    send(entry, { kind: "loot", text: tf("Notify.Loot", { count: items.length }), users: audience });
  });

  Hooks.once("ready", () => {
    game.socket.on(CHANNEL, (data) => {
      if (data?.type === "questNotify" && data.users?.includes(game.user.id)) show(data);
    });
  });

  // Quest links in chat cards open the quest window.
  Hooks.on("renderChatMessageHTML", (message, html) => {
    html.querySelector(".fw-quest-chat-link")?.addEventListener("click", (event) => {
      const id = event.currentTarget.dataset.questId;
      if (getQuest(id)) game.modules.get(MODULE_ID).api?.quests?.open(id);
    });
  });
}
