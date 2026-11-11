// Country helpers for analytics lists: ISO-3166 alpha-2 code → flag emoji and
// English name. Unknown or non-2-letter codes fall back gracefully.

export function flag(cc: string) {
  if (!cc || cc.length !== 2) return "🌐";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

let names: Intl.DisplayNames | null = null;
export function countryName(cc: string) {
  if (!cc || cc.length !== 2) return cc || "Unknown";
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(cc.toUpperCase()) || cc;
  } catch { return cc; }
}
