import { createHash } from "crypto";
import { createNsfwProvider, getNsfwConfig } from "./provider.js";

export { getNsfwConfig } from "./provider.js";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function now() {
  return Date.now();
}

export class NsfwDetector {
  constructor(options = {}) {
    this.config = { ...getNsfwConfig(), ...options };
    this.provider = typeof options.provider?.analyze === "function"
      ? options.provider
      : createNsfwProvider(this.config);
    this.cache = new Map();
  }

  _cacheGet(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (now() - entry.at > this.config.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  _cacheSet(key, result) {
    this.cache.set(key, { at: now(), result });
    while (this.cache.size > this.config.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
    }
  }

  async analyze(buffer, options = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return { skipped: true, reason: "media vacia", score: 0, nsfw: false };
    }

    if (buffer.length > this.config.maxBytes) {
      return { skipped: true, reason: "media demasiado grande", score: 0, nsfw: false };
    }

    const key = sha256(buffer);
    const cached = this._cacheGet(key);
    if (cached) return { ...cached, cached: true };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      if (typeof this.provider?.analyze !== "function") {
        return { error: "proveedor NSFW invalido", score: 0, nsfw: false, provider: String(this.config.provider || "unknown") };
      }

      const result = await this.provider.analyze(buffer, { ...options, signal: controller.signal });
      const score = Number(result.score || 0);
      const normalized = {
        ...result,
        score,
        nsfw: score >= this.config.threshold,
        threshold: this.config.threshold,
      };
      this._cacheSet(key, normalized);
      return normalized;
    } catch (err) {
      const message = err?.name === "AbortError" ? "timeout del proveedor NSFW" : err?.message || "error NSFW";
      return { error: message, score: 0, nsfw: false, provider: this.provider.name };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createNsfwDetector(options = {}) {
  return new NsfwDetector(options);
}
