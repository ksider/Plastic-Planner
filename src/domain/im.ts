import type { ImParamDef } from "../types.js";

export function parseListNumbers(raw: string): number[] {
  const matches = raw.match(/-?\d+(?:[.,]\d+)?/g) || [];
  return matches
    .map((v) => v.replace(",", "."))
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

export function parseNumberFlexible(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  const text = String(raw).trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

export function normalizeFieldValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length ? String(value[value.length - 1]) : "";
  }
  return value === undefined || value === null ? "" : String(value);
}

export function normalizeCheckbox(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.map(String).includes("1");
  }
  return String(value) === "1";
}

export function groupByStage(defs: ImParamDef[]) {
  const stages = new Map<string, Map<string, ImParamDef[]>>();
  defs.forEach((def) => {
    const stage = def.stage || "OTHER";
    const group = def.group_label || "Other";
    if (!stages.has(stage)) stages.set(stage, new Map());
    const stageGroups = stages.get(stage)!;
    if (!stageGroups.has(group)) stageGroups.set(group, []);
    stageGroups.get(group)!.push(def);
  });
  return stages;
}

export function getImDefaultConfig(def: ImParamDef) {
  const isMoisture = def.code === "material_moisture_pct";
  const isCushion = def.code === "cushion_target";
  if (isMoisture) {
    return {
      mode: "RANGE",
      active: 1,
      fixed_value: null,
      range_min: def.min_default ?? null,
      range_max: def.max_default ?? def.min_default ?? null,
    };
  }
  if (isCushion) {
    return {
      mode: "RANGE",
      active: 0,
      fixed_value: null,
      range_min: def.min_default ?? null,
      range_max: def.max_default ?? def.min_default ?? null,
    };
  }
  return {
    mode: "FIXED",
    active: 0,
    fixed_value: def.min_default ?? null,
    range_min: null,
    range_max: null,
  };
}
