import express from "express";
import type { Db } from "../db.js";
import {
  createExperimentWithDefaults,
  createCustomParam,
  generateRuns
} from "../services/experiments_service.js";
import { listRecipes, getRecipeComponents } from "../repos/recipes_repo.js";
import {
  getExperiment,
  getExperimentRecipes,
  deleteExperiment
} from "../repos/experiments_repo.js";
import {
  listParamDefinitions,
  listParamDefinitionsByKind,
  listParamConfigs,
  upsertParamConfig,
  updateAllowedValues
} from "../repos/params_repo.js";
import { listRuns } from "../repos/runs_repo.js";
import { loadRuns, filterRuns, summarizeByFactor, summarizeHeatmap, buildRegression } from "../services/analysis_service.js";
import { sd } from "../domain/stats.js";
import { toCsv } from "../lib/csv.js";

export function createExperimentsRouter(db: Db) {
  const router = express.Router();

  router.get("/experiments/new", (_req, res) => {
    const recipes = listRecipes(db).map((recipe) => ({
      ...recipe,
      components: getRecipeComponents(db, recipe.id)
    }));
    res.render("experiment_new", { recipes });
  });

  router.post("/experiments", (req, res) => {
    const recipeIds = Array.isArray(req.body.recipe_ids)
      ? req.body.recipe_ids.map((id: string) => Number(id))
      : req.body.recipe_ids
        ? [Number(req.body.recipe_ids)]
        : [];

    const experimentId = createExperimentWithDefaults(db, {
      name: req.body.name,
      design_type: req.body.design_type,
      seed: Number(req.body.seed || 1),
      notes: req.body.notes || null,
      center_points: Number(req.body.center_points || 3),
      max_runs: Number(req.body.max_runs || 200),
      replicate_count: Number(req.body.replicate_count || 1),
      recipe_as_block: req.body.recipe_as_block ? 1 : 0,
      recipe_ids: recipeIds
    });

    res.redirect(`/experiments/${experimentId}`);
  });

  router.get("/experiments/:id", (req, res) => {
    const experimentId = Number(req.params.id);
    const tab = (req.query.tab as string) || "design";
    const experiment = getExperiment(db, experimentId);
    if (!experiment) return res.status(404).send("Experiment not found");
    const errorMessage = req.query.error ? String(req.query.error) : null;

    const recipes = listRecipes(db);
    const linkedRecipes = getExperimentRecipes(db, experimentId);
    const params = listParamDefinitions(db, experimentId);
    const inputParams = listParamDefinitionsByKind(db, experimentId, "INPUT");
    const outputParams = listParamDefinitionsByKind(db, experimentId, "OUTPUT");
    const configs = listParamConfigs(db, experimentId);
    const runs = listRuns(db, experimentId);
    const runRows = loadRuns(db, experimentId);
    const activeInputParams = inputParams.filter((param) => {
      const cfg = configs.find((c) => c.param_def_id === param.id);
      return cfg?.active === 1;
    });
    const outputNumericParams = outputParams.filter((param) => param.field_type === "number");

    const runPreview = buildRunPreview(experiment, inputParams, configs, linkedRecipes);

    let analysis = null;
    if (tab === "analysis") {
      const outputParamId = Number(req.query.output_param || outputNumericParams[0]?.id || 0);
      const xParamId = Number(req.query.x_param || activeInputParams[0]?.id || 0);
      const yParamId = Number(req.query.y_param || activeInputParams[1]?.id || 0);
      const recipeId = req.query.recipe_id ? Number(req.query.recipe_id) : null;
      const defectTag = req.query.defect_tag ? String(req.query.defect_tag) : null;

      const allRuns = loadRuns(db, experimentId);
      const defectParam = outputParams.find((param) => param.code === "defects");
      const filtered = filterRuns(allRuns, { recipeId, defectTag }, defectParam?.id);

      const summary = outputParamId && xParamId
        ? summarizeByFactor(filtered, outputParamId, xParamId)
        : [];
      const overallValues = filtered
        .map((run) => run.values[outputParamId])
        .filter((value) => value != null) as number[];
      const overall =
        overallValues.length > 0
          ? {
              mean: overallValues.reduce((a, b) => a + b, 0) / overallValues.length,
              sd: sd(overallValues),
              n: overallValues.length
            }
          : { mean: NaN, sd: NaN, n: 0 };
      const heatmap = outputParamId && xParamId && yParamId
        ? summarizeHeatmap(filtered, outputParamId, xParamId, yParamId)
        : [];
      const scatter = filtered
        .map((run) => ({
          x: run.values[xParamId],
          y: run.values[outputParamId],
          recipe_id: run.recipe_id ?? 0
        }))
        .filter((point) => point.x != null && point.y != null);
      const scatter3d = filtered
        .map((run) => ({
          x: run.values[xParamId],
          y: run.values[yParamId],
          z: run.values[outputParamId]
        }))
        .filter((point) => point.x != null && point.y != null && point.z != null);
      const regression = outputParamId
        ? buildRegression(filtered, outputParamId, activeInputParams.slice(0, 3))
        : { coefficients: [], r2: NaN };

      analysis = {
        outputParamId,
        xParamId,
        yParamId,
        recipeId,
        defectTag,
        summary,
        overall,
        heatmap,
        scatter,
        scatter3d,
        regression
      };
    }

    res.render("experiment_detail", {
      experiment,
      recipes,
      linkedRecipes,
      params,
      inputParams,
      outputParams,
      activeInputParams,
      outputNumericParams,
      configs,
      runs,
      runRows,
      tab,
      analysis,
      runPreview,
      errorMessage
    });
  });

  router.post("/experiments/:id/params", (req, res) => {
    const experimentId = Number(req.params.id);
    const code = String(req.body.code || "").trim();
    if (!code) return res.redirect(`/experiments/${experimentId}?tab=design`);

    createCustomParam(db, experimentId, {
      code,
      label: req.body.label || code,
      unit: req.body.unit || null,
      field_kind: req.body.field_kind,
      field_type: req.body.field_type,
      group_label: req.body.group_label || null,
      allowed_values_json: req.body.allowed_values
        ? JSON.stringify(String(req.body.allowed_values).split(",").map((tag: string) => tag.trim()).filter(Boolean))
        : null
    });
    res.redirect(`/experiments/${experimentId}?tab=design`);
  });

  router.post("/experiments/:id/delete", (req, res) => {
    const experimentId = Number(req.params.id);
    deleteExperiment(db, experimentId);
    res.redirect("/");
  });

  router.post("/experiments/:id/configs", (req, res) => {
    const experimentId = Number(req.params.id);
    const experiment = getExperiment(db, experimentId);
    if (!experiment) return res.status(404).send("Experiment not found");
    const configs = listParamConfigs(db, experimentId);
    const inputParams = listParamDefinitionsByKind(db, experimentId, "INPUT");
    const labelMap = new Map(inputParams.map((param) => [param.id, param.label]));
    const updates: Array<{
      experiment_id: number;
      param_def_id: number;
      active: number;
      mode: "FIXED" | "RANGE" | "LIST";
      fixed_value_real: number | null;
      range_min_real: number | null;
      range_max_real: number | null;
      list_json: string | null;
      level_count: number | null;
    }> = [];
    const errors: string[] = [];

    for (const config of configs) {
      const prefix = `param_${config.param_def_id}`;
      const active = req.body[`${prefix}_active`] ? 1 : 0;
      const mode = req.body[`${prefix}_mode`] || config.mode;
      let rangeMin = parseNumber(req.body[`${prefix}_min`]);
      let rangeMax = parseNumber(req.body[`${prefix}_max`]);
      const valuesRaw = String(req.body[`${prefix}_values`] || "");
      const values = valuesRaw
        .split(/[\s,;]+/)
        .map((val) => parseFloat(val))
        .filter((val) => Number.isFinite(val));
      const levelCount = Number(req.body[`${prefix}_levels`] || config.level_count || 2);
      const fixed = mode === "FIXED" ? values[0] : NaN;
      const list = mode === "LIST" ? values : [];

      if (
        mode === "RANGE" &&
        (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) &&
        values.length >= 2
      ) {
        rangeMin = values[0];
        rangeMax = values[1];
      }

      if (experiment.design_type === "BBD" && active === 1) {
        if (mode === "FIXED") {
          errors.push(
            `BBD: "${labelMap.get(config.param_def_id) || "Factor"}" must be RANGE or LIST (3 levels).`
          );
        }
        if (mode === "RANGE") {
          if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) {
            errors.push(
              `BBD: "${labelMap.get(config.param_def_id) || "Factor"}" needs min and max.`
            );
          }
        }
        if (mode === "LIST" && list.length !== 3) {
          errors.push(
            `BBD: "${labelMap.get(config.param_def_id) || "Factor"}" needs exactly 3 values.`
          );
        }
      }

      updates.push({
        experiment_id: experimentId,
        param_def_id: config.param_def_id,
        active,
        mode,
        fixed_value_real: Number.isFinite(fixed) ? fixed : null,
        range_min_real: mode === "RANGE" && Number.isFinite(rangeMin) ? rangeMin : null,
        range_max_real: mode === "RANGE" && Number.isFinite(rangeMax) ? rangeMax : null,
        list_json: list.length ? JSON.stringify(list) : null,
        level_count: experiment.design_type === "BBD" && mode === "RANGE" ? 3 : mode === "RANGE" ? levelCount : null
      });
    }
    if (errors.length) {
      const message = errors[0];
      return res.redirect(`/experiments/${experimentId}?tab=design&error=${encodeURIComponent(message)}`);
    }
    for (const update of updates) {
      upsertParamConfig(db, update);
    }
    res.redirect(`/experiments/${experimentId}?tab=design`);
  });

  router.post("/experiments/:id/tags", (req, res) => {
    const experimentId = Number(req.params.id);
    const paramId = Number(req.body.param_id || 0);
    const allowed = String(req.body.allowed_values || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    updateAllowedValues(db, paramId, allowed.length ? JSON.stringify(allowed) : null);
    res.redirect(`/experiments/${experimentId}?tab=design`);
  });

  router.post("/experiments/:id/generate", (req, res) => {
    const experimentId = Number(req.params.id);
    generateRuns(db, experimentId);
    res.redirect(`/experiments/${experimentId}?tab=runs`);
  });

  router.get("/experiments/:id/export/:type", (req, res) => {
    const experimentId = Number(req.params.id);
    const type = String(req.params.type);
    const runs = loadRuns(db, experimentId);
    const params = listParamDefinitions(db, experimentId);

    if (type === "runs") {
      const rows = runs.map((run) => {
        const row: Record<string, string | number | null> = {
          run_code: run.run_code,
          run_order: run.run_order,
          recipe_id: run.recipe_id ?? "",
          done: run.done,
          exclude_from_analysis: run.exclude_from_analysis
        };
        for (const param of params) {
          const value = run.values[param.id];
          row[param.code] = value ?? "";
        }
        return row;
      });
      const csv = toCsv(rows);
      res.setHeader("Content-Type", "text/csv");
      return res.send(csv);
    }

    if (type === "wide") {
      const headers = ["run_code", "run_order", "recipe_id", ...params.map((p) => p.code)];
      const rows = runs.map((run) => {
        const row: Record<string, string | number | null> = {
          run_code: run.run_code,
          run_order: run.run_order,
          recipe_id: run.recipe_id ?? ""
        };
        for (const param of params) {
          const value = run.values[param.id];
          row[param.code] = value ?? "";
        }
        return row;
      });
      const csv = toCsv(rows);
      res.setHeader("Content-Type", "text/csv");
      return res.send(csv);
    }

    return res.status(400).send("Unknown export type");
  });

  return router;
}

function parseNumber(value: string | number | undefined) {
  if (value == null) return NaN;
  const raw = String(value).trim();
  if (!raw) return NaN;
  const normalized = raw.includes(",") && !raw.includes(".") ? raw.replace(",", ".") : raw;
  return parseFloat(normalized);
}

function buildRunPreview(
  experiment: {
    design_type: string;
    center_points: number;
    max_runs: number;
    replicate_count: number;
    recipe_as_block: number;
  },
  inputParams: Array<{ id: number }>,
  configs: Array<{
    param_def_id: number;
    active: number;
    mode: string;
    range_min_real: number | null;
    range_max_real: number | null;
    list_json: string | null;
    level_count: number | null;
  }>,
  recipeIds: number[]
) {
  const configMap = new Map(configs.map((config) => [config.param_def_id, config]));
  const activeConfigs = inputParams
    .map((param) => configMap.get(param.id))
    .filter((config) => config && config.active === 1) as typeof configs;

  const levelCounts = activeConfigs.map((config) => {
    if (config.mode === "LIST") {
      const list = config.list_json ? (JSON.parse(config.list_json) as number[]) : [];
      return list.length;
    }
    if (config.mode === "RANGE") {
      return config.level_count === 3 ? 3 : 2;
    }
    return 1;
  });
  const threeLevelFlags = activeConfigs.map((config) => {
    if (config.mode === "LIST") {
      const list = config.list_json ? (JSON.parse(config.list_json) as number[]) : [];
      return list.length === 3;
    }
    if (config.mode === "RANGE") {
      if (experiment.design_type === "BBD") {
        return Number.isFinite(config.range_min_real) && Number.isFinite(config.range_max_real);
      }
      return config.level_count === 3;
    }
    return false;
  });

  let baseRuns = 0;
  let formula = "";
  let warning = "";
  let k = 0;
  if (experiment.design_type === "SIM") {
    const simLevels = activeConfigs.map((config) => {
      if (config.mode === "LIST") {
        const list = config.list_json ? (JSON.parse(config.list_json) as number[]) : [];
        return list.length;
      }
      if (config.mode === "RANGE") {
        return config.level_count === 3 ? 3 : 2;
      }
      return 1;
    });
    baseRuns = simLevels.length
      ? simLevels.reduce((acc, val) => acc * Math.max(val, 1), 1)
      : 0;
    formula = `SIM: product(levels) = ${baseRuns}`;
  } else if (experiment.design_type === "FFA") {
    baseRuns = levelCounts.length
      ? levelCounts.reduce((acc, val) => acc * Math.max(val, 1), 1)
      : 0;
    formula = `FFA: product(levels) = ${baseRuns}`;
  } else if (experiment.design_type === "BBD") {
    k = threeLevelFlags.filter(Boolean).length;
    baseRuns = k >= 2 ? 4 * (k * (k - 1)) / 2 + (experiment.center_points || 0) : 0;
    formula = `BBD: 4*C(k,2)+center = ${baseRuns} (k=${k})`;
    if (k < 2) {
      warning = `BBD needs at least 2 factors with 3 levels. Currently: ${k}. Set Levels=3 or use LIST with 3 values.`;
    }
  } else {
    const k = levelCounts.length;
    const fullCombos = k > 0 ? Math.pow(2, k) : 0;
    baseRuns = Math.min(experiment.max_runs || fullCombos, fullCombos);
    formula = `SCREEN: min(max_runs, 2^k) = ${baseRuns} (k=${k})`;
  }

  const recipeMultiplier =
    experiment.recipe_as_block === 1 && recipeIds.length > 0 ? recipeIds.length : 1;
  const replicateMultiplier = Math.max(experiment.replicate_count || 1, 1);
  const totalRuns = baseRuns * recipeMultiplier * replicateMultiplier;

  return {
    totalRuns,
    baseRuns,
    recipeMultiplier,
    replicateMultiplier,
    formula,
    warning,
    k
  };
}
