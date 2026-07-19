const CATEGORY_ORDER = [
  "IA",
  "CREADOR",
  "ECONOMIA",
  "CASINO",
  "STICKERS",
  "ANTI-NSFW",
  "ADMINISTRACION",
  "MODERACION",
  "NIVELES",
  "UTILIDADES",
  "BASE",
];

function title(category) {
  if (/^[A-Z0-9_-]+$/.test(category)) return category;

  return category
    .toLowerCase()
    .replace(/(^|\s)\w/g, (char) => char.toUpperCase());
}

function groupedCommands(commands) {
  const groups = new Map();
  for (const item of commands) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item.command);
  }
  return groups;
}

function sortedCategories(groups) {
  return [...groups.keys()].sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function renderMenu(ctx, commands) {
  const groups = groupedCommands(commands);
  const lines = [
    "╭━━━〔 BOT MENU 〕━━━╮",
    `┃ Prefix: ${ctx.prefix}`,
    `┃ Usuario: ${ctx.name}`,
    "┃ Modo: Publico",
    "╰━━━━━━━━━━━━━━━╯",
  ];

  for (const category of sortedCategories(groups)) {
    lines.push("", `╭─ ${title(category)}`);
    for (const command of groups.get(category)) {
      lines.push(`┃ ${ctx.prefix}${command}`);
    }
    lines.push("╰────────");
  }

  return lines.join("\n");
}

export const helpPlugin = {
  name: "help",
  version: "1.0.0",
  register(router) {
    router.register((ctx) => {
      if (!ctx.isCommand || ctx.command !== "help") return null;
      return renderMenu(ctx, router.getCommands());
    }, {
      category: "BASE",
      commands: ["help"],
    });
  },
};
