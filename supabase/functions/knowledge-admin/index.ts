const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type KnowledgeChunk = {
  title: string;
  content: string;
  category?: string;
  keywords?: string[];
  diagnosis_tags?: string[];
  source_name?: string;
  source_page?: number | null;
  active?: boolean;
};

type AdminAiConfig = {
  id?: string;
  app_id?: string;
  provider: string;
  provider_label?: string | null;
  base_url?: string | null;
  api_key: string;
  model: string;
  active?: boolean;
  gemini_fallback_api_key?: string | null;
  gemini_fallback_model?: string | null;
};

type AdminAiUser = {
  id?: string;
  username: string;
  password_hash: string;
  active?: boolean;
  active_device_id?: string | null;
  session_token?: string | null;
  session_expires_at?: string | null;
};

type ClaimLibraryKnowledge = {
  title: string;
  content: string;
  category?: string;
  keywords?: string[];
  source_name?: string;
  source_page?: number | null;
};

type ClaimLibraryTemplate = {
  keyword: string;
  note?: string;
  instruction: string;
};

const OPENAI_ENDPOINTS: Record<string, string> = {
  sumopod: "https://ai.sumopod.com/v1/chat/completions",
  aimurah: "https://aimurah.my.id/api/v1/chat/completions",
  semutssh: "https://ai-partner.semutssh.com/v1/chat/completions",
};

const REMOVED_PROVIDERS = new Set(["genfity", "x5lab"]);

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Gemini",
  sumopod: "Sumopod",
  aimurah: "AIMurah",
  semutssh: "SemutSSH",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseFirstJsonValue(text: string) {
  const source = String(text || "").trim();
  try {
    return JSON.parse(source);
  } catch (originalError) {
    for (let start = 0; start < source.length; start += 1) {
      if (source[start] !== "{" && source[start] !== "[") continue;
      const end = findFirstJsonValueEnd(source, start);
      if (end < 0) continue;
      try {
        return JSON.parse(source.slice(start, end));
      } catch (_) {
        // Continue to the next possible JSON value.
      }
    }
    throw originalError;
  }
}

function findFirstJsonValueEnd(text: string, start: number) {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return -1;
      if (!stack.length) return i + 1;
    }
  }
  return -1;
}

function normalizeList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function assertAdmin(payload: Record<string, unknown>) {
  const expectedUser = Deno.env.get("ADMIN_USERNAME") || "admin";
  const expectedPassword = Deno.env.get("ADMIN_PASSWORD") || "";
  if (payload.username !== expectedUser || payload.password !== expectedPassword) {
    throw new Error("Login admin tidak valid");
  }
}

function getAppId(payload: Record<string, unknown>) {
  const appId = String(payload.app_id || payload.appId || "resume-medis-reviewer").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(appId)) throw new Error("app_id tidak valid");
  return appId;
}

function normalizeProviderKey(value: unknown) {
  const provider = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(provider) || REMOVED_PROVIDERS.has(provider)) throw new Error("Provider admin tidak valid");
  return provider;
}

function normalizeUsername(value: unknown) {
  const username = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/i.test(username)) {
    throw new Error("Username tidak valid");
  }
  return username;
}

function normalizeLogLabel(value: unknown, fallback = "") {
  return String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").slice(0, 64);
}

function safeAiError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/^(Provider API \d+|Gemini API \d+|API key admin belum diset|Respons AI admin kosong)/)?.[0]
    || "Gagal memanggil provider";
}

async function hashPassword(password: string, username: string) {
  const pepper = Deno.env.get("ADMIN_USER_PASSWORD_PEPPER") || "";
  const payload = new TextEncoder().encode(`${username}::${password}::${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function makeSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function getSessionExpiryIso(days = 7) {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt.toISOString();
}

async function supabaseRequest(path: string, init: RequestInit = {}) {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diset");
  }
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Supabase REST ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
}

async function writeUsageLog(log: Record<string, unknown>) {
  try {
    await supabaseRequest("app_usage_logs", {
      method: "POST",
      body: JSON.stringify(log),
    });
  } catch (error) {
    console.error("Gagal menyimpan usage log", error);
  }
}

function sanitizeChunk(chunk: KnowledgeChunk) {
  return {
    title: String(chunk.title || "").trim(),
    content: String(chunk.content || "").trim(),
    category: chunk.category ? String(chunk.category).trim() : null,
    keywords: normalizeList(chunk.keywords),
    diagnosis_tags: normalizeList(chunk.diagnosis_tags),
    source_name: chunk.source_name ? String(chunk.source_name).trim() : null,
    source_page: Number.isFinite(chunk.source_page) ? chunk.source_page : null,
    active: chunk.active !== false,
  };
}

function assertClaimClarifyApp(payload: Record<string, unknown>) {
  const appId = getAppId(payload);
  if (appId !== "claim-clarify") throw new Error("Library ini hanya tersedia untuk Claim Clarify");
  return appId;
}

function claimUserSession(payload: Record<string, unknown>) {
  return (payload.user_session && typeof payload.user_session === "object"
    ? payload.user_session
    : payload) as Record<string, unknown>;
}

function sanitizeClaimKnowledge(value: ClaimLibraryKnowledge) {
  return {
    title: String(value.title || "").trim().slice(0, 240),
    content: String(value.content || "").trim().slice(0, 50000),
    category: value.category ? String(value.category).trim().slice(0, 120) : null,
    keywords: normalizeList(value.keywords).slice(0, 20),
    source_name: value.source_name ? String(value.source_name).trim().slice(0, 240) : null,
    source_page: Number.isFinite(value.source_page) ? value.source_page : null,
  };
}

function sanitizeClaimTemplate(value: ClaimLibraryTemplate) {
  return {
    keyword: String(value.keyword || "").trim().slice(0, 120),
    note: value.note ? String(value.note).trim().slice(0, 500) : null,
    instruction: String(value.instruction || "").trim().slice(0, 20000),
  };
}

async function listClaimLibrary(payload: Record<string, unknown>) {
  const appId = assertClaimClarifyApp(payload);
  const session = await validateAdminAiUserSession(claimUserSession(payload));
  const [knowledge, templates, ownKnowledge, ownTemplates] = await Promise.all([
    supabaseRequest(`app_knowledge_entries?select=*&app_id=eq.${encodeURIComponent(appId)}&status=eq.approved&active=eq.true&order=updated_at.desc&limit=500`, { method: "GET", headers: { Prefer: "" } }),
    supabaseRequest(`app_templates?select=*&app_id=eq.${encodeURIComponent(appId)}&status=eq.approved&active=eq.true&order=updated_at.desc&limit=200`, { method: "GET", headers: { Prefer: "" } }),
    supabaseRequest(`app_knowledge_entries?select=id,title,status,review_note,created_at,updated_at&app_id=eq.${encodeURIComponent(appId)}&submitted_by=eq.${encodeURIComponent(session.username)}&status=neq.approved&order=updated_at.desc&limit=200`, { method: "GET", headers: { Prefer: "" } }),
    supabaseRequest(`app_templates?select=id,keyword,status,review_note,created_at,updated_at&app_id=eq.${encodeURIComponent(appId)}&submitted_by=eq.${encodeURIComponent(session.username)}&status=neq.approved&order=updated_at.desc&limit=200`, { method: "GET", headers: { Prefer: "" } }),
  ]);
  return { knowledge: knowledge || [], templates: templates || [], submissions: { knowledge: ownKnowledge || [], templates: ownTemplates || [] } };
}

async function submitClaimKnowledge(payload: Record<string, unknown>) {
  const appId = assertClaimClarifyApp(payload);
  const session = await validateAdminAiUserSession(claimUserSession(payload));
  const values = Array.isArray(payload.knowledge) ? payload.knowledge : [payload.knowledge];
  const knowledge = values.slice(0, 100).map((value) => sanitizeClaimKnowledge((value || {}) as ClaimLibraryKnowledge))
    .filter((value) => value.title && value.content)
    .map((value) => ({ ...value, app_id: appId, status: "pending", active: true, submitted_by: session.username }));
  if (!knowledge.length) throw new Error("Knowledge yang diajukan tidak valid");
  const data = await supabaseRequest("app_knowledge_entries", { method: "POST", body: JSON.stringify(knowledge) });
  return data || [];
}

async function submitClaimTemplate(payload: Record<string, unknown>) {
  const appId = assertClaimClarifyApp(payload);
  const session = await validateAdminAiUserSession(claimUserSession(payload));
  const template = sanitizeClaimTemplate((payload.template || {}) as ClaimLibraryTemplate);
  if (!template.keyword || !template.instruction) throw new Error("Keyword dan instruksi template wajib diisi");
  const data = await supabaseRequest("app_templates", {
    method: "POST",
    body: JSON.stringify({ ...template, app_id: appId, status: "pending", active: true, submitted_by: session.username }),
  });
  return data?.[0] || null;
}

async function listClaimLibraryReviews(payload: Record<string, unknown>) {
  const appId = assertClaimClarifyApp(payload);
  const status = ["pending", "approved", "rejected"].includes(String(payload.status)) ? String(payload.status) : "pending";
  const [knowledge, templates] = await Promise.all([
    supabaseRequest(`app_knowledge_entries?select=*&app_id=eq.${encodeURIComponent(appId)}&status=eq.${status}&order=created_at.asc&limit=500`, { method: "GET", headers: { Prefer: "" } }),
    supabaseRequest(`app_templates?select=*&app_id=eq.${encodeURIComponent(appId)}&status=eq.${status}&order=created_at.asc&limit=200`, { method: "GET", headers: { Prefer: "" } }),
  ]);
  return { knowledge: knowledge || [], templates: templates || [] };
}

async function reviewClaimLibraryItem(payload: Record<string, unknown>) {
  const appId = assertClaimClarifyApp(payload);
  const resourceType = String(payload.resource_type || payload.resourceType || "");
  const table = resourceType === "knowledge" ? "app_knowledge_entries" : resourceType === "template" ? "app_templates" : "";
  if (!table) throw new Error("Jenis pengajuan tidak valid");
  const id = String(payload.id || "").trim();
  const decision = String(payload.decision || "").trim();
  if (!id || !["approved", "rejected"].includes(decision)) throw new Error("Keputusan review tidak valid");
  const rows = await supabaseRequest(`${table}?select=*&id=eq.${encodeURIComponent(id)}&app_id=eq.${encodeURIComponent(appId)}&limit=1`, { method: "GET", headers: { Prefer: "" } });
  if (!rows?.[0]) throw new Error("Pengajuan tidak ditemukan");
  const incoming = (payload.patch && typeof payload.patch === "object" ? payload.patch : {}) as Record<string, unknown>;
  const contentPatch: Record<string, unknown> = resourceType === "knowledge"
    ? sanitizeClaimKnowledge({ ...rows[0], ...incoming })
    : sanitizeClaimTemplate({ ...rows[0], ...incoming });
  const data = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}&app_id=eq.${encodeURIComponent(appId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      ...contentPatch,
      status: decision,
      active: decision === "approved",
      reviewed_by: String(payload.username || "admin").trim().slice(0, 64),
      review_note: String(payload.review_note || payload.reviewNote || "").trim().slice(0, 1000) || null,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }),
  });
  if (resourceType === "template" && decision === "approved") {
    await supabaseRequest(`app_templates?app_id=eq.${encodeURIComponent(appId)}&keyword=eq.${encodeURIComponent(String(contentPatch.keyword || ""))}&id=neq.${encodeURIComponent(id)}&status=eq.approved&active=eq.true`, {
      method: "PATCH",
      body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
    });
  }
  return data?.[0] || null;
}

async function manageClaimLibraryItem(payload: Record<string, unknown>) {
  const appId = assertClaimClarifyApp(payload);
  const resourceType = String(payload.resource_type || payload.resourceType || "");
  const table = resourceType === "knowledge" ? "app_knowledge_entries" : resourceType === "template" ? "app_templates" : "";
  if (!table) throw new Error("Jenis library tidak valid");

  const operation = String(payload.operation || "");
  const id = String(payload.id || "").trim();
  if (!["save", "set_active", "delete"].includes(operation)) throw new Error("Operasi library tidak valid");
  if (operation !== "save" && !id) throw new Error("ID library wajib diisi");

  if (operation === "delete") {
    const data = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}&app_id=eq.${encodeURIComponent(appId)}`, { method: "DELETE" });
    if (!data?.length) throw new Error("Item library tidak ditemukan");
    return data[0];
  }

  if (operation === "set_active") {
    const data = await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}&app_id=eq.${encodeURIComponent(appId)}&status=eq.approved`, {
      method: "PATCH",
      body: JSON.stringify({ active: payload.active === true, updated_at: new Date().toISOString() }),
    });
    if (!data?.length) throw new Error("Item library tidak ditemukan");
    if (resourceType === "template" && payload.active === true) {
      await supabaseRequest(`app_templates?app_id=eq.${encodeURIComponent(appId)}&keyword=eq.${encodeURIComponent(String(data[0].keyword || ""))}&id=neq.${encodeURIComponent(id)}&status=eq.approved&active=eq.true`, {
        method: "PATCH",
        body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
      });
    }
    return data[0];
  }

  const incoming = (payload.item && typeof payload.item === "object" ? payload.item : {}) as Record<string, unknown>;
  const existing = id
    ? await supabaseRequest(`${table}?select=*&id=eq.${encodeURIComponent(id)}&app_id=eq.${encodeURIComponent(appId)}&limit=1`, { method: "GET", headers: { Prefer: "" } })
    : [];
  if (id && !existing?.[0]) throw new Error("Item library tidak ditemukan");
  const item = resourceType === "knowledge"
    ? sanitizeClaimKnowledge({ ...(existing?.[0] || {}), ...incoming })
    : sanitizeClaimTemplate({ ...(existing?.[0] || {}), ...incoming });
  if (resourceType === "knowledge" && (!("title" in item) || !item.title || !("content" in item) || !item.content)) throw new Error("Judul dan isi knowledge wajib diisi");
  if (resourceType === "template" && (!("keyword" in item) || !item.keyword || !("instruction" in item) || !item.instruction)) throw new Error("Keyword dan instruksi template wajib diisi");

  const now = new Date().toISOString();
  const record = {
    ...item,
    app_id: appId,
    status: "approved",
    active: typeof incoming.active === "boolean" ? incoming.active : existing?.[0]?.active !== false,
    reviewed_by: String(payload.username || "admin").trim().slice(0, 64),
    reviewed_at: now,
    updated_at: now,
    ...(!id ? { submitted_by: String(payload.username || "admin").trim().slice(0, 64) } : {}),
  };
  const data = id
    ? await supabaseRequest(`${table}?id=eq.${encodeURIComponent(id)}&app_id=eq.${encodeURIComponent(appId)}`, { method: "PATCH", body: JSON.stringify(record) })
    : await supabaseRequest(table, { method: "POST", body: JSON.stringify(record) });
  const saved = data?.[0];
  if (!saved) throw new Error("Item library gagal disimpan");

  if (resourceType === "template" && saved.active) {
    await supabaseRequest(`app_templates?app_id=eq.${encodeURIComponent(appId)}&keyword=eq.${encodeURIComponent(String(saved.keyword || ""))}&id=neq.${encodeURIComponent(saved.id)}&status=eq.approved&active=eq.true`, {
      method: "PATCH",
      body: JSON.stringify({ active: false, updated_at: now }),
    });
  }
  return saved;
}

function buildSearchFilter(keywords: string[]) {
  const clean = keywords.map((item) => item.toLowerCase().replace(/[^a-z0-9_\-\s]/gi, "").trim()).filter(Boolean);
  if (!clean.length) return "active=eq.true&order=updated_at.desc&limit=15";
  const orParts = clean.flatMap((keyword) => [
    `title.ilike.*${encodeURIComponent(keyword)}*`,
    `content.ilike.*${encodeURIComponent(keyword)}*`,
    `keywords.cs.{${encodeURIComponent(keyword)}}`,
    `diagnosis_tags.cs.{${encodeURIComponent(keyword)}}`,
  ]);
  return `active=eq.true&or=(${orParts.join(",")})&limit=30`;
}

function sanitizeAiConfig(config: Record<string, unknown>, appId: string, existing?: AdminAiConfig | null) {
  const provider = normalizeProviderKey(config.provider || "gemini");
  const providerLabel = String(config.provider_label || config.providerLabel || "").trim();
  const baseUrl = String(config.base_url || config.baseUrl || "").trim();
  const apiKey = String(config.api_key || config.apiKey || "").trim() || existing?.api_key || "";
  const fallbackApiKey = String(config.gemini_fallback_api_key || config.geminiFallbackApiKey || "").trim()
    || existing?.gemini_fallback_api_key
    || null;
  const model = String(config.model || existing?.model || "").trim();
  if (provider !== "gemini") {
    const endpoint = baseUrl || existing?.base_url || OPENAI_ENDPOINTS[provider] || "";
    if (!endpoint) throw new Error("Endpoint provider admin wajib diisi");
    if (!/^https?:\/\//i.test(endpoint)) throw new Error("Endpoint provider admin harus berupa URL http/https");
  }
  if (!apiKey) throw new Error("API key admin wajib diisi");
  if (!model) throw new Error("Model admin wajib diisi");
  return {
    app_id: appId,
    provider,
    provider_label: providerLabel || PROVIDER_LABELS[provider] || provider,
    base_url: provider === "gemini" ? null : (baseUrl || existing?.base_url || OPENAI_ENDPOINTS[provider] || null),
    api_key: apiKey,
    model,
    gemini_fallback_api_key: fallbackApiKey,
    gemini_fallback_model: String(config.gemini_fallback_model || config.geminiFallbackModel || "gemini-2.0-flash").trim(),
    updated_at: new Date().toISOString(),
  };
}

function publicAiConfig(config: AdminAiConfig | null) {
  if (!config) return null;
  return {
    app_id: config.app_id || config.id || "resume-medis-reviewer",
    provider: config.provider,
    providerLabel: config.provider_label || null,
    baseUrl: config.base_url || null,
    model: config.model,
    hasApiKey: Boolean(config.api_key),
    hasGeminiFallback: Boolean(config.gemini_fallback_api_key),
    geminiFallbackModel: config.gemini_fallback_model || "gemini-2.0-flash",
  };
}

function publicProvider(config: AdminAiConfig) {
  return {
    provider: config.provider,
    providerLabel: config.provider_label || PROVIDER_LABELS[config.provider] || config.provider,
    baseUrl: config.base_url || OPENAI_ENDPOINTS[config.provider] || null,
    model: config.model,
    active: config.active === true,
    hasApiKey: Boolean(config.api_key),
    hasGeminiFallback: Boolean(config.gemini_fallback_api_key),
    geminiFallbackModel: config.gemini_fallback_model || "gemini-2.0-flash",
  };
}

async function getAdminAiConfig(appId: string): Promise<AdminAiConfig | null> {
  const providerRows = await supabaseRequest(`admin_ai_providers?select=*&app_id=eq.${encodeURIComponent(appId)}&active=eq.true&provider=not.in.(genfity,x5lab)&limit=1`, {
    method: "GET",
    headers: { Prefer: "" },
  });
  if (providerRows?.[0]) return providerRows[0];

  const rows = await supabaseRequest(`admin_ai_config?select=*&app_id=eq.${encodeURIComponent(appId)}&provider=not.in.(genfity,x5lab)&limit=1`, {
    method: "GET",
    headers: { Prefer: "" },
  });
  return rows?.[0] || null;
}

async function getAdminAiProvider(appId: string, provider: string): Promise<AdminAiConfig | null> {
  const rows = await supabaseRequest(`admin_ai_providers?select=*&app_id=eq.${encodeURIComponent(appId)}&provider=eq.${encodeURIComponent(provider)}&limit=1`, {
    method: "GET",
    headers: { Prefer: "" },
  });
  return rows?.[0] || null;
}

async function listAdminAiProviders(appId: string): Promise<AdminAiConfig[]> {
  const rows = await supabaseRequest(`admin_ai_providers?select=*&app_id=eq.${encodeURIComponent(appId)}&provider=not.in.(genfity,x5lab)&order=provider.asc`, {
    method: "GET",
    headers: { Prefer: "" },
  });
  return rows || [];
}

async function getAdminAiUser(username: string): Promise<AdminAiUser | null> {
  const rows = await supabaseRequest(`admin_ai_users?select=*&username=eq.${encodeURIComponent(username)}&limit=1`, {
    method: "GET",
    headers: { Prefer: "" },
  });
  return rows?.[0] || null;
}

async function listAdminAiUsers(): Promise<AdminAiUser[]> {
  const rows = await supabaseRequest("admin_ai_users?select=*&order=username.asc", {
    method: "GET",
    headers: { Prefer: "" },
  });
  return rows || [];
}

function publicAdminUser(user: AdminAiUser) {
  return {
    id: user.id,
    username: user.username,
    active: user.active !== false,
    hasActiveDevice: Boolean(user.active_device_id),
    sessionExpiresAt: user.session_expires_at || null,
  };
}

async function createAdminAiUser(payload: Record<string, unknown>) {
  const userPayload = (payload.user && typeof payload.user === "object" ? payload.user : payload) as Record<string, unknown>;
  const username = normalizeUsername(userPayload.username);
  const password = String(userPayload.password || "").trim();
  if (password.length < 4) throw new Error("Password minimal 4 karakter");
  const existing = await getAdminAiUser(username);
  if (existing) throw new Error("Username sudah terdaftar");
  const user = {
    username,
    password_hash: await hashPassword(password, username),
    active: true,
    active_device_id: null,
    session_token: null,
    session_expires_at: null,
    updated_at: new Date().toISOString(),
  };
  const rows = await supabaseRequest("admin_ai_users", {
    method: "POST",
    body: JSON.stringify(user),
  });
  return rows?.[0] || user;
}

async function resetAdminAiUserPassword(payload: Record<string, unknown>) {
  const userPayload = (payload.user && typeof payload.user === "object" ? payload.user : payload) as Record<string, unknown>;
  const username = normalizeUsername(userPayload.username);
  const password = String(userPayload.password || "").trim();
  if (password.length < 4) throw new Error("Password minimal 4 karakter");
  const existing = await getAdminAiUser(username);
  if (!existing) throw new Error("Username tidak terdaftar");
  const rows = await supabaseRequest(`admin_ai_users?username=eq.${encodeURIComponent(username)}`, {
    method: "PATCH",
    body: JSON.stringify({
      password_hash: await hashPassword(password, username),
      active_device_id: null,
      session_token: null,
      session_expires_at: null,
      updated_at: new Date().toISOString(),
    }),
  });
  return rows?.[0] || null;
}

async function deleteAdminAiUser(payload: Record<string, unknown>) {
  const userPayload = (payload.user && typeof payload.user === "object" ? payload.user : payload) as Record<string, unknown>;
  const username = normalizeUsername(userPayload.username);
  await supabaseRequest(`admin_ai_users?username=eq.${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}

async function loginAdminAiUser(payload: Record<string, unknown>) {
  const username = normalizeUsername(payload.username);
  const password = String(payload.password || "").trim();
  const deviceId = String(payload.device_id || payload.deviceId || "").trim();
  if (!deviceId) throw new Error("Device ID tidak ditemukan");
  const user = await getAdminAiUser(username);
  if (!user || user.active === false) throw new Error("Username tidak terdaftar");
  const passwordHash = await hashPassword(password, username);
  if (passwordHash !== user.password_hash) throw new Error("Password salah");
  const session_token = makeSessionToken();
  const session_expires_at = getSessionExpiryIso(7);
  const rows = await supabaseRequest(`admin_ai_users?username=eq.${encodeURIComponent(username)}`, {
    method: "PATCH",
    body: JSON.stringify({
      active_device_id: deviceId,
      session_token,
      session_expires_at,
      updated_at: new Date().toISOString(),
    }),
  });
  const saved = rows?.[0] || { ...user, active_device_id: deviceId, session_token, session_expires_at };
  return {
    username: saved.username,
    sessionToken: saved.session_token,
    deviceId: saved.active_device_id,
    expiresAt: saved.session_expires_at,
  };
}

async function validateAdminAiUserSession(payload: Record<string, unknown>) {
  const username = normalizeUsername(payload.username);
  const deviceId = String(payload.device_id || payload.deviceId || "").trim();
  const sessionToken = String(payload.session_token || payload.sessionToken || "").trim();
  if (!deviceId || !sessionToken) throw new Error("Sesi login belum lengkap");
  const user = await getAdminAiUser(username);
  if (!user || user.active === false) throw new Error("Username tidak terdaftar");
  if (user.session_token !== sessionToken || user.active_device_id !== deviceId) {
    throw new Error("Sesi admin di perangkat ini sudah tidak aktif. Silakan login ulang.");
  }
  if (!user.session_expires_at || new Date(user.session_expires_at).getTime() < Date.now()) {
    throw new Error("Sesi admin sudah berakhir. Silakan login ulang.");
  }
  return {
    username: user.username,
    deviceId: user.active_device_id,
    expiresAt: user.session_expires_at,
  };
}

async function logoutAdminAiUser(payload: Record<string, unknown>) {
  const username = normalizeUsername(payload.username);
  const user = await getAdminAiUser(username);
  if (!user) return;
  await supabaseRequest(`admin_ai_users?username=eq.${encodeURIComponent(username)}`, {
    method: "PATCH",
    body: JSON.stringify({
      active_device_id: null,
      session_token: null,
      session_expires_at: null,
      updated_at: new Date().toISOString(),
    }),
  });
}

async function resetAdminAiProvider(appId: string, provider: string) {
  const existing = await getAdminAiProvider(appId, provider);
  if (!existing) throw new Error("Provider admin belum tersimpan");
  const patch = {
    api_key: "",
    gemini_fallback_api_key: null,
    updated_at: new Date().toISOString(),
  };
  const providerRows = await supabaseRequest(
    `admin_ai_providers?app_id=eq.${encodeURIComponent(appId)}&provider=eq.${encodeURIComponent(provider)}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
    }
  );
  const providerConfig = providerRows?.[0] || { ...existing, ...patch };
  const mirrorConfig = {
    app_id: appId,
    provider: existing.provider,
    provider_label: existing.provider_label || null,
    base_url: existing.base_url || null,
    api_key: "",
    model: existing.model,
    gemini_fallback_api_key: null,
    gemini_fallback_model: existing.gemini_fallback_model || "gemini-2.0-flash",
    updated_at: new Date().toISOString(),
  };
  await supabaseRequest("admin_ai_config?on_conflict=app_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(mirrorConfig),
  });
  const providers = await listAdminAiProviders(appId);
  return {
    config: publicAiConfig(providerConfig),
    providers: providers.map(publicProvider),
  };
}

async function saveAdminAiProvider(config: AdminAiConfig) {
  await supabaseRequest(`admin_ai_providers?app_id=eq.${encodeURIComponent(config.app_id || config.id || "")}`, {
    method: "PATCH",
    body: JSON.stringify({ active: false, updated_at: new Date().toISOString() }),
  });
  const providerPayload = { ...config, active: true };
  const data = await supabaseRequest("admin_ai_providers?on_conflict=app_id,provider", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(providerPayload),
  });
  await supabaseRequest("admin_ai_config?on_conflict=app_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(config),
  });
  return data?.[0] || providerPayload;
}

async function callGemini(config: AdminAiConfig, payload: Record<string, unknown>) {
  const responseSchema = payload.responseSchema;
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: String(payload.userPrompt || payload.prompt || "") }] }],
    generationConfig: {
      temperature: Number(payload.temperature ?? 0.2),
    },
  };
  if (payload.systemPrompt) body.systemInstruction = { parts: [{ text: String(payload.systemPrompt) }] };
  if (payload.responseJson) {
    body.generationConfig = {
      ...(body.generationConfig as Record<string, unknown>),
      responseMimeType: "application/json",
      ...(responseSchema ? { responseSchema } : {}),
    };
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.api_key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${text.slice(0, 200)}`);
  const data = parseFirstJsonValue(text);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function callOpenAiCompatible(config: AdminAiConfig, payload: Record<string, unknown>) {
  const endpoint = String(config.base_url || OPENAI_ENDPOINTS[config.provider] || "").trim();
  if (!endpoint) throw new Error("Provider admin tidak mendukung format OpenAI-compatible");
  const messages = [];
  if (payload.systemPrompt) messages.push({ role: "system", content: String(payload.systemPrompt) });
  messages.push({ role: "user", content: String(payload.userPrompt || payload.prompt || "") });
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.api_key}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: Number(payload.temperature ?? 0.2),
      ...(payload.responseJson ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Provider API ${res.status}: ${text.slice(0, 200)}`);
  const data = parseFirstJsonValue(text);
  return data?.choices?.[0]?.message?.content || "";
}

function normalizeVisionImage(payload: Record<string, unknown>) {
  const image = (payload.image || {}) as Record<string, unknown>;
  const mimeType = String(image.mime_type || image.mimeType || "").trim().toLowerCase();
  const dataBase64 = String(image.data_base64 || image.dataBase64 || "").replace(/\s+/g, "");
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    throw new Error("Format gambar harus JPG, PNG, atau WebP");
  }
  if (!dataBase64 || dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
    throw new Error("Data gambar tidak valid");
  }
  const padding = dataBase64.endsWith("==") ? 2 : dataBase64.endsWith("=") ? 1 : 0;
  if (Math.floor(dataBase64.length * 3 / 4) - padding > 8 * 1024 * 1024) {
    throw new Error("Ukuran gambar maksimal 8 MB");
  }
  return { mimeType, dataBase64 };
}

async function callGeminiVision(config: AdminAiConfig, payload: Record<string, unknown>) {
  const { mimeType, dataBase64 } = normalizeVisionImage(payload);
  const prompt = String(payload.userPrompt || payload.prompt || "").trim();
  if (!prompt) throw new Error("Prompt vision wajib diisi");
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType, data: dataBase64 } }] }],
    generationConfig: { temperature: Number(payload.temperature ?? 0.1) },
  };
  if (payload.systemPrompt) body.systemInstruction = { parts: [{ text: String(payload.systemPrompt) }] };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.api_key)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${text.slice(0, 200)}`);
  const data = parseFirstJsonValue(text);
  return data?.candidates?.[0]?.content?.parts?.map((part: Record<string, unknown>) => part.text || "").join("") || "";
}

async function callOpenAiCompatibleVision(config: AdminAiConfig, payload: Record<string, unknown>) {
  const endpoint = String(config.base_url || OPENAI_ENDPOINTS[config.provider] || "").trim();
  if (!endpoint) throw new Error("Provider admin tidak mendukung format OpenAI-compatible");
  const { mimeType, dataBase64 } = normalizeVisionImage(payload);
  const prompt = String(payload.userPrompt || payload.prompt || "").trim();
  if (!prompt) throw new Error("Prompt vision wajib diisi");
  const messages = [];
  if (payload.systemPrompt) messages.push({ role: "system", content: String(payload.systemPrompt) });
  messages.push({
    role: "user",
    content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${dataBase64}`, detail: "high" } },
    ],
  });
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.api_key}` },
    body: JSON.stringify({ model: config.model, messages, temperature: Number(payload.temperature ?? 0.1) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Provider API ${res.status}: ${text.slice(0, 200)}`);
  const data = parseFirstJsonValue(text);
  return data?.choices?.[0]?.message?.content || "";
}

async function callAdminVision(payload: Record<string, unknown>) {
  const session = await validateAdminAiUserSession(payload.user_session || {});
  const appId = getAppId(payload);
  const startedAt = Date.now();
  let config: AdminAiConfig | null = null;
  try {
    config = await getAdminAiConfig(appId);
    if (!config?.api_key) throw new Error("API key admin belum diset");
    const text = config.provider === "gemini"
      ? await callGeminiVision(config, payload)
      : await callOpenAiCompatibleVision(config, payload);
    if (!String(text || "").trim()) throw new Error("Respons vision AI admin kosong");
    await writeUsageLog({
      app_id: appId,
      username: session.username,
      event_type: "api_call",
      feature: normalizeLogLabel(payload.feature, "ai_generate_vision"),
      provider: config.provider,
      model: config.model,
      success: true,
      duration_ms: Date.now() - startedAt,
      input_chars: String(payload.systemPrompt || "").length + String(payload.userPrompt || payload.prompt || "").length,
      output_chars: String(text).length,
    });
    return text;
  } catch (error) {
    await writeUsageLog({
      app_id: appId,
      username: session.username,
      event_type: "api_call",
      feature: normalizeLogLabel(payload.feature, "ai_generate_vision"),
      provider: config?.provider || null,
      model: config?.model || null,
      success: false,
      error_message: safeAiError(error),
      duration_ms: Date.now() - startedAt,
      input_chars: String(payload.systemPrompt || "").length + String(payload.userPrompt || payload.prompt || "").length,
      output_chars: 0,
    });
    throw error;
  }
}

async function callAdminAi(payload: Record<string, unknown>) {
  const session = await validateAdminAiUserSession(payload.user_session || {});
  const appId = getAppId(payload);
  const startedAt = Date.now();
  let config: AdminAiConfig | null = null;
  let provider = "";
  let model = "";
  try {
    config = await getAdminAiConfig(appId);
    if (!config?.api_key) throw new Error("API key admin belum diset");
    provider = config.provider;
    model = config.model;
    let text = "";
    try {
      text = config.provider === "gemini"
        ? await callGemini(config, payload)
        : await callOpenAiCompatible(config, payload);
    } catch (error) {
      if (config.provider === "gemini" || !config.gemini_fallback_api_key) throw error;
      provider = "gemini-fallback";
      model = config.gemini_fallback_model || "gemini-2.0-flash";
      text = await callGemini(
        {
          ...config,
          provider: "gemini",
          api_key: config.gemini_fallback_api_key,
          model,
        },
        payload,
      );
    }
    if (!String(text || "").trim()) throw new Error("Respons AI admin kosong");
    await writeUsageLog({
      app_id: appId,
      username: session.username,
      event_type: "api_call",
      feature: normalizeLogLabel(payload.feature, "ai_generate"),
      provider,
      model,
      success: true,
      duration_ms: Date.now() - startedAt,
      input_chars: String(payload.systemPrompt || "").length
        + String(payload.userPrompt || payload.prompt || "").length,
      output_chars: String(text).length,
    });
    return text;
  } catch (error) {
    await writeUsageLog({
      app_id: appId,
      username: session.username,
      event_type: "api_call",
      feature: normalizeLogLabel(payload.feature, "ai_generate"),
      provider: provider || config?.provider || null,
      model: model || config?.model || null,
      success: false,
      error_message: safeAiError(error),
      duration_ms: Date.now() - startedAt,
      input_chars: String(payload.systemPrompt || "").length
        + String(payload.userPrompt || payload.prompt || "").length,
      output_chars: 0,
    });
    throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const payload = await req.json();
    const action = payload.action;

    if (action === "login") {
      assertAdmin(payload);
      return json({ ok: true });
    }

    if (action === "search") {
      const keywords = normalizeList(payload.keywords);
      const data = await supabaseRequest(`knowledge_chunks?select=*&${buildSearchFilter(keywords)}`, {
        method: "GET",
        headers: { Prefer: "" },
      });
      return json({ chunks: data || [] });
    }

    if (action === "list_active") {
      const data = await supabaseRequest(
        "knowledge_chunks?select=id,title,content,category,keywords,diagnosis_tags&active=eq.true&order=updated_at.desc&limit=200",
        { method: "GET", headers: { Prefer: "" } },
      );
      return json({ chunks: data || [] });
    }

    if (action === "get_ai_config") {
      const appId = getAppId(payload);
      const config = await getAdminAiConfig(appId);
      const providers = await listAdminAiProviders(appId);
      return json({ config: publicAiConfig(config), providers: providers.map(publicProvider) });
    }

    if (action === "ai_generate") {
      const text = await callAdminAi(payload);
      return json({ text });
    }

    if (action === "ai_generate_vision") {
      const text = await callAdminVision(payload);
      return json({ text });
    }

    if (action === "login_user") {
      const session = await loginAdminAiUser(payload);
      await writeUsageLog({
        app_id: getAppId(payload),
        username: session.username,
        event_type: "login",
        success: true,
      });
      return json({ session });
    }

    if (action === "validate_user_session") {
      return json({ session: await validateAdminAiUserSession(payload) });
    }

    if (action === "logout_user") {
      await logoutAdminAiUser(payload);
      return json({ ok: true });
    }

    if (action === "claim_library_list") {
      return json(await listClaimLibrary(payload));
    }

    if (action === "claim_library_submit_knowledge") {
      return json({ knowledge: await submitClaimKnowledge(payload) });
    }

    if (action === "claim_library_submit_template") {
      return json({ template: await submitClaimTemplate(payload) });
    }

    assertAdmin(payload);

    if (action === "claim_library_admin_list") {
      return json(await listClaimLibraryReviews(payload));
    }

    if (action === "claim_library_admin_review") {
      return json({ item: await reviewClaimLibraryItem(payload) });
    }

    if (action === "claim_library_admin_manage") {
      return json({ item: await manageClaimLibraryItem(payload) });
    }

    if (action === "usage_logs") {
      const appId = getAppId(payload);
      const limit = Math.min(Math.max(Number(payload.limit) || 500, 1), 1000);
      const days = Math.min(Math.max(Number(payload.days) || 30, 1), 365);
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const data = await supabaseRequest(
        `app_usage_logs?select=*&app_id=eq.${encodeURIComponent(appId)}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=${limit}`,
        { method: "GET", headers: { Prefer: "" } },
      );
      return json({ logs: data || [] });
    }

    if (action === "list_users") {
      const users = await listAdminAiUsers();
      return json({ users: users.map(publicAdminUser) });
    }

    if (action === "create_user") {
      const user = await createAdminAiUser(payload);
      return json({ user: publicAdminUser(user) });
    }

    if (action === "reset_user_password") {
      const user = await resetAdminAiUserPassword(payload);
      return json({ user: user ? publicAdminUser(user) : null });
    }

    if (action === "delete_user") {
      await deleteAdminAiUser(payload);
      return json({ ok: true });
    }

    if (action === "save_ai_config") {
      const appId = getAppId(payload);
      const incoming = (payload.config || {}) as Record<string, unknown>;
      const provider = normalizeProviderKey(incoming.provider || "gemini");
      const existing = await getAdminAiProvider(appId, provider);
      const config = sanitizeAiConfig(incoming, appId, existing);
      const saved = await saveAdminAiProvider(config);
      const providers = await listAdminAiProviders(appId);
      return json({ config: publicAiConfig(saved), providers: providers.map(publicProvider) });
    }

    if (action === "validate_ai_config") {
      const appId = getAppId(payload);
      const incoming = (payload.config || {}) as Record<string, unknown>;
      const provider = normalizeProviderKey(incoming.provider || "gemini");
      const existing = await getAdminAiProvider(appId, provider);
      const config = sanitizeAiConfig(incoming, appId, existing);
      const text = config.provider === "gemini"
        ? await callGemini(config, { prompt: "Balas OK.", temperature: 0 })
        : await callOpenAiCompatible(config, { prompt: "Balas OK.", temperature: 0 });
      if (config.provider !== "gemini" && config.gemini_fallback_api_key) {
        await callGemini(
          {
            ...config,
            provider: "gemini",
            api_key: config.gemini_fallback_api_key,
            model: config.gemini_fallback_model || "gemini-2.0-flash",
          },
          { prompt: "Balas OK.", temperature: 0 },
        );
      }
      return json({ ok: true, preview: String(text || "").slice(0, 40) });
    }

    if (action === "reset_ai_config") {
      const appId = getAppId(payload);
      const provider = normalizeProviderKey(payload.provider || (await getAdminAiConfig(appId))?.provider || "gemini");
      return json(await resetAdminAiProvider(appId, provider));
    }

    if (action === "create") {
      const chunk = sanitizeChunk(payload.chunk || {});
      if (!chunk.title || !chunk.content) throw new Error("Judul dan isi knowledge wajib diisi");
      const data = await supabaseRequest("knowledge_chunks", {
        method: "POST",
        body: JSON.stringify(chunk),
      });
      return json({ chunk: data?.[0] || null });
    }

    if (action === "bulk_create") {
      const chunks = (payload.chunks || []).map(sanitizeChunk).filter((chunk: KnowledgeChunk) => chunk.title && chunk.content);
      if (!chunks.length) throw new Error("Tidak ada chunk valid untuk disimpan");
      const data = await supabaseRequest("knowledge_chunks", {
        method: "POST",
        body: JSON.stringify(chunks),
      });
      return json({ chunks: data || [] });
    }

    if (action === "list") {
      const data = await supabaseRequest("knowledge_chunks?select=*&order=updated_at.desc&limit=50", {
        method: "GET",
        headers: { Prefer: "" },
      });
      return json({ chunks: data || [] });
    }

    if (action === "update") {
      const id = String(payload.id || "");
      if (!id) throw new Error("ID wajib diisi");
      const patch = sanitizeChunk(payload.chunk || {});
      const data = await supabaseRequest(`knowledge_chunks?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
      });
      return json({ chunk: data?.[0] || null });
    }

    if (action === "delete") {
      const id = String(payload.id || "");
      if (!id) throw new Error("ID wajib diisi");
      await supabaseRequest(`knowledge_chunks?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      return json({ ok: true });
    }

    return json({ error: "Action tidak dikenal" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 400);
  }
});

