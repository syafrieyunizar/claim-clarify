# AGENTS.md — Claim Clarify

Guidance for AI coding agents (Claude Code, Cursor, Codex, etc.) and human contributors working on this repository.

**Status:** Pre-implementation. Only planning artifacts exist so far (`PRD.md`, `claim-clarify-wireframe.jsx`). No project has been scaffolded yet — if you are starting implementation, bootstrap the project structure described below before writing feature code.

---

## 1. What this project is

Claim Clarify is a Google Chrome Extension (Manifest V3) that opens as a **Side Panel**. It helps hospital *Dokter Casemix* and *Verifikator JKN* draft responses to BPJS Kesehatan pending-claim queries, grounded in the user's own regulation documents (RAG-style), using a **bring-your-own-key (BYOK)** AI backend.

Read `PRD.md` first — it is the source of truth for product behavior. This file (`AGENTS.md`) is the source of truth for *how to build it*. `claim-clarify-wireframe.jsx` is the source of truth for UI structure, component naming, copy (in Indonesian), and visual tokens — real components should map to it 1:1 rather than being redesigned from scratch.

---

## 2. Non-negotiable architectural rules

These come directly from PRD decisions. Do not silently change them; if a task seems to require violating one, stop and flag it instead of proceeding.

1. **No backend server.** The extension calls the user's configured AI endpoint (Anthropic-compatible or OpenAI-compatible) directly from the client. Never introduce a proxy/relay server owned by this project — that would defeat the BYOK privacy model.
2. **API keys stay local.** Store in `chrome.storage.local`, never `chrome.storage.sync` (sync would push the key to Google's servers across devices). Never log keys. Never send keys anywhere except the Authorization header of the user's own configured endpoint.
3. **Knowledge base priority is fixed:** locally uploaded PDFs/spreadsheets are always checked first. Web search is a **fallback only**, triggered when nothing relevant is found locally. Don't reorder this or make search "smart-default" to internet-first.
4. **Case data and drafts stay local.** Knowledge and templates may remain local or be explicitly submitted to the moderated Claim Clarify library in Supabase. Only owner-approved items are shared across logged-in Claim Clarify accounts; rejected/pending items are never used for generation. Import/Export remains available for local backup.
5. **Every processed case must produce an audit log entry** — timestamp, workflow type, input reference, generated output (FR-18). This is a compliance requirement, not optional telemetry, and it must also stay local (see rule 2's spirit — no third-party analytics for this data).
6. **Output contract for Workflow 1 & 2 is fixed:** two parts — (1) short case summary, (2) "Jawaban Pending": a single professional-tone paragraph, no bullet points, one-click copy. Enforce this in the AI prompt *and* validate the response shape before rendering (e.g., reject/retry if the model returns a bulleted list).
7. **Workflow 3 output is fully template-driven.** If a user's keyword doesn't match any saved template, don't silently fall back to the default format — surface the mismatch and let the user choose (PRD §5.4, step 5).
8. **Readmisi workflow requires ≥2 uploaded files.** Validate in the UI before allowing "Proses Dokumen," not only via an AI check.
9. **No medical record content leaves the device** except in the outbound request to the user's own configured AI endpoint. No third-party crash/analytics SDKs that could capture PHI.

---

## 3. Proposed tech stack

Not yet locked in code, but this is the intended stack — follow it unless there's a strong reason to deviate (and note the reason if you do):

| Concern | Choice |
|---|---|
| Extension platform | Manifest V3, `sidePanel` API |
| UI | React + TypeScript |
| Bundler | Vite + `@crxjs/vite-plugin` (handles MV3 + HMR for extensions) |
| Styling | Tailwind CSS |
| Icons | `lucide-react` (already used in the wireframe) |
| PDF parsing | `pdf.js` (`pdfjs-dist`) |
| Storage | `chrome.storage.local` for settings, local drafts/templates/audit metadata; IndexedDB for larger local blobs; Supabase for the moderated Claim Clarify knowledge/template library |
| AI calls | Native `fetch` to Anthropic Messages API or an OpenAI-compatible Chat Completions endpoint — no SDK lock-in, since the endpoint is user-configurable |

---

## 4. Target project structure

```
claim-clarify/
├── AGENTS.md
├── PRD.md
├── manifest.json
├── package.json
├── vite.config.ts
├── src/
│   ├── sidepanel/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── views/
│   │   │   ├── Home/               # workflow select → input → processing → question → output
│   │   │   └── Settings/           # ai / knowledge / template / history tabs
│   │   └── components/             # WorkflowCard, PanelButton, StepDots, InputMethodTabs, etc.
│   │                                 (names/props should mirror claim-clarify-wireframe.jsx)
│   ├── workflows/
│   │   ├── standard.ts
│   │   ├── readmisi.ts             # includes auto-detection heuristic (PRD §5.3 step 2)
│   │   └── template.ts             # keyword → template matching (PRD §5.4)
│   ├── background/
│   │   └── service-worker.ts       # opens side panel, handles tab-context reads
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── provider.ts         # shared interface
│   │   │   ├── anthropic.ts
│   │   │   └── openaiCompatible.ts
│   │   ├── pdf/
│   │   │   └── parse.ts            # upload / link / active-tab extraction
│   │   ├── storage/
│   │   │   ├── local.ts            # chrome.storage.local wrapper
│   │   │   └── indexeddb.ts        # KB blob storage
│   │   ├── knowledge/
│   │   │   └── retrieve.ts         # local-first retrieval, web-search fallback
│   │   └── audit/
│   │       └── log.ts
│   ├── theme.ts                    # color tokens extracted from the wireframe (INK, TEAL, PLUM, AMBER, MIST, SLATE, ...)
│   └── types/
├── public/icons/
└── tests/
```

---

## 5. AI provider abstraction

Implement one interface both providers satisfy:

```ts
interface AIProvider {
  send(input: { systemPrompt: string; userMessage: string; context: string[] }, config: AIConfig): Promise<{ text: string; raw: unknown }>;
  testConnection(config: AIConfig): Promise<{ ok: boolean; message: string }>;
}

interface AIConfig {
  provider: "anthropic" | "openai-compatible";
  endpoint: string;
  model: string;
  apiKey: string;
}
```

- `anthropic.ts` targets the Messages API shape; `openaiCompatible.ts` targets Chat Completions shape. Normalize both to `{ text, raw }` before returning to UI code — UI components should never branch on provider type.
- "Test Connection" (Settings → AI tab) sends a minimal message and reports success/failure without leaking the key in any error text shown to the user.

---

## 6. PDF parsing

Three entry points, one shared extraction function:

- **Upload**: `File` object → `pdfjs-dist` text extraction.
- **Link**: fetch the URL (respect CORS/permission constraints — likely needs `host_permissions` or `optional_host_permissions`), then parse the same way.
- **Active tab**: when the user is viewing a PDF in Chrome's built-in viewer, read it via the tab's URL/content through `chrome.tabs` + `scripting` (test this path early — Chrome's native PDF viewer has known quirks for extension access).

If extraction fails (e.g., scanned/no text layer), fall back to letting the user paste text manually rather than failing the flow outright.

---

## 7. Coding conventions

- TypeScript, strict mode on.
- Functional components + hooks only.
- Keep workflow business logic (readmisi detection, template matching, prompt construction) in `src/workflows/*` and `src/lib/*` — not inline in components.
- Reuse the design tokens and component names already prototyped in `claim-clarify-wireframe.jsx` (`WorkflowCard`, `PanelButton`, `StepDots`, `InputMethodTabs`, `SettingsView`) instead of re-deriving new patterns.
- Indonesian stays in user-facing copy (labels, prompts, buttons); code identifiers, comments, and this file stay in English, matching standard JS/TS ecosystem convention.

---

## 8. Manifest permissions (minimum set)

Request only what's needed, and justify each in a manifest comment or PR description:

- `sidePanel` — core UI surface
- `storage` — settings/templates/audit metadata
- `activeTab` / `scripting` — reading the PDF in the currently open tab
- `tabs` — only if `activeTab` proves insufficient for detecting the open PDF
- `downloads` — only if/when export-to-file features ship
- host permissions — scope as narrowly as possible for the "link" input mode; prefer `optional_host_permissions` requested at time of use over broad `<all_urls>`.

---

## 9. Testing

- **Unit**: PDF parsing utils, AI provider adapters (mock fetch), template keyword matcher, readmisi auto-detection heuristic.
- **E2E**: Playwright with the extension loaded unpacked, covering all three workflows end-to-end (select → input → confirm → output → copy).
- Before merging any change to `src/lib/ai/*` or `src/lib/storage/*`, run through the security checklist below.

---

## 10. Security & privacy checklist (check before every PR touching data flow)

- [ ] No API key or medical record content in `console.log` / error messages
- [ ] No PHI sent anywhere except the user-configured AI endpoint
- [ ] Secrets in `chrome.storage.local`, never `chrome.storage.sync`
- [ ] No new third-party analytics/crash-reporting SDK added without explicit review
- [ ] New manifest permissions are minimal and documented

---

## 11. Domain glossary

For agents unfamiliar with Indonesian healthcare claims:

- **BPJS Kesehatan** — Indonesia's national health insurance body (the payer).
- **Klaim Pending** — a submitted claim BPJS has paused/queried rather than outright approved or rejected.
- **Dokter Casemix** — hospital physician responsible for clinical coding and defending claims.
- **Verifikator JKN** — hospital staff who verify claims and communicate with BPJS.
- **INA-CBG** — Indonesia's case-based-groups tariff system for hospital claims.
- **Readmisi** — readmission; a patient returning to inpatient care shortly after a prior discharge, which BPJS scrutinizes for validity.
- **SEP** (Surat Eligibilitas Peserta) — the eligibility reference number tied to each claim episode.

---

## 12. Reference documents in this repo

- `PRD.md` — full product requirements, decision log, and open questions.
- `claim-clarify-wireframe.jsx` — interactive UI/UX reference (component structure, flow, copy, color tokens).

---

## 13. Release packaging

- After every application change, increment the patch version and keep `manifest.json`, `package.json`, and `package-lock.json` synchronized.
- Run `npm run package:extension` so the Chrome upload ZIP is rebuilt from the latest source. The packaging script removes older `release/claim-clarify-v*.zip` files, leaving only the current version.
- The command writes `release/claim-clarify-v<manifest-version>.zip` with `manifest.json` at the archive root.
- After verification, commit the update and push it to the configured Git remote. If Git or its remote is not configured, report the blocker instead of inventing one.
