const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Split a single "line" at any place where the value is followed by 2+
// whitespace chars and then another uppercase KEY=... token. This recovers
// from paste sources that lose newlines between KVs — the original bug was a
// connection string + JWT glued together by a run of spaces instead of \n.
const BOUNDARY_RE = /\s{2,}(?=[A-Z_][A-Z0-9_]*=)/;

export function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/[\r\n]+/)) {
    for (const part of raw.split(BOUNDARY_RE)) {
      const trimmed = part.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!KEY_RE.test(key)) continue;
      out[key] = trimmed.slice(eq + 1).trim();
    }
  }
  return out;
}

export function formatEnvVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

export function autoFormatEnvText(text: string): string {
  return formatEnvVars(parseEnvText(text));
}
