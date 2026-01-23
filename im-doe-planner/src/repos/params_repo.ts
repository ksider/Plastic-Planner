import type { Db } from "../db.js";

export type ParamDefinition = {
  id: number;
  scope: "GLOBAL" | "EXPERIMENT";
  experiment_id: number | null;
  code: string;
  label: string;
  unit: string | null;
  field_kind: "INPUT" | "OUTPUT";
  field_type: "number" | "text" | "tag";
  group_label: string | null;
  allowed_values_json: string | null;
};

export type ParamConfig = {
  id: number;
  experiment_id: number;
  param_def_id: number;
  active: number;
  mode: "FIXED" | "RANGE" | "LIST";
  fixed_value_real: number | null;
  range_min_real: number | null;
  range_max_real: number | null;
  list_json: string | null;
  level_count: number | null;
};

export function listParamDefinitions(db: Db, experimentId: number): ParamDefinition[] {
  return db
    .prepare(
      `SELECT * FROM param_definitions
       WHERE scope = 'GLOBAL' OR (scope = 'EXPERIMENT' AND experiment_id = ?)
       ORDER BY group_label, id`
    )
    .all(experimentId) as ParamDefinition[];
}

export function listParamDefinitionsByKind(
  db: Db,
  experimentId: number,
  kind: "INPUT" | "OUTPUT"
): ParamDefinition[] {
  return db
    .prepare(
      `SELECT * FROM param_definitions
       WHERE field_kind = ? AND (scope = 'GLOBAL' OR (scope = 'EXPERIMENT' AND experiment_id = ?))
       ORDER BY group_label, id`
    )
    .all(kind, experimentId) as ParamDefinition[];
}

export function listParamConfigs(db: Db, experimentId: number): ParamConfig[] {
  return db
    .prepare("SELECT * FROM param_configs WHERE experiment_id = ? ORDER BY id")
    .all(experimentId) as ParamConfig[];
}

export function getParamConfig(db: Db, experimentId: number, paramDefId: number): ParamConfig | undefined {
  return db
    .prepare(
      "SELECT * FROM param_configs WHERE experiment_id = ? AND param_def_id = ?"
    )
    .get(experimentId, paramDefId) as ParamConfig | undefined;
}

export function upsertParamConfig(db: Db, config: Omit<ParamConfig, "id">) {
  const existing = getParamConfig(db, config.experiment_id, config.param_def_id);
  if (existing) {
    db.prepare(
      `UPDATE param_configs
       SET active = ?, mode = ?, fixed_value_real = ?, range_min_real = ?, range_max_real = ?, list_json = ?, level_count = ?
       WHERE id = ?`
    ).run(
      config.active,
      config.mode,
      config.fixed_value_real,
      config.range_min_real,
      config.range_max_real,
      config.list_json,
      config.level_count,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO param_configs
       (experiment_id, param_def_id, active, mode, fixed_value_real, range_min_real, range_max_real, list_json, level_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      config.experiment_id,
      config.param_def_id,
      config.active,
      config.mode,
      config.fixed_value_real,
      config.range_min_real,
      config.range_max_real,
      config.list_json,
      config.level_count
    );
  }
}

export function deleteParamConfig(db: Db, experimentId: number, paramDefId: number) {
  db.prepare("DELETE FROM param_configs WHERE experiment_id = ? AND param_def_id = ?").run(
    experimentId,
    paramDefId
  );
}

export function createParamDefinition(db: Db, def: Omit<ParamDefinition, "id">): number {
  const result = db
    .prepare(
      `INSERT INTO param_definitions
       (scope, experiment_id, code, label, unit, field_kind, field_type, group_label, allowed_values_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      def.scope,
      def.experiment_id,
      def.code,
      def.label,
      def.unit ?? null,
      def.field_kind,
      def.field_type,
      def.group_label ?? null,
      def.allowed_values_json ?? null
    );
  return Number(result.lastInsertRowid);
}

export function updateAllowedValues(db: Db, paramDefId: number, allowedValuesJson: string | null) {
  db.prepare("UPDATE param_definitions SET allowed_values_json = ? WHERE id = ?").run(
    allowedValuesJson,
    paramDefId
  );
}
