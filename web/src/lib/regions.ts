// Region presets offered when an admin names a platform server. Slug is stored
// in worker_servers.region; the picker maps it to flag + friendly name. Custom
// slugs still work — they just fall back to a globe.
export interface RegionPreset {
  slug: string;
  name: string;
  flag: string;
}

export const REGION_PRESETS: RegionPreset[] = [
  { slug: "us-east", name: "US East (Virginia)", flag: "🇺🇸" },
  { slug: "us-west", name: "US West (Oregon)", flag: "🇺🇸" },
  { slug: "eu-central", name: "EU Central (Germany)", flag: "🇩🇪" },
  { slug: "eu-west", name: "EU West (Ireland)", flag: "🇮🇪" },
  { slug: "uk", name: "UK (London)", flag: "🇬🇧" },
  { slug: "asia-south", name: "Asia South (Mumbai)", flag: "🇮🇳" },
  { slug: "asia-southeast", name: "Asia SE (Singapore)", flag: "🇸🇬" },
  { slug: "asia-east", name: "Asia East (Tokyo)", flag: "🇯🇵" },
  { slug: "africa", name: "Africa (Lagos)", flag: "🇳🇬" },
  { slug: "primary", name: "Deployzy Cloud", flag: "☁️" },
];

const bySlug = new Map(REGION_PRESETS.map((r) => [r.slug, r]));

export function regionName(slug: string, fallbackLabel?: string): string {
  return bySlug.get(slug)?.name || fallbackLabel || slug || "Deployzy Cloud";
}

export function regionFlag(slug: string): string {
  return bySlug.get(slug)?.flag || "☁️";
}
