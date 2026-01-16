export function formatNumber(value: unknown, digits = 3): string {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "";
  const fixed = num.toFixed(digits);
  return fixed.replace(/\.?0+$/, "");
}
