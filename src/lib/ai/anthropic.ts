import type { AIConfig, AIProvider } from "../../types";
import { requireProviderText } from "./extractText";
import { aiHttpError, aiNetworkError, prepareAiEndpoint } from "./http";

export const anthropicProvider: AIProvider = {
  async send(input, config) {
    const endpoint = await prepareAiEndpoint(config.endpoint);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 1800,
        system: input.systemPrompt,
        messages: [{ role: "user", content: [...input.context, input.userMessage].join("\n\n") }],
      }),
    }).catch((error) => { throw aiNetworkError(error); });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(aiHttpError("Anthropic", res.status));
    return { text: requireProviderText(raw), raw };
  },
  async testConnection(config: AIConfig) {
    try {
      await this.send({ systemPrompt: "Balas singkat: OK", userMessage: "OK?", context: [] }, config);
      return { ok: true, message: "Terhubung" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Koneksi gagal" };
    }
  },
};


