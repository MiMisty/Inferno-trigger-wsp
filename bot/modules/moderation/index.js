import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { ModerationStore } from "./store.js";
import { isBotAdmin, isProtectedJid } from "../../utils/owner.js";
import { cleanJid } from "../../utils/jid.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  spamWindowMs: 7000,
  spamMaxMessages: 5,
  spamWarnThreshold: 3,
  autoDeleteSpam: true,
  statePath: join(__dirname, "data", "state.json"),
};

const buckets = new Map();
const metadataCache = new Map();
const METADATA_TTL = 60000;

async function getMetadata(ctx) {
  if (!ctx.isGroup) return null;
  const cached = metadataCache.get(ctx.phone);
  if (cached && Date.now() - cached.ts < METADATA_TTL) return cached.data;
  const data = await ctx.getGroupMetadata().catch(() => null);
  if (data) metadataCache.set(ctx.phone, { data, ts: Date.now() });
  return data;
}

function normalizeJid(jid = "") {
  return String(jid).replace(/:\d+(?=@)/, "").toLowerCase();
}

function jidUser(jid = "") {
  return normalizeJid(jid).split("@")[0];
}

function jidFromNumber(value) {
  const number = String(value || "").replace(/\D/g, "");
  return number ? `${number}@s.whatsapp.net` : null;
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
  return [
    participant.id,
    participant.jid,
    participant.lid,
    participant.phoneNumber,
    jidFromNumber(participant.phoneNumber),
  ].filter(Boolean);
}

function isAdminParticipant(participant) {
  return (
    participant?.admin === "admin" ||
    participant?.admin === "superadmin" ||
    participant?.isAdmin === true ||
    participant?.isSuperAdmin === true
  );
}

function findParticipant(metadata, ids) {
  const candidates = ids.filter(Boolean);
  return metadata?.participants?.find((participant) =>
    participantIds(participant).some((participantId) =>
      candidates.some((jid) => sameParticipant(participantId, jid)),
    ),
  );
}

async function getGroupAuth(ctx) {
  if (!ctx.isGroup) return { ok: false, reason: "Solo grupos." };
  const metadata = await getMetadata(ctx);
  const sender = findParticipant(metadata, [
    ctx.sender,
    ctx.raw.key?.participant,
    ctx.raw.participant,
    ctx.raw.participantPn,
    ctx.raw.participantLid,
  ]);
  return {
    ok: isAdminParticipant(sender),
    reason: "Solo administradores.",
    metadata,
    botIsAdmin: await isBotAdmin(ctx.getGroupMetadata, ctx.botJid, ctx.botLid),
  };
}

function senderIds(ctx) {
  return [
    ctx.sender,
    ctx.raw.key?.participant,
    ctx.raw.participant,
    ctx.raw.participantPn,
    ctx.raw.participantLid,
  ].filter(Boolean);
}

function mutedTarget(group, ctx) {
  return Object.keys(group.muted).find((target) =>
    senderIds(ctx).some((sender) => sameParticipant(target, sender)),
  );
}

function mentionedJid(ctx) {
  const quoted = ctx.raw.message?.extendedTextMessage?.contextInfo;
  const fromQuote = quoted?.participant;
  const fromMention = quoted?.mentionedJid?.[0];
  const fromArg = ctx.args?.[0];
  return cleanJid(fromQuote || fromMention || (fromArg?.includes("@") ? fromArg : jidFromNumber(fromArg)));
}

function quotedKey(ctx) {
  const info = ctx.raw.message?.extendedTextMessage?.contextInfo;
  if (!info?.stanzaId) return null;

  return {
    remoteJid: info.remoteJid || ctx.raw.key?.remoteJid,
    id: info.stanzaId,
    participant: info.participant,
  };
}

async function safeDelete(ctx, key) {
  if (!key) return false;
  try {
    await ctx.deleteMessage(key);
    return true;
  } catch (err) {
    console.warn("[moderation] Baileys no pudo eliminar mensaje:", err?.message || err);
    return false;
  }
}

function addWarning(store, ctx, target, reason, source = "manual") {
  const group = store.group(ctx.phone);
  const current = group.warnings[target] || { count: 0, reasons: [] };
  current.count += 1;
  current.reasons.push({ at: new Date().toISOString(), reason, source, by: ctx.sender });
  group.warnings[target] = current;
  store.log({ type: "warning", group: ctx.phone, target, by: ctx.sender, reason, source });
  return current.count;
}

function trackSpam(config, sender) {
  const now = Date.now();
  const bucket = buckets.get(sender) || [];
  const fresh = bucket.filter((stamp) => now - stamp <= config.spamWindowMs);
  fresh.push(now);
  buckets.set(sender, fresh);
  return fresh.length;
}

function makeHandler(config, store) {
  return async (ctx) => {
    const command = ctx.command;
    const group = store.group(ctx.phone);
    const metadata = await getMetadata(ctx);
    const senderProtected = isProtectedJid(ctx.sender, ctx, metadata);

    if (!senderProtected && group.blacklist[ctx.sender]) {
      store.log({ type: "blacklist-hit", group: ctx.phone, sender: ctx.sender, text: ctx.text });
      await safeDelete(ctx, ctx.raw.key);
      return null;
    }

    const muteTarget = mutedTarget(group, ctx);
    if (!senderProtected && muteTarget) {
      store.log({ type: "mute-hit", group: ctx.phone, sender: ctx.sender, target: muteTarget, text: ctx.text });
      await safeDelete(ctx, ctx.raw.key);
      return null;
    }

    if (!ctx.isCommand && !senderProtected) {
      const spamCount = trackSpam(config, `${ctx.phone}:${ctx.sender}`);
      if (spamCount > config.spamMaxMessages) {
        const warnings = addWarning(store, ctx, ctx.sender, "anti spam", "anti-spam");
        if (config.autoDeleteSpam) await safeDelete(ctx, ctx.raw.key);
        return `Anti spam: ${ctx.name} acumula ${warnings} warning(s).`;
      }
    }

    if (command === "del") {
      const targetKey = quotedKey(ctx);
      const deletedTarget = await safeDelete(ctx, targetKey);
      await safeDelete(ctx, ctx.raw.key);
      store.log({ type: "delete", group: ctx.phone, by: ctx.sender, target: targetKey?.id, ok: deletedTarget });
      return deletedTarget ? null : "No pude eliminar el mensaje citado.";
    }

    if (command === "delme") {
      const ok = await safeDelete(ctx, ctx.raw.key);
      store.log({ type: "delete-self", group: ctx.phone, by: ctx.sender, ok });
      return ok ? null : "No pude eliminar tu mensaje.";
    }

    if (command === "warn") {
      const target = mentionedJid(ctx);
      if (!target) return "Responde o menciona al usuario para advertirlo.";
      if (isProtectedJid(target, ctx, metadata)) return "Ese usuario esta protegido por el creador.";
      const reason = (ctx.args || []).slice(1).join(" ") || "sin motivo";
      const total = addWarning(store, ctx, target, reason);
      return `Warning para ${target}. Total: ${total}.`;
    }

    if (command === "warnings") {
      const target = mentionedJid(ctx) || ctx.sender;
      const warnings = group.warnings[target]?.count || 0;
      return `${target} tiene ${warnings} warning(s).`;
    }

    if (command === "blacklist") {
      const target = mentionedJid(ctx);
      if (!target) return "Responde o menciona al usuario para agregarlo a blacklist.";
      if (isProtectedJid(target, ctx, metadata)) return "Ese usuario esta protegido por el creador.";
      group.blacklist[target] = { by: ctx.sender, at: new Date().toISOString() };
      store.log({ type: "blacklist-add", group: ctx.phone, by: ctx.sender, target });
      return `${target} agregado a blacklist.`;
    }

    if (command === "unblacklist") {
      const target = mentionedJid(ctx);
      if (!target) return "Responde o menciona al usuario para quitarlo de blacklist.";
      delete group.blacklist[target];
      store.log({ type: "blacklist-remove", group: ctx.phone, by: ctx.sender, target });
      return `${target} eliminado de blacklist.`;
    }

    if (command === "mute") {
      if (!ctx.isGroup) return "Mute solo aplica en grupos.";
      const auth = await getGroupAuth(ctx);
      if (!auth.ok) return auth.reason;

      const target = mentionedJid(ctx);
      if (!target) return "Responde o menciona al usuario para mutearlo.";
      if (isProtectedJid(target, ctx, auth.metadata || metadata)) return "Ese usuario esta protegido por el creador.";
      if (!auth.botIsAdmin) return "El bot necesita ser admin para borrar mensajes del usuario muteado.";

      group.muted[target] = { by: ctx.sender, at: new Date().toISOString() };
      store.log({ type: "mute", group: ctx.phone, by: ctx.sender, target });
      return `${target} muteado. Sus mensajes se borraran si Baileys y los permisos del grupo lo permiten.`;
    }

    if (command === "unmute") {
      if (!ctx.isGroup) return "Unmute solo aplica en grupos.";
      const auth = await getGroupAuth(ctx);
      if (!auth.ok) return auth.reason;

      const target = mentionedJid(ctx);
      if (!target) return "Responde o menciona al usuario para desmutearlo.";
      delete group.muted[target];
      store.log({ type: "unmute", group: ctx.phone, by: ctx.sender, target });
      return `${target} eliminado de la lista mute.`;
    }

    if (command === "modlogs") {
      const recent = store.state.logs
        .filter((entry) => entry.group === ctx.phone)
        .slice(-5)
        .map((entry) => `- ${entry.at} ${entry.type} ${entry.target || entry.sender || ""}`.trim());
      return recent.length ? recent.join("\n") : "Sin logs de moderacion para este chat.";
    }

    return null;
  };
}

export const moderationPlugin = {
  name: "moderation",
  version: "1.0.0",
  register(router, options = {}) {
    const config = { ...DEFAULT_CONFIG, ...options };
    const store = new ModerationStore(config.statePath);
    router.register(makeHandler(config, store), {
      category: "MODERACION",
      commands: ["del", "delme", "warn", "warnings", "blacklist", "unblacklist", "mute", "unmute", "modlogs"],
    });
  },
};
