import { existsSync, readFileSync } from "fs";

const DEFAULTS = {
  provider: "disabled",
  threshold: 0.75,
  timeoutMs: 8000,
  sightengineUrl: "https://api.sightengine.com/1.0/check.json",
  geminiApiUrl: "https://generativelanguage.googleapis.com/v1beta",
};

function readEnvFile() {
  const paths = [".env", "../.env"];
  const values = {};

  for (const path of paths) {
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

  return values;
}

function envValue(name, fallback = "") {
  const fileEnv = readEnvFile();
  return process.env[name] ?? fileEnv[name] ?? fallback;
}

function envNumber(name, fallback) {
  const raw = envValue(name, "");
  if (raw === "") return fallback;

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function scoreFromObject(value) {
  if (!value || typeof value !== "object") return 0;
  return Math.max(
    Number(value.score || 0),
    Number(value.probability || 0),
    Number(value.confidence || 0),
  );
}

function normalizeSightengine(data) {
  const nudity = data?.nudity || {};
  const scores = [
    nudity.raw,
    nudity.partial,
    nudity.sexual_activity,
    nudity.sexual_display,
    nudity.erotica,
  ].map((value) => Number(value || 0));

  return { score: Math.max(0, ...scores), details: data };
}

function normalizeNudeNet(data) {
  const predictions = Array.isArray(data) ? data : data?.predictions || data?.detections || [];
  const unsafeLabels = new Set(["female_breast_exposed", "female_genitalia_exposed", "male_genitalia_exposed", "anus_exposed", "buttocks_exposed"]);
  const score = predictions.reduce((max, item) => {
    const label = String(item.class || item.label || item.name || "").toLowerCase();
    if (!unsafeLabels.has(label)) return max;
    return Math.max(max, scoreFromObject(item));
  }, Number(data?.score || 0));

  return { score, details: data };
}

function normalizeCustom(data) {
  const score = Math.max(
    Number(data?.score || 0),
    Number(data?.nsfwScore || 0),
    Number(data?.unsafeScore || 0),
    data?.nsfw === true || data?.unsafe === true || data?.adult === true ? 1 : 0,
  );

  return { score, details: data };
}

function parseJsonText(text = "") {
  const cleaned = String(text)
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function normalizeGemini(data) {
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  const parsed = parseJsonText(text);
  const safetyScore = geminiSafetyScore(data);
  const score = Math.max(
    Number(parsed?.score || 0),
    Number(parsed?.nsfwScore || 0),
    parsed?.nsfw === true || parsed?.unsafe === true ? 1 : 0,
    safetyScore,
  );

  return {
    score,
    reason: parsed?.reason || geminiSafetyReason(data) || "gemini",
    details: { result: parsed, rawText: text, safetyRatings: candidate?.safetyRatings, promptFeedback: data?.promptFeedback },
  };
}

function geminiSafetyScore(data) {
  if (data?.promptFeedback?.blockReason) return 1;
  const ratings = data?.candidates?.[0]?.safetyRatings || [];
  const sexual = ratings.find((rating) => String(rating.category || "").includes("SEXUALLY_EXPLICIT"));
  const probability = String(sexual?.probability || "").toUpperCase();
  if (probability === "HIGH") return 1;
  if (probability === "MEDIUM") return 0.85;
  if (probability === "LOW") return 0.35;
  return 0;
}

function geminiSafetyReason(data) {
  if (data?.promptFeedback?.blockReason) return `blocked:${data.promptFeedback.blockReason}`;
  const finishReason = data?.candidates?.[0]?.finishReason;
  if (finishReason) return `finish:${finishReason}`;
  return "";
}

async function postMultipart(url, buffer, { signal, fields = {}, filename = "media.bin", mimeType = "application/octet-stream" } = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
  }
  form.append("media", new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch(url, { method: "POST", body: form, signal });
  if (!response.ok) throw new Error(`NSFW provider HTTP ${response.status}`);
  return response.json();
}

async function postJson(url, body, { signal, apiKey }) {
  const response = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `NSFW provider HTTP ${response.status}`);
  return data;
}

function makeDisabledProvider() {
  return {
    name: "disabled",
    async analyze() {
      return { skipped: true, score: 0, provider: "disabled", reason: "NSFW_PROVIDER no configurado" };
    },
  };
}

function makeSightengineProvider(config) {
  return {
    name: "sightengine",
    async analyze(buffer, options = {}) {
      const data = await postMultipart(config.sightengineUrl, buffer, {
        ...options,
        fields: {
          models: envValue("SIGHTENGINE_MODELS", "nudity-2.1"),
          api_user: envValue("SIGHTENGINE_API_USER"),
          api_secret: envValue("SIGHTENGINE_API_SECRET"),
        },
      });
      return { ...normalizeSightengine(data), provider: "sightengine" };
    },
  };
}

function makeNudeNetProvider() {
  const url = envValue("NUDENET_URL", envValue("NSFW_NUDENET_URL"));
  if (!url) return makeDisabledProvider();

  return {
    name: "nudenet",
    async analyze(buffer, options = {}) {
      const data = await postMultipart(url, buffer, options);
      return { ...normalizeNudeNet(data), provider: "nudenet" };
    },
  };
}

function makeCustomProvider() {
  const url = envValue("NSFW_CUSTOM_URL");
  if (!url) return makeDisabledProvider();

  return {
    name: "custom",
    async analyze(buffer, options = {}) {
      const data = await postMultipart(url, buffer, options);
      return { ...normalizeCustom(data), provider: "custom" };
    },
  };
}

function makeGeminiProvider(config) {
  const apiKey = envValue("GEMINI_API_KEY");
  if (!apiKey) return makeDisabledProvider();

  const model = envValue("NSFW_GEMINI_MODEL", envValue("GEMINI_MODEL", "gemini-2.5-flash"));
  const apiUrl = envValue("GEMINI_API_URL", config.geminiApiUrl).replace(/\/$/, "");

  return {
    name: "gemini",
    async analyze(buffer, options = {}) {
      const url = `${apiUrl}/models/${encodeURIComponent(model)}:generateContent`;
      const data = await postJson(
        url,
        {
          system_instruction: {
            parts: [
              {
                text: [
                  "Eres un clasificador de seguridad de contenido visual para moderacion.",
                  "Debes responder solo JSON valido.",
                  "Marca NSFW si hay desnudez explicita, genitales, actividad sexual o contenido sexual claro.",
                  "No marques NSFW por ropa normal, memes no sexuales, arte no explicito o ambiguedad baja.",
                ].join(" "),
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: 'Analiza esta media. Responde SOLO este JSON compacto, sin markdown ni explicacion: {"nsfw":false,"score":0,"reason":"breve"}. Usa true y score alto si hay desnudez explicita o sexual.',
                },
                {
                  inline_data: {
                    mime_type: options.mimeType || "application/octet-stream",
                    data: buffer.toString("base64"),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 256,
            responseMimeType: "application/json",
            thinkingConfig: {
              thinkingBudget: 0,
            },
          },
        },
        { signal: options.signal, apiKey },
      );
      return { ...normalizeGemini(data), provider: "gemini" };
    },
  };
}

export function getNsfwConfig() {
  return {
    provider: envValue("NSFW_PROVIDER", DEFAULTS.provider).toLowerCase(),
    threshold: envNumber("NSFW_THRESHOLD", DEFAULTS.threshold),
    timeoutMs: envNumber("NSFW_TIMEOUT_MS", DEFAULTS.timeoutMs),
    maxBytes: envNumber("NSFW_MAX_BYTES", 8 * 1024 * 1024),
    cacheTtlMs: envNumber("NSFW_CACHE_TTL_MS", 10 * 60 * 1000),
    cacheMaxEntries: envNumber("NSFW_CACHE_MAX_ENTRIES", 100),
    kickThreshold: envNumber("NSFW_KICK_THRESHOLD", 3),
    sightengineUrl: envValue("SIGHTENGINE_URL", DEFAULTS.sightengineUrl),
    geminiApiUrl: envValue("GEMINI_API_URL", DEFAULTS.geminiApiUrl),
  };
}

export function createNsfwProvider(config = getNsfwConfig()) {
  if (config.provider === "gemini") return makeGeminiProvider(config);
  if (config.provider === "sightengine") return makeSightengineProvider(config);
  if (config.provider === "nudenet") return makeNudeNetProvider(config);
  if (config.provider === "custom") return makeCustomProvider(config);
  return makeDisabledProvider();
}
