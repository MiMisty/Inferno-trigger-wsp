import { animatedToSticker, gifToSticker, imageToSticker } from "./processor.js";
import { stickerSendOptions } from "./metadata.js";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { mkdir, rm, writeFile } from "fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

const COMMANDS = new Set(["sticker", "s", "stiker"]);
const DEBUG_DIR = join(__dirname, "data");

function commandFrom(text) {
  return text.trim().split(/\s+/)[0].toLowerCase();
}

function mediaContentFrom(message = {}) {
  if (message.imageMessage) {
    return { mediaType: "image", mimetype: message.imageMessage.mimetype || "image/jpeg" };
  }

  if (message.videoMessage) {
    return {
      mediaType: message.videoMessage.gifPlayback ? "gif" : "video",
      mimetype: message.videoMessage.mimetype || "video/mp4",
    };
  }

  if (message.documentMessage?.mimetype?.startsWith("image/")) {
    return { mediaType: "image", mimetype: message.documentMessage.mimetype };
  }

  if (message.documentMessage?.mimetype?.startsWith("video/")) {
    return { mediaType: "video", mimetype: message.documentMessage.mimetype };
  }

  return null;
}

function quotedMediaMessage(ctx) {
  const info = ctx.raw.message?.extendedTextMessage?.contextInfo;
  if (!info?.quotedMessage) return null;

  return {
    key: {
      remoteJid: info.remoteJid || ctx.phone,
      participant: info.participant,
      id: info.stanzaId,
    },
    message: info.quotedMessage,
  };
}

function selectMediaSource(ctx) {
  const direct = mediaContentFrom(ctx.raw.message);
  if (direct) return { message: ctx.raw, ...direct };

  const quoted = quotedMediaMessage(ctx);
  const quotedMedia = mediaContentFrom(quoted?.message);
  if (quoted && quotedMedia) return { message: quoted, ...quotedMedia };

  return null;
}

async function makeSticker(ctx, source) {
  const media = await ctx.downloadMedia(source.message);

  if (source.mediaType === "image" && !source.mimetype.includes("gif")) {
    return imageToSticker(media);
  }

  if (source.mimetype.includes("gif")) {
    return gifToSticker(media);
  }

  return animatedToSticker(media, {
    mediaType: source.mediaType,
    mimetype: source.mimetype,
  });
}

async function sendSticker(ctx, sticker) {
  await mkdir(DEBUG_DIR, { recursive: true });

  const debugPath = join(DEBUG_DIR, "last-sticker.webp");
  const tmpPath = join(DEBUG_DIR, `sticker-${Date.now()}-${Math.random().toString(36).slice(2)}.webp`);

  await writeFile(debugPath, sticker);
  await writeFile(tmpPath, sticker);

  try {
    await ctx.sendMessage({
      sticker: { url: tmpPath },
      mimetype: "image/webp",
      ...stickerSendOptions,
    });
  } finally {
    await rm(tmpPath, { force: true });
  }
}

function makeHandler() {
  return async (ctx) => {
    if (!ctx.isCommand || !COMMANDS.has(ctx.command)) return null;

    const source = selectMediaSource(ctx);
    if (!source) {
      return `Envia una imagen/video/GIF con ${ctx.prefix}sticker o responde a una media.`;
    }

    try {
      const sticker = await makeSticker(ctx, source);
      await sendSticker(ctx, sticker);
      return null;
    } catch (err) {
      console.error("[stickers] Error creando sticker:", err);
      return `No pude crear el sticker: ${err.message || "error desconocido"}`;
    }
  };
}

export const stickersPlugin = {
  name: "stickers",
  version: "1.0.0",
  register(router) {
    router.register(makeHandler(), {
      category: "STICKERS",
      commands: [...COMMANDS],
    });
  },
};
