export function extractJsonValue(text: string) {
  const clean = text.trim().replace(/^```(?:json)?/i, "").trim();
  const start = clean.search(/[\[{]/);
  if (start === -1) throw new Error("Respons AI bukan JSON valid.");

  const open = clean[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < clean.length; i += 1) {
    const char = clean[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return clean.slice(start, i + 1);
    }
  }

  throw new Error("Respons AI bukan JSON valid.");
}
