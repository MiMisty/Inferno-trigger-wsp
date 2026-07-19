import { Connection } from "./core/connection.js";
import { Router } from "./core/router.js";
import { downloadMediaMessage } from "@whiskeysockets/baileys";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { cleanJid } from "./utils/jid.js";
import { scanAllGroups, handleGroupUpdate } from "./utils/autoPromote.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dirname, "modules", "moderation", "data", "state.json");
import { antiNsfwPlugin } from "./modules/anti_nsfw/index.js";
import { aiPlugin } from "./modules/ai/index.js";
import { casinoPlugin } from "./modules/casino/index.js";
import { economyPlugin } from "./modules/economy/index.js";
import { groupAdminPlugin, handleGroupParticipantsUpdate } from "./modules/group_admin/index.js";
import { helpPlugin } from "./modules/help/index.js";
import { levelsPlugin } from "./modules/levels/index.js";
import { moderationPlugin } from "./modules/moderation/index.js";
import { ownerPlugin } from "./modules/owner/index.js";
import { stickersPlugin } from "./modules/stickers/index.js";

const AUTH_PATH = "../bridge/auth";

function readPrefix() {
  if (process.env.PREFIX) return process.env.PREFIX;
  const envPath = existsSync(".env") ? ".env" : existsSync("../.env") ? "../.env" : null;
  if (!envPath) return "!";
  const line = readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith("PREFIX="));
  return line?.split("=").slice(1).join("=").trim() || "!";
}

const PREFIX = readPrefix();

const connection = new Connection(AUTH_PATH);
const router = new Router({ prefix: PREFIX });

const coreCommandsPlugin = {
  name: "core-commands",
  version: "1.0.0",
  register(pluginRouter) {
    pluginRouter.register((ctx) => {
      if (!ctx.isCommand) return null;
      const { text, name, phone } = ctx;

      if (ctx.command === "ping") {
        return "Pong!";
      }

      if (ctx.command === "hola") {
        return `Hola ${name}!`;
      }

      if (ctx.command === "echo") {
        return ctx.args.join(" ");
      }

      if (ctx.command === "info") {
        return [
          "*BandalandBot*",
          "",
          `Telefono: ${phone}`,
          `Nombre: ${name}`,
          `Grupo: ${ctx.isGroup ? "Si" : "No"}`,
        ].join("\n");
      }

      return null;
    }, {
      category: "BASE",
      commands: ["ping", "hola", "echo", "info"],
    });
  },
};

router.registerPlugin(groupAdminPlugin);
router.registerPlugin(ownerPlugin);
router.registerPlugin(aiPlugin);
router.registerPlugin(antiNsfwPlugin);
router.registerPlugin(moderationPlugin);
router.registerPlugin(stickersPlugin);
router.registerPlugin(levelsPlugin);
router.registerPlugin(economyPlugin);
router.registerPlugin(casinoPlugin);
router.registerPlugin(helpPlugin);
router.registerPlugin(coreCommandsPlugin);

connection.on("ready", (user) => {
  console.log(`[bot] Conectado como: ${cleanJid(user.id)}`);
  connection.sendMessage(user.id, "Bot iniciado correctamente");

  connection.sock?.ev?.on("group-participants.update", (update) => {
    handleGroupParticipantsUpdate(update, {
      sendMessage: (jid, content) => connection.sendMessage(jid, content),
    }).catch((err) => console.error("[group_admin] Error en welcome/bye:", err));
  });

  connection.sock?.ev?.on("group-participants.update", (update) => {
    handleGroupUpdate(update, {
      getGroupMetadata: (jid) => connection.sock?.groupMetadata(jid),
      updateParticipants: (jid, participants, action) =>
        connection.sock?.groupParticipantsUpdate(jid, participants, action),
      botJid: connection.sock?.user?.id,
      botLid: connection.sock?.user?.lid,
    }).catch((err) => console.error("[autoPromote] Error en evento de grupo:", err));
  });

  scanAllGroups({
    getGroupMetadataAll: () => connection.sock?.groupFetchAllParticipating(),
    getGroupMetadata: (jid) => connection.sock?.groupMetadata(jid),
    updateParticipants: (jid, participants, action) =>
      connection.sock?.groupParticipantsUpdate(jid, participants, action),
    botJid: connection.sock?.user?.id,
    botLid: connection.sock?.user?.lid,
  }).catch((err) => console.error("[autoPromote] Error en escaneo inicial:", err));
});

connection.on("message", async (msg) => {
  if (msg.message?.stickerMessage && msg.key?.remoteJid?.endsWith("@g.us")) {
    const phone = cleanJid(msg.key.remoteJid);
    const sender = cleanJid(msg.key.participant || msg.key.remoteJid);
    try {
      const raw = readFileSync(STATE_PATH, "utf8");
      const state = JSON.parse(raw);
      if (state.muted?.[phone]?.[sender]) {
        await connection.sendMessage(msg.key.remoteJid, { delete: msg.key });
        return;
      }
    } catch (e) {
      /* state file not available */
    }
  }

  const reply = await router.route(msg, {
    sendMessage: (jid, content) => connection.sendMessage(jid, content),
    deleteMessage: (jid, key) => connection.sock?.sendMessage(jid, { delete: key }),
    getGroupMetadata: (jid) => connection.sock?.groupMetadata(jid),
    updateGroupSetting: (jid, setting) => connection.sock?.groupSettingUpdate(jid, setting),
    updateParticipants: (jid, participants, action) =>
      connection.sock?.groupParticipantsUpdate(jid, participants, action),
    inviteCode: (jid) => connection.sock?.groupInviteCode(jid),
    revokeInvite: (jid) => connection.sock?.groupRevokeInvite(jid),
    leaveGroup: (jid) => connection.sock?.groupLeave(jid),
    shutdown: async () => {
      await connection.disconnect();
      process.exit(0);
    },
    botJid: connection.sock?.user?.id,
    botLid: connection.sock?.user?.lid,
    downloadMedia: (message) =>
      downloadMediaMessage(
        message,
        "buffer",
        {},
        {
          logger: console,
          reuploadRequest: (message) => connection.sock?.updateMediaMessage(message),
        },
      ),
  });

  if (reply) {
    const jid = msg.key.remoteJid;
    await connection.sendMessage(jid, reply);
  }
});

connection.on("qr", (qr) => {
  console.log("[bot] QR recibido. Escanea con WhatsApp.");
});

process.on("SIGINT", async () => {
  console.log("\n[bot] Cerrando conexion...");
  await connection.disconnect();
  process.exit(0);
});

await connection.connect();
