import type { Database } from "sqlite";

export async function listRecipesForExperimentNew(db: Database) {
  return db.all(
    `SELECT r.id, r.name, r.description,
            EXISTS(
              SELECT 1 FROM recipe_components rc
              WHERE rc.recipe_id = r.id AND rc.mode = 'range'
            ) as has_range
            ,(
              SELECT COUNT(1) FROM recipe_components rc
              WHERE rc.recipe_id = r.id AND rc.mode = 'range'
            ) as range_count
     FROM recipes r
     ORDER BY r.name`
  );
}

export async function insertExperiment(
  db: Database,
  name: string,
  finalMass: number,
  seed: number,
  moldTempsJson: string,
  headTempsJson: string,
  sampleFieldsJson: string,
  analysisMetricKeysJson: string,
  replicates: number,
  notes: string | null
) {
  return db.run(
    `INSERT INTO experiments (name, final_mass_g, seed, mold_temps_json, head_temps_json, sample_fields_json, analysis_metric_keys_json, replicates_per_temp, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      name,
      finalMass,
      seed,
      moldTempsJson,
      headTempsJson,
      sampleFieldsJson,
      analysisMetricKeysJson,
      replicates,
      notes,
    ]
  );
}

export async function getRecipesByIds(db: Database, recipeIds: number[]) {
  const placeholders = recipeIds.map(() => "?").join(",");
  return db.all(
    `SELECT id, name FROM recipes WHERE id IN (${placeholders})`,
    recipeIds
  );
}

export async function getRecipeComponentsByIds(db: Database, recipeIds: number[]) {
  const placeholders = recipeIds.map(() => "?").join(",");
  return db.all(
    `SELECT recipe_id, name, mode, parts_static, parts_min, parts_max, position, is_locked
     FROM recipe_components
     WHERE recipe_id IN (${placeholders})
     ORDER BY recipe_id, position`,
    recipeIds
  );
}

export async function insertBatch(
  db: Database,
  experimentId: number,
  row: {
    recipe_id: number;
    recipe_variant: string | null;
    compound_order: number;
    batch_code: string;
    starch_g: number;
    citric_g: number;
    pers_g: number;
    esbo_g: number;
    water_g: number;
    total_g: number;
    weights_json: string;
    parts_json: string;
    head_set: number | null;
  }
) {
  await db.run(
    `INSERT INTO batches
      (experiment_id, recipe_id, recipe_variant, compound_order, batch_code, starch_g, citric_g, pers_g, esbo_g, water_g, total_g, weights_json, parts_json, head_set)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      experimentId,
      row.recipe_id,
      row.recipe_variant,
      row.compound_order,
      row.batch_code,
      row.starch_g,
      row.citric_g,
      row.pers_g,
      row.esbo_g,
      row.water_g,
      row.total_g,
      row.weights_json,
      row.parts_json,
      row.head_set,
    ]
  );
}

export async function getExperimentMoldingMeta(db: Database, experimentId: number) {
  return db.get<{
    id: number;
    seed: number;
    mold_temps_json: string;
    replicates_per_temp: number;
  }>(
    "SELECT id, seed, mold_temps_json, replicates_per_temp FROM experiments WHERE id = ?",
    [experimentId]
  );
}

export async function listBatchesForExperiment(db: Database, experimentId: number) {
  return db.all<{ id: number; batch_code: string }>(
    "SELECT id, batch_code FROM batches WHERE experiment_id = ? ORDER BY compound_order",
    [experimentId]
  );
}

export async function deleteSamplesByExperiment(db: Database, experimentId: number) {
  await db.run("DELETE FROM samples WHERE experiment_id = ?", [experimentId]);
}

export async function insertSample(
  db: Database,
  experimentId: number,
  row: {
    batch_id: number;
    mold_temp_c: number;
    replicate: number;
    sample_code: string;
    mold_order: number;
  }
) {
  await db.run(
    `INSERT INTO samples
      (experiment_id, batch_id, mold_order, mold_temp_c, replicate, sample_code)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      experimentId,
      row.batch_id,
      row.mold_order,
      row.mold_temp_c,
      row.replicate,
      row.sample_code,
    ]
  );
}

export async function deleteExperimentCascade(db: Database, experimentId: number) {
  await db.run("DELETE FROM samples WHERE experiment_id = ?", [experimentId]);
  await db.run("DELETE FROM batches WHERE experiment_id = ?", [experimentId]);
  await db.run("DELETE FROM experiments WHERE id = ?", [experimentId]);
}

export async function getExperimentById(db: Database, experimentId: number) {
  return db.get("SELECT * FROM experiments WHERE id = ?", [experimentId]);
}

export async function getExperimentMinimal(db: Database, experimentId: number) {
  return db.get("SELECT id, name FROM experiments WHERE id = ?", [experimentId]);
}

export async function listRecipes(db: Database) {
  return db.all("SELECT id, name FROM recipes ORDER BY name");
}

export async function listExperimentBatchesRaw(db: Database, experimentId: number) {
  return db.all(
    `SELECT b.*,
            CASE 
              WHEN b.recipe_variant IS NOT NULL AND b.recipe_variant != '' 
              THEN r.name || '_' || b.recipe_variant 
              ELSE r.name 
            END as recipe_name
     FROM batches b
     JOIN recipes r ON r.id = b.recipe_id
     WHERE b.experiment_id = ?
     ORDER BY b.compound_order`,
    [experimentId]
  );
}

export async function listExperimentSamplesRaw(db: Database, experimentId: number) {
  return db.all(
    `SELECT s.*, b.batch_code,
            CASE 
              WHEN b.recipe_variant IS NOT NULL AND b.recipe_variant != '' 
              THEN r.name || '_' || b.recipe_variant 
              ELSE r.name 
            END as recipe_name
     FROM samples s
     JOIN batches b ON b.id = s.batch_id
     JOIN recipes r ON r.id = b.recipe_id
     WHERE s.experiment_id = ?
     ORDER BY s.mold_order`,
    [experimentId]
  );
}

export async function getSamplesCount(db: Database, experimentId: number) {
  return db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM samples WHERE experiment_id = ?",
    [experimentId]
  );
}

export async function getBatchById(db: Database, experimentId: number, batchId: number) {
  return db.get(
    `SELECT b.*,
            CASE 
              WHEN b.recipe_variant IS NOT NULL AND b.recipe_variant != '' 
              THEN r.name || '_' || b.recipe_variant 
              ELSE r.name 
            END as recipe_name
     FROM batches b
     JOIN recipes r ON r.id = b.recipe_id
     WHERE b.id = ? AND b.experiment_id = ?`,
    [batchId, experimentId]
  );
}

export async function getPrevBatchId(db: Database, experimentId: number, compoundOrder: number) {
  return db.get<{ id: number }>(
    `SELECT id FROM batches
     WHERE experiment_id = ? AND compound_order < ?
     ORDER BY compound_order DESC LIMIT 1`,
    [experimentId, compoundOrder]
  );
}

export async function getNextBatchId(db: Database, experimentId: number, compoundOrder: number) {
  return db.get<{ id: number }>(
    `SELECT id FROM batches
     WHERE experiment_id = ? AND compound_order > ?
     ORDER BY compound_order ASC LIMIT 1`,
    [experimentId, compoundOrder]
  );
}

export async function getSampleById(db: Database, experimentId: number, sampleId: number) {
  return db.get(
    `SELECT s.*, b.batch_code, b.weights_json, b.parts_json,
            b.starch_g, b.citric_g, b.pers_g, b.esbo_g, b.water_g, b.total_g,
            CASE 
              WHEN b.recipe_variant IS NOT NULL AND b.recipe_variant != '' 
              THEN r.name || '_' || b.recipe_variant 
              ELSE r.name 
            END as recipe_name
     FROM samples s
     JOIN batches b ON b.id = s.batch_id
     JOIN recipes r ON r.id = b.recipe_id
     WHERE s.id = ? AND s.experiment_id = ?`,
    [sampleId, experimentId]
  );
}

export async function getPrevSampleId(db: Database, experimentId: number, moldOrder: number) {
  return db.get<{ id: number }>(
    `SELECT id FROM samples
     WHERE experiment_id = ? AND mold_order < ?
     ORDER BY mold_order DESC LIMIT 1`,
    [experimentId, moldOrder]
  );
}

export async function getNextSampleId(db: Database, experimentId: number, moldOrder: number) {
  return db.get<{ id: number }>(
    `SELECT id FROM samples
     WHERE experiment_id = ? AND mold_order > ?
     ORDER BY mold_order ASC LIMIT 1`,
    [experimentId, moldOrder]
  );
}

export async function updateBatchFields(
  db: Database,
  batchId: number,
  data: {
    head_set: number | null;
    head_actual: number | null;
    moist_after_dry: number | null;
    moist_before_mold: number | null;
    notes_compound: string | null;
  }
) {
  await db.run(
    `UPDATE batches
     SET head_set = ?,
         head_actual = ?,
         moist_after_dry = ?,
         moist_before_mold = ?,
         notes_compound = ?
     WHERE id = ?`,
    [
      data.head_set,
      data.head_actual,
      data.moist_after_dry,
      data.moist_before_mold,
      data.notes_compound,
      batchId,
    ]
  );
}

export async function updateBatchFieldsPartial(
  db: Database,
  batchId: number,
  data: Partial<{
    head_set: number | null;
    head_actual: number | null;
    moist_after_dry: number | null;
    moist_before_mold: number | null;
    notes_compound: string | null;
  }>
) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  await db.run(`UPDATE batches SET ${setClause} WHERE id = ?`, [
    ...values,
    batchId,
  ]);
}

export async function updateBatchDone(db: Database, batchId: number, doneValue: number) {
  await db.run("UPDATE batches SET done = ? WHERE id = ?", [doneValue, batchId]);
}

export async function getSampleMoldTemp(db: Database, sampleId: number) {
  return db.get<{ mold_temp_c: number }>(
    "SELECT mold_temp_c FROM samples WHERE id = ?",
    [sampleId]
  );
}

export async function updateSampleFields(
  db: Database,
  sampleId: number,
  data: {
    mold_temp_c: number | null;
    solubles_pct: number | null;
    swelling_g_g: number | null;
    density_g_cm3: number | null;
    notes_mold: string | null;
  }
) {
  await db.run(
    `UPDATE samples
     SET mold_temp_c = ?,
         solubles_pct = ?,
         swelling_g_g = ?,
         density_g_cm3 = ?,
         notes_mold = ?
     WHERE id = ?`,
    [
      data.mold_temp_c,
      data.solubles_pct,
      data.swelling_g_g,
      data.density_g_cm3,
      data.notes_mold,
      sampleId,
    ]
  );
}

export async function updateSampleFieldsPartial(
  db: Database,
  sampleId: number,
  data: Partial<{
    mold_temp_c: number | null;
    solubles_pct: number | null;
    swelling_g_g: number | null;
    density_g_cm3: number | null;
    notes_mold: string | null;
  }>
) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return;
  const setClause = entries.map(([key]) => `${key} = ?`).join(", ");
  const values = entries.map(([, value]) => value);
  await db.run(`UPDATE samples SET ${setClause} WHERE id = ?`, [
    ...values,
    sampleId,
  ]);
}

export async function getSampleExtra(db: Database, sampleId: number) {
  return db.get<{ extra_json: string | null; experiment_id: number }>(
    "SELECT extra_json, experiment_id FROM samples WHERE id = ?",
    [sampleId]
  );
}

export async function getExperimentFields(db: Database, experimentId: number) {
  return db.get<{
    sample_fields_json: string;
    analysis_metric_key: string;
    analysis_metric_keys_json: string;
  }>(
    "SELECT sample_fields_json, analysis_metric_key, analysis_metric_keys_json FROM experiments WHERE id = ?",
    [experimentId]
  );
}

export async function getExperimentFieldJson(db: Database, experimentId: number) {
  return db.get<{ sample_fields_json: string }>(
    "SELECT sample_fields_json FROM experiments WHERE id = ?",
    [experimentId]
  );
}

export async function updateExperimentFields(
  db: Database,
  experimentId: number,
  sampleFieldsJson: string
) {
  await db.run("UPDATE experiments SET sample_fields_json = ? WHERE id = ?", [
    sampleFieldsJson,
    experimentId,
  ]);
}

export async function updateExperimentFieldsAndMetrics(
  db: Database,
  experimentId: number,
  sampleFieldsJson: string,
  metricKeysJson: string
) {
  await db.run(
    "UPDATE experiments SET sample_fields_json = ?, analysis_metric_keys_json = ? WHERE id = ?",
    [sampleFieldsJson, metricKeysJson, experimentId]
  );
}

export async function updateExperimentPrimaryMetric(
  db: Database,
  experimentId: number,
  primary: string
) {
  await db.run("UPDATE experiments SET analysis_metric_key = ? WHERE id = ?", [
    primary,
    experimentId,
  ]);
}

export async function listSamplesExtraByExperiment(db: Database, experimentId: number) {
  return db.all<{ id: number; extra_json: string | null }>(
    "SELECT id, extra_json FROM samples WHERE experiment_id = ?",
    [experimentId]
  );
}

export async function updateSampleExtra(db: Database, sampleId: number, extraJson: string) {
  await db.run("UPDATE samples SET extra_json = ? WHERE id = ?", [extraJson, sampleId]);
}

export async function updateSampleDone(db: Database, sampleId: number, doneValue: number) {
  await db.run("UPDATE samples SET done = ? WHERE id = ?", [doneValue, sampleId]);
}

export async function listTableARows(db: Database, experimentId: number) {
  return db.all(
    `SELECT b.compound_order, b.batch_code,
            CASE 
              WHEN b.recipe_variant IS NOT NULL AND b.recipe_variant != '' 
              THEN r.name || '_' || b.recipe_variant 
              ELSE r.name 
            END as recipe_name,
            b.starch_g, b.citric_g, b.pers_g, b.esbo_g, b.water_g, b.total_g,
            b.head_set, b.head_actual, b.moist_after_dry, b.moist_before_mold, b.notes_compound,
            b.weights_json, b.parts_json
     FROM batches b
     JOIN recipes r ON r.id = b.recipe_id
     WHERE b.experiment_id = ?
     ORDER BY b.compound_order`,
    [experimentId]
  );
}

export async function listTableBRows(db: Database, experimentId: number) {
  return db.all(
    `SELECT s.mold_order, s.sample_code, b.batch_code,
            CASE 
              WHEN b.recipe_variant IS NOT NULL AND b.recipe_variant != '' 
              THEN r.name || '_' || b.recipe_variant 
              ELSE r.name 
            END as recipe_name,
            s.mold_temp_c, s.replicate,
            s.solubles_pct, s.swelling_g_g, s.density_g_cm3, s.notes_mold, s.extra_json
     FROM samples s
     JOIN batches b ON b.id = s.batch_id
     JOIN recipes r ON r.id = b.recipe_id
     WHERE s.experiment_id = ?
     ORDER BY s.mold_order`,
    [experimentId]
  );
}

export async function listMergedRows(db: Database, experimentId: number) {
  return db.all(
    `SELECT s.sample_code, s.mold_order, s.mold_temp_c, s.replicate,
            s.solubles_pct, s.swelling_g_g, s.density_g_cm3, s.notes_mold, s.extra_json,
            b.batch_code, b.compound_order, b.head_set, b.head_actual,
            b.moist_after_dry, b.moist_before_mold, b.notes_compound,
            CASE 
              WHEN b.recipe_variant IS NOT NULL AND b.recipe_variant != '' 
              THEN r.name || '_' || b.recipe_variant 
              ELSE r.name 
            END as recipe_name,
            b.starch_g, b.citric_g, b.pers_g, b.esbo_g, b.water_g, b.total_g
     FROM samples s
     JOIN batches b ON b.id = s.batch_id
     JOIN recipes r ON r.id = b.recipe_id
     WHERE s.experiment_id = ?
     ORDER BY s.mold_order`,
    [experimentId]
  );
}

export async function getExperimentAnalysisMeta(db: Database, experimentId: number) {
  return db.get<{
    sample_fields_json: string;
    analysis_metric_keys_json: string;
  }>(
    "SELECT sample_fields_json, analysis_metric_keys_json FROM experiments WHERE id = ?",
    [experimentId]
  );
}

export async function getBatchesCount(db: Database, experimentId: number) {
  return db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM batches WHERE experiment_id = ?",
    [experimentId]
  );
}

export async function listAnalysisSamples(db: Database, experimentId: number) {
  return db.all(
    `SELECT s.sample_code, s.mold_temp_c, s.replicate, s.solubles_pct, s.swelling_g_g,
            s.density_g_cm3, s.notes_mold, s.extra_json,
            b.batch_code, b.moist_before_mold, b.parts_json,
            r.name as recipe_name
     FROM samples s
     JOIN batches b ON b.id = s.batch_id
     JOIN recipes r ON r.id = b.recipe_id
     WHERE s.experiment_id = ?
     ORDER BY s.mold_order`,
    [experimentId]
  );
}
