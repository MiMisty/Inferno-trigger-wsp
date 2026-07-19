import { getEconomyApi } from "../economy/index.js";

const BJ_SESSIONS = new Map();
const SLOT_SYMBOLS = ["A", "B", "C", "D", "7"];

function parts(ctx) {
  return [ctx.command, ...(ctx.args || [])];
}

function amountFrom(value) {
  const amount = Number.parseInt(value, 10);
  return Number.isFinite(amount) ? amount : 0;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function sessionKey(ctx) {
  return `${ctx.phone}:${ctx.sender}`;
}

function card() {
  const value = Math.floor(Math.random() * 13) + 1;
  if (value === 1) return 11;
  if (value > 10) return 10;
  return value;
}

function score(hand) {
  let total = hand.reduce((sum, value) => sum + value, 0);
  let aces = hand.filter((value) => value === 11).length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function settle(api, ctx, amount, multiplier, game, detail) {
  const result = api.settleBet(ctx.sender, amount, multiplier, { game, group: ctx.phone });
  if (!result.ok) return result.reason;

  const outcome = multiplier === 0 ? "Perdiste." : multiplier === 1 ? "Empate." : `Pago ${api.money(result.payout)}.`;
  return `${detail} ${outcome} Balance: ${api.money(result.balance)}.`;
}

function coinflip(api, ctx, amount) {
  const win = Math.random() < 0.5;
  return settle(api, ctx, amount, win ? 2 : 0, "coinflip", win ? "Cara." : "Cruz.");
}

function dice(api, ctx, amount) {
  const roll = Math.floor(Math.random() * 6) + 1;
  return settle(api, ctx, amount, roll >= 4 ? 2 : 0, "dice", `Dado: ${roll}.`);
}

function roulette(api, ctx, amount, choice) {
  if (!["rojo", "negro"].includes(choice)) return `Usa ${ctx.prefix}roulette <cantidad> <rojo|negro>.`;
  const result = Math.random() < 0.5 ? "rojo" : "negro";
  return settle(api, ctx, amount, result === choice ? 2 : 0, "roulette", `Salio ${result}.`);
}

function slots(api, ctx, amount) {
  const roll = [pick(SLOT_SYMBOLS), pick(SLOT_SYMBOLS), pick(SLOT_SYMBOLS)];
  const unique = new Set(roll).size;
  const multiplier = unique === 1 ? (roll[0] === "7" ? 5 : 3) : unique === 2 ? 1.5 : 0;
  return settle(api, ctx, amount, multiplier, "slots", roll.join(" "));
}

function startBlackjack(api, ctx, amount) {
  if (api.balance(ctx.sender) < amount) return "Saldo insuficiente.";

  const player = [card(), card()];
  const dealer = [card(), card()];
  BJ_SESSIONS.set(sessionKey(ctx), { amount, player, dealer });

  const total = score(player);
  if (total === 21) {
    BJ_SESSIONS.delete(sessionKey(ctx));
    return settle(api, ctx, amount, 2.5, "blackjack", "Blackjack.");
  }

  return `BJ ${player.join(",")} = ${total}. Dealer: ${dealer[0]}. ${ctx.prefix}hit/${ctx.prefix}stand`;
}

function finishBlackjack(api, ctx, session, stood = false) {
  const playerTotal = score(session.player);
  if (playerTotal > 21) {
    BJ_SESSIONS.delete(sessionKey(ctx));
    return settle(api, ctx, session.amount, 0, "blackjack", `BJ ${playerTotal}.`);
  }

  while (score(session.dealer) < 17) session.dealer.push(card());

  const dealerTotal = score(session.dealer);
  const multiplier = dealerTotal > 21 || playerTotal > dealerTotal ? 2 : playerTotal === dealerTotal ? 1 : 0;
  BJ_SESSIONS.delete(sessionKey(ctx));

  return settle(
    api,
    ctx,
    session.amount,
    multiplier,
    "blackjack",
    `Tu ${playerTotal}. Dealer ${dealerTotal}.${stood ? "" : ""}`,
  );
}

function blackjack(api, ctx, args) {
  const key = sessionKey(ctx);
  const action = ctx.command;
  const session = BJ_SESSIONS.get(key);

  if (action === "hit") {
    if (!session) return "No hay blackjack activo.";
    session.player.push(card());
    const total = score(session.player);
    return total > 21 ? finishBlackjack(api, ctx, session) : `BJ ${session.player.join(",")} = ${total}. ${ctx.prefix}hit/${ctx.prefix}stand`;
  }

  if (action === "stand") {
    if (!session) return "No hay blackjack activo.";
    return finishBlackjack(api, ctx, session, true);
  }

  const amount = amountFrom(args[1]);
  if (amount <= 0) return `Usa ${ctx.prefix}blackjack <cantidad>.`;
  if (session) return "Termina tu blackjack actual.";
  return startBlackjack(api, ctx, amount);
}

function makeHandler(options) {
  const api = getEconomyApi(options.economy);

  return async (ctx) => {
    if (!ctx.isCommand) return null;
    const args = parts(ctx);
    const command = ctx.command;
    const amount = amountFrom(args[1]);

    if (command === "hit" || command === "stand" || command === "blackjack") {
      return blackjack(api, ctx, args);
    }

    if (!["coinflip", "dice", "slots", "roulette"].includes(command)) return null;
    if (amount <= 0) return `Usa ${ctx.prefix}${command} <cantidad>.`;

    if (command === "coinflip") return coinflip(api, ctx, amount);
    if (command === "dice") return dice(api, ctx, amount);
    if (command === "slots") return slots(api, ctx, amount);
    if (command === "roulette") return roulette(api, ctx, amount, args[2]?.toLowerCase());

    return null;
  };
}

export const casinoPlugin = {
  name: "casino",
  version: "1.0.0",
  register(router, options = {}) {
    router.register(makeHandler(options), {
      category: "CASINO",
      commands: ["coinflip", "dice", "slots", "blackjack", "roulette", "hit", "stand"],
    });
  },
};
