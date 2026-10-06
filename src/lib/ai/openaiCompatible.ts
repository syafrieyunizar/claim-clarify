import type { AIConfig, AIProvider } from "../../types";
import { requireProviderText } from "./extractText";
import { aiHttpError, aiNetworkError, prepareAiEndpoint } from "./http";

export const openaiCompatibleProvider: AIProvider = {
  async send(input, config) {
    const endpoint = await prepareAiEndpoint(config.endpoint);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: [...input.context, input.userMessage].join("\n\n") },
        ],
      }),
    }).catch((error) => { throw aiNetworkError(error); });
    const raw = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(aiHttpError("Endpoint AI", res.status));
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


