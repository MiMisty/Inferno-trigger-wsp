export class GeminiClient {
  constructor(config) {
    this.config = config;
  }

  isConfigured() {
    return Boolean(this.config.apiKey);
  }

  async chat(messages) {
    if (!this.isConfigured()) {
      return { ok: false, error: "Falta GEMINI_API_KEY en .env." };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const system = messages.find((message) => message.role === "system")?.content || this.config.systemPrompt;
    const contents = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" || message.role === "model" ? "model" : "user",
        parts: [{ text: message.content }],
      }));

    try {
      const url = `${this.config.apiUrl.replace(/\/$/, "")}/models/${encodeURIComponent(this.config.model)}:generateContent`;
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "x-goog-api-key": this.config.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: system }],
          },
          contents,
          generationConfig: {
            temperature: this.config.temperature,
            maxOutputTokens: this.config.maxTokens,
          },
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: data?.error?.message || data?.message || `Gemini respondio HTTP ${response.status}`,
        };
      }

      const content = normalizeContent(data?.candidates?.[0]?.content?.parts);
      if (!content) return { ok: false, error: "Gemini no devolvio contenido." };

      return {
        ok: true,
        content,
        usage: data?.usageMetadata || null,
        model: this.config.model,
      };
    } catch (err) {
      const error = err?.name === "AbortError" ? "Timeout consultando Gemini." : err?.message || "Error consultando Gemini.";
      return { ok: false, error };
    } finally {
      clearTimeout(timer);
    }
  }
}

function normalizeContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return part?.text || "";
    })
    .join("")
    .trim();
}
