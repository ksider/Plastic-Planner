import express from "express";
import type { Db } from "../db.js";
import { getRun, getNextPrevRunIds, listRunValues, updateRunStatus } from "../repos/runs_repo.js";
import { getExperiment } from "../repos/experiments_repo.js";
import { listParamDefinitionsByKind, listParamDefinitions, listParamConfigs } from "../repos/params_repo.js";
import { getRecipe, getRecipeComponents } from "../repos/recipes_repo.js";
import {
  listActiveAnalysisFields,
  listAnalysisRunValuesByRunId,
  upsertAnalysisRunValue
} from "../repos/analysis_repo.js";

export function createRunsRouter(db: Db) {
  const router = express.Router();

  router.get("/runs/:id", (req, res) => {
    const runId = Number(req.params.id);
    const run = getRun(db, runId);
    if (!run) return res.status(404).send("Run not found");

    const experiment = getExperiment(db, run.experiment_id);
    if (!experiment) return res.status(404).send("Experiment not found");

    const params = listParamDefinitions(db, run.experiment_id);
    const inputParams = listParamDefinitionsByKind(db, run.experiment_id, "INPUT");
    const configs = listParamConfigs(db, run.experiment_id);
    const activeSet = new Set(
      configs.filter((cfg) => cfg.active === 1).map((cfg) => cfg.param_def_id)
    );
    const activeInputParams = inputParams.filter((param) => activeSet.has(param.id));
    const analysisFields = listActiveAnalysisFields(db, run.experiment_id);
    const analysisValues = listAnalysisRunValuesByRunId(db, run.id);
    const analysisValueMap = new Map(analysisValues.map((row) => [row.field_id, row]));
    const analysisFieldsWithOptions = analysisFields.map((field) => {
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
    });
    const analysisGroups = new Map<string, typeof analysisFieldsWithOptions>();
    analysisFieldsWithOptions.forEach((field) => {
      const group = field.group_label || "Custom";
      const groupRows = analysisGroups.get(group) || [];
      groupRows.push(field);
      analysisGroups.set(group, groupRows);
    });
    const values = listRunValues(db, run.id);
    const valueMap = new Map(values.map((value) => [value.param_def_id, value]));
    const recipe = run.recipe_id ? getRecipe(db, run.recipe_id) : null;
    const components = run.recipe_id ? getRecipeComponents(db, run.recipe_id) : [];
    const { prevId, nextId } = getNextPrevRunIds(db, run.experiment_id, run.run_order);

    res.render("run_detail", {
      run,
      experiment,
      params,
      inputParams: activeInputParams,
      valueMap,
      analysisGroups: Array.from(analysisGroups.entries()).map(([group, fields]) => ({
        group,
        fields
      })),
      analysisValueMap,
      recipe,
      components,
      prevId,
      nextId
    });
  });

  router.post("/runs/:id", (req, res) => {
    const runId = Number(req.params.id);
    const run = getRun(db, runId);
    if (!run) return res.status(404).send("Run not found");

    const analysisFields = listActiveAnalysisFields(db, run.experiment_id);
    for (const field of analysisFields) {
      const fieldName = `analysis_${field.id}`;
      if (!Object.prototype.hasOwnProperty.call(req.body, fieldName)) continue;
      const rawValue = (req.body as Record<string, unknown>)[fieldName];
      let valueReal: number | null = null;
      let valueText: string | null = null;
      let valueTagsJson: string | null = null;
      if (field.field_type === "tag") {
        const tags = Array.isArray(rawValue)
          ? rawValue.map((v) => String(v).trim()).filter(Boolean)
          : String(rawValue || "")
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean);
        valueTagsJson = tags.length ? JSON.stringify(tags) : null;
      } else if (field.field_type === "text") {
        valueText = rawValue ? String(rawValue).trim() : null;
      } else if (field.field_type === "boolean") {
        const values = Array.isArray(rawValue) ? rawValue.map(String) : [String(rawValue || "")];
        const checked = values.includes("1") || values.includes("true") || values.includes("on");
        valueReal = checked ? 1 : 0;
      } else {
        const num = rawValue === "" || rawValue == null ? null : Number(rawValue);
        valueReal = Number.isFinite(num) ? num : null;
      }
      upsertAnalysisRunValue(db, runId, field.id, valueReal, valueText, valueTagsJson);
    }

    const done = req.body.done ? 1 : 0;
    const exclude = req.body.exclude ? 1 : 0;
    updateRunStatus(db, runId, done, exclude);

    res.redirect(`/runs/${runId}`);
  });

  return router;
}
