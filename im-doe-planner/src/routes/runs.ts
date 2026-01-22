import express from "express";
import type { Db } from "../db.js";
import { getRun, getNextPrevRunIds, listRunValues, updateRunStatus, upsertRunValue } from "../repos/runs_repo.js";
import { getExperiment } from "../repos/experiments_repo.js";
import { listParamDefinitionsByKind, listParamDefinitions, listParamConfigs } from "../repos/params_repo.js";
import { getRecipe, getRecipeComponents } from "../repos/recipes_repo.js";

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
    const outputParams = listParamDefinitionsByKind(db, run.experiment_id, "OUTPUT");
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
      outputParams,
      valueMap,
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

    const outputParams = listParamDefinitionsByKind(db, run.experiment_id, "OUTPUT");
    for (const param of outputParams) {
      const fieldName = `param_${param.id}`;
      if (param.field_type === "tag") {
        const tags = req.body[`${fieldName}_tags`];
        const tagList = Array.isArray(tags) ? tags : tags ? [tags] : [];
        upsertRunValue(db, {
          run_id: runId,
          param_def_id: param.id,
          value_real: null,
          value_text: null,
          value_tags_json: JSON.stringify(tagList)
        });
      } else if (param.field_type === "text") {
        const value = req.body[fieldName];
        upsertRunValue(db, {
          run_id: runId,
          param_def_id: param.id,
          value_real: null,
          value_text: value ? String(value) : null,
          value_tags_json: null
        });
      } else {
        const value = req.body[fieldName];
        const num = value === "" || value == null ? null : Number(value);
        upsertRunValue(db, {
          run_id: runId,
          param_def_id: param.id,
          value_real: Number.isFinite(num) ? num : null,
          value_text: null,
          value_tags_json: null
        });
      }
    }

    const done = req.body.done ? 1 : 0;
    const exclude = req.body.exclude ? 1 : 0;
    updateRunStatus(db, runId, done, exclude);

    res.redirect(`/runs/${runId}`);
  });

  return router;
}
