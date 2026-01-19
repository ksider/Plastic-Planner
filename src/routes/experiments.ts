import express from "express";
import type { Database } from "sqlite";
import { wrap } from "../lib/http.js";
import { formatNumber } from "../lib/format.js";
import { AppError } from "../lib/errors.js";
import type { SampleFieldDef } from "../types.js";
import { withTransaction } from "../tx.js";
import {
  buildDecisionSupportAnalysis,
  buildAnalysis,
  buildWeightRows,
  mergeDefaultSampleFields,
  normalizeBatchComponents,
  parseHeadTemps,
  parseExtra,
  parseMoldTemps,
  parseMetricKeys,
  parseSampleFields,
  uniqueFieldKey,
} from "../domain/experiments.js";
import { getRecipeVariantCount, recipeSearchText } from "../domain/recipes.js";
import { createExperimentWithBatches, generateMoldingSamples } from "../services/experiments_service.js";
import { parseNumber, toCsv } from "../utils.js";
import {
  deleteExperimentCascade,
  getBatchById,
  getBatchesCount,
  getExperimentAnalysisMeta,
  getExperimentById,
  getExperimentFieldJson,
  getExperimentFields,
  getExperimentMinimal,
  getNextBatchId,
  getNextSampleId,
  getPrevBatchId,
  getPrevSampleId,
  getSampleById,
  getSampleExtra,
  getSamplesCount,
  listAnalysisSamples,
  listExperimentBatchesRaw,
  listExperimentSamplesRaw,
  listMergedRows,
  listRecipes,
  listRecipesForExperimentNew,
  listSamplesExtraByExperiment,
  listTableARows,
  listTableBRows,
  getRecipeComponentsByIds,
  updateBatchDone,
  updateBatchFieldsPartial,
  updateExperimentFields,
  updateExperimentFieldsAndMetrics,
  updateExperimentPrimaryMetric,
  updateSampleExtra,
  updateSampleFieldsPartial,
  updateSampleDone,
  updateSampleFields,
} from "../repos/experiments_repo.js";

export function createExperimentsRouter(db: Database) {
  const router = express.Router();
  router.get(
    "/experiments",
    wrap(async (_req, res) => {
      const experiments = await db.all(
        "SELECT id, name, final_mass_g, seed, notes, created_at FROM experiments ORDER BY created_at DESC"
      );
      res.render("experiments_index", { experiments });
    })
  );
  router.get(
    "/experiments/new",
    wrap(async (req, res) => {
      const recipes = await listRecipesForExperimentNew(db);
      const recipeIds = recipes.map((r: any) => r.id);
      const components = recipeIds.length
        ? await getRecipeComponentsByIds(db, recipeIds)
        : [];
      const componentsByRecipe = new Map<number, any[]>();
      for (const row of components) {
        const list = componentsByRecipe.get(row.recipe_id) ?? [];
        list.push(row);
        componentsByRecipe.set(row.recipe_id, list);
      }
      const recipesWithComponents = recipes.map((r: any) => {
        const components = componentsByRecipe.get(r.id) ?? [];
        const variantCount = getRecipeVariantCount(r, components);
        return {
          ...r,
          has_structure: Boolean(r.structure_json),
          has_variants: variantCount > 1,
          variant_count: variantCount,
          component_search: recipeSearchText(components, r),
        };
      });
      res.render("experiment_new", { recipes: recipesWithComponents });
    })
  );

  router.post(
    "/experiments",
    wrap(async (req, res) => {
    const name = String(req.body.name || "").trim();
    const finalMass = Number(req.body.final_mass_g || 1500);
    const recipeIds = Array.isArray(req.body.recipe_ids)
      ? req.body.recipe_ids.map((id: string) => Number(id))
      : [Number(req.body.recipe_ids)].filter((n) => Number.isFinite(n));
    const totalRuns = Number(req.body.total_runs);
    const seedInput = String(req.body.seed || "").trim();
    const notes = String(req.body.notes || "").trim() || null;
    const moldTemps = parseMoldTemps(
      String(req.body.mold_temps || "40,80,120")
    );
    const headTemps = parseHeadTemps(
      String(req.body.head_temps || "160,180,200")
    );
    const replicates = Number(req.body.replicates_per_temp || 1);

    if (!name || !Number.isFinite(finalMass) || !Number.isFinite(totalRuns)) {
      throw new AppError({
        status: 400,
        code: "INVALID_INPUT",
        message: "Invalid experiment inputs",
      });
    }
    if (recipeIds.length < 1) {
      throw new AppError({
        status: 400,
        code: "INVALID_INPUT",
        message: "Select at least one recipe",
      });
    }
    const parsedSeed = seedInput ? parseNumber(seedInput) : null;
    if (seedInput && parsedSeed === null) {
      throw new AppError({
        status: 400,
        code: "INVALID_INPUT",
        message: "Seed must be a number",
      });
    }
    const seed = parsedSeed ?? Math.floor(Math.random() * 2 ** 31);
    const moldTempsJson = JSON.stringify(
      moldTemps.length ? moldTemps : [40, 80, 120]
    );
    const headTempsJson = JSON.stringify(
      headTemps.length ? headTemps : [160, 180, 200]
    );

    const experimentId = await createExperimentWithBatches(db, {
      name,
      finalMass,
      recipeIds,
      totalRuns,
      seed,
      moldTempsJson,
      headTempsJson,
      headTemps,
      replicates,
      notes,
    });

    res.redirect(`/experiments/${experimentId}`);
  })
);

  router.post(
  "/experiments/:id/generate-molding",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    await generateMoldingSamples(db, experimentId);

    res.redirect(`/experiments/${experimentId}`);
  })
);

  router.post(
  "/experiments/:id/delete",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    await withTransaction(db, async () => {
      await deleteExperimentCascade(db, experimentId);
    });
    res.redirect("/");
  })
);

  router.get(
  "/experiments/:id",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const experiment = await getExperimentById(db, experimentId);
    if (!experiment) return res.status(404).send("Experiment not found");

    const recipes = await listRecipes(db);

    const batchesRaw = await listExperimentBatchesRaw(db, experimentId);

    const { batches, componentOrder } = normalizeBatchComponents(batchesRaw);

    const samples = await listExperimentSamplesRaw(db, experimentId);

    const samplesCount = await getSamplesCount(db, experimentId);

    let sampleFields = mergeDefaultSampleFields(
      parseSampleFields(experiment.sample_fields_json)
    );
    await updateExperimentFields(
      db,
      experimentId,
      JSON.stringify(sampleFields)
    );
    const analysisMetricKeys = parseMetricKeys(
      experiment.analysis_metric_keys_json
    );
    const analysis = buildAnalysis(batches, samples);

    res.render("experiment_show", {
      experiment,
      recipes,
      batches,
      componentOrder,
      samples,
      analysis,
      formatNumber,
      sampleFields,
      analysisMetricKeys,
      samplesCount: samplesCount?.count ?? 0,
    });
  })
);

  router.get(
  "/experiments/:id/batches/:batchId",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const batchId = Number(req.params.batchId);
    const experiment = await getExperimentMinimal(db, experimentId);
    if (!experiment) return res.status(404).send("Experiment not found");

    const batch = await getBatchById(db, experimentId, batchId);
    if (!batch) return res.status(404).send("Batch not found");

    const prev = await getPrevBatchId(db, experimentId, batch.compound_order);
    const next = await getNextBatchId(db, experimentId, batch.compound_order);

    const weights = buildWeightRows(batch);

    res.render("batch_detail", {
      experiment,
      batch,
      weights,
      formatNumber,
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
    });
  })
);

  router.get(
  "/experiments/:id/samples/:sampleId",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const sampleId = Number(req.params.sampleId);
    const experiment = await getExperimentMinimal(db, experimentId);
    if (!experiment) return res.status(404).send("Experiment not found");

    const sample = await getSampleById(db, experimentId, sampleId);
    if (!sample) return res.status(404).send("Sample not found");

    const prev = await getPrevSampleId(db, experimentId, sample.mold_order);
    const next = await getNextSampleId(db, experimentId, sample.mold_order);

    const weights = buildWeightRows(sample);

    res.render("sample_detail", {
      experiment,
      sample,
      weights,
      formatNumber,
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
    });
  })
);

  router.post(
  "/experiments/:id/batches/:batchId",
  wrap(async (req, res) => {
    const batchId = Number(req.params.batchId);
    const redirectTo =
      req.body.redirect_to !== undefined
        ? String(req.body.redirect_to)
        : null;
    const fields = [
      "head_set",
      "head_actual",
      "moist_after_dry",
      "moist_before_mold",
      "notes_compound",
    ];
    const updates: Record<string, unknown> = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    const payload: Partial<{
      head_set: number | null;
      head_actual: number | null;
      moist_after_dry: number | null;
      moist_before_mold: number | null;
      notes_compound: string | null;
    }> = {};
    if (Object.prototype.hasOwnProperty.call(updates, "head_set")) {
      payload.head_set = parseNumber(updates.head_set);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "head_actual")) {
      payload.head_actual = parseNumber(updates.head_actual);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "moist_after_dry")) {
      payload.moist_after_dry = parseNumber(updates.moist_after_dry);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "moist_before_mold")) {
      payload.moist_before_mold = parseNumber(updates.moist_before_mold);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "notes_compound")) {
      payload.notes_compound =
        updates.notes_compound !== undefined
          ? String(updates.notes_compound)
          : null;
    }

    await updateBatchFieldsPartial(db, batchId, payload);

    if (Object.prototype.hasOwnProperty.call(req.body, "done")) {
      const doneValue =
        req.body.done === "1" || req.body.done === "on" ? 1 : 0;
      await updateBatchDone(db, batchId, doneValue);
    }

    if (redirectTo) {
      return res.redirect(redirectTo);
    }
    res.json({ ok: true });
  })
);

  router.post(
  "/experiments/:id/samples/:sampleId",
  wrap(async (req, res) => {
    const sampleId = Number(req.params.sampleId);
    const redirectTo =
      req.body.redirect_to !== undefined
        ? String(req.body.redirect_to)
        : null;
    const fields = [
      "mold_temp_c",
      "solubles_pct",
      "swelling_g_g",
      "density_g_cm3",
      "notes_mold",
    ];
    const updates: Record<string, unknown> = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = req.body[field];
      }
    }

    const payload: Partial<{
      mold_temp_c: number | null;
      solubles_pct: number | null;
      swelling_g_g: number | null;
      density_g_cm3: number | null;
      notes_mold: string | null;
    }> = {};
    if (Object.prototype.hasOwnProperty.call(updates, "mold_temp_c")) {
      payload.mold_temp_c = parseNumber(updates.mold_temp_c);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "solubles_pct")) {
      payload.solubles_pct = parseNumber(updates.solubles_pct);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "swelling_g_g")) {
      payload.swelling_g_g = parseNumber(updates.swelling_g_g);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "density_g_cm3")) {
      payload.density_g_cm3 = parseNumber(updates.density_g_cm3);
    }
    if (Object.prototype.hasOwnProperty.call(updates, "notes_mold")) {
      payload.notes_mold =
        updates.notes_mold !== undefined ? String(updates.notes_mold) : null;
    }

    await updateSampleFieldsPartial(db, sampleId, payload);

    const extraKeys = Object.keys(req.body).filter((k) =>
      k.startsWith("extra__")
    );
    if (extraKeys.length > 0) {
      const sample = await getSampleExtra(db, sampleId);
      const experiment = sample
        ? await getExperimentFieldJson(db, sample.experiment_id)
        : null;
      const fields = experiment
        ? parseSampleFields(experiment.sample_fields_json)
        : [];
      const fieldMap = new Map(fields.map((f) => [f.key, f]));
      let extra: Record<string, unknown> = {};
      if (sample?.extra_json) {
        try {
          extra = JSON.parse(sample.extra_json);
        } catch {
          extra = {};
        }
      }

      for (const key of extraKeys) {
        const fieldKey = key.replace("extra__", "");
        const value = req.body[key];
        const def = fieldMap.get(fieldKey);
        if (def?.type === "number") {
          const num = parseNumber(value);
          extra[fieldKey] = num;
        } else if (def?.type === "tags") {
          const arr = Array.isArray(value)
            ? value.map((v) => String(v))
            : typeof value === "string"
            ? value
                .split(",")
                .map((v) => v.trim())
                .filter((v) => v)
            : [];
          extra[fieldKey] = arr;
        } else {
          extra[fieldKey] =
            value !== undefined && value !== null ? String(value) : "";
        }
      }
      await updateSampleExtra(db, sampleId, JSON.stringify(extra));
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "done")) {
      const doneValue =
        req.body.done === "1" || req.body.done === "on" ? 1 : 0;
      await updateSampleDone(db, sampleId, doneValue);
    }

    if (redirectTo) {
      return res.redirect(redirectTo);
    }
    res.json({ ok: true });
  })
);

  router.post(
  "/experiments/:id/fields",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const label = String(req.body.label || "").trim();
    const typeRaw = typeof req.body.type === "string" ? req.body.type : "";
    const type = typeRaw || "text";
    const optionsRaw = String(req.body.options || "").trim();
    if (!label) return res.status(400).send("Field name required");

    const experiment = await getExperimentFields(db, experimentId);
    if (!experiment) return res.status(404).send("Experiment not found");
    const fields = parseSampleFields(experiment.sample_fields_json);

    const key = uniqueFieldKey(label, fields);
    const options =
      type === "tags" && optionsRaw.length > 0
        ? optionsRaw.split(",").map((t) => t.trim()).filter((t) => t)
        : [];
    const field: SampleFieldDef = {
      key,
      label,
      type: type === "number" ? "number" : type === "tags" ? "tags" : "text",
      options,
      analyze: type === "number",
      is_core: false,
      is_default: false,
    };
    fields.push(field);
    await updateExperimentFields(db, experimentId, JSON.stringify(fields));
    res.redirect(`/experiments/${experimentId}#tab-data`);
  })
);

  router.post(
  "/experiments/:id/fields/:key/update",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const key = String(req.params.key);
    const label = String(req.body.label || "").trim();
    const type = String(req.body.type || "text");
    const optionsRaw = String(req.body.options || "").trim();
    if (!label) return res.status(400).send("Field name required");

    const experiment = await getExperimentFieldJson(db, experimentId);
    if (!experiment) return res.status(404).send("Experiment not found");
    const fields = parseSampleFields(experiment.sample_fields_json);
    const updated = fields.map((f) => {
      if (f.key !== key) return f;
      const options =
        type === "tags" && optionsRaw.length > 0
          ? optionsRaw
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t)
          : [];
      const nextType =
        f.is_core || f.is_default || !typeRaw
          ? f.type
          : type === "number"
          ? "number"
          : type === "tags"
          ? "tags"
          : "text";
      return {
        ...f,
        label,
        type: nextType,
        options,
      };
    });
    await updateExperimentFields(db, experimentId, JSON.stringify(updated));
    res.redirect(`/experiments/${experimentId}#tab-data`);
  })
);

  router.post(
  "/experiments/:id/fields/:key",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const key = String(req.params.key);
    const experiment = await getExperimentFields(db, experimentId);
    if (!experiment) return res.status(404).send("Experiment not found");
    const fields = parseSampleFields(experiment.sample_fields_json);
    const analyze = Boolean(req.body.analyze);
    const keys = new Set(parseMetricKeys(experiment.analysis_metric_keys_json));
    if (analyze) keys.add(key);
    else keys.delete(key);
    if (keys.size === 0) keys.add("solubles_pct");
    const updated = fields.map((f) => {
      if (f.key !== key) return f;
      return { ...f, analyze };
    });
    await updateExperimentFieldsAndMetrics(
      db,
      experimentId,
      JSON.stringify(updated),
      JSON.stringify(Array.from(keys))
    );
    const primary = Array.from(keys)[0] || "solubles_pct";
    await updateExperimentPrimaryMetric(db, experimentId, primary);
    res.json({ ok: true, keys: Array.from(keys) });
  })
);

  router.post(
  "/experiments/:id/fields/:key/delete",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const key = String(req.params.key);
    const experiment = await getExperimentAnalysisMeta(db, experimentId);
    if (!experiment) return res.status(404).send("Experiment not found");
    const allFields = mergeDefaultSampleFields(
      parseSampleFields(experiment.sample_fields_json)
    );
    const fieldToDelete = allFields.find((f) => f.key === key);
    if (fieldToDelete?.is_default) {
      return res.status(400).send("Default fields cannot be deleted");
    }
    const fields = allFields.filter((f) => f.key !== key);
    const keys = new Set(parseMetricKeys(experiment.analysis_metric_keys_json));
    keys.delete(key);
    if (keys.size === 0) keys.add("solubles_pct");

    await updateExperimentFieldsAndMetrics(
      db,
      experimentId,
      JSON.stringify(fields),
      JSON.stringify(Array.from(keys))
    );

    const samples = await listSamplesExtraByExperiment(db, experimentId);
    for (const s of samples) {
      const extra = parseExtra(s.extra_json);
      if (extra[key] !== undefined) {
        delete extra[key];
        await updateSampleExtra(db, s.id, JSON.stringify(extra));
      }
    }

    res.redirect(`/experiments/${experimentId}#tab-data`);
  })
);

  router.get(
  "/experiments/:id/export/tableA.csv",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const rowsRaw = await listTableARows(db, experimentId);

    const { batches, componentOrder } = normalizeBatchComponents(rowsRaw);

    const header = [
      "CompoundOrder",
      "BatchCode",
      "Recipe",
      ...componentOrder.map((name) => `${name}_g`),
      "total_g",
      "head_set",
      "head_actual",
      "moist_after_dry",
      "moist_before_mold",
      "notes_compound",
    ];

    const data = batches.map((r) => {
      const componentValues = componentOrder.map((name) =>
        r.weights && r.weights[name] !== undefined ? r.weights[name] : ""
      );
      return [
        String(r.compound_order),
        String(r.batch_code),
        String(r.recipe_name),
        ...componentValues,
        String(r.total_g),
        r.head_set ?? "",
        r.head_actual ?? "",
        r.moist_after_dry ?? "",
        r.moist_before_mold ?? "",
        r.notes_compound ?? "",
      ].map(String);
    });

    const csv = toCsv([header, ...data]);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=experiment_${experimentId}_tableA.csv`
    );
    res.send(csv);
  })
);

  router.get(
  "/experiments/:id/export/tableB.csv",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const experiment = await getExperimentFieldJson(db, experimentId);
    let sampleFields = mergeDefaultSampleFields(
      parseSampleFields(experiment?.sample_fields_json)
    );
    sampleFields = sampleFields.filter((f) => !f.is_core);
    const rows = await listTableBRows(db, experimentId);

    const header = [
      "MoldOrder",
      "SampleCode",
      "BatchCode",
      "Recipe",
      "MoldTemp_C",
      "Replicate",
      "solubles_pct",
      "swelling_g_g",
      "density_g_cm3",
      ...sampleFields.map((f) => f.label),
      "notes_mold",
    ];

    const data = rows.map((r) =>
      [
        String(r.mold_order),
        String(r.sample_code),
        String(r.batch_code),
        String(r.recipe_name),
        String(r.mold_temp_c),
        String(r.replicate),
        r.solubles_pct ?? "",
        r.swelling_g_g ?? "",
        r.density_g_cm3 ?? "",
        ...sampleFields.map((f) => {
          const extra = parseExtra(r.extra_json);
          const value = extra[f.key];
          if (Array.isArray(value)) return value.join(",");
          return value ?? "";
        }),
        r.notes_mold ?? "",
      ].map(String)
    );

    const csv = toCsv([header, ...data]);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=experiment_${experimentId}_tableB.csv`
    );
    res.send(csv);
  })
);

  router.get(
  "/experiments/:id/export/merged.csv",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const experiment = await getExperimentFieldJson(db, experimentId);
    let sampleFields = mergeDefaultSampleFields(
      parseSampleFields(experiment?.sample_fields_json)
    );
    sampleFields = sampleFields.filter((f) => !f.is_core);
    const rows = await listMergedRows(db, experimentId);

    const header = [
      "SampleCode",
      "MoldOrder",
      "MoldTemp_C",
      "Replicate",
      "solubles_pct",
      "swelling_g_g",
      "density_g_cm3",
      ...sampleFields.map((f) => f.label),
      "notes_mold",
      "BatchCode",
      "CompoundOrder",
      "head_set",
      "head_actual",
      "moist_after_dry",
      "moist_before_mold",
      "notes_compound",
      "Recipe",
      "starch_g",
      "citric_g",
      "pers_g",
      "esbo_g",
      "water_g",
      "total_g",
    ];

    const data = rows.map((r) =>
      [
        r.sample_code,
        String(r.mold_order),
        String(r.mold_temp_c),
        String(r.replicate),
        r.solubles_pct ?? "",
        r.swelling_g_g ?? "",
        r.density_g_cm3 ?? "",
        ...sampleFields.map((f) => {
          const extra = parseExtra(r.extra_json);
          const value = extra[f.key];
          if (Array.isArray(value)) return value.join(",");
          return value ?? "";
        }),
        r.notes_mold ?? "",
        r.batch_code,
        String(r.compound_order),
        r.head_set ?? "",
        r.head_actual ?? "",
        r.moist_after_dry ?? "",
        r.moist_before_mold ?? "",
        r.notes_compound ?? "",
        r.recipe_name,
        String(r.starch_g),
        String(r.citric_g),
        String(r.pers_g),
        String(r.esbo_g),
        String(r.water_g),
        String(r.total_g),
      ].map(String)
    );

    const csv = toCsv([header, ...data]);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=dataset_merged_AplusB_${experimentId}.csv`
    );
    res.send(csv);
  })
);
 
  router.get(
    "/experiments/:id/analysis.json",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const experiment = await getExperimentAnalysisMeta(db, experimentId);
      if (!experiment) return res.status(404).send("Experiment not found");

      const batchesCount = (await getBatchesCount(db, experimentId))?.count ?? 0;
      const samplesCount = (await getSamplesCount(db, experimentId))?.count ?? 0;
      const samples = await listAnalysisSamples(db, experimentId);

      const metricQuery = typeof req.query.metrics === "string" ? req.query.metrics : "";
      const metricKeys =
        metricQuery.trim().length > 0
          ? metricQuery.split(",").map((v) => v.trim()).filter((v) => v)
          : parseMetricKeys(experiment.analysis_metric_keys_json);
      const alphaRaw = typeof req.query.alpha === "string" ? req.query.alpha : "";
      const alphaNum = Number(alphaRaw);
      const alpha = Number.isFinite(alphaNum) ? alphaNum : 1.5;

      const analysis = buildDecisionSupportAnalysis({
        batchesCount,
        samplesCount,
        joinedCount: samples.length,
        samples,
        sampleFields: mergeDefaultSampleFields(
          parseSampleFields(experiment.sample_fields_json)
        ),
        metricKeys,
        alpha,
      });

      res.json(analysis);
    })
  );

  router.post(
    "/experiments/:id/update",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const name = String(req.body.name || "").trim();
      const seed = Number(req.body.seed);

      if (!name || !Number.isFinite(seed)) {
        throw new AppError({
          status: 400,
          code: "INVALID_INPUT",
          message: "Invalid experiment inputs",
        });
      }

      const notes = String(req.body.notes || "").trim() || null;
      await db.run(
        "UPDATE experiments SET name = ?, seed = ?, notes = ? WHERE id = ?",
        [name, seed, notes, experimentId]
      );

      res.redirect(`/experiments/${experimentId}`);
    })
  );

  return router;
}
