import {
  addProtectedTarget,
  botNumbers,
  creatorNumbers,
  extraProtectedEntries,
  isCreatorJid,
  jidFromNumber,
  removeProtectedTarget,
} from "../../utils/owner.js";

const COMMANDS = [
  "creador",
  "owner",
  "ownerid",
  "ownerprotect",
  "protect",
  "proteger",
  "unprotect",
  "desproteger",
  "protected",
  "protegidos",
  "botuptime",
  "botoff",
  "apagarbot",
  "salirgrupo",
  "leavegroup",
];

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}h ${minutes}m ${rest}s`;
}

async function isCreator(ctx) {
  const metadata = ctx.isGroup ? await ctx.getGroupMetadata().catch(() => null) : null;
  return isCreatorJid(ctx.sender, metadata);
}

function senderIds(ctx) {
  return [
    ctx.sender,
    ctx.raw.key?.participant,
    ctx.raw.participant,
    ctx.raw.participantPn,
    ctx.raw.participantLid,
    ctx.botJid,
    ctx.botLid,
  ].filter(Boolean);
}

function targetFrom(ctx) {
  const info = ctx.raw.message?.extendedTextMessage?.contextInfo;
  const mentioned = info?.mentionedJid?.[0];
  const quoted = info?.participant;
  const arg = ctx.args?.[0];
  return mentioned || quoted || (arg?.includes("@") ? arg : jidFromNumber(arg));
}

function mentionedJids(ctx) {
  return ctx.raw.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
}

async function mentionsCreator(ctx) {
  const metadata = ctx.isGroup ? await ctx.getGroupMetadata().catch(() => null) : null;
  return mentionedJids(ctx).some((jid) => isCreatorJid(jid, metadata));
}

function makeHandler(startedAt) {
  return async (ctx) => {
    if (!ctx.isCommand && ctx.isGroup && (await mentionsCreator(ctx)) && !(await isCreator(ctx))) {
      return "No molesten a mi creador por favor.";
    }

    if (!ctx.isCommand || !COMMANDS.includes(ctx.command)) return null;
    if (!(await isCreator(ctx))) return "Solo el creador del bot puede usar este comando.";

    if (ctx.command === "creador" || ctx.command === "owner") {
      return [
        "*Panel creador*",
        "Proteccion: activa",
        `Creador: ${creatorNumbers().join(", ")}`,
        `Bot: ${botNumbers().join(", ")}`,
        `Uptime: ${formatDuration(Date.now() - startedAt)}`,
      ].join("\n");
    }

    if (ctx.command === "ownerid") {
      return ["*IDs detectados*", ...senderIds(ctx).map((jid) => `- ${jid}`)].join("\n");
    }

    if (ctx.command === "ownerprotect") {
      const extra = extraProtectedEntries();
      return [
        "*Proteccion creador*",
        "Estos numeros no pueden ser afectados por mute, blacklist, warn, kick, antilink o Anti-NSFW.",
        `Creador: ${creatorNumbers().join(", ")}`,
        `Bot: ${botNumbers().join(", ")}`,
        `Extras: ${[...extra.numbers, ...extra.jids].join(", ") || "ninguno"}`,
      ].join("\n");
    }

    if (ctx.command === "protect" || ctx.command === "proteger") {
      const target = targetFrom(ctx);
      if (!target) return `Usa ${ctx.prefix}${ctx.command} <numero> o menciona/responde a alguien.`;

      const added = addProtectedTarget(target);
      return `Proteccion agregada: ${added.number || added.jid}.`;
    }

    if (ctx.command === "unprotect" || ctx.command === "desproteger") {
      const target = targetFrom(ctx);
      if (!target) return `Usa ${ctx.prefix}${ctx.command} <numero> o menciona/responde a alguien.`;

      const removed = removeProtectedTarget(target);
      return `Proteccion removida: ${removed.number || removed.jid}.`;
    }

    if (ctx.command === "protected" || ctx.command === "protegidos") {
      const extra = extraProtectedEntries();
      return [
        "*Protegidos*",
        `Creador: ${creatorNumbers().join(", ")}`,
        `Bot: ${botNumbers().join(", ")}`,
        `Extras: ${[...extra.numbers, ...extra.jids].join(", ") || "ninguno"}`,
      ].join("\n");
    }

    if (ctx.command === "botuptime") {
      return `Uptime: ${formatDuration(Date.now() - startedAt)}.`;
    }

    if (ctx.command === "salirgrupo" || ctx.command === "leavegroup") {
      if (!ctx.isGroup) return "Este comando solo funciona en grupos.";
      await ctx.sendMessage({ text: "Saliendo del grupo por orden del creador." });
      await ctx.leaveGroup();
      return null;
    }

    if (ctx.command === "botoff" || ctx.command === "apagarbot") {
      await ctx.sendMessage({ text: "Apagando bot por orden del creador." });
      setTimeout(() => ctx.shutdown(), 500);
      return null;
    }

    return null;
  };
}

export const ownerPlugin = {
  name: "owner",
  version: "1.0.0",
  register(router) {
    router.register(makeHandler(Date.now()), {
      category: "CREADOR",
      commands: COMMANDS,
    });
  },
};
