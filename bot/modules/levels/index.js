import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { LevelsStore } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  statePath: join(__dirname, "data", "state.json"),
  xpMin: 8,
  xpMax: 18,
  xpCooldownMs: 45 * 1000,
  topSize: 10,
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function xpForLevel(level) {
  return 100 + (level - 1) * 75;
}

function normalizeCommand(text) {
  return text.trim().split(/\s+/)[0].toLowerCase();
}

function parseTarget(ctx) {
  const info = ctx.raw.message?.extendedTextMessage?.contextInfo;
  const fromMention = info?.mentionedJid?.[0];
  const fromQuote = info?.participant;
  const arg = ctx.args?.[0];
  return fromMention || fromQuote || (arg?.includes("@") ? arg : null);
}

function cleanJid(jid) {
  if (!jid) return "";
  return String(jid).split(":")[0].split("@")[0];
}

function normalizeJid(jid = "") {
  return String(jid).replace(/:\d+(?=@)/, "").toLowerCase();
}

function jidUser(jid = "") {
  return cleanJid(jid);
}

function sameParticipant(a = "", b = "") {
  const normalizedA = normalizeJid(a);
  const normalizedB = normalizeJid(b);
  if (normalizedA === normalizedB) return true;

  const userA = jidUser(a);
  const userB = jidUser(b);
  return Boolean(userA && userB && userA === userB);
}

function participantIds(participant = {}) {
  return [participant.id, participant.jid, participant.lid, participant.phoneNumber].filter(Boolean);
}

function participantName(participant) {
  return participant?.name || participant?.notify || participant?.verifiedName || participant?.pushName || "";
}

function displayUser(user, metadata) {
  const jid = typeof user === "string" ? user : user.jid;
  if (typeof user === "object" && user.name) return user.name;

  const participant = metadata?.participants?.find((item) =>
    participantIds(item).some((id) => sameParticipant(id, jid)),
  );
  const name = participantName(participant);
  if (name) return name;

  const handle = jidUser(jid);
  return handle ? `@${handle}` : jid;
}

function applyMessageXp(config, store, ctx) {
  store.updateProfile(ctx.sender, { name: ctx.name });
  const user = store.user(ctx.sender);
  const now = Date.now();

  user.messages += 1;

  if (now - user.lastXpAt < config.xpCooldownMs) {
    store.save();
    return null;
  }

  const gained = randomInt(config.xpMin, config.xpMax);
  user.xp += gained;
  user.lastXpAt = now;

  let leveled = false;
  while (user.xp >= xpForLevel(user.level)) {
    user.xp -= xpForLevel(user.level);
    user.level += 1;
    leveled = true;
  }

  if (leveled) {
    store.log({ type: "level-up", jid: ctx.sender, level: user.level, group: ctx.phone });
  }

  store.save();
  return leveled ? `${ctx.name} subio a nivel ${user.level}.` : null;
}

function makeHandler(config, store) {
  return async (ctx) => {
    if (!ctx.isCommand) {
      return applyMessageXp(config, store, ctx);
    }

    const command = ctx.command;

    if (command === "level" || command === "xp") {
      const target = parseTarget(ctx) || ctx.sender;
      const user = store.user(target);
      const needed = xpForLevel(user.level);
      const metadata = ctx.isGroup ? await ctx.getGroupMetadata().catch(() => null) : null;
      const text = `${displayUser({ jid: target, ...user }, metadata)}: nivel ${user.level}, XP ${user.xp}/${needed}, mensajes ${user.messages}.`;
      if (ctx.isGroup) {
        await ctx.sendMessage({ text, mentions: [target] });
        return null;
      }
      return text;
    }

    if (command === "rank" || command === "ranking" || command === "top") {
      const ranked = store.rankedUsers().slice(0, config.topSize);
      if (!ranked.length) return "Aun no hay ranking.";
      const metadata = ctx.isGroup ? await ctx.getGroupMetadata().catch(() => null) : null;
      const mentions = ranked.map((user) => user.jid);
      const text = [
        "Ranking global:",
        ...ranked.map((user, index) => `${index + 1}. ${displayUser(user, metadata)} - nivel ${user.level}, XP ${user.xp}, mensajes ${user.messages}`),
      ].join("\n");

      if (ctx.isGroup) {
        await ctx.sendMessage({ text, mentions });
        return null;
      }
      return text;
    }

    return null;
  };
}

export const levelsPlugin = {
  name: "levels",
  version: "1.0.0",
  register(router, options = {}) {
    const config = { ...DEFAULT_CONFIG, ...options };
    const store = new LevelsStore(config.statePath);

    router.register(makeHandler(config, store), {
      category: "NIVELES",
      commands: ["level", "xp", "rank", "ranking", "top"],
    });
  },
};
