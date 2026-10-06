import type { AuditEntry } from "../../types";
import { getLocal, setLocal } from "../storage/local";

const AUDIT_KEY = "claimClarify.audit";

export async function appendAuditEntry(entry: AuditEntry): Promise<void> {
  const existing = await getLocal<AuditEntry[]>(AUDIT_KEY, []);
  await setLocal(AUDIT_KEY, [entry, ...existing].slice(0, 200));
}

export function listAuditEntries(): Promise<AuditEntry[]> {
  return getLocal<AuditEntry[]>(AUDIT_KEY, []);
}

export async function removeAuditEntry(id: string): Promise<void> {
  const existing = await getLocal<AuditEntry[]>(AUDIT_KEY, []);
  await setLocal(AUDIT_KEY, existing.filter((entry) => entry.id !== id));
}

export async function replaceAuditEntries(entries: AuditEntry[]): Promise<void> {
  await setLocal(AUDIT_KEY, entries.slice(0, 200));
}
