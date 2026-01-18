import type { SampleFieldDef } from "../types.js";
import { parseSampleFields } from "./experiments.js";
import { mean, sd } from "../utils.js";

export const EXTRUSION_GEOMETRY_CODES = new Set([
  "piston_diameter_mm",
  "nozzle_diameter_mm",
  "nozzle_length_mm",
  "cold_capillary_diameter_mm",
  "cold_capillary_length_mm",
  "wheel_diameter_mm",
  "pressure_coeff_kp",
]);

export type ExtrusionGeometry = {
  piston_diameter_mm: number | null;
  nozzle_diameter_mm: number | null;
  nozzle_length_mm: number | null;
  cold_capillary_diameter_mm: number | null;
  cold_capillary_length_mm: number | null;
  wheel_diameter_mm: number | null;
  pressure_coeff_kp: number | null;
};

export function defaultExtrusionOutputFields(): SampleFieldDef[] {
  return [
    {
      key: "wheel_rpm",
      label: "Wheel RPM",
      type: "number",
      analyze: false,
      is_default: true,
    },
  ];
}

export function parseExtrusionOutputFields(
  raw: string | null | undefined
): SampleFieldDef[] {
  const parsed = parseSampleFields(raw);
  return mergeExtrusionDefaultFields(parsed);
}

export function mergeExtrusionDefaultFields(
  fields: SampleFieldDef[]
): SampleFieldDef[] {
  const defaults = defaultExtrusionOutputFields();
  const map = new Map(fields.map((f) => [f.key, f]));
  const merged: SampleFieldDef[] = [];
  for (const def of defaults) {
    const existing = map.get(def.key);
    if (existing) {
      merged.push({ ...def, ...existing, is_default: true });
      map.delete(def.key);
    } else {
      merged.push(def);
    }
  }
  for (const rest of map.values()) merged.push(rest);
  return merged;
}

export function parseExtrusionMetricKeys(
  raw: string | null | undefined
): string[] {
  if (!raw) return ["shear_rate_s"];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return ["shear_rate_s"];
    }
    return parsed.map((k) => String(k));
  } catch {
    return ["shear_rate_s"];
  }
}

export function parseExtrusionOutputsJson(
  raw: string | null | undefined
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

export function parseNumberLoose(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  const text = String(raw).trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, ".");
  const num = Number(normalized);
  if (Number.isFinite(num)) return num;
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const fallback = Number(match[0]);
  return Number.isFinite(fallback) ? fallback : null;
}

export function getExtrusionMetricValue(
  outputs: Record<string, unknown>,
  field: SampleFieldDef
): number | null {
  const value = outputs[field.key];
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function resolveGeometry(configsByCode: Map<string, any>): ExtrusionGeometry {
  const getValue = (code: string) => {
    const cfg = configsByCode.get(code);
    const candidates = [
      cfg?.fixed_value,
      cfg?.range_min,
      cfg?.range_max,
    ];
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined || candidate === "") continue;
      const num = Number(candidate);
      if (Number.isFinite(num)) return num;
    }
    return null;
  };
  return {
    piston_diameter_mm: getValue("piston_diameter_mm"),
    nozzle_diameter_mm: getValue("nozzle_diameter_mm"),
    nozzle_length_mm: getValue("nozzle_length_mm"),
    cold_capillary_diameter_mm: getValue("cold_capillary_diameter_mm"),
    cold_capillary_length_mm: getValue("cold_capillary_length_mm"),
    wheel_diameter_mm: getValue("wheel_diameter_mm"),
    pressure_coeff_kp: getValue("pressure_coeff_kp"),
  };
}

export function computeRheology(input: {
  outputs: Record<string, unknown>;
  pressureBar: number | null;
  geometry: ExtrusionGeometry;
}) {
  const { outputs, pressureBar, geometry } = input;
  const wheelRpm = parseNumberLoose(outputs.wheel_rpm);

  const pistonDiameter = geometry.piston_diameter_mm;
  const nozzleDiameter = geometry.nozzle_diameter_mm;
  const nozzleLength = geometry.nozzle_length_mm;
  const coldDiameter = geometry.cold_capillary_diameter_mm;
  const coldLength = geometry.cold_capillary_length_mm;
  const wheelDiameter = geometry.wheel_diameter_mm;
  const pressureCoeff = geometry.pressure_coeff_kp ?? 1;

  const pistonRadius = pistonDiameter ? pistonDiameter / 2 : null;
  const nozzleRadius = nozzleDiameter ? nozzleDiameter / 2 : null;
  const coldRadius = coldDiameter ? coldDiameter / 2 : null;
  const pistonArea = pistonRadius ? Math.PI * pistonRadius ** 2 : null;

  let pistonSpeed: number | null = null;
  if (wheelRpm !== null && wheelDiameter) {
    pistonSpeed = (Math.PI * wheelDiameter * wheelRpm) / 60;
  }

  let flowRateMm3S: number | null = null;
  if (pistonSpeed !== null && pistonArea !== null) {
    flowRateMm3S = pistonSpeed * pistonArea;
  }

  let shearRateS: number | null = null;
  if (flowRateMm3S !== null && nozzleRadius !== null) {
    shearRateS = (4 * flowRateMm3S) / (Math.PI * nozzleRadius ** 3);
  }

  let shearStressPa: number | null = null;
  const nozzleRadiusM =
    nozzleRadius !== null && Number.isFinite(nozzleRadius)
      ? nozzleRadius / 1000
      : null;
  if (
    pressureBar !== null &&
    nozzleRadiusM !== null &&
    nozzleRadius !== null &&
    nozzleLength !== null &&
    coldLength !== null &&
    coldRadius !== null &&
    Number.isFinite(pressureBar) &&
    Number.isFinite(nozzleLength) &&
    nozzleLength > 0 &&
    coldLength > 0
  ) {
    const l5Term = nozzleLength / Math.pow(nozzleRadius, 4);
    const l8Term = coldLength / Math.pow(coldRadius, 4);
    const f5 = l5Term + l8Term > 0 ? l5Term / (l5Term + l8Term) : null;
    const pressurePa = pressureBar * 1e5 * pressureCoeff;
    const lengthM = nozzleLength / 1000;
    if (f5 !== null) {
      const deltaP5 = f5 * pressurePa;
      shearStressPa = (deltaP5 * nozzleRadiusM) / (2 * lengthM);
    }
  }

  let viscosityPaS: number | null = null;
  if (
    shearStressPa !== null &&
    shearRateS !== null &&
    Number.isFinite(shearRateS) &&
    shearRateS > 0
  ) {
    viscosityPaS = shearStressPa / shearRateS;
  }

  return {
    piston_speed_mm_s: pistonSpeed,
    shear_rate_s: shearRateS,
    shear_stress_pa: shearStressPa,
    viscosity_pa_s: viscosityPaS,
    flow_rate_mm3_s: flowRateMm3S,
  };
}

export function buildStats(values: number[]) {
  if (!values.length) return { n: 0, mean: null, sd: null };
  const avg = mean(values);
  const s = values.length > 1 ? sd(values) : 0;
  return { n: values.length, mean: avg, sd: s };
}

export function defaultExtrusionParamConfig(code: string) {
  if (code === "pellet_moisture_pct") {
    return {
      mode: "RANGE",
      active: 1,
      fixed_value: null,
      range_min: null,
      range_max: null,
      list_json: null,
    };
  }
  if (EXTRUSION_GEOMETRY_CODES.has(code)) {
    return {
      mode: "FIXED",
      active: 0,
      fixed_value: null,
      range_min: null,
      range_max: null,
      list_json: null,
    };
  }
  return {
    mode: "FIXED",
    active: 0,
    fixed_value: null,
    range_min: null,
    range_max: null,
    list_json: null,
  };
}
