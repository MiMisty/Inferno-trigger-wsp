import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

const DEFAULT_STATE = {
  users: {},
  transactions: [],
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export class EconomyStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this._load();
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return cloneDefaultState();
      return { ...cloneDefaultState(), ...JSON.parse(readFileSync(this.filePath, "utf8")) };
    } catch (err) {
      console.error("[economy] No se pudo cargar estado, usando estado limpio:", err);
      return cloneDefaultState();
    }
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    renameSync(tmpPath, this.filePath);
  }

  user(jid) {
    if (!this.state.users[jid]) {
      this.state.users[jid] = {
        balance: 0,
        inventory: {},
        cooldowns: {},
        createdAt: new Date().toISOString(),
      };
    }

    return this.state.users[jid];
  }

  addBalance(jid, amount, reason, meta = {}) {
    const user = this.user(jid);
    user.balance = Math.max(0, Number(user.balance || 0) + amount);
    this.log({ type: "balance", jid, amount, reason, ...meta });
    this.save();
    return user.balance;
  }

  transfer(from, to, amount) {
    const sender = this.user(from);
    const receiver = this.user(to);

    if (amount <= 0) return { ok: false, reason: "Monto invalido." };
    if (sender.balance < amount) return { ok: false, reason: "Fondos insuficientes." };

    sender.balance -= amount;
    receiver.balance += amount;
    this.log({ type: "transfer", from, to, amount });
    this.save();

    return { ok: true, fromBalance: sender.balance, toBalance: receiver.balance };
  }

  addItem(jid, itemId, quantity = 1) {
    const user = this.user(jid);
    user.inventory[itemId] = (user.inventory[itemId] || 0) + quantity;
    this.save();
    return user.inventory[itemId];
  }

  log(entry) {
    this.state.transactions.push({ at: new Date().toISOString(), ...entry });
    this.state.transactions = this.state.transactions.slice(-1000);
  }
}
