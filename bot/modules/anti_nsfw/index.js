import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { AntiNsfwStore } from "./store.js";
import { createNsfwDetector, getNsfwConfig } from "../../services/nsfw/detector.js";
import { isBotAdmin, isProtectedJid } from "../../utils/owner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  statePath: join(__dirname, "data", "state.json"),
};

const COMMANDS = ["antinsfw on", "antinsfw off", "antinsfw status", "antinsfw mode"];
const MODES = new Set(["delete", "warn", "kick"]);

function normalizeJid(jid = "") {
  return String(jid).replace(/:\d+(?=@)/, "").toLowerCase();
}

function jidUser(jid = "") {
  return normalizeJid(jid).split("@")[0];
}

function sameParticipant(a = "", b = "") {
  const normalizedA = normalizeJid(a);
  const normalizedB = normalizeJid(b);
  if (normalizedA === normalizedB) return true;

  const userA = jidUser(a);
  const userB = jidUser(b);
  return Boolean(userA && userB && userA === userB);
}

function jidFromNumber(value) {
  const number = String(value || "").replace(/\D/g, "");
  return number ? `${number}@s.whatsapp.net` : null;
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

  const metadata = await ctx.getGroupMetadata();
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

function mediaContentFrom(message = {}) {
  if (message.imageMessage) {
    return { mediaType: "image", mimetype: message.imageMessage.mimetype || "image/jpeg", message };
  }

  if (message.stickerMessage) {
    return { mediaType: "sticker", mimetype: message.stickerMessage.mimetype || "image/webp", message };
  }

  if (message.videoMessage) {
    return { mediaType: "video", mimetype: message.videoMessage.mimetype || "video/mp4", message };
  }

  if (message.documentMessage?.mimetype?.startsWith("image/")) {
    return { mediaType: "image", mimetype: message.documentMessage.mimetype, message };
  }

  if (message.documentMessage?.mimetype?.startsWith("video/")) {
    return { mediaType: "video", mimetype: message.documentMessage.mimetype, message };
  }

  return null;
}

function mediaSource(ctx) {
  const media = mediaContentFrom(ctx.raw.message);
  if (!media) return null;
  return { ...media, rawMessage: ctx.raw };
}

async function safeDelete(ctx) {
  try {
    await ctx.deleteMessage(ctx.raw.key);
    return true;
  } catch (err) {
    console.warn("[anti_nsfw] No se pudo eliminar mensaje:", err?.message || err);
    return false;
  }
}

async function safeKick(ctx, target) {
  try {
    await ctx.updateParticipants([target], "remove");
    return true;
  } catch (err) {
    console.warn("[anti_nsfw] No se pudo expulsar usuario:", err?.message || err);
    return false;
  }
}

function makeStatus(ctx, group, detectorConfig) {
  return [
    "*Anti-NSFW*",
    `Estado: ${group.enabled ? "on" : "off"}`,
    `Modo: ${group.mode}`,
    `Proveedor: ${detectorConfig.provider}`,
    `Umbral: ${detectorConfig.threshold}`,
  ].join("\n");
}

function makeHandler(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const store = new AntiNsfwStore(config.statePath);
  const detectorConfig = getNsfwConfig();
  const detector = createNsfwDetector(detectorConfig);

  return async (ctx) => {
    const group = store.group(ctx.phone);

    if (ctx.isCommand && ctx.command === "antinsfw") {
      const action = ctx.args?.[0]?.toLowerCase();
      const auth = await getGroupAuth(ctx);
      if (!auth.ok) return auth.reason;

      if (action === "on") {
        group.enabled = true;
        store.log({ type: "config", group: ctx.phone, by: ctx.sender, enabled: true });
        store.save();
        if (detectorConfig.provider === "disabled") {
          return "Anti-NSFW activado, pero falta configurar NSFW_PROVIDER.";
        }
        return `Anti-NSFW activado con proveedor ${detectorConfig.provider}.`;
      }

      if (action === "off") {
        group.enabled = false;
        store.log({ type: "config", group: ctx.phone, by: ctx.sender, enabled: false });
        store.save();
        return "Anti-NSFW desactivado.";
      }

      if (action === "status") {
        store.log({ type: "status", group: ctx.phone, by: ctx.sender });
        return makeStatus(ctx, group, detectorConfig);
      }

      if (action === "mode") {
        const mode = ctx.args?.[1]?.toLowerCase();
        if (!MODES.has(mode)) return `Usa ${ctx.prefix}antinsfw mode delete|warn|kick.`;
        group.mode = mode;
        store.log({ type: "mode", group: ctx.phone, by: ctx.sender, mode });
        store.save();
        return `Modo Anti-NSFW: ${mode}.`;
      }

      return `Usa ${ctx.prefix}antinsfw on|off|status|mode.`;
    }

    if (!ctx.isGroup || !group.enabled) return null;

    const source = mediaSource(ctx);
    if (!source) return null;
    const metadata = await ctx.getGroupMetadata().catch(() => null);
    if (isProtectedJid(ctx.sender, ctx, metadata)) return null;

    let buffer;
    try {
      buffer = await ctx.downloadMedia(source.rawMessage);
    } catch (err) {
      store.log({ type: "download-error", group: ctx.phone, by: ctx.sender, error: err?.message || String(err) });
      return null;
    }

    const result = await detector.analyze(buffer, {
      mimeType: source.mimetype,
      filename: `${source.mediaType}.${source.mimetype.split("/")[1] || "bin"}`,
    });

    store.log({
      type: "scan",
      group: ctx.phone,
      by: ctx.sender,
      mediaType: source.mediaType,
      provider: result.provider,
      score: result.score,
      nsfw: result.nsfw,
      reason: result.reason,
      skipped: result.skipped,
      error: result.error,
      cached: result.cached,
    });

    if (!result.nsfw) return null;

    const auth = await getGroupAuth(ctx);
    const infractions = store.addInfraction(ctx.phone, ctx.sender);
    const mention = `@${jidUser(ctx.sender)}`;

    if (group.mode === "delete") {
      if (!auth.botIsAdmin) return "Detecte contenido NSFW, pero el bot necesita ser admin para eliminarlo.";
      const deleted = await safeDelete(ctx);
      store.log({ type: "delete", group: ctx.phone, target: ctx.sender, ok: deleted, score: result.score });
      return deleted ? `${mention}, contenido NSFW eliminado.` : "Detecte contenido NSFW, pero no pude eliminarlo.";
    }

    if (group.mode === "kick") {
      if (infractions < detectorConfig.kickThreshold) {
        return `${mention}, advertencia Anti-NSFW ${infractions}/${detectorConfig.kickThreshold}.`;
      }

      if (!auth.botIsAdmin) return `${mention}, limite Anti-NSFW alcanzado, pero el bot necesita ser admin para expulsar.`;
      const kicked = await safeKick(ctx, ctx.sender);
      store.log({ type: "kick", group: ctx.phone, target: ctx.sender, ok: kicked, score: result.score });
      return kicked ? `${mention} expulsado por infracciones Anti-NSFW.` : `${mention}, no pude expulsarte.`;
    }

    return `${mention}, advertencia Anti-NSFW.`;
  };
}

export const antiNsfwPlugin = {
  name: "anti_nsfw",
  version: "1.0.0",
  register(router, options = {}) {
    router.register(makeHandler(options), {
      category: "ANTI-NSFW",
      commands: COMMANDS,
    });
  },
};
