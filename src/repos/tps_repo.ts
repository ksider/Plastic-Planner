import type { Database } from "sqlite";

export async function listTpsExperimentsSummary(db: Database) {
  return db.all(
    `SELECT e.*, COUNT(r.id) as run_count
     FROM tps_experiments e
     LEFT JOIN tps_runs r ON r.experiment_id = e.id
     GROUP BY e.id
     ORDER BY e.created_at DESC`
  );
}

export async function listRecipeNames(db: Database) {
  return db.all(
    `SELECT r.id, r.name, r.description,
            EXISTS(
              SELECT 1 FROM recipe_components rc
              WHERE rc.recipe_id = r.id AND rc.mode = 'range'
             ) as has_range
     FROM recipes r
     ORDER BY r.name`
  );
}

export async function insertTpsExperiment(
  db: Database,
  name: string,
  seed: number,
  notes: string | null,
  outputFieldsJson: string
) {
  return db.run(
    `INSERT INTO tps_experiments (name, seed, notes, output_fields_json)
     VALUES (?, ?, ?, ?)`,
    [name, seed, notes, outputFieldsJson]
  );
}

export async function insertTpsExperimentRecipe(
  db: Database,
  experimentId: number,
  recipeId: number
) {
  await db.run(
    "INSERT INTO tps_experiment_recipes (experiment_id, recipe_id) VALUES (?, ?)",
    [experimentId, recipeId]
  );
}

export async function getTpsExperimentById(db: Database, experimentId: number) {
  return db.get("SELECT * FROM tps_experiments WHERE id = ?", [experimentId]);
}

export async function listTpsExperimentRecipes(db: Database, experimentId: number) {
  return db.all(
    `SELECT r.id, r.name,
            EXISTS(
              SELECT 1 FROM recipe_components rc
              WHERE rc.recipe_id = r.id AND rc.mode = 'range'
             ) as has_range
     FROM tps_experiment_recipes er
     JOIN recipes r ON r.id = er.recipe_id
     WHERE er.experiment_id = ?
     ORDER BY r.name`,
    [experimentId]
  );
}

export async function listTpsParamDefs(db: Database) {
  return db.all(
    "SELECT * FROM tps_param_definitions ORDER BY is_default DESC, id"
  );
}

export async function getTpsParamDef(db: Database, paramDefId: number) {
  return db.get("SELECT * FROM tps_param_definitions WHERE id = ?", [
    paramDefId,
  ]);
}

export async function listTpsParamConfigsByExperiment(
  db: Database,
  experimentId: number
) {
  return db.all(
    "SELECT * FROM tps_param_configs WHERE experiment_id = ?",
    [experimentId]
  );
}

export async function insertTpsParamConfig(
  db: Database,
  experimentId: number,
  paramDefId: number,
  mode: string,
  fixedValue: number | null,
  rangeMin: number | null,
  rangeMax: number | null,
  listJson: string | null,
  active: number
) {
  await db.run(
    `INSERT OR IGNORE INTO tps_param_configs
      (experiment_id, param_def_id, mode, fixed_value, range_min, range_max, list_json, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [experimentId, paramDefId, mode, fixedValue, rangeMin, rangeMax, listJson, active]
  );
}

export async function upsertTpsParamConfig(
  db: Database,
  experimentId: number,
  paramDefId: number,
  mode: string,
  fixedValue: number | null,
  rangeMin: number | null,
  rangeMax: number | null,
  listJson: string | null,
  active: number
) {
  await db.run(
    `INSERT INTO tps_param_configs
      (experiment_id, param_def_id, mode, fixed_value, range_min, range_max, list_json, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(experiment_id, param_def_id) DO UPDATE SET
       mode = excluded.mode,
       fixed_value = excluded.fixed_value,
       range_min = excluded.range_min,
       range_max = excluded.range_max,
       list_json = excluded.list_json,
       active = excluded.active`,
    [
      experimentId,
      paramDefId,
      mode,
      fixedValue,
      rangeMin,
      rangeMax,
      listJson,
      active,
    ]
  );
}

export async function deactivateTpsParamConfig(
  db: Database,
  experimentId: number,
  paramDefId: number
) {
  await db.run(
    `UPDATE tps_param_configs
     SET active = 0,
         fixed_value = NULL,
         range_min = NULL,
         range_max = NULL,
         list_json = NULL
     WHERE experiment_id = ? AND param_def_id = ?`,
    [experimentId, paramDefId]
  );
}

export async function findTpsParamDefinitionByCode(db: Database, code: string) {
  return db.get("SELECT 1 FROM tps_param_definitions WHERE code = ?", [code]);
}

export async function insertTpsParamDefinitionCustom(
  db: Database,
  code: string,
  label: string,
  unit: string | null
) {
  return db.run(
    `INSERT INTO tps_param_definitions
      (code, label, unit, min_default, max_default, is_default)
     VALUES (?, ?, ?, NULL, NULL, 0)`,
    [code, label, unit]
  );
}

export async function listActiveTpsParamConfigs(
  db: Database,
  experimentId: number
) {
  return db.all(
    `SELECT c.*, d.code
     FROM tps_param_configs c
     JOIN tps_param_definitions d ON d.id = c.param_def_id
     WHERE c.experiment_id = ? AND c.active = 1`,
    [experimentId]
  );
}

export async function clearTpsRuns(db: Database, experimentId: number) {
  await db.run(
    "DELETE FROM tps_run_param_values WHERE run_id IN (SELECT id FROM tps_runs WHERE experiment_id = ?)",
    [experimentId]
  );
  await db.run("DELETE FROM tps_runs WHERE experiment_id = ?", [experimentId]);
}

export async function insertTpsRun(
  db: Database,
  experimentId: number,
  runOrder: number,
  runCode: string,
  recipeId: number | null,
  recipeVariant: string | null
) {
  return db.run(
    `INSERT INTO tps_runs (experiment_id, run_order, run_code, recipe_id, recipe_variant, done, outputs_json)
     VALUES (?, ?, ?, ?, ?, 0, '{}')`,
    [experimentId, runOrder, runCode, recipeId, recipeVariant]
  );
}

export async function insertTpsRunParamValue(
  db: Database,
  runId: number,
  paramDefId: number,
  value: number
) {
  await db.run(
    `INSERT INTO tps_run_param_values (run_id, param_def_id, value_real)
     VALUES (?, ?, ?)`,
    [runId, paramDefId, value]
  );
}

export async function listTpsRuns(db: Database, experimentId: number) {
  return db.all(
    `SELECT r.*, rec.name as recipe_name
     FROM tps_runs r
     LEFT JOIN recipes rec ON rec.id = r.recipe_id
     WHERE r.experiment_id = ?
     ORDER BY r.run_order`,
    [experimentId]
  );
}

export async function listTpsRunsSummary(db: Database, experimentId: number) {
  return db.all(
    `SELECT r.id, r.run_code, r.run_order, r.recipe_id, rec.name as recipe_name
     FROM tps_runs r
     LEFT JOIN recipes rec ON rec.id = r.recipe_id
     WHERE r.experiment_id = ?
     ORDER BY r.run_order`,
    [experimentId]
  );
}

export async function listTpsRunParamValuesByRunIds(
  db: Database,
  runIds: number[]
) {
  return db.all(
    `SELECT rp.run_id, rp.param_def_id, rp.value_real
     FROM tps_run_param_values rp
     WHERE rp.run_id IN (${runIds.map(() => "?").join(",") || "NULL"})`,
    runIds
  );
}

export async function getTpsRunById(db: Database, runId: number) {
  return db.get(
    `SELECT r.*, rec.name as recipe_name
     FROM tps_runs r
     LEFT JOIN recipes rec ON rec.id = r.recipe_id
     WHERE r.id = ?`,
    [runId]
  );
}

export async function updateTpsRunOutputs(
  db: Database,
  runId: number,
  outputsJson: string
) {
  await db.run("UPDATE tps_runs SET outputs_json = ? WHERE id = ?", [
    outputsJson,
    runId,
  ]);
}

export async function updateTpsRunNotes(
  db: Database,
  runId: number,
  notes: string | null
) {
  await db.run("UPDATE tps_runs SET notes = ? WHERE id = ?", [notes, runId]);
}

export async function updateTpsRunDone(
  db: Database,
  runId: number,
  done: number
) {
  await db.run("UPDATE tps_runs SET done = ? WHERE id = ?", [done, runId]);
}

export async function updateTpsExperimentOutputFields(
  db: Database,
  experimentId: number,
  fieldsJson: string
) {
  await db.run(
    "UPDATE tps_experiments SET output_fields_json = ? WHERE id = ?",
    [fieldsJson, experimentId]
  );
}

export async function updateTpsExperimentAnalysisKeys(
  db: Database,
  experimentId: number,
  keysJson: string
) {
  await db.run(
    "UPDATE tps_experiments SET analysis_metric_keys_json = ? WHERE id = ?",
    [keysJson, experimentId]
  );
}

export async function getPrevTpsRunId(
  db: Database,
  experimentId: number,
  runOrder: number
) {
  return db.get(
    "SELECT id FROM tps_runs WHERE experiment_id = ? AND run_order < ? ORDER BY run_order DESC LIMIT 1",
    [experimentId, runOrder]
  );
}

export async function getNextTpsRunId(
  db: Database,
  experimentId: number,
  runOrder: number
) {
  return db.get(
    "SELECT id FROM tps_runs WHERE experiment_id = ? AND run_order > ? ORDER BY run_order ASC LIMIT 1",
    [experimentId, runOrder]
  );
}

export async function deleteTpsExperimentCascade(
  db: Database,
  experimentId: number
) {
  await db.run(
    "DELETE FROM tps_run_param_values WHERE run_id IN (SELECT id FROM tps_runs WHERE experiment_id = ?)",
    [experimentId]
  );
  await db.run("DELETE FROM tps_runs WHERE experiment_id = ?", [experimentId]);
  await db.run(
    "DELETE FROM tps_experiment_recipes WHERE experiment_id = ?",
    [experimentId]
  );
  await db.run("DELETE FROM tps_param_configs WHERE experiment_id = ?", [
    experimentId,
  ]);
  await db.run("DELETE FROM tps_experiments WHERE id = ?", [experimentId]);
}
