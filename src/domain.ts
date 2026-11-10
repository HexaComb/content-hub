export type Direction = "higher" | "lower" | "neutral";
export type Quality = "complete" | "partial" | "missing";
export type Reading = { value: number | null; quality: Quality };

export function monthRange(month: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) < 1000)
    throw new Error("Use a calendar month in YYYY-MM format (year >= 1000).");
  const [year, m] = month.split("-").map(Number);
  return { start: `${month}-01`, end: `${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01` };
}

export function previousMonth(month: string): string {
  monthRange(month);
  const [year, m] = month.split("-").map(Number);
  return `${m === 1 ? year - 1 : year}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
}

export function compareReadings(current: Reading | null, previous: Reading | null, direction: Direction, unit: string) {
  if (!current || !previous || current.value === null || previous.value === null ||
      current.quality !== "complete" || previous.quality !== "complete") {
    return { current, previous, delta: null, relativePercent: null, percentagePoints: null, change: "not_comparable", reason: "missing_or_partial_period" };
  }
  if (!Number.isFinite(current.value) || !Number.isFinite(previous.value)) throw new Error("Values must be finite.");
  const delta = current.value - previous.value;
  if (!Number.isFinite(delta)) return { current, previous, delta: null, relativePercent: null, percentagePoints: null, change: "not_comparable", reason: "numeric_change_out_of_range" };
  const relative = previous.value === 0 ? null : delta / Math.abs(previous.value) * 100;
  const relativeInRange = relative === null || Number.isFinite(relative);
  return {
    current, previous, delta,
    relativePercent: relativeInRange ? relative : null,
    percentagePoints: unit === "percent" ? delta : null,
    change: delta === 0 ? "unchanged" : direction === "neutral" ? "changed" : (delta > 0) === (direction === "higher") ? "improved" : "declined",
    reason: previous.value === 0 ? "zero_baseline" : relativeInRange ? null : "relative_change_out_of_range",
  };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}
