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
import { buildRecipeVariantsFromComponents } from "../domain/recipes.js";
import { getRecipeComponentsByIds } from "../repos/experiments_repo.js";
import {
  deactivateImParamConfig,
  deleteImExperimentCascade,
  findImParamDefinitionByCode,
  getImExperimentById,
  getImParamConfigByCode,
  getImParamDefinition,
  getImRunById,
  getImRunMaterialProps,
  getNextImRunId,
  getPrevImRunId,
  insertImParamConfig,
  insertImParamDefinitionCustom,
  listImExperimentsSummary,
  listImMachineProfiles,
  listImOutputDefs,
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
  updateImRunMoldTemp,
  updateImRunParamText,
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
    res.render("im_index", { experiments });
  })
);

  router.get(
  "/im/new",
  wrap(async (req, res) => {
    const profiles = await listImMachineProfiles(db);
    const recipes = await listRecipeNames(db);
    res.render("im_new", { profiles, recipes });
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
    });

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
          const variants = buildRecipeVariantsFromComponents(
            componentsByRecipe.get(r.id) ?? []
          );
          return sum + Math.max(1, variants.length);
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
    res.render("im_show", {
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

    const { warning } = await generateImRuns(db, { experimentId, maxRuns });

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
    const outputDefs = await listImOutputDefs(db);
    const values = await listImRunParamValues(db, runIds);
    const valueMap = new Map<string, number | null>();
    const textMap = new Map<string, string | null>();
    values.forEach((row: any) => {
      valueMap.set(`${row.run_id}:${row.param_def_id}`, row.value_real);
      textMap.set(`${row.run_id}:${row.param_def_id}`, row.value_text);
    });

    const defectDef = outputDefs.find((d) => d.code === "defect_tags");
    const keyOutputCodes = [
      "cycle_time",
      "part_weight",
      "wall_thickness",
      "eject_temp",
      "shots_per_run",
      "shots_ok",
      "shots_scrap",
    ];
    const keyOutputs = outputDefs.filter((d) =>
      keyOutputCodes.includes(d.code)
    );

    const runData = runs.map((run: any) => {
      const defectRaw =
        defectDef && textMap.get(`${run.id}:${defectDef.id}`)
          ? textMap.get(`${run.id}:${defectDef.id}`)
          : "";
      const defectTags = String(defectRaw || "")
        .split(",")
        .map((v) => v.trim())
        .filter((v) => v);
      const outputs: Record<string, number | null> = {};
      keyOutputs.forEach((def) => {
        const val = valueMap.get(`${run.id}:${def.id}`);
        outputs[def.code] = val ?? null;
      });
      const inputs: Record<string, number | null> = {};
      inputDefs.forEach((def) => {
        const val = valueMap.get(`${run.id}:${def.id}`);
        inputs[def.code] = val ?? null;
      });
      return {
        id: run.id,
        run_code: run.run_code,
        recipe: run.recipe_name || "",
        defectTags,
        outputs,
        inputs,
      };
    });

    const goodRuns = runData.filter((r) => {
      const ok = r.outputs.shots_ok ?? null;
      const scrap = r.outputs.shots_scrap ?? null;
      if (typeof ok !== "number" || typeof scrap !== "number") return false;
      const total = ok + scrap;
      if (total <= 0) return false;
      return ok / total >= 0.9;
    });
    const badRuns = runData.filter((r) => !goodRuns.includes(r));

    const scoreMetrics: Array<{ code: string; direction: "min" | "max" }> = [
      { code: "cycle_time", direction: "min" },
      { code: "shots_scrap", direction: "min" },
      { code: "shots_ok", direction: "max" },
    ];
    const metricRanges = new Map<string, { min: number; max: number }>();
    scoreMetrics.forEach((m) => {
      const vals = goodRuns
        .map((r) => r.outputs[m.code])
        .filter((v) => typeof v === "number") as number[];
      if (vals.length > 0) {
        metricRanges.set(m.code, {
          min: Math.min(...vals),
          max: Math.max(...vals),
        });
      }
    });
    const scoredRuns = goodRuns
      .map((r) => {
        const parts: number[] = [];
        scoreMetrics.forEach((m) => {
          const range = metricRanges.get(m.code);
          const val = r.outputs[m.code];
          if (!range || val === null || val === undefined) return;
          const span = range.max - range.min;
          if (span <= 0) return;
          const score =
            m.direction === "min"
              ? (range.max - val) / span
              : (val - range.min) / span;
          parts.push(score);
        });
        const score =
          parts.length > 0
            ? parts.reduce((a, b) => a + b, 0) / parts.length
            : null;
        return { ...r, score };
      })
      .filter((r) => r.score !== null) as Array<
      typeof goodRuns[number] & { score: number }
    >;
    const suggestedCount = scoredRuns.length
      ? Math.max(1, Math.ceil(scoredRuns.length * 0.25))
      : 0;
    const suggestedRuns = suggestedCount
      ? [...scoredRuns]
          .sort((a, b) => b.score - a.score)
          .slice(0, suggestedCount)
      : [];

    const defByCode = new Map(inputDefs.map((d: any) => [d.code, d]));
    let window = inputDefs.map((def: any) => {
      let values = goodRuns
        .map((r) => r.inputs[def.code])
        .filter((v) => typeof v === "number") as number[];
      if (values.length === 0) {
        if (def.mode === "FIXED" && def.fixed_value !== null) {
          values = [def.fixed_value];
        } else if (def.mode === "RANGE" && def.range_min !== null && def.range_max !== null) {
          values = [def.range_min, def.range_max];
        } else if (def.mode === "LIST" && def.list_json) {
          try {
            const list = JSON.parse(def.list_json);
            if (Array.isArray(list)) {
              values = list.map((v: any) => Number(v)).filter((v: number) => Number.isFinite(v));
            }
          } catch {
            values = [];
          }
        }
      }
      return {
        code: def.code,
        label: def.label,
        unit: def.unit || "",
        n: values.length,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
      };
    });

    const windowSuggested = inputDefs.map((def: any) => {
      const vals = suggestedRuns
        .map((r) => r.inputs[def.code])
        .filter((v) => typeof v === "number") as number[];
      return {
        code: def.code,
        n: vals.length,
        min: vals.length ? Math.min(...vals) : null,
        max: vals.length ? Math.max(...vals) : null,
      };
    });
    const windowSuggestedMap = new Map(
      windowSuggested.map((w) => [w.code, w])
    );

    const windowCombined = window.map((row: any) => {
      const suggested = windowSuggestedMap.get(row.code);
      return {
        ...row,
        suggested_min: suggested?.min ?? null,
        suggested_max: suggested?.max ?? null,
        suggested_n: suggested?.n ?? 0,
      };
    });

    const meltCfg = await getImParamConfigByCode(
      db,
      experimentId,
      "barrel_zone1_temp"
    );
    if (meltCfg) {
      let values = goodRuns
        .map((r) => r.inputs[meltCfg.code])
        .filter((v) => typeof v === "number") as number[];
      if (values.length === 0) {
        if (meltCfg.mode === "FIXED" && meltCfg.fixed_value !== null) {
          values = [meltCfg.fixed_value];
        } else if (
          meltCfg.mode === "RANGE" &&
          meltCfg.range_min !== null &&
          meltCfg.range_max !== null
        ) {
          values = [meltCfg.range_min, meltCfg.range_max];
        } else if (meltCfg.mode === "LIST" && meltCfg.list_json) {
          try {
            const list = JSON.parse(meltCfg.list_json);
            if (Array.isArray(list)) {
              values = list
                .map((v: any) => Number(v))
                .filter((v: number) => Number.isFinite(v));
            }
          } catch {
            values = [];
          }
        }
      }
      if (values.length > 0) {
        windowCombined.splice(
          windowCombined.findIndex((row: any) => row.code === "barrel_zone1_temp"),
          1
        );
        windowCombined.unshift({
          code: "barrel_zone1_temp",
          label: "Melt temp (Zone 1)",
          unit: meltCfg.unit || "°C",
          n: values.length,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
          suggested_min: null,
          suggested_max: null,
          suggested_n: 0,
        });
      }
    }
    if (meltCfg) {
      const suggestedVals = suggestedRuns
        .map((r) => r.inputs[meltCfg.code])
        .filter((v) => typeof v === "number") as number[];
      if (suggestedVals.length > 0) {
        const row = windowCombined.find((r: any) => r.code === "barrel_zone1_temp");
        if (row) {
          row.suggested_min = Math.min(...suggestedVals);
          row.suggested_max = Math.max(...suggestedVals);
          row.suggested_n = suggestedVals.length;
        }
      }
    }

    const outputSummary = keyOutputs.map((def) => {
      const vals = goodRuns
        .map((r) => r.outputs[def.code])
        .filter((v) => typeof v === "number") as number[];
      return {
        label: def.label,
        unit: def.unit || "",
        n: vals.length,
        mean: vals.length ? mean(vals) : null,
        sd: vals.length > 1 ? sd(vals) : null,
      };
    });

    const defectCountsGood = new Map<string, number>();
    const defectCountsBad = new Map<string, number>();
    runData.forEach((r) => {
      const target = goodRuns.includes(r) ? defectCountsGood : defectCountsBad;
      r.defectTags.forEach((tag) => {
        target.set(tag, (target.get(tag) || 0) + 1);
      });
    });
    const defectListGood = Array.from(defectCountsGood.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
    const defectListBad = Array.from(defectCountsBad.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    const missingOutputs = keyOutputs.map((def) => {
      const missing = runData.filter((r) => r.outputs[def.code] === null)
        .length;
      return { label: def.label, missing };
    });

    res.json({
      quality: {
        runs: runData.length,
        goodRuns: goodRuns.length,
        badRuns: badRuns.length,
        defectRate:
          runData.length > 0
            ? Math.round((badRuns.length / runData.length) * 100)
            : 0,
        missingOutputs,
      },
      window: windowCombined,
      suggestedNote: suggestedRuns.length
        ? `Suggested window based on top ${suggestedRuns.length} runs (cycle time ↓, scrap ↓, good shots ↑).`
        : "Suggested window unavailable (not enough output data).",
      outputSummary,
      defectListGood,
      defectListBad,
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
    const textMap = new Map(paramValues.map((v: any) => [v.param_def_id, v.value_text]));

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
    const outputDefs = defWithOptions.filter((d) => Number(d.is_output) === 1);
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

    res.render("im_run_detail", {
      experiment,
      run,
      recipes: await listRecipeNames(db),
      material,
      params: inputDefs,
      outputs: outputDefs,
      settingsList,
      valueMap,
      textMap,
      stages: groupByStage(inputDefs),
      outputStages: groupByStage(outputDefs),
      formatNumber,
      slugify,
      prevId: prev?.id ?? null,
      nextId: next?.id ?? null,
    });
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
    const recipeId =
      updates.recipe_id !== undefined && String(updates.recipe_id).trim() !== ""
        ? Number(updates.recipe_id)
        : null;
    const doneValue =
      updates.done !== undefined
        ? updates.done === "1" || updates.done === "on" || updates.done === true
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

      if (updates.moisture_pct !== undefined || updates.density_g_cm3 !== undefined) {
        await upsertImRunMaterialProps(db, runId, moisture, density);
      }

      const paramDefs = await listImParamDefs(db);
      const moldTempDef = paramDefs.find((d) => d.code === "mold_temp");
      const moistureDef = paramDefs.find((d) => d.code === "material_moisture_pct");
      const densityDef = paramDefs.find((d) => d.code === "material_density_g_cm3");
      let moldTempValue: number | null = null;
      for (const def of paramDefs) {
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

      if (moistureDef && updates.moisture_pct !== undefined) {
        await upsertImRunParamValue(db, runId, moistureDef.id, moisture);
      }
      if (densityDef && updates.density_g_cm3 !== undefined) {
        await upsertImRunParamValue(db, runId, densityDef.id, density);
      }

      if (moldTempValue !== null) {
        await updateImRunMoldTemp(db, experimentId, runId, moldTempValue);
      }
    });

    if (redirectTo) return res.redirect(redirectTo);
    res.json({ ok: true });
  })
);
  return router;
}
