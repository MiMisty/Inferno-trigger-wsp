import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname } from "path";

const DEFAULT_STATE = {
  chats: {},
  logs: [],
};

function cloneDefaultState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

export class AiStore {
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.maxHistoryMessages = options.maxHistoryMessages || 8;
    this.maxStoredMessages = options.maxStoredMessages || 1200;
    this.messageRetentionMs = options.messageRetentionMs || 48 * 60 * 60 * 1000;
    this.state = this._load();
  }

  _load() {
    try {
      if (!existsSync(this.filePath)) return cloneDefaultState();
      return { ...cloneDefaultState(), ...JSON.parse(readFileSync(this.filePath, "utf8")) };
    } catch (err) {
      console.error("[ai] No se pudo cargar estado:", err);
      return cloneDefaultState();
    }
  }

  save() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    renameSync(tmpPath, this.filePath);
  }

  chat(jid) {
    if (!this.state.chats[jid]) {
      this.state.chats[jid] = {
        enabled: true,
        history: [],
        messages: [],
        updatedAt: null,
      };
    }
    if (!Array.isArray(this.state.chats[jid].messages)) this.state.chats[jid].messages = [];
    return this.state.chats[jid];
  }

  reset(jid) {
    const chat = this.chat(jid);
    chat.history = [];
    chat.updatedAt = new Date().toISOString();
    this.save();
  }

  append(jid, role, content) {
    const chat = this.chat(jid);
    chat.history.push({ role, content, at: new Date().toISOString() });
    chat.history = chat.history.slice(-this.maxHistoryMessages);
    chat.updatedAt = new Date().toISOString();
    this.save();
  }

  messages(jid) {
    return this.chat(jid).history.map((item) => ({
      role: item.role,
      content: item.content,
    }));
  }

  recordMessage(jid, message) {
    const text = String(message.text || "").trim();
    if (!text) return;

    const chat = this.chat(jid);
    chat.messages.push({
      at: message.at || new Date().toISOString(),
      sender: message.sender,
      name: message.name,
      text: text.slice(0, 1000),
    });
    this.pruneMessages(jid);
    this.save();
  }

  recentMessages(jid, sinceMs) {
    const cutoff = Date.now() - sinceMs;
    return this.chat(jid).messages.filter((message) => Date.parse(message.at) >= cutoff);
  }

  pruneMessages(jid) {
    const chat = this.chat(jid);
    const cutoff = Date.now() - this.messageRetentionMs;
    chat.messages = chat.messages
      .filter((message) => Date.parse(message.at) >= cutoff)
      .slice(-this.maxStoredMessages);
  }

  log(entry) {
    this.state.logs.push({ at: new Date().toISOString(), ...entry });
    this.state.logs = this.state.logs.slice(-500);
    this.save();
  }
}
