type JsonValue = Record<string, unknown>;

export function extractProviderText(raw: unknown): string {
  const data = asObject(raw);
  if (!data) return "";

  const direct = [
    data.output_text,
    data.completion,
    data.text,
    data.response,
    data.content,
    asObject(data.message)?.content,
    asObject(first(data.choices))?.text,
    asObject(asObject(first(data.choices))?.message)?.content,
    asObject(first(data.choices))?.delta,
  ];

  for (const candidate of direct) {
    const text = stringifyContent(candidate);
    if (text) return text;
  }

  const candidateText = array(data.candidates)
    .flatMap((item) => array(asObject(asObject(item)?.content)?.parts))
    .map(stringifyContent)
    .join("")
    .trim();
  if (candidateText) return candidateText;

  return array(data.output)
    .flatMap((item) => array(asObject(item)?.content))
    .map(stringifyContent)
    .join("")
    .trim();
}

export function requireProviderText(raw: unknown): string {
  const text = extractProviderText(raw);
  if (!text) throw new Error("Provider AI tidak mengirim teks jawaban. Periksa endpoint, model, dan format respons.");
  return text;
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(stringifyContent).join("").trim();

  const object = asObject(value);
  if (!object) return "";

  return stringifyContent(object.text ?? object.content ?? object.value);
}

function asObject(value: unknown): JsonValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonValue) : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function first(value: unknown): unknown {
  return array(value)[0];
}
