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
  EXTRUSION_GEOMETRY_CODES,
  buildStats,
  computeRheology,
  defaultExtrusionParamConfig,
  parseExtrusionMetricKeys,
  parseExtrusionOutputFields,
  parseExtrusionOutputsJson,
  resolveGeometry,
} from "../domain/extrusion.js";
import {
  buildRecipeVariants,
  getRecipeVariantCount,
  recipeSearchText,
} from "../domain/recipes.js";
import { uniqueFieldKey } from "../domain/experiments.js";
import {
  createExtrusionExperiment,
  generateExtrusionRuns,
} from "../services/extrusion_service.js";
import {
  deactivateExtrusionParamConfig,
  deleteExtrusionExperimentCascade,
  findExtrusionParamDefinitionByCode,
  getExtrusionExperimentById,
  getExtrusionRunById,
  getNextExtrusionRunId,
  getPrevExtrusionRunId,
  insertExtrusionParamConfig,
  insertExtrusionParamDefinitionCustom,
  listActiveExtrusionParamConfigs,
  listExtrusionExperimentRecipes,
  listExtrusionExperimentsSummary,
  listExtrusionParamConfigsByExperiment,
  listExtrusionParamDefs,
  listExtrusionRunParamValuesByRunIds,
  listExtrusionRuns,
  listRecipeNames,
  updateExtrusionExperimentAnalysisKeys,
  updateExtrusionExperimentOutputFields,
  updateExtrusionRunDone,
  updateExtrusionRunNotes,
  updateExtrusionRunOutputs,
  upsertExtrusionParamConfig,
} from "../repos/extrusion_repo.js";
import { getRecipeComponentsByIds } from "../repos/experiments_repo.js";
import { getRecipeById } from "../repos/recipes_repo.js";

export function createExtrusionRouter(db: Database) {
  const router = express.Router();

  router.get(
    "/extrusion",
    wrap(async (_req, res) => {
      const experiments = await listExtrusionExperimentsSummary(db);
      res.render("extrusion_index", { experiments });
    })
  );

  router.get(
    "/extrusion/new",
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
      res.render("extrusion_new", { recipes: recipesWithComponents });
    })
  );

  router.post(
    "/extrusion",
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
          message: "Invalid extrusion experiment inputs",
        });
      }

      const experimentId = await createExtrusionExperiment(db, {
        name,
        seed,
        notes,
        recipeIds,
      });
      res.redirect(`/extrusion/${experimentId}`);
    })
  );

  router.post(
    "/extrusion/:id/update",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const name = String(req.body.name || "").trim();
      const seed = Number(req.body.seed);
      const notes = String(req.body.notes || "").trim() || null;

      if (!name || !Number.isFinite(seed)) {
        throw new AppError({
          status: 400,
          code: "INVALID_INPUT",
          message: "Invalid extrusion experiment inputs",
        });
      }

      await db.run(
        "UPDATE extrusion_experiments SET name = ?, seed = ?, notes = ? WHERE id = ?",
        [name, seed, notes, experimentId]
      );

      res.redirect(`/extrusion/${experimentId}`);
    })
  );

  router.get(
    "/extrusion/:id",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const experiment = await getExtrusionExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("Extrusion experiment not found");

      const paramDefs = await listExtrusionParamDefs(db);
      const configs = await listExtrusionParamConfigsByExperiment(db, experimentId);
      const configMap = new Map(configs.map((c: any) => [c.param_def_id, c]));

      for (const def of paramDefs) {
        if (configMap.has(def.id)) continue;
        const defaults = defaultExtrusionParamConfig(def.code);
        await insertExtrusionParamConfig(
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
        const refreshed = await listExtrusionParamConfigsByExperiment(db, experimentId);
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

      const activeConfigs = await listActiveExtrusionParamConfigs(db, experimentId);
      const availableDefs = paramDefs.filter((d) => {
        const cfg = configMap.get(d.id);
        return !cfg || cfg.active !== 1;
      });

      const recipes = await listRecipeNames(db);
      const selectedRecipes = await listExtrusionExperimentRecipes(db, experimentId);
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

      const runs = await listExtrusionRuns(db, experimentId);
      const runParamRows = await listExtrusionRunParamValuesByRunIds(
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

      const outputFields = parseExtrusionOutputFields(experiment.output_fields_json);
      const analysisMetricKeys = parseExtrusionMetricKeys(
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

      const configsByCode = new Map(
        params.map((p) => [p.code, p.config || null])
      );
      const configValueFor = (code: string) => {
        const cfg = configsByCode.get(code);
        if (!cfg) return null;
        const candidates = [
          cfg.fixed_value,
          cfg.range_min,
          cfg.range_max,
        ];
        for (const candidate of candidates) {
          if (candidate === null || candidate === undefined || candidate === "") continue;
          const num = Number(candidate);
          if (Number.isFinite(num)) return num;
        }
        if (cfg.list_json) {
          try {
            const list = JSON.parse(cfg.list_json);
            if (Array.isArray(list) && list.length > 0) {
              const num = Number(list[0]);
              if (Number.isFinite(num)) return num;
            }
          } catch {
            return null;
          }
        }
        return null;
      };
      const geometry = resolveGeometry(configsByCode);
      const pressureDef = paramDefs.find((d) => d.code === "pressure_bar") || null;

      const labelFor = (run: any) => {
        const base = run.recipe_name || "Unassigned";
        return run.recipe_variant ? `${base} (${run.recipe_variant})` : base;
      };

      const analysisRuns = runs.map((run: any) => {
        const outputs = parseExtrusionOutputsJson(run.outputs_json);
        const pressure =
          pressureDef !== null
            ? runParamMap.get(`${run.id}:${pressureDef.id}`) ??
              configValueFor("pressure_bar")
            : null;
        const pressurePa =
          pressure !== null ? pressure * 1e5 * (geometry.pressure_coeff_kp ?? 1) : null;
        const metrics = computeRheology({
          outputs,
          pressureBar: pressure,
          geometry,
        });
        return {
          run_id: run.id,
          run_code: run.run_code,
          recipe: labelFor(run),
          pressure,
          pressure_pa: pressurePa,
          notes: run.notes,
          metrics,
        };
      });

      const shearValues = analysisRuns
        .map((r) => r.metrics.shear_rate_s)
        .filter((v): v is number => v !== null);
      const viscosityValues = analysisRuns
        .map((r) => r.metrics.viscosity_pa_s)
        .filter((v): v is number => v !== null);

      const recipeStatsMap = new Map<
        string,
        { shear: number[]; viscosities: number[] }
      >();
      for (const run of analysisRuns) {
        const entry = recipeStatsMap.get(run.recipe) || {
          shear: [],
          viscosities: [],
        };
        if (run.metrics.shear_rate_s !== null) {
          entry.shear.push(run.metrics.shear_rate_s);
        }
        if (run.metrics.viscosity_pa_s !== null) {
          entry.viscosities.push(run.metrics.viscosity_pa_s);
        }
        recipeStatsMap.set(run.recipe, entry);
      }
      const recipeStats = Array.from(recipeStatsMap.entries()).map(
        ([recipe, values]) => ({
          recipe,
          shear: buildStats(values.shear),
          viscosity: buildStats(values.viscosities),
        })
      );

      const analysisParams = activeDefs.filter(
        (def) => !EXTRUSION_GEOMETRY_CODES.has(def.code)
      );
      const paramStats = analysisParams.map((def) => {
        const levelMap = new Map<number, { shear: number[]; viscosities: number[] }>();
        for (const run of analysisRuns) {
          const value = runParamMap.get(`${run.run_id}:${def.id}`) ?? null;
          if (value === null || value === undefined) continue;
          const entry = levelMap.get(value) || { shear: [], viscosities: [] };
          if (run.metrics.shear_rate_s !== null) {
            entry.shear.push(run.metrics.shear_rate_s);
          }
          if (run.metrics.viscosity_pa_s !== null) {
            entry.viscosities.push(run.metrics.viscosity_pa_s);
          }
          levelMap.set(value, entry);
        }
        const levels = Array.from(levelMap.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([value, values]) => ({
            value,
            shear: buildStats(values.shear),
            viscosity: buildStats(values.viscosities),
          }));
        return { def, levels };
      });

      const analysis = {
        runCount: analysisRuns.length,
        missingFlow: analysisRuns.filter((r) => r.metrics.shear_rate_s === null)
          .length,
        missingPressure: analysisRuns.filter((r) => r.pressure === null).length,
        shearOverall: buildStats(shearValues),
        viscosityOverall: buildStats(viscosityValues),
        recipeStats,
        paramStats,
        runs: analysisRuns,
        geometry,
      };

      res.render("extrusion_show", {
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
        analysis,
      });
    })
  );

  router.post(
    "/extrusion/:id/params",
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
        await upsertExtrusionParamConfig(
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
    "/extrusion/:id/params/:paramId/delete",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const paramId = Number(req.params.paramId);
      await deactivateExtrusionParamConfig(db, experimentId, paramId);
      res.json({ ok: true });
    })
  );

  router.post(
    "/extrusion/:id/add-param",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const paramDefId = Number(req.body.param_def_id || 0);
      if (!paramDefId) return res.redirect(`/extrusion/${experimentId}`);
      const def = await getExtrusionParamDef(db, paramDefId);
      const defaults = defaultExtrusionParamConfig(def?.code || "");
      await upsertExtrusionParamConfig(
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
      res.redirect(`/extrusion/${experimentId}#tab-extrusion-design`);
    })
  );

  router.post(
    "/extrusion/:id/add-custom-param",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const label = String(req.body.label || "").trim();
      const unit = String(req.body.unit || "").trim() || null;
      const mode = String(req.body.mode || "FIXED");
      if (!label) {
        return res.redirect(`/extrusion/${experimentId}#tab-extrusion-design`);
      }
      const codeBase = slugify(label) || "param";
      let code = codeBase;
      let i = 2;
      while (await findExtrusionParamDefinitionByCode(db, code)) {
        code = `${codeBase}_${i}`;
        i += 1;
      }
      const insertResult = await insertExtrusionParamDefinitionCustom(
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
      await upsertExtrusionParamConfig(
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
      res.redirect(`/extrusion/${experimentId}#tab-extrusion-design`);
    })
  );

  router.post(
    "/extrusion/:id/generate-runs",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const experiment = await getExtrusionExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("Extrusion experiment not found");
      const maxRuns = Number(req.body.max_runs || 0) || 1;
      const { warning } = await generateExtrusionRuns(db, {
        experimentId,
        maxRuns,
        seed: experiment.seed,
      });
      const warningParam = warning ? `?warning=${encodeURIComponent(warning)}` : "";
      res.redirect(`/extrusion/${experimentId}${warningParam}#tab-extrusion-runs`);
    })
  );

  router.post(
    "/extrusion/:id/delete",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      await deleteExtrusionExperimentCascade(db, experimentId);
      res.redirect("/extrusion");
    })
  );

  router.post(
    "/extrusion/:id/runs/:runId",
    wrap(async (req, res) => {
      const runId = Number(req.params.runId);
      const run = await getExtrusionRunById(db, runId);
      if (!run) return res.status(404).send("Run not found");

      const outputs = parseExtrusionOutputsJson(run.outputs_json);
      const payload = req.body || {};

      for (const [key, value] of Object.entries(payload)) {
        if (key === "notes") {
          const notes = String(normalizeFieldValue(value)).trim();
          await updateExtrusionRunNotes(db, runId, notes || null);
          continue;
        }
        if (key === "done") {
          const done = normalizeCheckbox(value);
          await updateExtrusionRunDone(db, runId, done ? 1 : 0);
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

      await updateExtrusionRunOutputs(db, runId, JSON.stringify(outputs));
      res.json({ ok: true });
    })
  );

  router.get(
    "/extrusion/:id/runs/:runId",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const runId = Number(req.params.runId);
      const experiment = await getExtrusionExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("Extrusion experiment not found");
      const run = await getExtrusionRunById(db, runId);
      if (!run) return res.status(404).send("Run not found");

      const paramDefs = await listExtrusionParamDefs(db);
      const configs = await listExtrusionParamConfigsByExperiment(db, experimentId);
      const configByDefId = new Map(configs.map((c: any) => [c.param_def_id, c]));
      const runParamRows = await listExtrusionRunParamValuesByRunIds(db, [runId]);
      const runParamMap = new Map(
        runParamRows.map((r: any) => [r.param_def_id, r.value_real])
      );
      const paramValues = paramDefs.map((def) => ({
        ...def,
        value:
          runParamMap.get(def.id) ??
          (() => {
            const cfg = configByDefId.get(def.id);
            if (!cfg) return null;
            const candidates = [cfg.fixed_value, cfg.range_min, cfg.range_max];
            for (const candidate of candidates) {
              if (candidate === null || candidate === undefined || candidate === "") continue;
              const num = Number(candidate);
              if (Number.isFinite(num)) return num;
            }
            if (cfg.list_json) {
              try {
                const list = JSON.parse(cfg.list_json);
                if (Array.isArray(list) && list.length > 0) {
                  const num = Number(list[0]);
                  if (Number.isFinite(num)) return num;
                }
              } catch {
                return null;
              }
            }
            return null;
          })(),
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

      const outputFields = parseExtrusionOutputFields(experiment.output_fields_json);
      const outputs = parseExtrusionOutputsJson(run.outputs_json);

      const prev = await getPrevExtrusionRunId(db, experimentId, run.run_order);
      const next = await getNextExtrusionRunId(db, experimentId, run.run_order);

      res.render("extrusion_run_detail", {
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
    "/extrusion/:id/fields",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const experiment = await getExtrusionExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("Extrusion experiment not found");
      const label = String(req.body.label || "").trim();
      if (!label) return res.redirect(`/extrusion/${experimentId}#tab-extrusion-runs`);
      const type =
        req.body.type === "number" ? "number" : req.body.type === "tags" ? "tags" : "text";
      const fields = parseExtrusionOutputFields(experiment.output_fields_json);
      const key = uniqueFieldKey(label, fields);
      const options =
        type === "tags"
          ? String(req.body.options || "")
              .split(",")
              .map((o) => o.trim())
              .filter(Boolean)
          : [];
      fields.push({ key, label, type, options, analyze: type === "number" });
      await updateExtrusionExperimentOutputFields(
        db,
        experimentId,
        JSON.stringify(fields)
      );
      res.redirect(`/extrusion/${experimentId}#tab-extrusion-runs`);
    })
  );

  router.post(
    "/extrusion/:id/fields/:key/update",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const key = String(req.params.key || "");
      const experiment = await getExtrusionExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("Extrusion experiment not found");
      const fields = parseExtrusionOutputFields(experiment.output_fields_json);
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
      await updateExtrusionExperimentOutputFields(
        db,
        experimentId,
        JSON.stringify(updated)
      );
      res.redirect(`/extrusion/${experimentId}#tab-extrusion-runs`);
    })
  );

  router.post(
    "/extrusion/:id/fields/:key",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const key = String(req.params.key || "");
      const experiment = await getExtrusionExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("Extrusion experiment not found");
      const fields = parseExtrusionOutputFields(experiment.output_fields_json);
      const updated = fields.map((f) =>
        f.key === key ? { ...f, analyze: Boolean(req.body.analyze) } : f
      );
      const analyzeKeys = updated
        .filter((f) => f.type === "number" && f.analyze)
        .map((f) => f.key);
      await updateExtrusionExperimentOutputFields(
        db,
        experimentId,
        JSON.stringify(updated)
      );
      await updateExtrusionExperimentAnalysisKeys(
        db,
        experimentId,
        JSON.stringify(analyzeKeys)
      );
      res.json({ ok: true });
    })
  );

  router.post(
    "/extrusion/:id/fields/:key/delete",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const key = String(req.params.key || "");
      const experiment = await getExtrusionExperimentById(db, experimentId);
      if (!experiment) return res.status(404).send("Extrusion experiment not found");
      const fields = parseExtrusionOutputFields(experiment.output_fields_json);
      const target = fields.find((f) => f.key === key);
      if (target?.is_default) {
        return res.status(400).send("Default fields cannot be deleted");
      }
      const updated = fields.filter((f) => f.key !== key);
      await updateExtrusionExperimentOutputFields(
        db,
        experimentId,
        JSON.stringify(updated)
      );
      res.redirect(`/extrusion/${experimentId}#tab-extrusion-runs`);
    })
  );

  return router;
}
