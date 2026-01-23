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
  deleteExperiment,
  getDesignMetadata,
  upsertDesignMetadata
} from "../repos/experiments_repo.js";
import {
  listParamDefinitions,
  listParamDefinitionsByKind,
  listParamConfigs,
  deleteParamConfig,
  upsertParamConfig,
  updateAllowedValues
} from "../repos/params_repo.js";
import {
  findExperimentAnalysisFieldByCode,
  insertAnalysisField,
  listActiveAnalysisFields,
  listExperimentAnalysisFields,
  listAnalysisRunValuesByRunIds,
  listStandardAnalysisFields,
  listTagValuesForExperimentField,
  updateAnalysisField,
  updateAnalysisFieldActive
} from "../repos/analysis_repo.js";
import { listRuns } from "../repos/runs_repo.js";
import {
  loadRuns,
  filterRuns,
  summarizeByFactorAnalysis,
  summarizeHeatmapAnalysis,
  buildRegressionAnalysis
} from "../services/analysis_service.js";
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
    const linkedRecipeOptions = recipes.filter((recipe) => linkedRecipes.includes(recipe.id));
    const params = listParamDefinitions(db, experimentId);
    const inputParams = listParamDefinitionsByKind(db, experimentId, "INPUT");
    const configs = listParamConfigs(db, experimentId);
    const designMeta = parseDesignMetadata(getDesignMetadata(db, experimentId));
    const nonRandomizedParamId =
      typeof designMeta.non_randomized_param_id === "number"
        ? designMeta.non_randomized_param_id
        : null;
    const runs = listRuns(db, experimentId);
    const runRows = loadRuns(db, experimentId);
    const activeInputParams = inputParams.filter((param) => {
      const cfg = configs.find((c) => c.param_def_id === param.id);
      return cfg?.active === 1;
    });
    const activeAnalysisFields = listActiveAnalysisFields(db, experimentId);
    const outputNumericParams = activeAnalysisFields.filter((field) => field.field_type === "number");
    const tagOutputFields = activeAnalysisFields.filter((field) => field.field_type === "tag");
    const booleanOutputFields = activeAnalysisFields.filter((field) => field.field_type === "boolean");
    const parseAllowed = (field: { allowed_values_json: string | null }) => {
      let allowedValues: string[] = [];
      if (field.allowed_values_json) {
        try {
          const parsed = JSON.parse(field.allowed_values_json);
          if (Array.isArray(parsed)) allowedValues = parsed.map(String);
        } catch {
          allowedValues = [];
        }
      }
      return { ...field, allowedValues };
    };
    const standardAnalysisFieldsRaw = listStandardAnalysisFields(db).map(parseAllowed);
    const experimentAnalysisFields = listExperimentAnalysisFields(db, experimentId).map(parseAllowed);
    const experimentByCode = new Map(experimentAnalysisFields.map((field) => [field.code, field]));
    const standardAnalysisFields = standardAnalysisFieldsRaw.map((field) => {
      const experimentField = experimentByCode.get(field.code);
      return {
        ...field,
        is_active: experimentField?.is_active ?? 0
      };
    });

    const runPreview = buildRunPreview(experiment, inputParams, configs, linkedRecipes);

    let analysis = null;
    if (tab === "analysis") {
      const outputParamId = Number(req.query.output_param || outputNumericParams[0]?.id || 0);
      const xParamId = Number(req.query.x_param || activeInputParams[0]?.id || 0);
      const yParamId = Number(req.query.y_param || activeInputParams[1]?.id || 0);
      const recipeId = req.query.recipe_id ? Number(req.query.recipe_id) : null;
      const tagFieldId = req.query.tag_field ? Number(req.query.tag_field) : null;
      const tagValueRaw = req.query.tag_value;
      const tagValues = Array.isArray(tagValueRaw)
        ? tagValueRaw.map((v) => String(v)).filter(Boolean)
        : tagValueRaw
          ? [String(tagValueRaw)]
          : [];
      const tagSet = new Set(tagValues);
      const wantsNoTags = tagSet.has("__none__");
      const wantedTags = tagValues.filter((value) => value !== "__none__");
      const boolFieldId = req.query.bool_field ? Number(req.query.bool_field) : null;
      const boolValue = req.query.bool_value ? Number(req.query.bool_value) : null;

      const allRuns = loadRuns(db, experimentId);
      const analysisValues = listAnalysisRunValuesByRunIds(db, allRuns.map((run) => run.id));
      const analysisValueMap = new Map(
        analysisValues.map((row) => [`${row.run_id}:${row.field_id}`, row])
      );
      const baseRuns = filterRuns(allRuns, { recipeId }, undefined);
      let filtered = baseRuns;
      let tagPenaltyRate: number | null = null;
      let boolPenaltyRate: number | null = null;
      if (tagFieldId) {
        const tagMatches = baseRuns.filter((run) => {
          const row = analysisValueMap.get(`${run.id}:${tagFieldId}`);
          if (!row?.value_tags_json) return wantsNoTags;
          try {
            const parsed = JSON.parse(row.value_tags_json);
            if (!Array.isArray(parsed) || parsed.length === 0) return false;
            if (wantedTags.length === 0) return !wantsNoTags;
            return wantedTags.some((value) => parsed.includes(value));
          } catch {
            return false;
          }
        });
        tagPenaltyRate = baseRuns.length ? tagMatches.length / baseRuns.length : null;
      }
      if (boolFieldId && (boolValue === 0 || boolValue === 1)) {
        const boolMatches = baseRuns.filter((run) => {
          const row = analysisValueMap.get(`${run.id}:${boolFieldId}`);
          return row?.value_real === boolValue;
        });
        boolPenaltyRate = baseRuns.length ? boolMatches.length / baseRuns.length : null;
      }
      if (tagFieldId) {
        filtered = filtered.filter((run) => {
          const row = analysisValueMap.get(`${run.id}:${tagFieldId}`);
          if (!row?.value_tags_json) return wantsNoTags;
          try {
            const parsed = JSON.parse(row.value_tags_json);
            if (!Array.isArray(parsed) || parsed.length === 0) return false;
            if (wantedTags.length === 0) return !wantsNoTags;
            return wantedTags.some((value) => parsed.includes(value));
          } catch {
            return false;
          }
        });
      }
      if (boolFieldId && (boolValue === 0 || boolValue === 1)) {
        filtered = filtered.filter((run) => {
          const row = analysisValueMap.get(`${run.id}:${boolFieldId}`);
          return row?.value_real === boolValue;
        });
      }

      const summary = outputParamId && xParamId
        ? summarizeByFactorAnalysis(filtered, analysisValueMap, outputParamId, xParamId)
        : [];
      const overallValues = filtered
        .map((run) => analysisValueMap.get(`${run.id}:${outputParamId}`)?.value_real)
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
        ? summarizeHeatmapAnalysis(filtered, analysisValueMap, outputParamId, xParamId, yParamId)
        : [];
      const scatter = filtered
        .map((run) => ({
          x: run.values[xParamId],
          y: analysisValueMap.get(`${run.id}:${outputParamId}`)?.value_real,
          recipe_id: run.recipe_id ?? 0
        }))
        .filter((point) => point.x != null && point.y != null);
      const scatter3d = filtered
        .map((run) => ({
          x: run.values[xParamId],
          y: run.values[yParamId],
          z: analysisValueMap.get(`${run.id}:${outputParamId}`)?.value_real
        }))
        .filter((point) => point.x != null && point.y != null && point.z != null);
      const regression = outputParamId
        ? buildRegressionAnalysis(filtered, analysisValueMap, outputParamId, activeInputParams.slice(0, 3))
        : { coefficients: [], r2: NaN };

      analysis = {
        outputParamId,
        xParamId,
        yParamId,
        recipeId,
        tagFieldId,
        tagValues,
        boolFieldId,
        boolValue,
        tagPenaltyRate,
        boolPenaltyRate,
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
      linkedRecipeOptions,
      params,
      inputParams,
      activeInputParams,
      outputNumericParams,
      tagOutputFields,
      booleanOutputFields,
      standardAnalysisFields,
      customAnalysisFields: experimentAnalysisFields.filter((field) => field.is_standard === 0),
      configs,
      runs,
      runRows,
      tab,
      analysis,
      runPreview,
      errorMessage,
      nonRandomizedParamId
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
    const configMap = new Map(configs.map((config) => [config.param_def_id, config]));
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

    for (const param of inputParams) {
      const config = configMap.get(param.id);
      const prefix = `param_${param.id}`;
      const active = req.body[`${prefix}_active`] ? 1 : 0;
      const mode = req.body[`${prefix}_mode`] || config?.mode || "FIXED";
      let rangeMin = parseNumber(req.body[`${prefix}_min`]);
      let rangeMax = parseNumber(req.body[`${prefix}_max`]);
      const valuesRaw = String(req.body[`${prefix}_values`] || "");
      const values = valuesRaw
        .split(/[\s,;]+/)
        .map((val) => parseFloat(val))
        .filter((val) => Number.isFinite(val));
      const levelCount = Number(req.body[`${prefix}_levels`] || config?.level_count || 2);
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
            `BBD: "${labelMap.get(param.id) || "Factor"}" must be RANGE or LIST (3 levels).`
          );
        }
        if (mode === "RANGE") {
          if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax)) {
            errors.push(
              `BBD: "${labelMap.get(param.id) || "Factor"}" needs min and max.`
            );
          }
        }
        if (mode === "LIST" && list.length !== 3) {
          errors.push(
            `BBD: "${labelMap.get(param.id) || "Factor"}" needs exactly 3 values.`
          );
        }
      }

      if (active === 1) {
        updates.push({
          experiment_id: experimentId,
          param_def_id: param.id,
          active,
          mode,
          fixed_value_real: Number.isFinite(fixed) ? fixed : null,
          range_min_real: mode === "RANGE" && Number.isFinite(rangeMin) ? rangeMin : null,
          range_max_real: mode === "RANGE" && Number.isFinite(rangeMax) ? rangeMax : null,
          list_json: list.length ? JSON.stringify(list) : null,
          level_count:
            experiment.design_type === "BBD" && mode === "RANGE"
              ? 3
              : mode === "RANGE"
                ? levelCount
                : null
        });
      }
    }
    const wantsJson =
      req.get("X-Requested-With") === "XMLHttpRequest" || req.accepts("json") === "json";
    if (errors.length) {
      const message = errors[0];
      if (wantsJson) {
        return res.status(400).json({ error: message });
      }
      return res.redirect(`/experiments/${experimentId}?tab=design&error=${encodeURIComponent(message)}`);
    }
    for (const param of inputParams) {
      const active = req.body[`param_${param.id}_active`] ? 1 : 0;
      if (active === 1) continue;
      if (configMap.has(param.id)) {
        deleteParamConfig(db, experimentId, param.id);
      }
    }
    for (const update of updates) {
      upsertParamConfig(db, update);
    }
    const selectedRaw = String(req.body.non_randomized_param_id || "").trim();
    const selectedId = selectedRaw ? Number(selectedRaw) : NaN;
    const activeSet = new Set(updates.map((update) => update.param_def_id));
    const nonRandomizedParamId =
      Number.isFinite(selectedId) && activeSet.has(selectedId) ? selectedId : null;
    const designMeta = parseDesignMetadata(getDesignMetadata(db, experimentId));
    upsertDesignMetadata(
      db,
      experimentId,
      JSON.stringify({ ...designMeta, non_randomized_param_id: nonRandomizedParamId })
    );
    if (wantsJson) {
      return res.status(204).send();
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

  router.post("/experiments/:id/analysis-fields/standard", (req, res) => {
    const experimentId = Number(req.params.id);
    const wantsJson =
      req.get("X-Requested-With") === "XMLHttpRequest" || req.accepts("json") === "json";
    const selected = req.body.standard_codes || [];
    const selectedCodes = new Set(
      Array.isArray(selected) ? selected.map(String) : [String(selected)]
    );
    const standardFields = listStandardAnalysisFields(db);
    for (const field of standardFields) {
      const shouldEnable = selectedCodes.has(field.code);
      const existing = findExperimentAnalysisFieldByCode(db, experimentId, field.code);
      if (shouldEnable) {
        if (!existing) {
          insertAnalysisField(db, {
            scope_type: "EXPERIMENT",
            scope_id: experimentId,
            code: field.code,
            label: field.label,
            field_type: field.field_type,
            unit: field.unit,
            group_label: field.group_label,
            allowed_values_json: field.allowed_values_json,
            is_standard: 1,
            is_active: 1
          });
        } else {
          updateAnalysisFieldActive(db, existing.id, 1);
        }
      } else if (existing && existing.is_standard === 1) {
        updateAnalysisFieldActive(db, existing.id, 0);
      }
    }
    if (wantsJson) return res.status(204).send();
    res.redirect(`/experiments/${experimentId}?tab=analysis`);
  });

  router.get("/experiments/:id/analysis-fields/tag-values", (req, res) => {
    const experimentId = Number(req.params.id);
    const fieldId = Number(req.query.field_id || 0);
    if (!Number.isFinite(fieldId) || fieldId <= 0) {
      return res.json({ values: [] });
    }
    const values = listTagValuesForExperimentField(db, experimentId, fieldId);
    res.json({ values });
  });

  router.get("/experiments/:id/analysis-fields/active", (req, res) => {
    const experimentId = Number(req.params.id);
    const fields = listActiveAnalysisFields(db, experimentId);
    res.json({
      fields: fields.map((field) => ({
        id: field.id,
        label: field.label,
        field_type: field.field_type
      }))
    });
  });

  router.post("/experiments/:id/analysis-fields/custom", (req, res) => {
    const experimentId = Number(req.params.id);
    const wantsJson =
      req.get("X-Requested-With") === "XMLHttpRequest" || req.accepts("json") === "json";
    const updates = req.body.custom || {};
    const ids = Object.keys(updates);
    const experimentFields = listExperimentAnalysisFields(db, experimentId);
    for (const id of ids) {
      const fieldId = Number(id);
      if (!Number.isFinite(fieldId)) continue;
      const existing = experimentFields.find((field) => field.id === fieldId);
      if (!existing || existing.is_standard === 1) continue;
      const raw = updates[id] || {};
      const label = String(raw.label || "").trim() || existing.label;
      const unit = raw.unit !== undefined ? String(raw.unit).trim() : "";
      const groupLabel =
        raw.group_label !== undefined && String(raw.group_label).trim()
          ? String(raw.group_label).trim()
          : "Custom";
      const allowedRaw =
        raw.allowed_values !== undefined ? String(raw.allowed_values || "") : "";
      const allowedValues = allowedRaw
        .split(",")
        .map((v: string) => v.trim())
        .filter((v: string) => v);
      const allowedValuesJson =
        existing.field_type === "tag" && allowedValues.length > 0
          ? JSON.stringify(allowedValues)
          : null;
      const rawActive = raw.is_active;
      const isActive = Array.isArray(rawActive)
        ? rawActive.map(String).some((v) => v === "1" || v === "on" || v === "true")
        : rawActive === "1" || rawActive === "on" || rawActive === true || rawActive === "true"
          ? 1
          : 0;
      updateAnalysisField(db, fieldId, {
        label,
        unit: unit || null,
        group_label: groupLabel,
        allowed_values_json: allowedValuesJson,
        is_active: isActive
      });
    }
    if (wantsJson) return res.status(204).send();
    res.redirect(`/experiments/${experimentId}?tab=analysis`);
  });

  router.post("/experiments/:id/analysis-fields/custom/active", (req, res) => {
    const experimentId = Number(req.params.id);
    const wantsJson =
      req.get("X-Requested-With") === "XMLHttpRequest" || req.accepts("json") === "json";
    const fieldId = Number(req.body.field_id || 0);
    const isActiveRaw = String(req.body.is_active || "").trim();
    const isActive = isActiveRaw === "1" || isActiveRaw === "true" || isActiveRaw === "on" ? 1 : 0;
    if (!Number.isFinite(fieldId) || fieldId <= 0) {
      if (wantsJson) return res.status(400).json({ error: "Field id required." });
      return res.redirect(`/experiments/${experimentId}?tab=analysis`);
    }
    const experimentFields = listExperimentAnalysisFields(db, experimentId);
    const existing = experimentFields.find((field) => field.id === fieldId);
    if (!existing || existing.is_standard === 1) {
      if (wantsJson) return res.status(404).json({ error: "Field not found." });
      return res.redirect(`/experiments/${experimentId}?tab=analysis`);
    }
    updateAnalysisFieldActive(db, fieldId, isActive);
    if (wantsJson) return res.status(204).send();
    res.redirect(`/experiments/${experimentId}?tab=analysis`);
  });

  router.post("/experiments/:id/analysis-fields/new", (req, res) => {
    const experimentId = Number(req.params.id);
    const wantsJson =
      req.get("X-Requested-With") === "XMLHttpRequest" || req.accepts("json") === "json";
    const label = String(req.body.label || "").trim();
    if (!label) {
      if (wantsJson) return res.status(400).json({ error: "Label is required." });
      return res.redirect(`/experiments/${experimentId}?tab=analysis`);
    }

    const rawType = String(req.body.field_type || "number").trim();
    const fieldType = ["number", "text", "tag", "boolean"].includes(rawType)
      ? rawType
      : "number";
    const unit = req.body.unit !== undefined ? String(req.body.unit).trim() : "";
    const groupLabel =
      req.body.group_label !== undefined && String(req.body.group_label).trim()
        ? String(req.body.group_label).trim()
        : "Custom";
    const rawCode = req.body.code !== undefined ? String(req.body.code).trim() : "";
    const allowedRaw =
      req.body.allowed_values !== undefined ? String(req.body.allowed_values || "") : "";
    const allowedValues = allowedRaw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v);
    const allowedValuesJson =
      fieldType === "tag" && allowedValues.length > 0 ? JSON.stringify(allowedValues) : null;

    const baseCode = slugify(rawCode || label) || "measured_field";
    let code = baseCode;
    let i = 2;
    while (findExperimentAnalysisFieldByCode(db, experimentId, code)) {
      code = `${baseCode}_${i}`;
      i += 1;
    }

    insertAnalysisField(db, {
      scope_type: "EXPERIMENT",
      scope_id: experimentId,
      code,
      label,
      field_type: fieldType as "number" | "text" | "tag" | "boolean",
      unit: unit || null,
      group_label: groupLabel,
      allowed_values_json: allowedValuesJson,
      is_standard: 0,
      is_active: 1
    });

    if (wantsJson) {
      const created = findExperimentAnalysisFieldByCode(db, experimentId, code);
      if (!created) return res.status(500).json({ error: "Failed to create field." });
      const allowedValues = created.allowed_values_json
        ? (JSON.parse(created.allowed_values_json) as string[])
        : [];
      return res.json({
        field: {
          id: created.id,
          code: created.code,
          label: created.label,
          field_type: created.field_type,
          unit: created.unit,
          group_label: created.group_label,
          allowed_values: allowedValues,
          is_active: created.is_active
        }
      });
    }
    res.redirect(`/experiments/${experimentId}?tab=analysis`);
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
    const activeAnalysisFields = listActiveAnalysisFields(db, experimentId);
    const analysisValues = listAnalysisRunValuesByRunIds(db, runs.map((run) => run.id));
    const analysisValueMap = new Map(
      analysisValues.map((row) => [`${row.run_id}:${row.field_id}`, row])
    );

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
          if (param.field_kind === "OUTPUT") continue;
          const value = run.values[param.id];
          row[param.code] = value ?? "";
        }
        for (const field of activeAnalysisFields) {
          const valueRow = analysisValueMap.get(`${run.id}:${field.id}`);
          if (field.field_type === "tag") {
            row[field.code] = valueRow?.value_tags_json ?? "";
          } else if (field.field_type === "text") {
            row[field.code] = valueRow?.value_text ?? "";
          } else {
            row[field.code] = valueRow?.value_real ?? "";
          }
        }
        return row;
      });
      const csv = toCsv(rows);
      res.setHeader("Content-Type", "text/csv");
      return res.send(csv);
    }

    if (type === "wide") {
      const inputCodes = params.filter((p) => p.field_kind !== "OUTPUT").map((p) => p.code);
      const headers = [
        "run_code",
        "run_order",
        "recipe_id",
        ...inputCodes,
        ...activeAnalysisFields.map((f) => f.code)
      ];
      const rows = runs.map((run) => {
        const row: Record<string, string | number | null> = {
          run_code: run.run_code,
          run_order: run.run_order,
          recipe_id: run.recipe_id ?? ""
        };
        for (const param of params) {
          if (param.field_kind === "OUTPUT") continue;
          const value = run.values[param.id];
          row[param.code] = value ?? "";
        }
        for (const field of activeAnalysisFields) {
          const valueRow = analysisValueMap.get(`${run.id}:${field.id}`);
          if (field.field_type === "tag") {
            row[field.code] = valueRow?.value_tags_json ?? "";
          } else if (field.field_type === "text") {
            row[field.code] = valueRow?.value_text ?? "";
          } else {
            row[field.code] = valueRow?.value_real ?? "";
          }
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

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function parseDesignMetadata(jsonBlob: string | null): Record<string, unknown> {
  if (!jsonBlob) return {};
  try {
    return JSON.parse(jsonBlob) as Record<string, unknown>;
  } catch {
    return {};
  }
}
