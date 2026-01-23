import type { Database } from "sqlite";

export type AnalysisFieldRow = {
  id: number;
  scope_type: string;
  scope_id: number | null;
  code: string;
  label: string;
  field_type: string;
  unit: string | null;
  display_group: string | null;
  allowed_values_json: string | null;
};

export async function listAnalysisFields(
  db: Database,
  scopeType: string,
  scopeId: number | null
) {
  return db.all<AnalysisFieldRow>(
    `SELECT * FROM analysis_fields
     WHERE scope_type = ? AND (scope_id IS NULL OR scope_id = ?)
     ORDER BY COALESCE(display_group, ''), label, id`,
    [scopeType, scopeId]
  );
}

export async function findAnalysisFieldByCode(
  db: Database,
  scopeType: string,
  scopeId: number | null,
  code: string
) {
  return db.get<AnalysisFieldRow>(
    `SELECT * FROM analysis_fields
     WHERE scope_type = ? AND scope_id IS ? AND code = ?`,
    [scopeType, scopeId, code]
  );
}

export async function insertAnalysisField(
  db: Database,
  scopeType: string,
  scopeId: number | null,
  code: string,
  label: string,
  fieldType: string,
  unit: string | null,
  displayGroup: string | null,
  allowedValuesJson: string | null
) {
  return db.run(
    `INSERT INTO analysis_fields
     (scope_type, scope_id, code, label, field_type, unit, display_group, allowed_values_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [scopeType, scopeId, code, label, fieldType, unit, displayGroup, allowedValuesJson]
  );
}

export async function listAnalysisRunValuesByRunId(
  db: Database,
  scopeType: string,
  runId: number
) {
  return db.all(
    `SELECT * FROM analysis_run_values
     WHERE scope_type = ? AND run_id = ?`,
    [scopeType, runId]
  );
}

export async function listAnalysisRunValuesByRunIds(
  db: Database,
  scopeType: string,
  runIds: number[]
) {
  return db.all(
    `SELECT * FROM analysis_run_values
     WHERE scope_type = ? AND run_id IN (${runIds.map(() => "?").join(",") || "NULL"})`,
    [scopeType, ...runIds]
  );
}

export async function upsertAnalysisRunValue(
  db: Database,
  scopeType: string,
  runId: number,
  fieldId: number,
  valueReal: number | null,
  valueText: string | null,
  valueTagsJson: string | null
) {
  await db.run(
    `INSERT INTO analysis_run_values
     (scope_type, run_id, field_id, value_real, value_text, value_tags_json)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope_type, run_id, field_id) DO UPDATE SET
       value_real = excluded.value_real,
       value_text = excluded.value_text,
       value_tags_json = excluded.value_tags_json`,
    [scopeType, runId, fieldId, valueReal, valueText, valueTagsJson]
  );
}

export async function getAnalysisConfig(
  db: Database,
  scopeType: string,
  scopeId: number | null
) {
  return db.get(
    `SELECT * FROM analysis_configs
     WHERE scope_type = ? AND scope_id IS ?`,
    [scopeType, scopeId]
  );
}

export async function upsertAnalysisConfig(
  db: Database,
  scopeType: string,
  scopeId: number | null,
  configJson: string
) {
  await db.run(
    `INSERT INTO analysis_configs (scope_type, scope_id, config_json)
     VALUES (?, ?, ?)
     ON CONFLICT(scope_type, scope_id) DO UPDATE SET
       config_json = excluded.config_json`,
    [scopeType, scopeId, configJson]
  );
}
