import { existsSync, readFileSync } from "fs";

const DEFAULTS = {
  apiUrl: "https://generativelanguage.googleapis.com/v1beta",
  model: "gemini-3.5-flash",
  temperature: 0.4,
  maxTokens: 700,
  timeoutMs: 20000,
  maxPromptChars: 2500,
  maxHistoryMessages: 8,
  maxStoredMessages: 1200,
  messageRetentionMs: 48 * 60 * 60 * 1000,
  rateLimitMs: 3500,
  systemPrompt: [
    "Eres BandalandBot, un asistente util para grupos de WhatsApp.",
    "Responde en espanol claro, breve y accionable.",
    "No inventes datos si no estas seguro.",
  ].join(" "),
};

let cachedEnv = null;

function readEnvFile() {
  if (cachedEnv) return cachedEnv;

  const values = {};
  for (const path of [".env", "../.env"]) {
    if (!existsSync(path)) continue;

    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const index = trimmed.indexOf("=");
      if (index === -1) continue;

      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && values[key] === undefined) values[key] = value;
    }
  }

  cachedEnv = values;
  return values;
}

function env(name, fallback = "") {
  const fileEnv = readEnvFile();
  return process.env[name] ?? fileEnv[name] ?? fallback;
}

function envNumber(name, fallback) {
  const raw = env(name, "");
  if (raw === "") return fallback;

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function getAiConfig() {
  return {
    apiKey: env("GEMINI_API_KEY"),
    apiUrl: env("GEMINI_API_URL", DEFAULTS.apiUrl),
    model: env("GEMINI_MODEL", DEFAULTS.model),
    temperature: envNumber("GEMINI_TEMPERATURE", DEFAULTS.temperature),
    maxTokens: envNumber("GEMINI_MAX_TOKENS", DEFAULTS.maxTokens),
    timeoutMs: envNumber("GEMINI_TIMEOUT_MS", DEFAULTS.timeoutMs),
    maxPromptChars: envNumber("AI_MAX_PROMPT_CHARS", DEFAULTS.maxPromptChars),
    maxHistoryMessages: envNumber("AI_MAX_HISTORY_MESSAGES", DEFAULTS.maxHistoryMessages),
    maxStoredMessages: envNumber("AI_MAX_STORED_MESSAGES", DEFAULTS.maxStoredMessages),
    messageRetentionMs: envNumber("AI_MESSAGE_RETENTION_MS", DEFAULTS.messageRetentionMs),
    rateLimitMs: envNumber("AI_RATE_LIMIT_MS", DEFAULTS.rateLimitMs),
    systemPrompt: env("AI_SYSTEM_PROMPT", DEFAULTS.systemPrompt),
  };
}
