import type { AIConfig, AIProvider } from "../../types";
import { adminProvider } from "./admin";
import { anthropicProvider } from "./anthropic";
import { openaiCompatibleProvider } from "./openaiCompatible";

export function getProvider(config: AIConfig): AIProvider {
  if (config.source === "admin") return adminProvider;
  return config.provider === "anthropic" ? anthropicProvider : openaiCompatibleProvider;
}
