import type { Db } from "../db.js";
import { createParamDefinition } from "../repos/params_repo.js";

const DEFECT_TAGS = [
  "sticking",
  "flash",
  "short shot",
  "overheating",
  "bubbles",
  "warpage",
  "sink",
  "brittle",
  "poor surface",
  "demold damage"
];

type SeedParam = {
  code: string;
  label: string;
  unit: string | null;
  field_kind: "INPUT" | "OUTPUT";
  field_type: "number" | "text" | "tag";
  group_label: string;
  allowed_values_json?: string | null;
};

const SEED_PARAMS: SeedParam[] = [
  { code: "moisture_pct", label: "Moisture", unit: "%", field_kind: "INPUT", field_type: "number", group_label: "Material" },
  { code: "density_g_cm3", label: "Density", unit: "g/cm3", field_kind: "INPUT", field_type: "number", group_label: "Material" },
  { code: "mold_temp", label: "Mold Temp", unit: "C", field_kind: "INPUT", field_type: "number", group_label: "Mold" },
  { code: "cooling_time", label: "Cooling Time", unit: "s", field_kind: "INPUT", field_type: "number", group_label: "Mold" },
  { code: "nozzle_temp", label: "Nozzle Temp", unit: "C", field_kind: "INPUT", field_type: "number", group_label: "Barrel" },
  { code: "barrel_zone1", label: "Barrel Zone 1", unit: "C", field_kind: "INPUT", field_type: "number", group_label: "Barrel" },
  { code: "barrel_zone2", label: "Barrel Zone 2", unit: "C", field_kind: "INPUT", field_type: "number", group_label: "Barrel" },
  { code: "barrel_zone3", label: "Barrel Zone 3", unit: "C", field_kind: "INPUT", field_type: "number", group_label: "Barrel" },
  { code: "barrel_zone4", label: "Barrel Zone 4", unit: "C", field_kind: "INPUT", field_type: "number", group_label: "Barrel" },
  { code: "barrel_zone5", label: "Barrel Zone 5", unit: "C", field_kind: "INPUT", field_type: "number", group_label: "Barrel" },
  { code: "inj_speed", label: "Injection Speed", unit: "mm/s", field_kind: "INPUT", field_type: "number", group_label: "Fill" },
  { code: "inj_press_limit", label: "Injection Pressure Limit", unit: "bar", field_kind: "INPUT", field_type: "number", group_label: "Fill" },
  { code: "v_to_p_transfer", label: "V-to-P Transfer", unit: "%", field_kind: "INPUT", field_type: "number", group_label: "Fill" },
  { code: "shot_size", label: "Shot Size", unit: "mm", field_kind: "INPUT", field_type: "number", group_label: "Fill" },
  { code: "cushion_target", label: "Cushion Target", unit: "mm", field_kind: "INPUT", field_type: "number", group_label: "Fill" },
  { code: "pack_press", label: "Pack Pressure", unit: "bar", field_kind: "INPUT", field_type: "number", group_label: "Pack/Hold" },
  { code: "pack_time", label: "Pack Time", unit: "s", field_kind: "INPUT", field_type: "number", group_label: "Pack/Hold" },
  { code: "hold_press", label: "Hold Pressure", unit: "bar", field_kind: "INPUT", field_type: "number", group_label: "Pack/Hold" },
  { code: "hold_time", label: "Hold Time", unit: "s", field_kind: "INPUT", field_type: "number", group_label: "Pack/Hold" },
  { code: "screw_rpm", label: "Screw RPM", unit: "rpm", field_kind: "INPUT", field_type: "number", group_label: "Screw" },
  { code: "back_pressure", label: "Back Pressure", unit: "bar", field_kind: "INPUT", field_type: "number", group_label: "Screw" },
  { code: "decompression", label: "Decompression", unit: "mm", field_kind: "INPUT", field_type: "number", group_label: "Screw" },
  { code: "recovery_time", label: "Recovery Time", unit: "s", field_kind: "INPUT", field_type: "number", group_label: "Screw" },
  { code: "clamp_tonnage", label: "Clamp Tonnage", unit: "t", field_kind: "INPUT", field_type: "number", group_label: "Clamp" },
  { code: "melt_temp", label: "Melt Temp", unit: "C", field_kind: "OUTPUT", field_type: "number", group_label: "Outputs" },
  { code: "fill_time", label: "Fill Time", unit: "s", field_kind: "OUTPUT", field_type: "number", group_label: "Outputs" },
  { code: "peak_inj_pressure", label: "Peak Injection Pressure", unit: "bar", field_kind: "OUTPUT", field_type: "number", group_label: "Outputs" },
  { code: "part_weight", label: "Part Weight", unit: "g", field_kind: "OUTPUT", field_type: "number", group_label: "Outputs" },
  { code: "cycle_time", label: "Cycle Time", unit: "s", field_kind: "OUTPUT", field_type: "number", group_label: "Outputs" },
  {
    code: "defects",
    label: "Defects",
    unit: null,
    field_kind: "OUTPUT",
    field_type: "tag",
    group_label: "Defects",
    allowed_values_json: JSON.stringify(DEFECT_TAGS)
  }
];

export function ensureSeedParams(db: Db) {
  const existing = db
    .prepare("SELECT COUNT(*) as count FROM param_definitions WHERE scope = 'GLOBAL'")
    .get() as { count: number };
  if (existing.count > 0) return;

  for (const param of SEED_PARAMS) {
    createParamDefinition(db, {
      scope: "GLOBAL",
      experiment_id: null,
      code: param.code,
      label: param.label,
      unit: param.unit,
      field_kind: param.field_kind,
      field_type: param.field_type,
      group_label: param.group_label,
      allowed_values_json: param.allowed_values_json ?? null
    });
  }
}

export const DEFAULT_INPUT_VALUES: Record<string, number> = {
  moisture_pct: 0.1,
  density_g_cm3: 1.0,
  mold_temp: 60,
  cooling_time: 18,
  nozzle_temp: 220,
  barrel_zone1: 210,
  barrel_zone2: 220,
  barrel_zone3: 230,
  barrel_zone4: 235,
  barrel_zone5: 235,
  inj_speed: 60,
  inj_press_limit: 800,
  v_to_p_transfer: 95,
  shot_size: 50,
  cushion_target: 5,
  pack_press: 500,
  pack_time: 6,
  hold_press: 450,
  hold_time: 10,
  screw_rpm: 120,
  back_pressure: 20,
  decompression: 2,
  recovery_time: 8,
  clamp_tonnage: 80
};
