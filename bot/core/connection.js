import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { EventEmitter } from "events";
import { rmSync } from "fs";

const PRESENCE_INTERVAL = 300000; // 5 min

export class Connection extends EventEmitter {
  constructor(authPath) {
    super();
    this.authPath = authPath;
    this.sock = null;
    this.reconnectAttempts = 0;
    this._presenceTimer = null;
  }

  async connect() {
    this.reconnectAttempts++;
    console.log(`[connection] Intento #${this.reconnectAttempts} - Cargando sesión desde:`, this.authPath);

    const { state, saveCreds } = await useMultiFileAuthState(this.authPath);
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`[connection] Usando versión WA: ${version.join(".")} (latest: ${isLatest})`);

    this.sock = makeWASocket({
      version,
      browser: Browsers.ubuntu("Chrome"),
      auth: state,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      generateHighQualityLinkPreview: false,
      shouldSyncHistoryMessage: () => false,
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log("\n[connection] 📱 ESCANEA EL QR CON WHATSAPP:");
        qrcode.generate(qr, { small: true });
        this.emit("qr", qr);
      }

      if (connection === "open") {
        console.log("[connection] ✅ Conectado a WhatsApp");
        this.reconnectAttempts = 0;
        this._startPresenceLoop();
        this.emit("ready", this.sock.user);
      }

      if (connection === "close") {
        this._stopPresenceLoop();
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const reason = DisconnectReason[statusCode] || statusCode || "Desconocido";
        console.log(`[connection] ❌ Desconectado. Razón: ${reason} (código: ${statusCode})`);

        if (statusCode !== DisconnectReason.loggedOut) {
          const delay = Math.min(5000 * (this.reconnectAttempts > 5 ? 2 : 1), 30000);
          console.log(`[connection] Reconnectando en ${delay / 1000}s...`);
          setTimeout(() => this.connect(), delay);
        } else {
          console.log("[connection] Sesión cerrada. Limpiando credenciales para mostrar un QR nuevo...");
          this.sock = null;
          rmSync(this.authPath, { recursive: true, force: true });
          setTimeout(() => this.connect(), 1500);
        }
      }
    });

    this.sock.ev.on("messages.upsert", ({ messages }) => {
      for (const msg of messages) {
        this.emit("message", msg);
      }
    });

    return this.sock;
  }

  _startPresenceLoop() {
    this._stopPresenceLoop();
    this._presenceTimer = setInterval(() => {
      if (this.sock?.sendPresenceUpdate) {
        this.sock.sendPresenceUpdate("available").catch(() => {});
      }
    }, PRESENCE_INTERVAL);
  }

  _stopPresenceLoop() {
    if (this._presenceTimer) {
      clearInterval(this._presenceTimer);
      this._presenceTimer = null;
    }
  }

  async sendMessage(jid, content) {
    const msg = typeof content === "string" ? { text: content } : content;
    return this.sock.sendMessage(jid, msg);
  }

  async disconnect() {
    this._stopPresenceLoop();
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
  }
}
