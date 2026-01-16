import type { Database } from "sqlite";
import { AppError } from "../lib/errors.js";
import { getImDefaultConfig } from "../domain/im.js";
import { buildRecipeVariantsFromComponents } from "../domain/recipes.js";
import { randomize } from "../utils.js";
import {
  clearImRuns,
  getImExperimentSeedAndDefaults,
  insertImExperiment,
  insertImExperimentRecipe,
  insertImParamConfig,
  insertImRun,
  insertImRunMaterialProps,
  insertImRunParamValue,
  listActiveImParamConfigs,
  listImExperimentRecipes,
  listImParamDefsInput,
} from "../repos/im_repo.js";
import { getRecipeComponentsByIds } from "../repos/experiments_repo.js";
import { withTransaction } from "../tx.js";

export async function createImExperiment(
  db: Database,
  input: {
    name: string;
    machineProfileId: number | null;
    seed: number;
    moisture: number | null;
    density: number | null;
    notes: string | null;
    recipeIds: number[];
  }
) {
  const { name, machineProfileId, seed, moisture, density, notes, recipeIds } =
    input;
  if (!name) {
    throw new AppError({
      status: 400,
      code: "INVALID_INPUT",
      message: "Invalid IM experiment inputs",
    });
  }

  let experimentId = 0;
  await withTransaction(db, async () => {
    const result = await insertImExperiment(
      db,
      name,
      machineProfileId,
      seed,
      moisture,
      density,
      notes
    );
    experimentId = result.lastID as number;

    for (const recipeId of recipeIds) {
      await insertImExperimentRecipe(db, experimentId, recipeId);
    }

    const paramDefs = await listImParamDefsInput(db);
    for (const def of paramDefs) {
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
  });

  return experimentId;
}

export async function generateImRuns(
  db: Database,
  input: {
    experimentId: number;
    maxRuns: number;
  }
) {
  const { experimentId, maxRuns } = input;
  const experiment = await getImExperimentSeedAndDefaults(db, experimentId);
  if (!experiment) {
    throw new AppError({
      status: 404,
      code: "NOT_FOUND",
      message: "IM experiment not found",
    });
  }

  const recipeRows = await listImExperimentRecipes(db, experimentId);
  const recipeIds = recipeRows.map((r: any) => r.id);
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
  const recipeVariants = recipeRows.flatMap((recipe: any) => {
    const components = componentsByRecipe.get(recipe.id) ?? [];
    const variants = buildRecipeVariantsFromComponents(components);
    return variants.map((variant) => ({
      id: recipe.id,
      name: recipe.name,
      variant: variant.variant,
    }));
  });
  const configs = await listActiveImParamConfigs(db, experimentId);

  const paramLevels = configs
    .map((c: any) => {
      let levels: number[] = [];
      if (c.mode === "RANGE" && c.range_min !== null && c.range_max !== null) {
        levels =
          c.range_min === c.range_max ? [c.range_min] : [c.range_min, c.range_max];
      } else if (c.mode === "LIST" && c.list_json) {
        try {
          const parsed = JSON.parse(c.list_json);
          if (Array.isArray(parsed)) {
            levels = parsed.map(Number).filter((v: number) => Number.isFinite(v));
          }
        } catch {
          levels = [];
        }
      } else if (c.mode === "FIXED" && c.fixed_value !== null) {
        levels = [c.fixed_value];
      }
      return { param_def_id: c.param_def_id, code: c.code, levels };
    })
    .filter((p: any) => p.levels.length > 0);

  let combos: Array<Record<number, number>> = [{}];
  for (const p of paramLevels) {
    const next: Array<Record<number, number>> = [];
    for (const base of combos) {
      for (const level of p.levels) {
        next.push({ ...base, [p.param_def_id]: level });
      }
    }
    combos = next;
  }

  if (combos.length === 0) {
    combos = [{}];
  }

  if (recipeVariants.length > 0) {
    const expanded: Array<Record<number, number>> = [];
    for (const combo of combos) {
      for (const recipe of recipeVariants) {
        expanded.push({
          ...combo,
          __recipe_id: recipe.id,
          __recipe_variant: recipe.variant ?? null,
        });
      }
    }
    combos = expanded;
  }

  let warning = "";
  if (combos.length > maxRuns) {
    const total = combos.length;
    combos = randomize(combos, experiment.seed).slice(0, maxRuns);
    warning = `Too many combinations (${total}); sampled ${maxRuns}.`;
  }

  const randomized = randomize(combos, experiment.seed);

  await withTransaction(db, async () => {
    await clearImRuns(db, experimentId);

    const moistureDef = paramLevels.find(
      (p: any) => p.code === "material_moisture_pct"
    );
    const densityDef = paramLevels.find(
      (p: any) => p.code === "material_density_g_cm3"
    );

    for (let i = 0; i < randomized.length; i += 1) {
      const order = i + 1;
      const runCode = `IMR-${String(order).padStart(3, "0")}`;
      const recipeId =
        (randomized[i] as any).__recipe_id ??
        (recipeVariants.length > 0 ? recipeVariants[i % recipeVariants.length].id : null);
      const recipeVariant =
        (randomized[i] as any).__recipe_variant ?? null;
      let moldTemp: number | null = null;
      for (const p of paramLevels) {
        if (p.code === "mold_temp") {
          moldTemp = randomized[i][p.param_def_id] ?? null;
        }
      }
      const moistureValue = moistureDef
        ? randomized[i][moistureDef.param_def_id] ?? null
        : null;
      const densityValue = densityDef
        ? randomized[i][densityDef.param_def_id] ?? null
        : null;

      const result = await insertImRun(
        db,
        experimentId,
        order,
        runCode,
        recipeId,
        moldTemp,
        recipeVariant
      );
      const runId = result.lastID as number;

      for (const [paramId, value] of Object.entries(randomized[i])) {
        if (paramId.startsWith("__")) continue;
        const id = Number(paramId);
        if (!Number.isFinite(id)) continue;
        await insertImRunParamValue(db, runId, id, value as number);
      }

      await insertImRunMaterialProps(
        db,
        runId,
        moistureValue ?? experiment.default_material_moisture_pct ?? null,
        densityValue ?? experiment.default_material_density_g_cm3 ?? null
      );
    }
  });

  return { warning };
}
