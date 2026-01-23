import express from "express";
import type { Database } from "sqlite";
import { wrap } from "../lib/http.js";
import { withTransaction } from "../tx.js";
import { formatNumber } from "../lib/format.js";
import { AppError } from "../lib/errors.js";
import {
  parseListNumbers,
  parseNumberFlexible,
  normalizeFieldValue,
  normalizeCheckbox,
  groupByStage,
  getImDefaultConfig,
} from "../domain/im.js";
import { mean, sd, slugify, toCsv } from "../utils.js";
import type { ImParamDef } from "../types.js";
import { createImExperiment, generateImRuns } from "../services/im_service.js";
import { getRecipeVariantCount, recipeSearchText } from "../domain/recipes.js";
import { getRecipeComponentsByIds } from "../repos/experiments_repo.js";
import {
  findAnalysisFieldByCode,
  insertAnalysisField,
  listAnalysisFields,
  listAnalysisRunValuesByRunId,
  listAnalysisRunValuesByRunIds,
  upsertAnalysisRunValue,
} from "../repos/analysis_repo.js";
import {
  deactivateImParamConfig,
  deleteImExperimentCascade,
  findImParamDefinitionByCode,
  getImExperimentById,
  getImParamDefinition,
  getImRunById,
  getImRunMaterialProps,
  getNextImRunId,
  getPrevImRunId,
  insertImParamConfig,
  insertImParamDefinitionCustom,
  listImExperimentsSummary,
  listImMachineProfiles,
  listImParamConfigsByExperiment,
  listImActiveInputParamConfigsWithLabels,
  listImParamDefs,
  listImParamDefsActiveInputs,
  listImParamDefsAll,
  listImParamDefsInput,
  listImParamDefsInputIds,
  listImRunParamValues,
  listImRunParamValuesByRun,
  listImRunParamValuesByRunIds,
  listImRuns,
  listImRunsWithMaterialProps,
  listImRunsSummary,
  listImExperimentRecipes,
  listRecipeNames,
  upsertImParamConfig,
  upsertImParamConfigActive,
  updateImExperimentMaterialDefaults,
  updateImRunDone,
  updateImRunExclude,
  updateImRunMoldTemp,
  updateImRunParamText,
  updateImRunReplicate,
  updateImRunRecipe,
  upsertImRunMaterialProps,
  upsertImRunParamValue,
  getImMaterialMissing,
} from "../repos/im_repo.js";

export function createImRouter(db: Database) {
  const router = express.Router();
  router.get(
  "/im",
  wrap(async (req, res) => {
    const experiments = await listImExperimentsSummary(db);
    res.render("im/index", { experiments });
  })
);

  router.get(
  "/im/new",
  wrap(async (req, res) => {
    const profiles = await listImMachineProfiles(db);
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
    res.render("im/new", { profiles, recipes: recipesWithComponents });
  })
);

  router.post(
  "/im",
  wrap(async (req, res) => {
    const name = String(req.body.name || "").trim();
    const machineProfileId = Number(req.body.machine_profile_id || 0) || null;
    const seed = req.body.seed ? Number(req.body.seed) : Math.floor(Math.random() * 1e9);
    const moisture = parseNumberFlexible(req.body.default_material_moisture_pct);
    const density = parseNumberFlexible(req.body.default_material_density_g_cm3);
    const notes = String(req.body.notes || "").trim() || null;
    const designMode =
      String(req.body.design_mode || "").toUpperCase() === "BBD" ? "BBD" : "FULL";
    const recipeIds = Array.isArray(req.body.recipe_ids)
      ? req.body.recipe_ids.map((v: string) => Number(v)).filter(Number.isFinite)
      : req.body.recipe_ids
      ? [Number(req.body.recipe_ids)].filter(Number.isFinite)
      : [];

    if (!name) {
      throw new AppError({
        status: 400,
        code: "INVALID_INPUT",
        message: "Invalid IM experiment inputs",
      });
    }

    const experimentId = await createImExperiment(db, {
      name,
      machineProfileId,
      seed,
      moisture,
      density,
      notes,
      recipeIds,
      designMode,
    });

    res.redirect(`/im/${experimentId}`);
  })
);

  router.post(
    "/im/:id/update",
    wrap(async (req, res) => {
      const experimentId = Number(req.params.id);
      const name = String(req.body.name || "").trim();
      const seed = Number(req.body.seed);
      const notes = String(req.body.notes || "").trim() || null;

      if (!name || !Number.isFinite(seed)) {
        throw new AppError({
          status: 400,
          code: "INVALID_INPUT",
          message: "Invalid IM experiment inputs",
        });
      }

      await db.run(
        "UPDATE im_experiments SET name = ?, seed = ?, notes = ? WHERE id = ?",
        [name, seed, notes, experimentId]
      );

      res.redirect(`/im/${experimentId}`);
    })
  );

  router.get(
  "/im/:id",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const experiment = await getImExperimentById(db, experimentId);
    if (!experiment) return res.status(404).send("IM experiment not found");

    const profiles = await listImMachineProfiles(db);
    const paramDefs = await listImParamDefsAll(db);
    const configs = await listImParamConfigsByExperiment(db, experimentId);
    const configMap = new Map(configs.map((c: any) => [c.param_def_id, c]));
    const inputDefs = paramDefs.filter((d) => d.is_output === 0);
    for (const def of inputDefs) {
      if (configMap.has(def.id)) continue;
      const defaults = getImDefaultConfig(def);
      await insertImParamConfig(
        db,
        experimentId,
        def.id,
        defaults.mode,
        defaults.fixed_value,
        defaults.range_min,
        defaults.range_max,
        defaults.active
      );
    }
    if (inputDefs.length !== configs.length) {
      const refreshed = await listImParamConfigsByExperiment(db, experimentId);
      configMap.clear();
      refreshed.forEach((c: any) => configMap.set(c.param_def_id, c));
    }

    const params = paramDefs.map((def) => {
      const cfg = configMap.get(def.id) || null;
      let listString = "";
      if (cfg?.list_json) {
        try {
          const parsed = JSON.parse(cfg.list_json);
          if (Array.isArray(parsed)) {
            listString = parsed.join(", ");
          }
        } catch {
          listString = "";
        }
      }
      let options: string[] = [];
      if (def.options_json) {
        try {
          const parsed = JSON.parse(def.options_json);
          if (Array.isArray(parsed)) options = parsed.map(String);
        } catch {
          options = [];
        }
      }
      return { ...def, config: cfg, listString, options };
    });

    const recipes = await listRecipeNames(db);
    const selectedRecipes = await listImExperimentRecipes(db, experimentId);
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
    const runs = await listImRuns(db, experimentId);

    const coreCodes = [
      "nozzle_temp",
      "barrel_zone1_temp",
      "barrel_zone2_temp",
      "barrel_zone3_temp",
      "barrel_zone4_temp",
      "barrel_zone5_temp",
      "clamp_tonnage",
      "inj_press_limit",
      "material_moisture_pct",
    ];
    const activeParamDefs = paramDefs.filter((d) => {
      if (Number(d.is_output) === 1) return false;
      const cfg = configMap.get(d.id);
      return cfg?.active === 1;
    });
    const keyDefs = activeParamDefs;
    const keyDefMap = new Map(keyDefs.map((d) => [d.id, d.code]));

    const runParamRows = await listImRunParamValuesByRunIds(
      db,
      runs.map((r: any) => r.id)
    );
    const runParamMap = new Map<string, number>();
    runParamRows.forEach((row: any) => {
      runParamMap.set(`${row.run_id}:${row.param_def_id}`, row.value_real);
    });

    const runsWithParams = runs.map((run: any) => {
      const values: Record<string, number | null> = {};
      keyDefs.forEach((def) => {
        const val = runParamMap.get(`${run.id}:${def.id}`);
        values[def.code] = val ?? null;
      });
      return { ...run, keyValues: values };
    });

    const warning = req.query.warning ? String(req.query.warning) : "";

    const activeConfigs = configs.filter((c: any) => c.active === 1);
    const missingByParam: Array<{ label: string; missing: number }> = [];
    activeConfigs.forEach((cfg: any) => {
      const def = paramDefs.find((d) => d.id === cfg.param_def_id);
      if (!def) return;
      let missing = 0;
      runs.forEach((run: any) => {
        const val = runParamMap.get(`${run.id}:${def.id}`);
        if (val === undefined || val === null) missing += 1;
      });
      missingByParam.push({ label: def.label, missing });
    });

    const materialMissing = await getImMaterialMissing(
      db,
      runs.map((r: any) => r.id)
    );

    const inputParams = params.filter((d) => Number(d.is_output) === 0);
    const outputParams = params.filter((d) => Number(d.is_output) === 1);
    const availableAdvancedDefs = inputParams.filter((d) => {
      const cfg = configMap.get(d.id);
      return !cfg || cfg.active !== 1;
    });
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
    res.render("im/show", {
      experiment,
      profiles,
      params,
      coreCodes,
      availableAdvancedDefs,
      stages: groupByStage(inputParams),
      outputStages: groupByStage(outputParams),
      recipes,
      selectedRecipes,
      recipeVariantCount,
      runs: runsWithParams,
      keyDefs,
      maxRunsDefault,
      formatNumber,
      slugify,
      warning,
      imQuality: {
        runsCount: runs.length,
        missingMoisture: materialMissing?.moisture_missing ?? 0,
        missingDensity: materialMissing?.density_missing ?? 0,
        missingByParam,
      },
    });
  })
);

  router.post(
  "/im/:id/params",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const paramDefs = await listImParamDefsInputIds(db);
    const allowed = new Set(paramDefs.map((d) => String(d.id)));
    const paramsBody = req.body.params || {};
    const paramIds = Object.keys(paramsBody).filter((id) => allowed.has(id));

    await db.exec("BEGIN");
    try {
      for (const paramId of paramIds) {
        const raw = paramsBody[paramId] || {};
        const active = normalizeCheckbox(raw.active) ? 1 : 0;
        const modeRaw = normalizeFieldValue(raw.mode);
        const mode =
          modeRaw === "RANGE" || modeRaw === "LIST" ? modeRaw : "FIXED";

        let fixed_value: number | null = null;
        let range_min: number | null = null;
        let range_max: number | null = null;
        let list_json: string | null = null;

        if (mode === "FIXED") {
          fixed_value = parseNumberFlexible(
            normalizeFieldValue(raw.fixed_value)
          );
        } else if (mode === "RANGE") {
          range_min = parseNumberFlexible(normalizeFieldValue(raw.range_min));
          range_max = parseNumberFlexible(normalizeFieldValue(raw.range_max));
        } else {
          const listRaw = normalizeFieldValue(raw.list_values);
          list_json =
            typeof listRaw === "string" && listRaw.trim() !== ""
              ? JSON.stringify(parseListNumbers(listRaw))
              : null;
        }

        await upsertImParamConfig(
          db,
          experimentId,
          Number(paramId),
          mode,
          fixed_value,
          range_min,
          range_max,
          list_json,
          active
        );
      }

      if (
        Object.prototype.hasOwnProperty.call(
          req.body,
          "default_material_moisture_pct"
        ) ||
        Object.prototype.hasOwnProperty.call(
          req.body,
          "default_material_density_g_cm3"
        )
      ) {
        const moisture = parseNumberFlexible(
          req.body.default_material_moisture_pct
        );
        const density = parseNumberFlexible(
          req.body.default_material_density_g_cm3
        );
        await updateImExperimentMaterialDefaults(
          db,
          experimentId,
          moisture,
          density
        );
      }

      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }

    res.redirect(`/im/${experimentId}#tab-im-design`);
  })
);

  router.post(
  "/im/:id/add-param",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const paramDefId = Number(req.body.param_def_id || 0);
    if (!paramDefId) return res.redirect(`/im/${experimentId}#tab-im-design`);

    const def = await getImParamDefinition(db, paramDefId);
    if (!def || Number(def.is_output) === 1) {
      return res.redirect(`/im/${experimentId}#tab-im-design`);
    }

    const modeRaw = normalizeFieldValue(req.body.mode);
    const mode = modeRaw === "RANGE" || modeRaw === "LIST" ? modeRaw : "FIXED";
    let fixed_value: number | null = null;
    let range_min: number | null = null;
    let range_max: number | null = null;
    let list_json: string | null = null;
    if (mode === "FIXED") {
      fixed_value = parseNumberFlexible(req.body.fixed_value);
      if (fixed_value === null) {
        fixed_value =
          def.min_default !== null && def.min_default !== undefined
            ? def.min_default
            : null;
      }
    } else if (mode === "RANGE") {
      range_min = parseNumberFlexible(req.body.range_min);
      range_max = parseNumberFlexible(req.body.range_max);
      if (range_min === null) {
        range_min =
          def.min_default !== null && def.min_default !== undefined
            ? def.min_default
            : null;
      }
      if (range_max === null) {
        range_max =
          def.max_default !== null && def.max_default !== undefined
            ? def.max_default
            : def.min_default ?? null;
      }
    } else {
      const listRaw = normalizeFieldValue(req.body.list_values);
      list_json =
        typeof listRaw === "string" && listRaw.trim() !== ""
          ? JSON.stringify(parseListNumbers(listRaw))
          : null;
    }

    await upsertImParamConfigActive(
      db,
      experimentId,
      paramDefId,
      mode,
      fixed_value,
      range_min,
      range_max,
      list_json
    );

    res.redirect(`/im/${experimentId}#tab-im-design`);
  })
);

  router.post(
  "/im/:id/add-custom-param",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const label = String(req.body.label || "").trim();
    const unit = String(req.body.unit || "").trim() || null;
    if (!label) return res.redirect(`/im/${experimentId}#tab-im-design`);

    const baseCode = slugify(label) || "custom_param";
    let code = baseCode;
    let i = 2;
    while (await findImParamDefinitionByCode(db, code)) {
      code = `${baseCode}_${i}`;
      i += 1;
    }

    const modeRaw = normalizeFieldValue(req.body.mode);
    const mode = modeRaw === "RANGE" || modeRaw === "LIST" ? modeRaw : "FIXED";
    let fixed_value: number | null = null;
    let range_min: number | null = null;
    let range_max: number | null = null;
    let list_json: string | null = null;
    if (mode === "FIXED") {
      fixed_value = parseNumberFlexible(req.body.fixed_value);
    } else if (mode === "RANGE") {
      range_min = parseNumberFlexible(req.body.range_min);
      range_max = parseNumberFlexible(req.body.range_max);
    } else {
      const listRaw = normalizeFieldValue(req.body.list_values);
      list_json =
        typeof listRaw === "string" && listRaw.trim() !== ""
          ? JSON.stringify(parseListNumbers(listRaw))
          : null;
    }

    await db.exec("BEGIN");
    try {
      const result = await insertImParamDefinitionCustom(db, code, label, unit);
      const paramDefId = result.lastID as number;
      await upsertImParamConfigActive(
        db,
        experimentId,
        paramDefId,
        mode,
        fixed_value,
        range_min,
        range_max,
        list_json
      );
      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }

    res.redirect(`/im/${experimentId}#tab-im-design`);
  })
);

  router.post(
  "/im/:id/params/:paramId/delete",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const paramId = Number(req.params.paramId);
    if (!experimentId || !paramId) {
      return res.redirect(`/im/${experimentId}#tab-im-design`);
    }

    await deactivateImParamConfig(db, experimentId, paramId);

    res.redirect(`/im/${experimentId}#tab-im-design`);
  })
);

  router.post(
  "/im/:id/generate-runs",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const maxRunsRaw = Number(req.body.max_runs || 32);
    const maxRuns =
      Number.isFinite(maxRunsRaw) && maxRunsRaw > 0 ? maxRunsRaw : 32;
    const design =
      String(req.body.design || "").toUpperCase() === "BBD" ? "BBD" : "FULL";

    await db.run("UPDATE im_experiments SET design_mode = ? WHERE id = ?", [
      design,
      experimentId,
    ]);
    const { warning } = await generateImRuns(db, { experimentId, maxRuns, design });

    const warnQuery = warning ? `?warning=${encodeURIComponent(warning)}` : "";
    res.redirect(`/im/${experimentId}${warnQuery}#tab-im-runs`);
  })
);

  router.get(
  "/im/:id/export/runs.csv",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const runs = await listImRunsWithMaterialProps(db, experimentId);
    const activeDefs = await listImParamDefsActiveInputs(db, experimentId);
    const keyDefs = activeDefs;
    const keyDefMap = new Map(keyDefs.map((d) => [d.id, d.code]));

    const runParamRows = await listImRunParamValuesByRunIds(
      db,
      runs.map((r: any) => r.id)
    );
    const runParamMap = new Map<string, number>();
    runParamRows.forEach((row: any) => {
      runParamMap.set(`${row.run_id}:${row.param_def_id}`, row.value_real);
    });

    const header = [
      "RunCode",
      "RunOrder",
      "Recipe",
      "MoldTemp",
      "InjPressLimit",
      "PackPress",
      "HoldTime",
      "InjSpeed",
      "MoisturePct",
      "Density",
      "Done",
    ];
    const rows = runs.map((r: any) => {
      const values: Record<string, number | null> = {};
      keyDefs.forEach((def) => {
        values[def.code] = runParamMap.get(`${r.id}:${def.id}`) ?? null;
      });
      return [
        r.run_code,
        String(r.run_order),
        r.recipe_name ?? "",
        values.mold_temp ?? "",
        values.inj_press_limit ?? "",
        values.pack_press ?? "",
        values.hold_time ?? "",
        values.inj_speed_1 ?? "",
        r.moisture_pct ?? "",
        r.density_g_cm3 ?? "",
        r.done ? "1" : "0",
      ].map(String);
    });

    const csv = toCsv([header, ...rows]);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=im_runs_${experimentId}.csv`
    );
    res.send(csv);
  })
);

  router.get(
  "/im/:id/analysis.json",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const runs = await listImRunsSummary(db, experimentId);
    const runIds = runs.map((r: any) => r.id);
    const inputDefs = await listImParamDefsActiveInputs(db, experimentId);
    const analysisFields = await listAnalysisFields(db, "im", experimentId);
    const numericOutputs = analysisFields.filter((f) => f.field_type === "number");
    const outputCode = String(req.query.output || "");
    const outputField =
      numericOutputs.find((f) => f.code === outputCode) || numericOutputs[0] || null;

    const values = await listImRunParamValues(db, runIds);
    const inputValueMap = new Map<string, number | null>();
    values.forEach((row: any) => {
      inputValueMap.set(`${row.run_id}:${row.param_def_id}`, row.value_real);
    });

    const analysisValues = await listAnalysisRunValuesByRunIds(
      db,
      "im",
      runIds
    );
    const analysisValueMap = new Map<string, any>();
    analysisValues.forEach((row: any) => {
      analysisValueMap.set(`${row.run_id}:${row.field_id}`, row);
    });

    const defectField = analysisFields.find((f) => f.code === "defect_tags");
    const defectOptions = defectField?.allowed_values_json
      ? (() => {
          try {
            const parsed = JSON.parse(defectField.allowed_values_json);
            return Array.isArray(parsed) ? parsed.map(String) : [];
          } catch {
            return [];
          }
        })()
      : [];

    const runData = runs.map((run: any) => {
      const inputs: Record<string, number | null> = {};
      inputDefs.forEach((def: any) => {
        const val = inputValueMap.get(`${run.id}:${def.id}`);
        inputs[def.code] = val ?? null;
      });
      const outputValue =
        outputField &&
        analysisValueMap.get(`${run.id}:${outputField.id}`)
          ? analysisValueMap.get(`${run.id}:${outputField.id}`).value_real
          : null;
      let defectTags: string[] = [];
      if (defectField) {
        const row = analysisValueMap.get(`${run.id}:${defectField.id}`);
        if (row && row.value_tags_json) {
          try {
            const parsed = JSON.parse(row.value_tags_json);
            if (Array.isArray(parsed)) defectTags = parsed.map(String);
          } catch {
            defectTags = [];
          }
        }
      }
      return {
        id: run.id,
        run_code: run.run_code,
        recipe_id: run.recipe_id,
        recipe: run.recipe_name || "",
        exclude_from_analysis: run.exclude_from_analysis ? 1 : 0,
        inputs,
        outputValue,
        defectTags,
      };
    });

    const includeExcluded = String(req.query.include_excluded || "") === "1";
    const recipeFilter = String(req.query.recipe_ids || "")
      .split(",")
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));
    const defectFilter = String(req.query.defect_tags || "")
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v);

    let filteredRuns = runData.filter((r) =>
      includeExcluded ? true : r.exclude_from_analysis !== 1
    );
    if (recipeFilter.length > 0) {
      filteredRuns = filteredRuns.filter(
        (r) => r.recipe_id !== null && recipeFilter.includes(r.recipe_id)
      );
    }
    if (defectFilter.length > 0) {
      filteredRuns = filteredRuns.filter((r) =>
        r.defectTags.some((tag) => defectFilter.includes(tag))
      );
    }

    const factorParam = String(req.query.factors || "").trim();
    const factorList = factorParam
      ? factorParam.split(",").map((v) => v.trim()).filter((v) => v)
      : [];
    const factorDefs = [
      ...inputDefs.map((d: any) => ({
        code: d.code,
        label: d.label,
        unit: d.unit || "",
        type: "number" as const,
      })),
      {
        code: "recipe",
        label: "Recipe",
        unit: "",
        type: "category" as const,
      },
    ];

    const defaultFactors = factorList.length
      ? factorList
      : inputDefs
          .map((def: any) => {
            const values = filteredRuns
              .map((r) => r.inputs[def.code])
              .filter((v) => typeof v === "number") as number[];
            const unique = Array.from(new Set(values.map((v) => Number(v))));
            return unique.length > 1 ? def.code : null;
          })
          .filter((v) => v) as string[];

    const activeFactors = defaultFactors.length ? defaultFactors : factorDefs.map((d) => d.code);
    const hasRecipeFactor = activeFactors.includes("recipe");

    const buildReplicateKey = (run: any) => {
      const parts: string[] = [];
      activeFactors.forEach((code) => {
        if (code === "recipe") {
          parts.push(`recipe:${run.recipe_id ?? ""}`);
          return;
        }
        parts.push(`${code}:${run.inputs[code] ?? ""}`);
      });
      return parts.join("|");
    };

    const replicateMap = new Map<string, any>();
    filteredRuns.forEach((run) => {
      if (typeof run.outputValue !== "number") return;
      const key = buildReplicateKey(run);
      if (!replicateMap.has(key)) {
        replicateMap.set(key, {
          replicate_key: key,
          factors: activeFactors.reduce((acc: any, code: string) => {
            if (code === "recipe") {
              acc[code] = run.recipe || "";
            } else {
              acc[code] = run.inputs[code] ?? null;
            }
            return acc;
          }, {}),
          values: [] as number[],
        });
      }
      replicateMap.get(key).values.push(run.outputValue);
    });

    const replicateRows = Array.from(replicateMap.values()).map((row: any) => ({
      replicate_key: row.replicate_key,
      factors: row.factors,
      n: row.values.length,
      mean: mean(row.values),
      sd: sd(row.values),
      min: row.values.length ? Math.min(...row.values) : null,
      max: row.values.length ? Math.max(...row.values) : null,
    }));

    const modelRows = filteredRuns.filter(
      (r) => typeof r.outputValue === "number"
    );

    const factorEffects = activeFactors.map((code) => {
        const groups = new Map<string, number[]>();
        modelRows.forEach((r) => {
          if (code === "recipe") {
            const key = r.recipe || "";
            if (!key) return;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)?.push(r.outputValue as number);
            return;
          }
          const val = r.inputs[code];
          if (typeof val !== "number") return;
          const key = String(val);
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)?.push(r.outputValue as number);
        });
        const summaries = Array.from(groups.entries()).map(([level, values]) => ({
          level,
          mean: mean(values),
          sd: sd(values),
          n: values.length,
        }));
        if (summaries.length < 2) {
          return { code, label: code, delta_mean: null, pooled_sd: null, effect: null };
        }
        const sorted = [...summaries].sort((a, b) => (a.mean ?? 0) - (b.mean ?? 0));
        const low = sorted[0];
        const high = sorted[sorted.length - 1];
        const pooled =
          low.sd !== null &&
          high.sd !== null &&
          low.n > 1 &&
          high.n > 1
            ? Math.sqrt(
                ((low.n - 1) * low.sd * low.sd + (high.n - 1) * high.sd * high.sd) /
                  (low.n + high.n - 2)
              )
            : null;
        const delta =
          low.mean !== null && high.mean !== null ? high.mean - low.mean : null;
        const effect =
          pooled && delta !== null && pooled !== 0 ? delta / pooled : null;
        return {
          code,
          label:
            code === "recipe"
              ? "Recipe"
              : inputDefs.find((d: any) => d.code === code)?.label || code,
          delta_mean: delta,
          pooled_sd: pooled,
          effect,
        };
      });

    const designRows = modelRows.filter((r) =>
      activeFactors.every((code) => {
        if (code === "recipe") return true;
        return typeof r.inputs[code] === "number";
      })
    );

    const categories = hasRecipeFactor
      ? Array.from(
          new Set(
            designRows.map((r) => (r.recipe || "").trim()).filter((v) => v)
          )
        )
      : [];
    const X: number[][] = [];
    const y: number[] = [];
    designRows.forEach((r) => {
      if (typeof r.outputValue !== "number") return;
      const row: number[] = [1];
      activeFactors.forEach((code) => {
        if (code === "recipe") {
          categories.slice(1).forEach((cat) => {
            row.push(r.recipe === cat ? 1 : 0);
          });
        } else {
          row.push(Number(r.inputs[code]));
        }
      });
      X.push(row);
      y.push(r.outputValue as number);
    });

    const solveLinearSystem = (a: number[][], b: number[]) => {
      const n = a.length;
      const m = a[0].length;
      const matrix = a.map((row, i) => [...row, b[i]]);
      for (let i = 0; i < m; i += 1) {
        let maxRow = i;
        for (let k = i + 1; k < n; k += 1) {
          if (Math.abs(matrix[k][i]) > Math.abs(matrix[maxRow][i])) {
            maxRow = k;
          }
        }
        if (matrix[maxRow][i] === 0) continue;
        [matrix[i], matrix[maxRow]] = [matrix[maxRow], matrix[i]];
        const pivot = matrix[i][i];
        for (let j = i; j <= m; j += 1) {
          matrix[i][j] /= pivot;
        }
        for (let k = 0; k < n; k += 1) {
          if (k === i) continue;
          const factor = matrix[k][i];
          for (let j = i; j <= m; j += 1) {
            matrix[k][j] -= factor * matrix[i][j];
          }
        }
      }
      return matrix.slice(0, m).map((row) => row[m]);
    };

    let r2Adj: number | null = null;
    let residualSe: number | null = null;
    if (X.length >= 2 && X[0].length < X.length) {
      const Xt = X[0].map((_, i) => X.map((row) => row[i]));
      const XtXMat = Xt.map((row) =>
        Xt.map((_, j) => row.reduce((sum, v, idx) => sum + v * Xt[j][idx], 0))
      );
      const XtY = Xt.map((row) => row.reduce((sum, v, idx) => sum + v * y[idx], 0));
      const beta = solveLinearSystem(XtXMat, XtY);
      const yHat = X.map((row) => row.reduce((sum, v, idx) => sum + v * beta[idx], 0));
      const yMean = mean(y) ?? 0;
      const sse = y.reduce((sum, val, idx) => sum + (val - yHat[idx]) ** 2, 0);
      const sst = y.reduce((sum, val) => sum + (val - yMean) ** 2, 0);
      const r2 = sst > 0 ? 1 - sse / sst : null;
      const n = y.length;
      const p = X[0].length;
      r2Adj =
        r2 !== null && n - p > 0 ? 1 - (1 - r2) * ((n - 1) / (n - p)) : null;
      residualSe = n - p > 0 ? Math.sqrt(sse / (n - p)) : null;
    }

    res.json({
      selection: {
        output: outputField ? outputField.code : null,
        factors: activeFactors,
        recipe_ids: recipeFilter,
        defect_tags: defectFilter,
        include_excluded: includeExcluded ? 1 : 0,
      },
      outputs: numericOutputs.map((f) => ({
        code: f.code,
        label: f.label,
        unit: f.unit || "",
      })),
      factors: factorDefs,
      recipes: runs
        .filter((r: any) => r.recipe_id)
        .map((r: any) => ({ id: r.recipe_id, name: r.recipe_name }))
        .filter((r: any, idx: number, arr: any[]) =>
          arr.findIndex((x) => x.id === r.id) === idx
        ),
      defect_options: defectOptions,
      aggregates: replicateRows,
      stats: {
        delta_mean: factorEffects,
        r2_adj: r2Adj,
        residual_se: residualSe,
      },
    });
  })
);

  router.get(
  "/im/:id/runs/:runId",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const runId = Number(req.params.runId);
    const experiment = await getImExperimentById(db, experimentId);
    if (!experiment) return res.status(404).send("IM experiment not found");

    const run = await getImRunById(db, experimentId, runId);
    if (!run) return res.status(404).send("Run not found");

    const prev = await getPrevImRunId(db, experimentId, run.run_order);
    const next = await getNextImRunId(db, experimentId, run.run_order);

    const material = await getImRunMaterialProps(db, runId);
    const paramDefs = await listImParamDefsAll(db);
    const paramConfigs = await listImActiveInputParamConfigsWithLabels(
      db,
      experimentId
    );
    const paramValues = await listImRunParamValuesByRun(db, runId);
    const valueMap = new Map(paramValues.map((v: any) => [v.param_def_id, v.value_real]));

    const defWithOptions = paramDefs.map((def) => {
      let options: string[] = [];
      if (def.options_json) {
        try {
          const parsed = JSON.parse(def.options_json);
          if (Array.isArray(parsed)) options = parsed.map(String);
        } catch {
          options = [];
        }
      }
      return { ...def, options };
    });

    const inputDefs = defWithOptions.filter((d) => Number(d.is_output) === 0);
    const analysisFieldsRaw = await listAnalysisFields(db, "im", experimentId);
    const analysisFields = analysisFieldsRaw.map((field) => {
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
    const analysisValues = await listAnalysisRunValuesByRunId(db, "im", runId);
    const analysisValueMap = new Map(
      analysisValues.map((row: any) => [row.field_id, row])
    );
    const analysisGroups = new Map<string, typeof analysisFields>();
    analysisFields.forEach((field) => {
      const group = field.display_group || "Custom";
      const existing = analysisGroups.get(group) || [];
      existing.push(field);
      analysisGroups.set(group, existing);
    });
    const settingsList = paramConfigs.map((cfg: any) => {
      const assigned = valueMap.get(cfg.param_def_id);
      let display: string | null = null;
      if (assigned !== undefined && assigned !== null) {
        display = formatNumber(assigned);
      } else if (cfg.mode === "FIXED" && cfg.fixed_value !== null) {
        display = formatNumber(cfg.fixed_value);
      } else if (cfg.mode === "RANGE") {
        const min = cfg.range_min !== null ? formatNumber(cfg.range_min) : "";
        const max = cfg.range_max !== null ? formatNumber(cfg.range_max) : "";
        display = min && max ? `${min}–${max}` : min || max || null;
      } else if (cfg.mode === "LIST" && cfg.list_json) {
        try {
          const list = JSON.parse(cfg.list_json);
          if (Array.isArray(list)) {
            display = list.map((v) => formatNumber(v)).join(", ");
          }
        } catch {
          display = null;
        }
      }
      return {
        label: cfg.label,
        unit: cfg.unit,
        value: display || "—",
      };
    });

    res.render("im/run_detail", {
      experiment,
      run,
      recipes: await listRecipeNames(db),
      material,
      params: inputDefs,
      analysisFields,
      analysisGroups: Array.from(analysisGroups.entries()).map(([group, fields]) => ({
        group,
        fields,
      })),
      analysisValueMap,
      settingsList,
      valueMap,
      stages: groupByStage(inputDefs),
      formatNumber,
      slugify,
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
    });
  })
);

  router.post(
  "/im/:id/analysis-fields",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const label = String(req.body.label || "").trim();
    const rawType = String(req.body.field_type || "number").trim();
    const fieldType = ["number", "text", "tag"].includes(rawType) ? rawType : "number";
    const unit = req.body.unit !== undefined ? String(req.body.unit).trim() : "";
    const displayGroup =
      req.body.display_group !== undefined && String(req.body.display_group).trim()
        ? String(req.body.display_group).trim()
        : "Custom";
    const allowedRaw =
      req.body.allowed_values !== undefined
        ? String(req.body.allowed_values || "")
        : "";
    const allowedValues = allowedRaw
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v);
    const allowedValuesJson =
      fieldType === "tag" && allowedValues.length > 0
        ? JSON.stringify(allowedValues)
        : null;
    const isGlobal =
      req.body.is_global === "1" ||
      req.body.is_global === "on" ||
      req.body.is_global === true;
    const scopeId = isGlobal ? null : experimentId;

    if (!label) {
      return res.redirect(`/im/${experimentId}`);
    }

    const baseCode = slugify(label) || "output_field";
    let code = baseCode;
    let i = 2;
    while (await findAnalysisFieldByCode(db, "im", scopeId, code)) {
      code = `${baseCode}_${i}`;
      i += 1;
    }
    await insertAnalysisField(
      db,
      "im",
      scopeId,
      code,
      label,
      fieldType,
      unit || null,
      displayGroup,
      allowedValuesJson
    );

    const redirectTo =
      req.body.redirect_to !== undefined ? String(req.body.redirect_to) : null;
    res.redirect(redirectTo || `/im/${experimentId}`);
  })
);

  router.post(
  "/im/:id/delete",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    await db.exec("BEGIN");
    try {
      await deleteImExperimentCascade(db, experimentId);
      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }
    res.redirect("/im");
  })
);

  router.post(
  "/im/:id/runs/:runId",
  wrap(async (req, res) => {
    const experimentId = Number(req.params.id);
    const runId = Number(req.params.runId);
    const redirectTo =
      req.body.redirect_to !== undefined ? String(req.body.redirect_to) : null;
    const isJson = req.is("application/json");

    const updates: Record<string, unknown> = isJson ? req.body : req.body;
    const recipeIdProvided = updates.recipe_id !== undefined;
    const recipeId =
      recipeIdProvided && String(updates.recipe_id).trim() !== ""
        ? Number(updates.recipe_id)
        : null;
    const doneValue =
      updates.done !== undefined
        ? updates.done === "1" || updates.done === "on" || updates.done === true
          ? 1
          : 0
        : null;
    const excludeValue =
      updates.exclude_from_analysis !== undefined
        ? updates.exclude_from_analysis === "1" ||
          updates.exclude_from_analysis === "on" ||
          updates.exclude_from_analysis === true
          ? 1
          : 0
        : null;
    const moisture = parseNumberFlexible(updates.moisture_pct);
    const density = parseNumberFlexible(updates.density_g_cm3);

    await withTransaction(db, async () => {
      if (updates.recipe_id !== undefined) {
        await updateImRunRecipe(db, experimentId, runId, recipeId);
      }
      if (doneValue !== null) {
        await updateImRunDone(db, experimentId, runId, doneValue);
      }
      if (excludeValue !== null) {
        await updateImRunExclude(db, experimentId, runId, excludeValue);
      }

      if (updates.moisture_pct !== undefined || updates.density_g_cm3 !== undefined) {
        await upsertImRunMaterialProps(db, runId, moisture, density);
      }

      const paramDefs = await listImParamDefsAll(db);
      const inputDefs = paramDefs.filter((d) => Number(d.is_output) === 0);
      const moldTempDef = inputDefs.find((d) => d.code === "mold_temp");
      const moistureDef = inputDefs.find((d) => d.code === "material_moisture_pct");
      const densityDef = inputDefs.find((d) => d.code === "material_density_g_cm3");
      let moldTempValue: number | null = null;
      for (const def of inputDefs) {
        const key = `param_${def.id}`;
        if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
        const rawValue = (updates as any)[key];
        const rawText = Array.isArray(rawValue)
          ? rawValue.map((v) => String(v).trim()).filter((v) => v)
          : rawValue;
        const value = parseNumberFlexible(rawValue);
        const textValue =
          value === null && rawText !== undefined && String(rawText).trim() !== ""
            ? Array.isArray(rawText)
              ? rawText.join(", ")
              : String(rawText).trim()
            : null;
        if (moldTempDef && def.id === moldTempDef.id) {
          moldTempValue = value;
        }
        await upsertImRunParamValue(db, runId, def.id, value);
        await updateImRunParamText(db, runId, def.id, textValue);
      }

      const analysisFields = await listAnalysisFields(db, "im", experimentId);
      for (const field of analysisFields) {
        const key = `analysis_${field.id}`;
        if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
        const rawValue = (updates as any)[key];
        let valueReal: number | null = null;
        let valueText: string | null = null;
        let valueTagsJson: string | null = null;
        if (field.field_type === "text") {
          valueText =
            rawValue !== undefined && String(rawValue).trim() !== ""
              ? String(rawValue).trim()
              : null;
        } else if (field.field_type === "tag") {
          const tags = Array.isArray(rawValue)
            ? rawValue.map((v) => String(v).trim()).filter((v) => v)
            : String(rawValue || "")
                .split(",")
                .map((v) => v.trim())
                .filter((v) => v);
          valueTagsJson = tags.length ? JSON.stringify(tags) : null;
        } else {
          valueReal = parseNumberFlexible(rawValue);
        }
        await upsertAnalysisRunValue(
          db,
          "im",
          runId,
          field.id,
          valueReal,
          valueText,
          valueTagsJson
        );
      }

      if (moistureDef && updates.moisture_pct !== undefined) {
        await upsertImRunParamValue(db, runId, moistureDef.id, moisture);
      }
      if (densityDef && updates.density_g_cm3 !== undefined) {
        await upsertImRunParamValue(db, runId, densityDef.id, density);
      }

      if (moldTempValue !== null) {
        await updateImRunMoldTemp(db, experimentId, runId, moldTempValue);
      }

      const activeInputs = await listImParamDefsActiveInputs(db, experimentId);
      const currentRun = await getImRunById(db, experimentId, runId);
      const effectiveRecipeId = recipeIdProvided
        ? recipeId
        : currentRun?.recipe_id ?? null;
      const runParams = await listImRunParamValuesByRun(db, runId);
      const runParamMap = new Map(
        runParams.map((row: any) => [row.param_def_id, row.value_real])
      );
      const replicateParts: string[] = [];
      activeInputs.forEach((def: any) => {
        const val = runParamMap.get(def.id);
        if (val === null || val === undefined) return;
        replicateParts.push(`${def.code}:${val}`);
      });
      if (effectiveRecipeId !== null) {
        replicateParts.push(`recipe:${effectiveRecipeId}`);
      }
      const replicateKey = replicateParts.length ? replicateParts.join("|") : null;
      const siblings = await db.all<{ id: number }>(
        "SELECT id FROM im_runs WHERE experiment_id = ? AND replicate_key = ? ORDER BY run_order",
        [experimentId, replicateKey]
      );
      const replicateIndex =
        siblings.findIndex((r) => r.id === runId) >= 0
          ? siblings.findIndex((r) => r.id === runId) + 1
          : 1;
      await updateImRunReplicate(db, experimentId, runId, replicateKey, replicateIndex);
    });

    if (redirectTo) return res.redirect(redirectTo);
    res.json({ ok: true });
  })
);
  return router;
}
