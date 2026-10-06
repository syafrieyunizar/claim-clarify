import type { AdminUserSession, AIConfig, AIProvider } from "../../types";
import { getLocal, removeLocal, setLocal } from "../storage/local";

const KNOWLEDGE_FUNCTION_URL = "https://yvcqgwpfjoxhuyhxuiry.supabase.co/functions/v1/knowledge-admin";
const APP_ID = "claim-clarify";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2Y3Fnd3Bmam94aHV5aHh1aXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0NzkxOTIsImV4cCI6MjA5NDA1NTE5Mn0.cSVjIjIpC9hlm8Sb5nISxUitoRHtEL0pC6ZphQ9SxLw";

const DEVICE_KEY = "claimClarify.adminAccessDeviceId";
const SESSION_KEY = "claimClarify.adminUserSession";

export type AdminBackendAuth = { username: string; password: string };

export type AdminAiConfig = {
  provider: string;
  providerLabel?: string | null;
  baseUrl?: string | null;
  model: string;
  hasApiKey?: boolean;
  hasGeminiFallback?: boolean;
  geminiFallbackModel?: string | null;
};

export type AdminAiProviderMeta = AdminAiConfig & { active?: boolean };

export type AdminAccessUser = {
  username: string;
  active?: boolean;
  hasActiveDevice?: boolean;
  sessionExpiresAt?: string | null;
};

export type ClaimLibraryStatus = "pending" | "approved" | "rejected";

export type ClaimKnowledgeEntry = {
  id: string;
  title: string;
  content: string;
  category?: string | null;
  keywords: string[];
  source_name?: string | null;
  source_page?: number | null;
  status: ClaimLibraryStatus;
  active?: boolean;
  submitted_by?: string;
  review_note?: string | null;
};

export type ClaimTemplateEntry = {
  id: string;
  keyword: string;
  note?: string | null;
  instruction: string;
  status: ClaimLibraryStatus;
  active?: boolean;
  submitted_by?: string;
  review_note?: string | null;
};

export type ClaimSubmissionSummary = {
  id: string;
  status: ClaimLibraryStatus;
  review_note?: string | null;
  title?: string;
  keyword?: string;
};

export type ClaimLibraryData = {
  knowledge: ClaimKnowledgeEntry[];
  templates: ClaimTemplateEntry[];
  submissions: { knowledge: ClaimSubmissionSummary[]; templates: ClaimSubmissionSummary[] };
};

export type AdminAiDraft = {
  provider: string;
  provider_label: string;
  base_url: string;
  api_key: string;
  model: string;
  gemini_fallback_api_key: string;
  gemini_fallback_model: string;
};

export const ADMIN_PROVIDER_OPTIONS = [
  { value: "gemini", label: "Gemini" },
  { value: "sumopod", label: "Sumopod" },
  { value: "aimurah", label: "AImurah" },
  { value: "x5lab", label: "X5Lab" },
  { value: "custom", label: "Provider Lain" },
] as const;

const ADMIN_PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini",
  sumopod: "Sumopod",
  aimurah: "AImurah",
  x5lab: "X5Lab",
};

type KnowledgeApiData = Record<string, unknown> & { error?: string; text?: string; session?: Partial<AdminUserSession>; config?: AdminAiConfig | null; providers?: AdminAiProviderMeta[]; users?: AdminAccessUser[] };


export async function knowledgeApi(action: string, payload: Record<string, unknown> = {}): Promise<KnowledgeApiData> {
  const response = await fetch(KNOWLEDGE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ action, app_id: APP_ID, ...payload }),
  });
  const data = await response.json().catch(() => ({})) as KnowledgeApiData;
  if (!response.ok || data.error) {
    if (response.status === 401) throw new Error("Supabase menolak akses Edge Function. Pastikan function knowledge-admin sudah deploy dan secret/service role sudah diset.");
    if (response.status === 524 || response.status === 546) throw new Error("Knowledge API terlalu lama merespons. Coba kecilkan dokumen atau ulangi beberapa saat lagi.");
    throw new Error(data.error || `Knowledge API ${response.status}`);
  }
  return data;
}

async function getOrCreateDeviceId() {
  const existing = await getLocal(DEVICE_KEY, "");
  if (existing) return existing;
  const nextId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await setLocal(DEVICE_KEY, nextId);
  return nextId;
}

export async function getStoredAdminUserSession() {
  return getLocal<AdminUserSession | null>(SESSION_KEY, null);
}

async function setStoredAdminUserSession(session: AdminUserSession) {
  await setLocal(SESSION_KEY, session);
}

export async function clearAdminUserSession() {
  const session = await getStoredAdminUserSession();
  try {
    if (session?.username) await knowledgeApi("logout_user", { username: session.username });
  } catch {
    // Best effort only; local logout must still work.
  }
  await removeLocal(SESSION_KEY);
}

export async function loginAdminUser(username: string, password: string) {
  const deviceId = await getOrCreateDeviceId();
  const data = await knowledgeApi("login_user", { username, password, device_id: deviceId });
  const session = normalizeSession(data.session, username, deviceId);
  await setStoredAdminUserSession(session);
  return session;
}

export async function validateStoredAdminUserSession() {
  const session = await getStoredAdminUserSession();
  if (!session?.username || !session?.sessionToken || !session?.deviceId) return null;
  try {
    const data = await knowledgeApi("validate_user_session", {
      username: session.username,
      session_token: session.sessionToken,
      device_id: session.deviceId,
    });
    const nextSession = normalizeSession(data.session, session.username, session.deviceId, session.sessionToken, session.expiresAt);
    await setStoredAdminUserSession(nextSession);
    return nextSession;
  } catch {
    await removeLocal(SESSION_KEY);
    return null;
  }
}

async function requireAdminSession(config: AIConfig) {
  const session = config.adminSession || await validateStoredAdminUserSession();
  if (!session) throw new Error("Sesi admin di perangkat ini sudah tidak aktif. Silakan login ulang.");
  return session;
}

export const adminProvider: AIProvider = {
  async send(input, config) {
    const session = await requireAdminSession(config);
    const userPrompt = [...input.context, input.userMessage].filter(Boolean).join("\n\n");
    const data = await knowledgeApi("ai_generate", {
      systemPrompt: input.systemPrompt,
      userPrompt,
      prompt: userPrompt,
      responseJson: input.responseJson ?? false,
      ...(input.responseSchema ? { responseSchema: input.responseSchema } : {}),
      user_session: session,
    });
    const text = String(data.text || "").trim();
    if (!text) throw new Error("Respons AI admin kosong.");
    return { text, raw: data };
  },
  async testConnection(config) {
    try {
      await knowledgeApi("get_ai_config");
      await this.send({ systemPrompt: "Balas singkat: OK", userMessage: "OK?", context: [] }, config);
      return { ok: true, message: "Terhubung" };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "Koneksi gagal" };
    }
  },
};

function normalizeSession(raw: Partial<AdminUserSession> | undefined, username: string, deviceId: string, sessionToken = "", expiresAt: string | null = null): AdminUserSession {
  const token = raw?.sessionToken || sessionToken;
  if (!token) throw new Error("Session token admin tidak diterima.");
  return {
    username: raw?.username || username.trim().toLowerCase(),
    sessionToken: token,
    deviceId: raw?.deviceId || deviceId,
    expiresAt: raw?.expiresAt || expiresAt,
  };
}

export function getAdminProviderLabel(provider: string, customLabel = "") {
  return customLabel || ADMIN_PROVIDER_LABELS[provider] || provider || "Provider";
}

export function normalizeAdminProviderKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function getAdminAiConfig() {
  const data = await knowledgeApi("get_ai_config");
  return {
    config: data.config || null,
    providers: Array.isArray(data.providers) ? data.providers : [],
  };
}

export async function validateAdminAiConfig(auth: AdminBackendAuth, config: AdminAiDraft) {
  return knowledgeApi("validate_ai_config", { ...auth, config });
}

export async function saveAdminAiConfig(auth: AdminBackendAuth, config: AdminAiDraft) {
  const data = await knowledgeApi("save_ai_config", { ...auth, config });
  return {
    config: data.config || null,
    providers: Array.isArray(data.providers) ? data.providers : [],
  };
}

export async function resetAdminAiConfig(auth: AdminBackendAuth, provider: string) {
  const data = await knowledgeApi("reset_ai_config", { ...auth, provider });
  return {
    config: (data.config as AdminAiConfig | undefined) || null,
    providers: Array.isArray(data.providers) ? data.providers : [],
  };
}

export async function loginAdminBackend(auth: AdminBackendAuth) {
  return knowledgeApi("login", auth);
}

export async function listAdminAccessUsers(auth: AdminBackendAuth) {
  const data = await knowledgeApi("list_users", auth);
  return Array.isArray(data.users) ? data.users : [];
}

export async function createAdminAccessUser(auth: AdminBackendAuth, username: string, password: string) {
  return knowledgeApi("create_user", { ...auth, user: { username, password } });
}

export async function resetAdminAccessUserPassword(auth: AdminBackendAuth, username: string, password: string) {
  return knowledgeApi("reset_user_password", { ...auth, user: { username, password } });
}

export async function deleteAdminAccessUser(auth: AdminBackendAuth, username: string) {
  return knowledgeApi("delete_user", { ...auth, user: { username } });
}

export async function listClaimLibrary(session: AdminUserSession): Promise<ClaimLibraryData> {
  const data = await knowledgeApi("claim_library_list", { user_session: session });
  return {
    knowledge: Array.isArray(data.knowledge) ? data.knowledge as ClaimKnowledgeEntry[] : [],
    templates: Array.isArray(data.templates) ? data.templates as ClaimTemplateEntry[] : [],
    submissions: normalizeClaimSubmissions(data.submissions),
  };
}

export async function submitClaimKnowledge(session: AdminUserSession, knowledge: Array<Record<string, unknown>>) {
  return knowledgeApi("claim_library_submit_knowledge", { user_session: session, knowledge });
}

export async function submitClaimTemplate(session: AdminUserSession, template: Record<string, unknown>) {
  return knowledgeApi("claim_library_submit_template", { user_session: session, template });
}

export async function listClaimLibraryReviews(auth: AdminBackendAuth, status: ClaimLibraryStatus = "pending") {
  const data = await knowledgeApi("claim_library_admin_list", { ...auth, status });
  return {
    knowledge: Array.isArray(data.knowledge) ? data.knowledge as ClaimKnowledgeEntry[] : [],
    templates: Array.isArray(data.templates) ? data.templates as ClaimTemplateEntry[] : [],
  };
}

export async function reviewClaimLibraryItem(auth: AdminBackendAuth, input: { resourceType: "knowledge" | "template"; id: string; decision: "approved" | "rejected"; reviewNote?: string; patch?: Record<string, unknown> }) {
  return knowledgeApi("claim_library_admin_review", {
    ...auth,
    resource_type: input.resourceType,
    id: input.id,
    decision: input.decision,
    review_note: input.reviewNote || "",
    patch: input.patch || {},
  });
}

export async function manageClaimLibraryItem(auth: AdminBackendAuth, input: { resourceType: "knowledge" | "template"; operation: "save" | "set_active" | "delete"; id?: string; item?: Record<string, unknown>; active?: boolean }) {
  return knowledgeApi("claim_library_admin_manage", {
    ...auth,
    resource_type: input.resourceType,
    operation: input.operation,
    ...(input.id ? { id: input.id } : {}),
    ...(input.item ? { item: input.item } : {}),
    ...(typeof input.active === "boolean" ? { active: input.active } : {}),
  });
}

function normalizeClaimSubmissions(value: unknown): ClaimLibraryData["submissions"] {
  const submissions = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    knowledge: Array.isArray(submissions.knowledge) ? submissions.knowledge as ClaimSubmissionSummary[] : [],
    templates: Array.isArray(submissions.templates) ? submissions.templates as ClaimSubmissionSummary[] : [],
  };
}
