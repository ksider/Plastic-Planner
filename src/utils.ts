export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function computeWeights(
  parts: Record<string, number>,
  finalMass: number,
  roundStep = 0.1
): {
  grams: Record<string, number>;
  total_g: number;
} {
  const totalParts = Object.values(parts).reduce((a, b) => a + b, 0);
  const gPerPart = totalParts > 0 ? finalMass / totalParts : 0;
  const roundTo = (v: number) => Math.round(v / roundStep) * roundStep;

  const grams: Record<string, number> = {};
  for (const [name, value] of Object.entries(parts)) {
    grams[name] = roundTo(value * gPerPart);
  }
  const total_g = roundTo(Object.values(grams).reduce((a, b) => a + b, 0));

  return { grams, total_g };
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomize<T>(arr: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

export function sd(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values);
  if (m === null) return null;
  const variance =
    values.reduce((acc, v) => acc + Math.pow(v - m, 2), 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

export function toCsv(rows: string[][]): string {
  const escape = (v: string) => {
    if (v.includes(",") || v.includes("\n") || v.includes('"')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  return rows.map((r) => r.map(escape).join(",")).join("\n");
}

export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.join("\t")).join("\n");
}

export function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const v = typeof value === "string" ? value.trim() : value;
  if (v === "") return null;
  const num = Number(v);
  return Number.isFinite(num) ? num : null;
}
