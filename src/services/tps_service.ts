import type { Database } from "sqlite";
import { AppError } from "../lib/errors.js";
import { randomize } from "../utils.js";
import { defaultTpsOutputFields, defaultTpsParamConfig } from "../domain/tps.js";
import { buildRecipeVariantsFromComponents } from "../domain/recipes.js";
import {
  clearTpsRuns,
  insertTpsExperiment,
  insertTpsExperimentRecipe,
  insertTpsParamConfig,
  insertTpsRun,
  insertTpsRunParamValue,
  listActiveTpsParamConfigs,
  listTpsExperimentRecipes,
  listTpsParamDefs,
} from "../repos/tps_repo.js";
import { getRecipeComponentsByIds } from "../repos/experiments_repo.js";
import { withTransaction } from "../tx.js";

export async function createTpsExperiment(
  db: Database,
  input: {
    name: string;
    seed: number;
    notes: string | null;
    recipeIds: number[];
  }
) {
  const { name, seed, notes, recipeIds } = input;
  if (!name) {
    throw new AppError({
      status: 400,
      code: "INVALID_INPUT",
      message: "Invalid TPS experiment inputs",
    });
  }

  let experimentId = 0;
  await withTransaction(db, async () => {
    const result = await insertTpsExperiment(
      db,
      name,
      seed,
      notes,
      JSON.stringify(defaultTpsOutputFields())
    );
    experimentId = result.lastID as number;

    for (const recipeId of recipeIds) {
      await insertTpsExperimentRecipe(db, experimentId, recipeId);
    }

    const paramDefs = await listTpsParamDefs(db);
    for (const def of paramDefs) {
      const defaults = defaultTpsParamConfig(def.code);
      await insertTpsParamConfig(
        db,
        experimentId,
        def.id,
        defaults.mode,
        defaults.fixed_value,
        defaults.range_min ?? def.min_default ?? null,
        defaults.range_max ?? def.max_default ?? null,
        defaults.list_json ?? null,
        defaults.active
      );
    }
  });

  return experimentId;
}

export async function generateTpsRuns(
  db: Database,
  input: { experimentId: number; maxRuns: number; seed: number }
) {
  const { experimentId, maxRuns, seed } = input;
  const recipeRows = await listTpsExperimentRecipes(db, experimentId);
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
  const configs = await listActiveTpsParamConfigs(db, experimentId);

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
      return { param_def_id: c.param_def_id, levels };
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

  if (combos.length === 0) combos = [{}];

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
    combos = randomize(combos, seed).slice(0, maxRuns);
    warning = `Too many combinations (${total}); sampled ${maxRuns}.`;
  }

  const randomized = randomize(combos, seed);

  await withTransaction(db, async () => {
    await clearTpsRuns(db, experimentId);

    for (let i = 0; i < randomized.length; i += 1) {
      const order = i + 1;
      const runCode = `TPSR-${String(order).padStart(3, "0")}`;
      const recipeId =
        (randomized[i] as any).__recipe_id ??
        (recipeVariants.length > 0 ? recipeVariants[i % recipeVariants.length].id : null);
      const recipeVariant =
        (randomized[i] as any).__recipe_variant ?? null;

      const result = await insertTpsRun(
        db,
        experimentId,
        order,
        runCode,
        recipeId,
        recipeVariant
      );
      const runId = result.lastID as number;

      for (const [paramId, value] of Object.entries(randomized[i])) {
        if (paramId.startsWith("__")) continue;
        const id = Number(paramId);
        if (!Number.isFinite(id)) continue;
        await insertTpsRunParamValue(db, runId, id, value as number);
      }
    }
  });

  return { warning };
}
