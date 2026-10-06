# Claim Clarify Shared Library

This folder contains additive changes for the existing `knowledge-admin` Supabase Edge Function.

Deployment order:

1. Run `migrations/20260812000100_add_claim_clarify_library.sql` once.
2. Deploy `functions/knowledge-admin/index.ts` over the existing function.
3. Reload the Claim Clarify extension.

Compatibility rules:

- Existing tables and actions are unchanged.
- Legacy `knowledge_chunks` remains global for Resume Medis Reviewer.
- New actions use the `claim_library_*` prefix and reject any `app_id` except `claim-clarify`.
- User submissions require a valid admin-user session and always start as `pending`.
- Owner approval/rejection requires the existing backend admin credentials.
- Owner CRUD for approved Claim Clarify knowledge/templates uses the additive `claim_library_admin_manage` action and remains scoped to `app_id=claim-clarify`.
- Only approved, active resources are returned to Claim Clarify for generation.
