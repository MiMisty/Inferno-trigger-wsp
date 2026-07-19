import { cleanJid } from "../utils/jid.js";

export class Router {
  constructor(options = {}) {
    this._handlers = [];
    this._plugins = [];
    this.prefix = options.prefix || "!";
    this._commands = [];
  }

  register(handler, meta = {}) {
    this._handlers.push({ handler, meta });
    if (Array.isArray(meta.commands)) {
      const category = meta.category || meta.plugin || "General";
      for (const command of meta.commands) {
        this._commands.push({
          command: String(command).replace(/^[!/]+/, ""),
          category,
          plugin: meta.plugin || "core",
        });
      }
    }
  }

  registerPlugin(plugin, options = {}) {
    if (!plugin?.name || typeof plugin.register !== "function") {
      throw new Error("[router] Plugin invalido: debe exponer name y register(api)");
    }

    const api = {
      register: (handler, meta = {}) =>
        this.register(handler, { ...meta, plugin: plugin.name }),
      getCommands: () => this.getCommands(),
      prefix: this.prefix,
    };

    plugin.register(api, options);
    this._plugins.push({ name: plugin.name, version: plugin.version || "0.0.0" });
    console.log(`[router] Plugin registrado: ${plugin.name}`);
  }

  async route(msg, services = {}) {
    if (!msg.message) return null;

    const rawJid = msg.key.remoteJid || "";
    const phone = cleanJid(rawJid);
    const sender = cleanJid(msg.key.participant || rawJid);

    const fullJid = (jid) => (jid && !jid.includes("@") ? `${jid}@s.whatsapp.net` : jid);
    const text = this._extractText(msg.message);
    if (msg.key?.fromMe && !text.trim().startsWith(this.prefix)) return null;

    const input = this._parseInput(text);
    const name = msg.pushName || sender;
    const isGroup = rawJid.endsWith("@g.us");
    const mediaType = this._extractMediaType(msg.message);

    if (!text && !mediaType) return null;

    const context = {
      phone,
      sender,
      text,
      prefix: this.prefix,
      isCommand: input.isCommand,
      command: input.command,
      args: input.args,
      name,
      isGroup,
      mediaType,
      raw: msg,
      services,
      sendMessage: async (content) => services.sendMessage?.(rawJid, content),
      reply: async (content) => services.sendMessage?.(rawJid, content),
      deleteMessage: async (key) => services.deleteMessage?.(rawJid, key),
      downloadMedia: async (message = msg) => services.downloadMedia?.(message),
      getGroupMetadata: async () => services.getGroupMetadata?.(rawJid),
      updateGroupSetting: async (setting) => services.updateGroupSetting?.(rawJid, setting),
      updateParticipants: async (participants, action) => services.updateParticipants?.(rawJid, participants.map(fullJid), action),
      inviteCode: async () => services.inviteCode?.(rawJid),
      revokeInvite: async () => services.revokeInvite?.(rawJid),
      leaveGroup: async () => services.leaveGroup?.(rawJid),
      shutdown: async () => services.shutdown?.(),
      botJid: services.botJid,
      botLid: services.botLid,
    };

    for (const { handler, meta } of this._handlers) {
      try {
        const reply = await handler(context);
        if (reply) return reply;
      } catch (err) {
        const source = meta?.plugin || "handler";
        console.error(`[router] Error en ${source}:`, err);
      }
    }

    return null;
  }

  getCommands() {
    const seen = new Set();
    return this._commands.filter((item) => {
      const key = `${item.category}:${item.command}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _parseInput(text) {
    const raw = text.trim();
    if (!raw.startsWith(this.prefix)) {
      return { isCommand: false, command: null, args: [] };
    }

    const parts = raw.slice(this.prefix.length).trim().split(/\s+/).filter(Boolean);
    return {
      isCommand: true,
      command: parts[0]?.toLowerCase() || null,
      args: parts.slice(1),
    };
  }

  _extractText(message) {
    return (
      message.conversation ||
      message.extendedTextMessage?.text ||
      message.imageMessage?.caption ||
      message.videoMessage?.caption ||
      message.documentMessage?.caption ||
      ""
    );
  }

  _extractMediaType(message) {
    if (message.imageMessage) return "image";
    if (message.videoMessage) return message.videoMessage.gifPlayback ? "gif" : "video";
    if (message.documentMessage?.mimetype?.startsWith("image/")) return "image";
    if (message.documentMessage?.mimetype?.startsWith("video/")) return "video";
    return null;
  }
}
