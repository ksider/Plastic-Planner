import type { Database } from "sqlite";

export async function listImExperimentsSummary(db: Database) {
  return db.all(
    `SELECT e.*, COUNT(r.id) as run_count
     FROM im_experiments e
     LEFT JOIN im_runs r ON r.experiment_id = e.id
     GROUP BY e.id
     ORDER BY e.created_at DESC`
  );
}

export async function listImMachineProfiles(db: Database) {
  return db.all(
    "SELECT id, name, barrel_zones_count FROM im_machine_profiles ORDER BY name"
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

export async function insertImExperiment(
  db: Database,
  name: string,
  machineProfileId: number | null,
  seed: number,
  moisture: number | null,
  density: number | null,
  notes: string | null
) {
  return db.run(
    `INSERT INTO im_experiments
      (name, machine_profile_id, seed, default_material_moisture_pct, default_material_density_g_cm3, notes)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, machineProfileId, seed, moisture, density, notes]
  );
}

export async function insertImExperimentRecipe(
  db: Database,
  experimentId: number,
  recipeId: number
) {
  await db.run(
    "INSERT INTO im_experiment_recipes (experiment_id, recipe_id) VALUES (?, ?)",
    [experimentId, recipeId]
  );
}

export async function listImParamDefsInput(db: Database) {
  return db.all(
    "SELECT id, code, min_default, max_default FROM im_param_definitions WHERE is_output = 0 ORDER BY id"
  );
}

export async function insertImParamConfig(
  db: Database,
  experimentId: number,
  paramDefId: number,
  mode: string,
  fixedValue: number | null,
  rangeMin: number | null,
  rangeMax: number | null,
  active: number
) {
  await db.run(
    `INSERT OR IGNORE INTO im_param_configs
      (experiment_id, param_def_id, mode, fixed_value, range_min, range_max, list_json, active)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    [experimentId, paramDefId, mode, fixedValue, rangeMin, rangeMax, active]
  );
}

export async function getImExperimentById(db: Database, experimentId: number) {
  return db.get("SELECT * FROM im_experiments WHERE id = ?", [experimentId]);
}

export async function listImParamDefsAll(db: Database) {
  return db.all("SELECT * FROM im_param_definitions ORDER BY stage, group_label, id");
}

export async function listImParamConfigsByExperiment(db: Database, experimentId: number) {
  return db.all("SELECT * FROM im_param_configs WHERE experiment_id = ?", [experimentId]);
}

export async function listImExperimentRecipes(db: Database, experimentId: number) {
  return db.all(
    `SELECT r.id, r.name,
            EXISTS(
              SELECT 1 FROM recipe_components rc
              WHERE rc.recipe_id = r.id AND rc.mode = 'range'
             ) as has_range
     FROM im_experiment_recipes er
     JOIN recipes r ON r.id = er.recipe_id
     WHERE er.experiment_id = ?
     ORDER BY r.name`,
    [experimentId]
  );
}

export async function listImRuns(db: Database, experimentId: number) {
  return db.all(
    `SELECT r.*, rec.name as recipe_name
     FROM im_runs r
     LEFT JOIN recipes rec ON rec.id = r.recipe_id
     WHERE r.experiment_id = ?
     ORDER BY r.run_order`,
    [experimentId]
  );
}

export async function listImRunsWithMaterialProps(db: Database, experimentId: number) {
  return db.all(
    `SELECT r.*, rec.name as recipe_name, mp.moisture_pct, mp.density_g_cm3
     FROM im_runs r
     LEFT JOIN recipes rec ON rec.id = r.recipe_id
     LEFT JOIN im_run_material_props mp ON mp.run_id = r.id
     WHERE r.experiment_id = ?
     ORDER BY r.run_order`,
    [experimentId]
  );
}

export async function listImRunParamValuesByRunIds(db: Database, runIds: number[]) {
  return db.all(
    `SELECT rp.run_id, rp.param_def_id, rp.value_real
     FROM im_run_param_values rp
     WHERE rp.run_id IN (${runIds.map(() => "?").join(",") || "NULL"})`,
    runIds
  );
}

export async function getImMaterialMissing(db: Database, runIds: number[]) {
  return db.get(
    `SELECT
      SUM(CASE WHEN moisture_pct IS NULL THEN 1 ELSE 0 END) as moisture_missing,
      SUM(CASE WHEN density_g_cm3 IS NULL THEN 1 ELSE 0 END) as density_missing
     FROM im_run_material_props
     WHERE run_id IN (${runIds.map(() => "?").join(",") || "NULL"})`,
    runIds
  );
}

export async function listImParamDefsInputIds(db: Database) {
  return db.all("SELECT id FROM im_param_definitions WHERE is_output = 0");
}

export async function upsertImParamConfig(
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
    `INSERT INTO im_param_configs
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

export async function updateImExperimentMaterialDefaults(
  db: Database,
  experimentId: number,
  moisture: number | null,
  density: number | null
) {
  await db.run(
    "UPDATE im_experiments SET default_material_moisture_pct = ?, default_material_density_g_cm3 = ? WHERE id = ?",
    [moisture, density, experimentId]
  );
}

export async function getImParamDefinition(db: Database, paramDefId: number) {
  return db.get("SELECT * FROM im_param_definitions WHERE id = ?", [
    paramDefId,
  ]);
}

export async function upsertImParamConfigActive(
  db: Database,
  experimentId: number,
  paramDefId: number,
  mode: string,
  fixedValue: number | null,
  rangeMin: number | null,
  rangeMax: number | null,
  listJson: string | null
) {
  await db.run(
    `INSERT INTO im_param_configs
      (experiment_id, param_def_id, mode, fixed_value, range_min, range_max, list_json, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(experiment_id, param_def_id) DO UPDATE SET
       mode = excluded.mode,
       fixed_value = excluded.fixed_value,
       range_min = excluded.range_min,
       range_max = excluded.range_max,
       list_json = excluded.list_json,
       active = 1`,
    [experimentId, paramDefId, mode, fixedValue, rangeMin, rangeMax, listJson]
  );
}

export async function findImParamDefinitionByCode(db: Database, code: string) {
  return db.get("SELECT 1 FROM im_param_definitions WHERE code = ?", [code]);
}

export async function insertImParamDefinitionCustom(
  db: Database,
  code: string,
  label: string,
  unit: string | null
) {
  return db.run(
    `INSERT INTO im_param_definitions
      (code, label, unit, stage, group_label, min_default, max_default, options_json, is_output)
     VALUES (?, ?, ?, 'CUSTOM', 'Custom', NULL, NULL, NULL, 0)`,
    [code, label, unit]
  );
}

export async function deactivateImParamConfig(
  db: Database,
  experimentId: number,
  paramId: number
) {
  await db.run(
    `UPDATE im_param_configs
     SET active = 0,
         fixed_value = NULL,
         range_min = NULL,
         range_max = NULL,
         list_json = NULL
     WHERE experiment_id = ? AND param_def_id = ?`,
    [experimentId, paramId]
  );
}

export async function getImExperimentSeedAndDefaults(db: Database, experimentId: number) {
  return db.get(
    "SELECT seed, default_material_moisture_pct, default_material_density_g_cm3 FROM im_experiments WHERE id = ?",
    [experimentId]
  );
}

export async function listActiveImParamConfigs(db: Database, experimentId: number) {
  return db.all(
    `SELECT c.*, d.code
     FROM im_param_configs c
     JOIN im_param_definitions d ON d.id = c.param_def_id
     WHERE c.experiment_id = ? AND c.active = 1`,
    [experimentId]
  );
}

export async function clearImRuns(db: Database, experimentId: number) {
  await db.run(
    "DELETE FROM im_run_param_values WHERE run_id IN (SELECT id FROM im_runs WHERE experiment_id = ?)",
    [experimentId]
  );
  await db.run(
    "DELETE FROM im_run_material_props WHERE run_id IN (SELECT id FROM im_runs WHERE experiment_id = ?)",
    [experimentId]
  );
  await db.run("DELETE FROM im_runs WHERE experiment_id = ?", [experimentId]);
}

export async function insertImRun(
  db: Database,
  experimentId: number,
  runOrder: number,
  runCode: string,
  recipeId: number | null,
  moldTemp: number | null,
  recipeVariant: string | null
) {
  return db.run(
    `INSERT INTO im_runs (experiment_id, run_order, run_code, recipe_id, mold_temp_c, recipe_variant, done)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [experimentId, runOrder, runCode, recipeId, moldTemp, recipeVariant]
  );
}

export async function insertImRunParamValue(
  db: Database,
  runId: number,
  paramId: number,
  value: number
) {
  await db.run(
    `INSERT INTO im_run_param_values (run_id, param_def_id, value_real)
     VALUES (?, ?, ?)`,
    [runId, paramId, value]
  );
}

export async function insertImRunMaterialProps(
  db: Database,
  runId: number,
  moisture: number | null,
  density: number | null
) {
  await db.run(
    `INSERT INTO im_run_material_props (run_id, moisture_pct, density_g_cm3)
     VALUES (?, ?, ?)`,
    [runId, moisture, density]
  );
}

export async function listImRunsSummary(db: Database, experimentId: number) {
  return db.all(
    `SELECT r.id, r.run_code, r.run_order, r.recipe_id, rec.name as recipe_name
     FROM im_runs r
     LEFT JOIN recipes rec ON rec.id = r.recipe_id
     WHERE r.experiment_id = ?
     ORDER BY r.run_order`,
    [experimentId]
  );
}

export async function listImParamDefsActiveInputs(db: Database, experimentId: number) {
  return db.all(
    `SELECT d.*, c.mode, c.fixed_value, c.range_min, c.range_max, c.list_json
     FROM im_param_configs c
     JOIN im_param_definitions d ON d.id = c.param_def_id
     WHERE c.experiment_id = ? AND c.active = 1 AND d.is_output = 0
     ORDER BY d.stage, d.group_label, d.id`,
    [experimentId]
  );
}

export async function listImOutputDefs(db: Database) {
  return db.all(
    "SELECT * FROM im_param_definitions WHERE is_output = 1 ORDER BY stage, group_label, id"
  );
}

export async function listImRunParamValues(db: Database, runIds: number[]) {
  return db.all(
    `SELECT run_id, param_def_id, value_real, value_text
     FROM im_run_param_values
     WHERE run_id IN (${runIds.map(() => "?").join(",") || "NULL"})`,
    runIds
  );
}

export async function getImParamConfigByCode(db: Database, experimentId: number, code: string) {
  return db.get(
    `SELECT c.*
     FROM im_param_configs c
     JOIN im_param_definitions d ON d.id = c.param_def_id
     WHERE c.experiment_id = ? AND d.code = ?`,
    [experimentId, code]
  );
}

export async function getImRunById(db: Database, experimentId: number, runId: number) {
  return db.get(
    `SELECT r.*, rec.name as recipe_name
     FROM im_runs r
     LEFT JOIN recipes rec ON rec.id = r.recipe_id
     WHERE r.id = ? AND r.experiment_id = ?`,
    [runId, experimentId]
  );
}

export async function getPrevImRunId(db: Database, experimentId: number, runOrder: number) {
  return db.get<{ id: number }>(
    `SELECT id FROM im_runs
     WHERE experiment_id = ? AND run_order < ?
     ORDER BY run_order DESC LIMIT 1`,
    [experimentId, runOrder]
  );
}

export async function getNextImRunId(db: Database, experimentId: number, runOrder: number) {
  return db.get<{ id: number }>(
    `SELECT id FROM im_runs
     WHERE experiment_id = ? AND run_order > ?
     ORDER BY run_order ASC LIMIT 1`,
    [experimentId, runOrder]
  );
}

export async function getImRunMaterialProps(db: Database, runId: number) {
  return db.get(
    "SELECT * FROM im_run_material_props WHERE run_id = ?",
    [runId]
  );
}

export async function listImParamDefs(db: Database) {
  return db.all("SELECT id, code FROM im_param_definitions");
}

export async function listImParamConfigsWithLabels(db: Database, experimentId: number) {
  return db.all(
    `SELECT c.*, d.label, d.unit
     FROM im_param_configs c
     JOIN im_param_definitions d ON d.id = c.param_def_id
     WHERE c.experiment_id = ?`,
    [experimentId]
  );
}

export async function listImActiveInputParamConfigsWithLabels(
  db: Database,
  experimentId: number
) {
  return db.all(
    `SELECT c.*, d.label, d.unit
     FROM im_param_configs c
     JOIN im_param_definitions d ON d.id = c.param_def_id
     WHERE c.experiment_id = ? AND d.is_output = 0 AND c.active = 1
     ORDER BY d.stage, d.group_label, d.id`,
    [experimentId]
  );
}

export async function listImRunParamValuesByRun(db: Database, runId: number) {
  return db.all(
    "SELECT param_def_id, value_real, value_text FROM im_run_param_values WHERE run_id = ?",
    [runId]
  );
}

export async function deleteImExperimentCascade(db: Database, experimentId: number) {
  await db.run(
    "DELETE FROM im_run_param_values WHERE run_id IN (SELECT id FROM im_runs WHERE experiment_id = ?)",
    [experimentId]
  );
  await db.run(
    "DELETE FROM im_run_material_props WHERE run_id IN (SELECT id FROM im_runs WHERE experiment_id = ?)",
    [experimentId]
  );
  await db.run("DELETE FROM im_runs WHERE experiment_id = ?", [experimentId]);
  await db.run("DELETE FROM im_param_configs WHERE experiment_id = ?", [experimentId]);
  await db.run(
    "DELETE FROM im_experiment_recipes WHERE experiment_id = ?",
    [experimentId]
  );
  await db.run("DELETE FROM im_experiments WHERE id = ?", [experimentId]);
}

export async function updateImRunRecipe(db: Database, experimentId: number, runId: number, recipeId: number | null) {
  await db.run("UPDATE im_runs SET recipe_id = ? WHERE id = ? AND experiment_id = ?", [
    recipeId,
    runId,
    experimentId,
  ]);
}

export async function updateImRunDone(db: Database, experimentId: number, runId: number, doneValue: number) {
  await db.run("UPDATE im_runs SET done = ? WHERE id = ? AND experiment_id = ?", [
    doneValue,
    runId,
    experimentId,
  ]);
}

export async function upsertImRunMaterialProps(
  db: Database,
  runId: number,
  moisture: number | null,
  density: number | null
) {
  await db.run(
    `INSERT INTO im_run_material_props (run_id, moisture_pct, density_g_cm3)
     VALUES (?, ?, ?)
     ON CONFLICT(run_id) DO UPDATE SET moisture_pct = excluded.moisture_pct, density_g_cm3 = excluded.density_g_cm3`,
    [runId, moisture, density]
  );
}

export async function upsertImRunParamValue(
  db: Database,
  runId: number,
  paramDefId: number,
  value: number | null
) {
  await db.run(
    `INSERT INTO im_run_param_values (run_id, param_def_id, value_real)
     VALUES (?, ?, ?)
     ON CONFLICT(run_id, param_def_id) DO UPDATE SET value_real = excluded.value_real`,
    [runId, paramDefId, value]
  );
}

export async function updateImRunParamText(
  db: Database,
  runId: number,
  paramDefId: number,
  textValue: string | null
) {
  await db.run(
    "UPDATE im_run_param_values SET value_text = ? WHERE run_id = ? AND param_def_id = ?",
    [textValue, runId, paramDefId]
  );
}

export async function updateImRunMoldTemp(
  db: Database,
  experimentId: number,
  runId: number,
  moldTemp: number | null
) {
  await db.run(
    "UPDATE im_runs SET mold_temp_c = ? WHERE id = ? AND experiment_id = ?",
    [moldTemp, runId, experimentId]
  );
}
