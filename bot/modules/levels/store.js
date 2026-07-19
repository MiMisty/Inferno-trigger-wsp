import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

const DEFAULT_STATE = {
  users: {},
  events: [],
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export class LevelsStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this._load();
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return cloneDefaultState();
      return { ...cloneDefaultState(), ...JSON.parse(readFileSync(this.filePath, "utf8")) };
    } catch (err) {
      console.error("[levels] No se pudo cargar estado, usando estado limpio:", err);
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
        xp: 0,
        level: 1,
        messages: 0,
        lastXpAt: 0,
        createdAt: new Date().toISOString(),
      };
    }

    return this.state.users[jid];
  }

  updateProfile(jid, profile = {}) {
    const user = this.user(jid);
    const name = String(profile.name || "").trim();
    if (name && !name.includes("@")) user.name = name.slice(0, 80);
    user.updatedAt = new Date().toISOString();
    return user;
  }

  rankedUsers() {
    return Object.entries(this.state.users)
      .map(([jid, user]) => ({ jid, ...user }))
      .sort((a, b) => b.level - a.level || b.xp - a.xp || b.messages - a.messages);
  }

  log(entry) {
    this.state.events.push({ at: new Date().toISOString(), ...entry });
    this.state.events = this.state.events.slice(-1000);
  }
}
