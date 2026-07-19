import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { GroupAdminStore } from "./store.js";
import { isBotAdmin, isProtectedJid } from "../../utils/owner.js";
import { cleanJid } from "../../utils/jid.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  statePath: join(__dirname, "data", "state.json"),
  tagChunkSize: 40,
  linkPattern: /(https?:\/\/|chat\.whatsapp\.com\/|wa\.me\/)/i,
};

const BOT_ADMIN_COMMANDS = new Set(["close", "open", "kick", "add", "promote", "demote", "link", "resetlink"]);

let sharedStore = null;
let sharedConfig = null;

function getStore(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  if (!sharedStore || sharedStore.filePath !== config.statePath) {
    sharedStore = new GroupAdminStore(config.statePath);
  }
  sharedConfig = config;
  return { store: sharedStore, config };
}

function jidFromNumber(value) {
  const number = String(value || "").replace(/\D/g, "");
  return number ? `${number}@s.whatsapp.net` : null;
}

function targetJid(ctx) {
  const info = ctx.raw.message?.extendedTextMessage?.contextInfo;
  const mentioned = info?.mentionedJid?.[0];
  const quoted = info?.participant;
  const arg = ctx.args?.[0];
  const raw = mentioned || quoted || (arg?.includes("@") ? arg : jidFromNumber(arg));
  return { raw, clean: cleanJid(raw) };
}

function resolveTargetJid(target, metadata) {
  if (!target) return null;
  const participant = metadata?.participants?.find((p) =>
    [p.id, p.jid, p.lid, p.phoneNumber && `${p.phoneNumber}@s.whatsapp.net`]
      .filter(Boolean)
      .some((id) => cleanJid(id) === cleanJid(target)),
  );
  return participant?.jid?.split("@")[0] || cleanJid(target);
}

function normalizeJid(jid = "") {
  return String(jid).replace(/:\d+(?=@)/, "").toLowerCase();
}

function jidUser(jid = "") {
  return normalizeJid(jid).split("@")[0];
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

function sameParticipant(a = "", b = "") {
  const normalizedA = normalizeJid(a);
  const normalizedB = normalizeJid(b);
  if (normalizedA === normalizedB) return true;

  const userA = jidUser(a);
  const userB = jidUser(b);
  return Boolean(userA && userB && userA === userB);
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
  return metadata.participants.find((participant) =>
    participantIds(participant).some((participantId) =>
      candidates.some((jid) => sameParticipant(participantId, jid)),
    ),
  );
}

async function getAuth(ctx) {
  if (!ctx.isGroup) return { ok: false, reason: "Solo grupos." };
  const metadata = await ctx.getGroupMetadata();
  const senderIds = [
    ctx.sender,
    ctx.raw.key?.participant,
    ctx.raw.participant,
    ctx.raw.participantPn,
    ctx.raw.participantLid,
  ].filter(Boolean);
  const sender = findParticipant(metadata, senderIds);

  if (!isAdminParticipant(sender)) return { ok: false, reason: "Solo administradores." };

  const botIsAdmin = await isBotAdmin(ctx.getGroupMetadata, ctx.botJid, ctx.botLid);

  return { ok: true, metadata, sender, botIsAdmin };
}

function needsBotAdmin(command) {
  return BOT_ADMIN_COMMANDS.has(command);
}

function commandText(ctx, skip = 0) {
  return (ctx.args || []).slice(skip).join(" ").trim();
}

async function mentionAll(ctx, metadata, visible) {
  const ids = metadata.participants.map((item) => item.id);
  const chunks = [];
  for (let i = 0; i < ids.length; i += sharedConfig.tagChunkSize) {
    chunks.push(ids.slice(i, i + sharedConfig.tagChunkSize));
  }

  for (const chunk of chunks) {
    await ctx.sendMessage({
      text: visible ? chunk.map((jid) => `@${jid.split("@")[0]}`).join(" ") : "Mensaje para todos.",
      mentions: chunk,
    });
  }

  return null;
}

function addWarning(store, ctx, jid) {
  const group = store.group(ctx.phone);
  group.warnings[jid] = (group.warnings[jid] || 0) + 1;
  store.save();
  return group.warnings[jid];
}

function makeHandler(options) {
  const { store, config } = getStore(options);

  return async (ctx) => {
    const group = store.group(ctx.phone);

    if (ctx.isGroup && group.antilink && config.linkPattern.test(ctx.text) && ctx.sender !== ctx.botJid) {
      const metadata = await ctx.getGroupMetadata().catch(() => null);
      if (isProtectedJid(ctx.sender, ctx, metadata)) return null;

      await ctx.deleteMessage(ctx.raw.key);
      const warnings = addWarning(store, ctx, ctx.sender);
      if (warnings >= 3) {
        await ctx.updateParticipants([ctx.sender], "remove").catch(() => null);
        return "Link eliminado. Usuario expulsado.";
      }
      return `Link eliminado. Warning ${warnings}/3.`;
    }

    if (ctx.isGroup && group.muted && ctx.isCommand && !["unmutechat", "help"].includes(ctx.command)) {
      const auth = await getAuth(ctx);
      if (!auth.ok) return "Grupo muteado.";
    }

    if (!ctx.isCommand) return null;

    const adminCommands = new Set([
      "close", "open", "tagall", "hidetag", "kick", "add", "promote", "demote", "link", "resetlink",
      "mutechat", "unmutechat", "antilink", "welcome", "setwelcome", "setbye", "warn", "warnings", "clearwarns",
    ]);
    if (!adminCommands.has(ctx.command)) return null;

    const auth = await getAuth(ctx);
    if (!auth.ok) return auth.reason;
    if (ctx.command === "kick" || ctx.command === "demote") {
      const { clean: targetClean } = targetJid(ctx);
      if (targetClean && isProtectedJid(targetClean, ctx, auth.metadata)) return "Ese usuario esta protegido por el creador.";
    }

    if (ctx.command === "kick") {
      const kickMetadata = await ctx.getGroupMetadata();
      const kickBotPhone = ctx.botJid?.split("@")[0]?.split(":")[0];
      const kickBotLid = ctx.botLid;

      const kickBotById = kickMetadata.participants.find((p) => p.id?.split("@")[0] === kickBotPhone);
      const kickBotByJid = kickMetadata.participants.find((p) => p.jid?.split("@")[0] === kickBotPhone);
      const kickBotByLid = kickMetadata.participants.find((p) => kickBotLid && p.lid === kickBotLid);
      const kickBot = kickBotById || kickBotByJid || kickBotByLid;

      const kickBotIsAdmin = kickBot?.admin === "admin" || kickBot?.admin === "superadmin";

      const { raw: targetRaw, clean: targetClean } = targetJid(ctx);
      console.log("SOCK USER:", ctx.botJid);
      console.log("BOT LID:", ctx.botLid);
      console.log("BOT PHONE:", kickBotPhone);
      console.log("MATCH by id:", kickBotById?.id, "admin:", kickBotById?.admin);
      console.log("MATCH by jid:", kickBotByJid?.jid, "admin:", kickBotByJid?.admin);
      console.log("MATCH by lid:", kickBotByLid?.lid, "admin:", kickBotByLid?.admin);
      console.log("PARTICIPANTS:", kickMetadata.participants.map((p) => ({ id: p.id, jid: p.jid, lid: p.lid, admin: p.admin })));
      console.log("IS ADMIN CHECK RAW RESULT:", kickBotIsAdmin);
      console.log("TARGET RAW:", targetRaw, "TARGET CLEAN:", targetClean);
      if (!kickBotIsAdmin) return "El bot necesita ser admin.";
    } else if (needsBotAdmin(ctx.command) && !auth.botIsAdmin) {
      return "El bot necesita ser admin.";
    }

    try {
      if (ctx.command === "close") {
        await ctx.updateGroupSetting("announcement");
        return "Grupo cerrado.";
      }
      if (ctx.command === "open") {
        await ctx.updateGroupSetting("not_announcement");
        return "Grupo abierto.";
      }
      if (ctx.command === "tagall") return mentionAll(ctx, auth.metadata, true);
      if (ctx.command === "hidetag") return mentionAll(ctx, auth.metadata, false);

      if (ctx.command === "kick" || ctx.command === "promote" || ctx.command === "demote") {
        const { raw: targetRaw, clean: targetClean } = targetJid(ctx);
        if (!targetClean) return "Indica un usuario.";
        if ((ctx.command === "kick" || ctx.command === "demote") && isProtectedJid(targetClean, ctx, auth.metadata)) {
          return "Ese usuario esta protegido por el creador.";
        }
        const action = ctx.command === "kick" ? "remove" : ctx.command;
        const resolvedTarget = resolveTargetJid(targetRaw, auth.metadata);
        console.log("KICK TARGET RAW:", targetRaw, "CLEAN:", targetClean, "RESOLVED:", resolvedTarget);
        await ctx.updateParticipants([resolvedTarget], action);
        return "Listo.";
      }

      if (ctx.command === "add") {
        const target = jidFromNumber(ctx.args?.[0]);
        if (!target) return "Indica un numero.";
        await ctx.updateParticipants([target], "add");
        return "Invitacion enviada.";
      }

      if (ctx.command === "link") {
        const code = await ctx.inviteCode();
        return `https://chat.whatsapp.com/${code}`;
      }
      if (ctx.command === "resetlink") {
        await ctx.revokeInvite();
        const code = await ctx.inviteCode();
        return `Nuevo link: https://chat.whatsapp.com/${code}`;
      }
    } catch (err) {
      console.warn("[group_admin] Accion rechazada por WhatsApp:", err?.message || err);
      return "No pude ejecutar. Revisa permisos del bot.";
    }
    if (ctx.command === "mutechat") {
      group.muted = true;
      store.save();
      return "Comandos muteados.";
    }
    if (ctx.command === "unmutechat") {
      group.muted = false;
      store.save();
      return "Comandos activos.";
    }
    if (ctx.command === "antilink") {
      group.antilink = ctx.args?.[0] === "on";
      store.save();
      return `Antilink ${group.antilink ? "on" : "off"}.`;
    }
    if (ctx.command === "welcome") {
      group.welcome = ctx.args?.[0] === "on";
      store.save();
      return `Welcome ${group.welcome ? "on" : "off"}.`;
    }
    if (ctx.command === "setwelcome") {
      group.welcomeText = commandText(ctx) || group.welcomeText;
      store.save();
      return "Welcome actualizado.";
    }
    if (ctx.command === "setbye") {
      group.byeText = commandText(ctx) || group.byeText;
      store.save();
      return "Bye actualizado.";
    }
    if (ctx.command === "warn") {
      const { clean: targetClean } = targetJid(ctx);
      if (!targetClean) return "Indica un usuario.";
      const metadata = await ctx.getGroupMetadata().catch(() => null);
      if (isProtectedJid(targetClean, ctx, metadata)) return "Ese usuario esta protegido por el creador.";
      return `Warnings: ${addWarning(store, ctx, targetClean)}.`;
    }
    if (ctx.command === "warnings") {
      const { clean: targetClean } = targetJid(ctx) || {};
      const target = targetClean || ctx.sender;
      return `Warnings: ${group.warnings[target] || 0}.`;
    }
    if (ctx.command === "clearwarns") {
      const { clean: targetClean } = targetJid(ctx);
      if (!targetClean) return "Indica un usuario.";
      delete group.warnings[targetClean];
      store.save();
      return "Warnings borrados.";
    }

    return null;
  };
}

export async function handleGroupParticipantsUpdate(update, services = {}, options = {}) {
  const { store } = getStore(options);
  const group = store.group(update.id);
  if (!group.welcome) return;

  for (const participant of update.participants || []) {
    const template = update.action === "remove" ? group.byeText : group.welcomeText;
    const text = template.replaceAll("{user}", `@${participant.split("@")[0]}`);
    await services.sendMessage?.(update.id, { text, mentions: [participant] });
  }
}

export const groupAdminPlugin = {
  name: "group_admin",
  version: "1.0.0",
  register(router, options = {}) {
    getStore(options);
    router.register(makeHandler(options), {
      category: "ADMINISTRACION",
      commands: [
        "close", "open", "tagall", "hidetag", "kick", "add", "promote", "demote", "link", "resetlink",
        "mutechat", "unmutechat", "antilink", "welcome", "setwelcome", "setbye", "warn", "warnings", "clearwarns",
      ],
    });
  },
};
