import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { EconomyStore } from "./store.js";
import { isCreatorJid } from "../../utils/owner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIG = {
  currencyName: "monedas",
  workCooldownMs: 60 * 60 * 1000,
  dailyCooldownMs: 24 * 60 * 60 * 1000,
  workMin: 25,
  workMax: 95,
  dailyReward: 250,
  statePath: join(__dirname, "data", "state.json"),
  shop: [
    { id: "pocion", name: "Pocion", price: 150 },
    { id: "escudo", name: "Escudo", price: 300 },
    { id: "vip", name: "Pase VIP", price: 1000 },
  ],
};

let sharedStore = null;
let sharedConfig = null;

function getEconomyContext(options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  if (!sharedStore || sharedStore.filePath !== config.statePath) {
    sharedStore = new EconomyStore(config.statePath);
  }
  sharedConfig = config;
  return { config, store: sharedStore };
}

export function getEconomyApi(options = {}) {
  const { config, store } = getEconomyContext(options);

  return {
    balance(jid) {
      return store.user(jid).balance;
    },
    money(amount) {
      return money(amount, config);
    },
    settleBet(jid, amount, payoutMultiplier, meta = {}) {
      const bet = Number.parseInt(amount, 10);
      if (!Number.isFinite(bet) || bet <= 0) {
        return { ok: false, reason: "Apuesta invalida." };
      }

      const user = store.user(jid);
      if (user.balance < bet) {
        return { ok: false, reason: "Saldo insuficiente." };
      }

      const payout = Math.floor(bet * payoutMultiplier);
      const profit = payout - bet;
      user.balance += profit;
      store.log({ type: "casino", jid, bet, payout, profit, ...meta });
      store.save();

      return { ok: true, balance: user.balance, payout, profit };
    },
  };
}

function parseTarget(ctx) {
  const info = ctx.raw.message?.extendedTextMessage?.contextInfo;
  const fromMention = info?.mentionedJid?.[0];
  const fromQuote = info?.participant;
  const arg = ctx.args?.[0];
  return fromMention || fromQuote || (arg?.includes("@") ? arg : null);
}

function parseAmount(value) {
  const amount = Number.parseInt(value, 10);
  return Number.isFinite(amount) ? amount : 0;
}

function money(amount, config) {
  return `${amount} ${config.currencyName}`;
}

function remaining(ms) {
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeHandler(config, store) {
  return async (ctx) => {
    if (!ctx.isCommand) return null;
    const parts = ctx.args || [];
    const command = ctx.command;
    const metadata = ctx.isGroup ? await ctx.getGroupMetadata().catch(() => null) : null;
    const isCreator = isCreatorJid(ctx.sender, metadata);

    if (command === "balance" || command === "bal") {
      const target = parseTarget(ctx) || ctx.sender;
      const user = store.user(target);
      return `Balance de ${target}: ${money(user.balance, config)}.`;
    }

    if (command === "work") {
      const user = store.user(ctx.sender);
      const now = Date.now();
      const lastWork = user.cooldowns.work || 0;
      const wait = config.workCooldownMs - (now - lastWork);

      if (!isCreator && wait > 0) return `Debes esperar ${remaining(wait)} para volver a trabajar.`;

      const reward = randomInt(config.workMin, config.workMax);
      if (!isCreator) user.cooldowns.work = now;
      const balance = store.addBalance(ctx.sender, reward, "work", { group: ctx.phone });
      return `Trabajaste y ganaste ${money(reward, config)}. Balance: ${money(balance, config)}.`;
    }

    if (command === "darcoins" || command === "givemoney" || command === "addmoney") {
      if (!isCreator) return "Solo el creador del bot puede usar este comando.";

      const target = parseTarget(ctx) || ctx.sender;
      const amountArg = target ? parts.find((part) => /^-?\d+$/.test(part)) : parts[0];
      const amount = parseAmount(amountArg);

      if (!target) return "Menciona o responde al usuario.";
      if (amount === 0) return "Indica un monto distinto de 0.";

      const balance = store.addBalance(target, amount, "creator-grant", { by: ctx.sender, group: ctx.phone });
      return `Listo. ${target} ahora tiene ${money(balance, config)}.`;
    }

    if (command === "daily") {
      const user = store.user(ctx.sender);
      const now = Date.now();
      const lastDaily = user.cooldowns.daily || 0;
      const wait = config.dailyCooldownMs - (now - lastDaily);

      if (wait > 0) return `Tu recompensa diaria estara lista en ${remaining(wait)}.`;

      user.cooldowns.daily = now;
      const balance = store.addBalance(ctx.sender, config.dailyReward, "daily", { group: ctx.phone });
      return `Recompensa diaria: ${money(config.dailyReward, config)}. Balance: ${money(balance, config)}.`;
    }

    if (command === "transfer" || command === "pay") {
      const target = parseTarget(ctx);
      const amountArg = target ? parts.find((part) => /^\d+$/.test(part)) : parts[0];
      const amount = parseAmount(amountArg);

      if (!target) return "Menciona o responde al usuario para transferir.";
      if (target === ctx.sender) return "No puedes transferirte a ti mismo.";
      if (amount <= 0) return "Indica un monto valido.";

      const result = store.transfer(ctx.sender, target, amount);
      if (!result.ok) return result.reason;

      return `Transferiste ${money(amount, config)} a ${target}. Tu balance: ${money(result.fromBalance, config)}.`;
    }

    if (command === "shop") {
      return [
        "Shop:",
        ...config.shop.map((item) => `- ${item.id}: ${item.name} (${money(item.price, config)})`),
        `Usa ${ctx.prefix}buy <id>.`,
      ].join("\n");
    }

    if (command === "buy") {
      const itemId = parts[0]?.toLowerCase();
      const item = config.shop.find((entry) => entry.id === itemId);

      if (!item) return `Item no encontrado. Usa ${ctx.prefix}shop.`;

      const user = store.user(ctx.sender);
      if (user.balance < item.price) return `Fondos insuficientes. Precio: ${money(item.price, config)}.`;

      user.balance -= item.price;
      store.addItem(ctx.sender, item.id, 1);
      store.log({ type: "buy", jid: ctx.sender, item: item.id, price: item.price, group: ctx.phone });
      store.save();

      return `Compraste ${item.name}. Balance: ${money(user.balance, config)}.`;
    }

    if (command === "inventory" || command === "inv") {
      const target = parseTarget(ctx) || ctx.sender;
      const user = store.user(target);
      const items = Object.entries(user.inventory);

      if (!items.length) return `${target} no tiene items en inventario.`;

      return [`Inventario de ${target}:`, ...items.map(([itemId, quantity]) => `- ${itemId} x${quantity}`)].join("\n");
    }

    return null;
  };
}

export const economyPlugin = {
  name: "economy",
  version: "1.0.0",
  register(router, options = {}) {
    const { config, store } = getEconomyContext(options);

    router.register(makeHandler(config, store), {
      category: "ECONOMIA",
      commands: ["balance", "bal", "work", "daily", "darcoins", "givemoney", "addmoney", "transfer", "pay", "shop", "buy", "inventory", "inv"],
    });
  },
};
