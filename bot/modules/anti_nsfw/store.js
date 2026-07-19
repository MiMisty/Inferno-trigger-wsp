import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

const DEFAULT_STATE = {
  groups: {},
  logs: [],
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export class AntiNsfwStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this._load();
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return cloneDefaultState();
      return { ...cloneDefaultState(), ...JSON.parse(readFileSync(this.filePath, "utf8")) };
    } catch (err) {
      console.error("[anti_nsfw] No se pudo cargar estado:", err);
      return cloneDefaultState();
    }
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    renameSync(tmpPath, this.filePath);
  }

  group(jid) {
    if (!this.state.groups[jid]) {
      this.state.groups[jid] = {
        enabled: false,
        mode: "warn",
        infractions: {},
      };
    }
    return this.state.groups[jid];
  }

  addInfraction(groupJid, userJid) {
    const group = this.group(groupJid);
    group.infractions[userJid] = (group.infractions[userJid] || 0) + 1;
    this.save();
    return group.infractions[userJid];
  }

  log(entry) {
    this.state.logs.push({ at: new Date().toISOString(), ...entry });
    this.state.logs = this.state.logs.slice(-500);
    this.save();
  }
}
