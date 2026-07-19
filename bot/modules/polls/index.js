const COMMANDS = ["encuesta", "poll"];

function parsePollArgs(text = "") {
  const parts = text
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  const question = parts.shift() || "";
  const options = [...new Set(parts)].slice(0, 12);
  return { question, options };
}

function usage(ctx) {
  return [
    `Usa ${ctx.prefix}encuesta Pregunta | Opcion 1 | Opcion 2`,
    `Ejemplo: ${ctx.prefix}encuesta Que jugamos? | Free Fire | Roblox | Minecraft`,
  ].join("\n");
}

function makeHandler() {
  return async (ctx) => {
    if (!ctx.isCommand || !COMMANDS.includes(ctx.command)) return null;

    const raw = (ctx.args || []).join(" ").trim();
    const { question, options } = parsePollArgs(raw);

    if (!question || options.length < 2) return usage(ctx);
    if (question.length > 250) return "La pregunta es demasiado larga.";
    if (options.some((option) => option.length > 100)) return "Cada opcion debe tener menos de 100 caracteres.";

    await ctx.sendMessage({
      poll: {
        name: question,
        values: options,
        selectableCount: 1,
      },
    });
    return null;
  };
}

export const pollsPlugin = {
  name: "polls",
  version: "1.0.0",
  register(router) {
    router.register(makeHandler(), {
      category: "UTILIDADES",
      commands: COMMANDS,
    });
  },
};
