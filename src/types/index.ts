export type WorkflowId = "standard" | "readmisi" | "template";

export type ApiKeySource = "admin" | "personal";

export interface AdminUserSession {
  username: string;
  sessionToken: string;
  deviceId: string;
  expiresAt?: string | null;
}

export interface AIConfig {
  source: ApiKeySource;
  provider: "anthropic" | "openai-compatible";
  endpoint: string;
  model: string;
  apiKey: string;
  adminSession?: AdminUserSession | null;
}

export interface AIProvider {
  send(
    input: { systemPrompt: string; userMessage: string; context: string[]; responseJson?: boolean; responseSchema?: Record<string, unknown> },
    config: AIConfig,
  ): Promise<{ text: string; raw: unknown }>;
  testConnection(config: AIConfig): Promise<{ ok: boolean; message: string }>;
}

export interface GeneratedAnswer {
  ringkasan: string;
  jawabanPending: string;
  sources: string[];
}

export interface ClaimChallengeAssessment {
  challengeScore: number;
  verdict: string;
  bpjsPerspective: string[];
  casemixPerspective: string[];
  missingEvidence: string[];
  recommendation: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  workflow: WorkflowId;
  inputReference: string;
  output: GeneratedAnswer;
}

export interface Template {
  keyword: string;
  note: string;
  instruction: string;
  sharedId?: string;
}

export interface KnowledgeChunk {
  id: string;
  title: string;
  source: string;
  keywords: string[];
  content: string;
  active: boolean;
}
