import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

const DEFAULT_STATE = {
  blacklist: {},
  warnings: {},
  muted: {},
  logs: [],
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export class ModerationStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this._load();
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return cloneDefaultState();
      return { ...cloneDefaultState(), ...JSON.parse(readFileSync(this.filePath, "utf8")) };
    } catch (err) {
      console.error("[moderation] No se pudo cargar estado, usando estado limpio:", err);
      return cloneDefaultState();
    }
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.state, null, 2));
  }

  group(jid) {
    for (const key of ["blacklist", "warnings", "muted"]) {
      if (!this.state[key][jid]) this.state[key][jid] = {};
    }
    return {
      blacklist: this.state.blacklist[jid],
      warnings: this.state.warnings[jid],
      muted: this.state.muted[jid],
    };
  }

  log(entry) {
    this.state.logs.push({ at: new Date().toISOString(), ...entry });
    this.state.logs = this.state.logs.slice(-500);
    this.save();
  }
}
