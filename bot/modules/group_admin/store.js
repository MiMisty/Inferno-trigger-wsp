import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

const DEFAULT_STATE = {
  groups: {},
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export class GroupAdminStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = this._load();
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return cloneDefaultState();
      return { ...cloneDefaultState(), ...JSON.parse(readFileSync(this.filePath, "utf8")) };
    } catch (err) {
      console.error("[group_admin] No se pudo cargar estado:", err);
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
        muted: false,
        antilink: false,
        welcome: false,
        welcomeText: "Bienvenido {user}",
        byeText: "Adios {user}",
        warnings: {},
      };
    }
    return this.state.groups[jid];
  }
}
