import express from "express";
import type { Database } from "sqlite";
import { wrap } from "../lib/http.js";
import { AppError } from "../lib/errors.js";
import { formatNumber } from "../lib/format.js";
import { slugify } from "../utils.js";
import {
  parseListNumbers,
  parseNumberFlexible,
  normalizeFieldValue,
  normalizeCheckbox,
} from "../domain/im.js";
import {
  buildTpsDecisionSupportAnalysis,
  defaultTpsParamConfig,
  parseOutputsJson,
  parseTpsMetricKeys,
  parseTpsOutputFields,
} from "../domain/tps.js";
import {
  buildRecipeVariants,
  getRecipeVariantCount,
  recipeSearchText,
} from "../domain/recipes.js";
import { uniqueFieldKey } from "../domain/experiments.js";
import { createTpsExperiment, generateTpsRuns } from "../services/tps_service.js";
import {
  deactivateTpsParamConfig,
  deleteTpsExperimentCascade,
  findTpsParamDefinitionByCode,
  getNextTpsRunId,
  getPrevTpsRunId,
  getTpsExperimentById,
  getTpsRunById,
  insertTpsParamConfig,
  insertTpsParamDefinitionCustom,
  listActiveTpsParamConfigs,
  listRecipeNames,
  listTpsExperimentRecipes,
  listTpsExperimentsSummary,
  listTpsParamConfigsByExperiment,
  listTpsParamDefs,
  getTpsParamDef,
  listTpsRunParamValuesByRunIds,
  listTpsRuns,
  updateTpsExperimentAnalysisKeys,
  updateTpsExperimentOutputFields,
  updateTpsRunDone,
  updateTpsRunNotes,
  updateTpsRunOutputs,
  upsertTpsParamConfig,
} from "../repos/tps_repo.js";
import { getRecipeComponentsByIds } from "../repos/experiments_repo.js";
import { getRecipeById } from "../repos/recipes_repo.js";

export function createTpsRouter(db: Database) {
  const router = express.Router();

  router.get(
    "/tps",
    wrap(async (_req, res) => {
      const experiments = await listTpsExperimentsSummary(db);
      res.render("tps_index", { experiments });
    })
  );

  router.get(
    "/tps/new",
    wrap(async (_req, res) => {
      const recipes = await listRecipeNames(db);
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
      res.render("tps_new", { recipes: recipesWithComponents });
    })
  );

  router.post(
    "/tps",
    wrap(async (req, res) => {
      const name = String(req.body.name || "").trim();
      const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 1e9);
      const notes = String(req.body.notes || "").trim() || null;
      const recipeIds = Array.isArray(req.body.recipe_ids)
        ? req.body.recipe_ids.map((v: string) => Number(v)).filter(Number.isFinite)
        : req.body.recipe_ids
        ? [Number(req.body.recipe_ids)].filter(Number.isFinite)
        : [];

      if (!name) {
        throw new AppError({
          status: 400,
          code: "INVALID_INPUT",
          message: "Invalid TPS experiment inputs",
        });
      }

      const experimentId = await createTpsExperiment(db, {
        name,
        seed,
        notes,
        recipeIds,
      });
      res.redirect(`/tps/${experimentId}`);
    })
  );

  router.post(
    "/tps/:id/update",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const name = String(req.body.name || "").trim();
      const seed = Number(req.body.seed);
      const notes = String(req.body.notes || "").trim() || null;

      if (!name || !Number.isFinite(seed)) {
        throw new AppError({
          status: 400,
          code: "INVALID_INPUT",
          message: "Invalid TPS experiment inputs",
        });
      }

      await db.run(
        "UPDATE tps_experiments SET name = ?, seed = ?, notes = ? WHERE id = ?",
        [name, seed, notes, experimentId]
      );

      res.redirect(`/tps/${experimentId}`);
    })
  );

  router.get(
    "/tps/:id",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const experiment = await getTpsExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("TPS experiment not found");

      const paramDefs = await listTpsParamDefs(db);
      const configs = await listTpsParamConfigsByExperiment(db, experimentId);
      const configMap = new Map(configs.map((c: any) => [c.param_def_id, c]));

      for (const def of paramDefs) {
        if (configMap.has(def.id)) continue;
        const defaults = defaultTpsParamConfig(def.code);
        await insertTpsParamConfig(
          db,
          experimentId,
          def.id,
          defaults.mode,
          defaults.fixed_value ?? def.min_default ?? null,
          defaults.range_min ?? def.min_default ?? null,
          defaults.range_max ?? def.max_default ?? def.min_default ?? null,
          defaults.list_json ?? null,
          defaults.active
        );
      }

      if (paramDefs.length !== configMap.size) {
        const refreshed = await listTpsParamConfigsByExperiment(db, experimentId);
        configMap.clear();
        refreshed.forEach((c: any) => configMap.set(c.param_def_id, c));
      }

      const params = paramDefs.map((def) => {
        const cfg = configMap.get(def.id) || null;
        let listString = "";
        if (cfg?.list_json) {
          try {
            const parsed = JSON.parse(cfg.list_json);
            if (Array.isArray(parsed)) listString = parsed.join(", ");
          } catch {
            listString = "";
          }
        }
        return { ...def, config: cfg, listString };
      });

      const activeConfigs = await listActiveTpsParamConfigs(db, experimentId);
      const availableDefs = paramDefs.filter((d) => {
        const cfg = configMap.get(d.id);
        return !cfg || cfg.active !== 1;
      });

      const recipes = await listRecipeNames(db);
      const selectedRecipes = await listTpsExperimentRecipes(db, experimentId);
      const recipeIds = selectedRecipes.map((r: any) => r.id);
      const recipeComponents = recipeIds.length
        ? await getRecipeComponentsByIds(db, recipeIds)
        : [];
      const componentsByRecipe = new Map<number, any[]>();
      for (const row of recipeComponents) {
        const list = componentsByRecipe.get(row.recipe_id) ?? [];
        list.push({
          name: row.name,
          mode: row.mode,
          parts_static: row.parts_static,
          parts_min: row.parts_min,
          parts_max: row.parts_max,
          is_locked: row.is_locked ?? 0,
        });
        componentsByRecipe.set(row.recipe_id, list);
      }
      const recipeVariantCount = selectedRecipes.length
        ? selectedRecipes.reduce((sum: number, r: any) => {
            const count = getRecipeVariantCount(
              r,
              componentsByRecipe.get(r.id) ?? []
            );
            return sum + Math.max(1, count);
          }, 0)
        : 1;

      const runs = await listTpsRuns(db, experimentId);
      const runParamRows = await listTpsRunParamValuesByRunIds(
        db,
        runs.map((r: any) => r.id)
      );
      const runParamMap = new Map(
        runParamRows.map((r: any) => [`${r.run_id}:${r.param_def_id}`, r.value_real])
      );

      const activeDefs = paramDefs.filter((d) => {
        const cfg = configMap.get(d.id);
        return cfg?.active === 1;
      });
      const runsWithParams = runs.map((run: any) => {
        const keyValues: Record<string, number | null> = {};
        activeDefs.forEach((def) => {
          keyValues[def.code] = runParamMap.get(`${run.id}:${def.id}`) ?? null;
        });
        return { ...run, keyValues };
      });

      const outputFields = parseTpsOutputFields(experiment.output_fields_json);
      const analysisMetricKeys = parseTpsMetricKeys(
        experiment.analysis_metric_keys_json
      );

      const maxRunsDefault = (() => {
        let total = 1;
        for (const cfg of activeConfigs) {
          if (!cfg) continue;
          if (cfg.mode === "LIST") {
            try {
              const list = cfg.list_json ? JSON.parse(cfg.list_json) : [];
              const count = Array.isArray(list) ? list.length : 0;
              total *= Math.max(1, count);
            } catch {
              total *= 1;
            }
          } else if (cfg.mode === "RANGE") {
            const min = cfg.range_min;
            const max = cfg.range_max;
            total *= min !== null && max !== null ? 2 : 1;
          } else {
            total *= 1;
          }
          if (!Number.isFinite(total) || total > 100000) return 100000;
        }
        return Math.max(1, Math.round(total * recipeVariantCount));
      })();

      res.render("tps_show", {
        experiment,
        params,
        availableDefs,
        recipes,
        selectedRecipes,
        recipeVariantCount,
        runs: runsWithParams,
        outputFields,
        analysisMetricKeys,
        activeDefs,
        maxRunsDefault,
        formatNumber,
        warning: req.query.warning || "",
      });
    })
  );

  router.post(
    "/tps/:id/params",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const payload = req.body?.params || {};
      for (const [paramId, config] of Object.entries(payload)) {
        const id = Number(paramId);
        if (!Number.isFinite(id)) continue;
        const mode = String((config as any).mode || "FIXED");
        const active = normalizeCheckbox((config as any).active);
        const fixedValue = parseNumberFlexible((config as any).fixed_value);
        const rangeMin = parseNumberFlexible((config as any).range_min);
        const rangeMax = parseNumberFlexible((config as any).range_max);
        const listValues = parseListNumbers((config as any).list_values || "");
        const listJson = listValues.length ? JSON.stringify(listValues) : null;
        await upsertTpsParamConfig(
          db,
          experimentId,
          id,
          mode,
          fixedValue,
          rangeMin,
          rangeMax,
          listJson,
          active ? 1 : 0
        );
      }
      res.json({ ok: true });
    })
  );

  router.post(
    "/tps/:id/params/:paramId/delete",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const paramId = Number(req.params.paramId);
      await deactivateTpsParamConfig(db, experimentId, paramId);
      res.json({ ok: true });
    })
  );

  router.post(
    "/tps/:id/add-param",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const paramDefId = Number(req.body.param_def_id || 0);
      if (!paramDefId) return res.redirect(`/tps/${experimentId}`);
      const def = await getTpsParamDef(db, paramDefId);
      const defaults = defaultTpsParamConfig(def?.code || "");
      await upsertTpsParamConfig(
        db,
        experimentId,
        paramDefId,
        defaults.mode,
        defaults.fixed_value ?? def?.min_default ?? null,
        defaults.range_min ?? def?.min_default ?? null,
        defaults.range_max ?? def?.max_default ?? def?.min_default ?? null,
        defaults.list_json ?? null,
        1
      );
      res.redirect(`/tps/${experimentId}#tab-tps-design`);
    })
  );

  router.post(
    "/tps/:id/add-custom-param",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const label = String(req.body.label || "").trim();
      const unit = String(req.body.unit || "").trim() || null;
      const mode = String(req.body.mode || "FIXED");
      if (!label) {
        return res.redirect(`/tps/${experimentId}#tab-tps-design`);
      }
      const codeBase = slugify(label) || "param";
      let code = codeBase;
      let i = 2;
      while (await findTpsParamDefinitionByCode(db, code)) {
        code = `${codeBase}_${i}`;
        i += 1;
      }
      const insertResult = await insertTpsParamDefinitionCustom(
        db,
        code,
        label,
        unit
      );
      const paramDefId = insertResult.lastID as number;
      const fixedValue = parseNumberFlexible(req.body.fixed_value);
      const rangeMin = parseNumberFlexible(req.body.range_min);
      const rangeMax = parseNumberFlexible(req.body.range_max);
      const listValues = parseListNumbers(String(req.body.list_values || ""));
      const listJson = listValues.length ? JSON.stringify(listValues) : null;
      await upsertTpsParamConfig(
        db,
        experimentId,
        paramDefId,
        mode,
        fixedValue,
        rangeMin,
        rangeMax,
        listJson,
        1
      );
      res.redirect(`/tps/${experimentId}#tab-tps-design`);
    })
  );

  router.post(
    "/tps/:id/generate-runs",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const experiment = await getTpsExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("TPS experiment not found");
      const maxRuns = Number(req.body.max_runs || 0) || 1;
      const { warning } = await generateTpsRuns(db, {
        experimentId,
        maxRuns,
        seed: experiment.seed,
      });
      const warningParam = warning ? `?warning=${encodeURIComponent(warning)}` : "";
      res.redirect(`/tps/${experimentId}${warningParam}#tab-tps-runs`);
    })
  );

  router.post(
    "/tps/:id/delete",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      await deleteTpsExperimentCascade(db, experimentId);
      res.redirect("/tps");
    })
  );

  router.post(
    "/tps/:id/runs/:runId",
    wrap(async (req, res) => {
      const runId = Number(req.params.runId);
      const run = await getTpsRunById(db, runId);
      if (!run) return res.status(404).send("Run not found");

      const outputs = parseOutputsJson(run.outputs_json);
      const payload = req.body || {};

      for (const [key, value] of Object.entries(payload)) {
        if (key === "notes") {
          const notes = String(normalizeFieldValue(value)).trim();
          await updateTpsRunNotes(db, runId, notes || null);
          continue;
        }
        if (key === "done") {
          const done = normalizeCheckbox(value);
          await updateTpsRunDone(db, runId, done ? 1 : 0);
          continue;
        }
        if (key.startsWith("output__")) {
          const outKey = key.replace("output__", "");
          if (Array.isArray(value)) {
            outputs[outKey] = value.map(String);
          } else {
            const normalized = normalizeFieldValue(value);
            outputs[outKey] = normalized === "" ? null : normalized;
          }
        }
      }

      await updateTpsRunOutputs(db, runId, JSON.stringify(outputs));
      res.json({ ok: true });
    })
  );

  router.get(
    "/tps/:id/runs/:runId",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const runId = Number(req.params.runId);
      const experiment = await getTpsExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("TPS experiment not found");
      const run = await getTpsRunById(db, runId);
      if (!run) return res.status(404).send("Run not found");

      const paramDefs = await listTpsParamDefs(db);
      const runParamRows = await listTpsRunParamValuesByRunIds(db, [runId]);
      const runParamMap = new Map(
        runParamRows.map((r: any) => [r.param_def_id, r.value_real])
      );
      const paramValues = paramDefs.map((def) => ({
        ...def,
        value: runParamMap.get(def.id) ?? null,
      }));

      let recipeParts: Array<{ name: string; parts_used: number }> = [];
      if (run.recipe_id) {
        const components = await getRecipeComponentsByIds(db, [run.recipe_id]);
        const recipe = await getRecipeById(db, run.recipe_id);
        const variants = buildRecipeVariants(recipe ?? {}, components);
        const match =
          run.recipe_variant !== null
            ? variants.find((v) => v.variant === run.recipe_variant)
            : variants.find((v) => v.variant === null);
        recipeParts = (match || variants[0] || { partsEntries: [] }).partsEntries;
      }

      const outputFields = parseTpsOutputFields(experiment.output_fields_json);
      const outputs = parseOutputsJson(run.outputs_json);

      const prev = await getPrevTpsRunId(db, experimentId, run.run_order);
      const next = await getNextTpsRunId(db, experimentId, run.run_order);

      res.render("tps_run_detail", {
        experiment,
        run,
        paramValues,
        recipeParts,
        outputFields,
        outputs,
        prevRunId: prev?.id || null,
        nextRunId: next?.id || null,
      });
    })
  );

  router.post(
    "/tps/:id/fields",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const experiment = await getTpsExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("TPS experiment not found");
      const label = String(req.body.label || "").trim();
      if (!label) return res.redirect(`/tps/${experimentId}#tab-tps-runs`);
      const type =
        req.body.type === "number" ? "number" : req.body.type === "tags" ? "tags" : "text";
      const fields = parseTpsOutputFields(experiment.output_fields_json);
      const key = uniqueFieldKey(label, fields);
      const options =
        type === "tags"
          ? String(req.body.options || "")
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : [];
      fields.push({ key, label, type, options, analyze: type === "number" });
      await updateTpsExperimentOutputFields(db, experimentId, JSON.stringify(fields));
      res.redirect(`/tps/${experimentId}#tab-tps-runs`);
    })
  );

  router.post(
    "/tps/:id/fields/:key/update",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const key = String(req.params.key || "");
      const experiment = await getTpsExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("TPS experiment not found");
      const fields = parseTpsOutputFields(experiment.output_fields_json);
      const updated = fields.map((f) => {
        if (f.key !== key) return f;
        const label = String(req.body.label || f.label).trim() || f.label;
        const typeRaw = typeof req.body.type === "string" ? req.body.type : "";
        const type =
          typeRaw === "number" ? "number" : typeRaw === "tags" ? "tags" : "text";
        const nextType =
          f.is_default || !typeRaw
            ? f.type
            : type;
        const options =
          nextType === "tags"
            ? String(req.body.options || "")
                .split(",")
                .map((o) => o.trim())
                .filter(Boolean)
            : [];
        return { ...f, label, type: nextType, options };
      });
      await updateTpsExperimentOutputFields(db, experimentId, JSON.stringify(updated));
      res.redirect(`/tps/${experimentId}#tab-tps-runs`);
    })
  );

  router.post(
    "/tps/:id/fields/:key",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const key = String(req.params.key || "");
      const experiment = await getTpsExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("TPS experiment not found");
      const fields = parseTpsOutputFields(experiment.output_fields_json);
      const updated = fields.map((f) =>
        f.key === key ? { ...f, analyze: Boolean(req.body.analyze) } : f
      );
      const analyzeKeys = updated
        .filter((f) => f.type === "number" && f.analyze)
        .map((f) => f.key);
      await updateTpsExperimentOutputFields(db, experimentId, JSON.stringify(updated));
      await updateTpsExperimentAnalysisKeys(
        db,
        experimentId,
        JSON.stringify(analyzeKeys)
      );
      res.json({ ok: true });
    })
  );

  router.post(
    "/tps/:id/fields/:key/delete",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const key = String(req.params.key || "");
      const experiment = await getTpsExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("TPS experiment not found");
      const fields = parseTpsOutputFields(experiment.output_fields_json);
      const target = fields.find((f) => f.key === key);
      if (target?.is_default) {
        return res.status(400).send("Default fields cannot be deleted");
      }
      const updated = fields.filter((f) => f.key !== key);
      await updateTpsExperimentOutputFields(db, experimentId, JSON.stringify(updated));
      res.redirect(`/tps/${experimentId}#tab-tps-runs`);
    })
  );

  router.get(
    "/tps/:id/analysis.json",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const experiment = await getTpsExperimentById(db, experimentId);
      if (!experiment) return res.status(404).json({ error: "Not found" });

      const outputFields = parseTpsOutputFields(experiment.output_fields_json);
      const metricQuery =
        typeof req.query.metrics === "string" ? req.query.metrics : "";
      const metricKeys =
        metricQuery.trim().length > 0
          ? metricQuery.split(",").map((v) => v.trim()).filter((v) => v)
          : parseTpsMetricKeys(experiment.analysis_metric_keys_json);

      const runs = await listTpsRuns(db, experimentId);
      const runParamRows = await listTpsRunParamValuesByRunIds(
        db,
        runs.map((r: any) => r.id)
      );
      const runParamMap = new Map(
        runParamRows.map((r: any) => [`${r.run_id}:${r.param_def_id}`, r.value_real])
      );
      const paramDefs = await listTpsParamDefs(db);
      const tempDef = paramDefs.find((d) => d.code === "heating_temp_c");
      const scatterDef = paramDefs.find((d) => d.code === "gelation_time_min");

      const rows = runs.map((run: any) => {
        const outputs = parseOutputsJson(run.outputs_json);
        const temp = tempDef
          ? runParamMap.get(`${run.id}:${tempDef.id}`) ?? null
          : null;
        const scatter = scatterDef
          ? runParamMap.get(`${run.id}:${scatterDef.id}`) ?? null
          : null;
        return {
          run_code: run.run_code,
          recipe_name: run.recipe_name,
          recipe_variant: run.recipe_variant ?? null,
          temp,
          scatter,
          outputs,
          notes: run.notes,
        };
      });

      const analysis = buildTpsDecisionSupportAnalysis({
        runs: rows,
        outputFields,
        metricKeys,
        tempLabel: "Heating temp",
        scatterLabel: "Gelation time",
      });

      res.json(analysis);
    })
  );

  return router;
}
