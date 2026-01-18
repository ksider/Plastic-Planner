import type { Database } from "sqlite";
import { AppError } from "../lib/errors.js";
import { defaultSampleFields } from "../domain/experiments.js";
import { buildRecipeVariantsFromComponents, defaultRecipeComponents } from "../domain/recipes.js";
import { computeWeights, randomize, slugify } from "../utils.js";
import {
  getRecipeComponentsByIds,
  getRecipesByIds,
  insertBatch,
  insertExperiment,
  listBatchesForExperiment,
  getExperimentMoldingMeta,
  deleteSamplesByExperiment,
  insertSample,
} from "../repos/experiments_repo.js";
import { withTransaction } from "../tx.js";
import type { RecipeComponentInput } from "../types.js";

export async function createExperimentWithBatches(
  db: Database,
  input: {
    name: string;
    finalMass: number;
    recipeIds: number[];
    totalRuns: number;
    seed: number;
    moldTempsJson: string;
    headTempsJson: string;
    headTemps: number[];
    replicates: number;
    notes: string | null;
  }
) {
  const {
    name,
    finalMass,
    recipeIds,
    totalRuns,
    seed,
    moldTempsJson,
    headTempsJson,
    headTemps,
    replicates,
    notes,
  } = input;

  const recipes = await getRecipesByIds(db, recipeIds);
  const recipeComponents = await getRecipeComponentsByIds(db, recipeIds);

  const componentsByRecipe = new Map<number, RecipeComponentInput[]>();
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

  const recipeVariants = recipes.flatMap((recipe) => {
    const components = componentsByRecipe.get(recipe.id) ?? [];
    const variants = buildRecipeVariantsFromComponents(components);
    return variants.map((variant) => ({
      ...recipe,
      variant: variant.variant,
      partsEntries: variant.partsEntries,
    }));
  });

  if (recipeVariants.length < 2) {
    throw new AppError({
      status: 400,
      code: "INVALID_INPUT",
      message: "Need at least two recipes or a Min/Max recipe to generate runs",
    });
  }

  const headTempsList = headTemps.length ? headTemps : [160, 180, 200];
  const comboCount = recipeVariants.length * headTempsList.length;
  if (totalRuns % comboCount !== 0) {
    throw new AppError({
      status: 400,
      code: "INVALID_INPUT",
      message: `Total runs must be divisible by recipe variants x head temps (${comboCount})`,
    });
  }

  const runsPerCombo = totalRuns / comboCount;
  const batchRows: Array<{
    recipe_id: number;
    recipe_variant: string | null;
    compound_order: number;
    batch_code: string;
    starch_g: number;
    citric_g: number;
    pers_g: number;
    esbo_g: number;
    water_g: number;
    total_g: number;
    weights_json: string;
    parts_json: string;
    head_set: number | null;
  }> = [];

  const expanded = recipeVariants.flatMap((r) =>
    headTempsList.flatMap((temp) =>
      Array.from({ length: runsPerCombo }, () => ({ recipe: r, headTemp: temp }))
    )
  );

  const randomized = randomize(expanded, seed);

  randomized.forEach((item, idx) => {
    const recipe = item.recipe;
    const order = idx + 1;
    let partsEntries = recipe.partsEntries as Array<{ name: string; parts_used: number }> | undefined;
    if (!partsEntries) {
      const components = componentsByRecipe.get(recipe.id) ?? defaultRecipeComponents();
      partsEntries = components.map((c) => ({
        name: c.name,
        parts_used: c.parts_static ?? 0,
      }));
    }
    const partsMap: Record<string, number> = {};
    for (const entry of partsEntries) {
      partsMap[entry.name] = entry.parts_used;
    }
    const weights = computeWeights(partsMap, finalMass, 0.1);
    const variantSuffix = recipe.variant ? `_${recipe.variant}` : "";
    const batchCode = `B${String(order).padStart(2, "0")}_${slugify(
      recipe.name
    )}${variantSuffix}`;

    const pickWeight = (keywords: string[]) => {
      const key = Object.keys(weights.grams).find((name) =>
        keywords.some((k) => name.toLowerCase().includes(k))
      );
      return key ? weights.grams[key] : 0;
    };

    batchRows.push({
      recipe_id: recipe.id,
      recipe_variant: recipe.variant,
      compound_order: order,
      batch_code: batchCode,
      starch_g: pickWeight(["starch"]),
      citric_g: pickWeight(["citric"]),
      pers_g: pickWeight(["persulfate", "pers"]),
      esbo_g: pickWeight(["esbo"]),
      water_g: pickWeight(["water"]),
      total_g: weights.total_g,
      weights_json: JSON.stringify(weights.grams),
      parts_json: JSON.stringify(partsEntries),
      head_set: item.headTemp,
    });
  });

  let experimentId = 0;
  await withTransaction(db, async () => {
    const expResult = await insertExperiment(
      db,
      name,
      finalMass,
      seed,
      moldTempsJson,
      headTempsJson,
      JSON.stringify(defaultSampleFields()),
      JSON.stringify(["solubles_pct"]),
      replicates,
      notes
    );
    experimentId = expResult.lastID as number;

    for (const row of batchRows) {
      await insertBatch(db, experimentId, row);
    }
  });

  return experimentId;
}

export async function generateMoldingSamples(db: Database, experimentId: number) {
  const experiment = await getExperimentMoldingMeta(db, experimentId);
  if (!experiment) {
    throw new AppError({
      status: 404,
      code: "NOT_FOUND",
      message: "Experiment not found",
    });
  }

  const batches = await listBatchesForExperiment(db, experimentId);
  const moldTemps: number[] = JSON.parse(experiment.mold_temps_json || "[]");
  const replicates = Number(experiment.replicates_per_temp || 1);

  const sampleRows: Array<{
    batch_id: number;
    mold_temp_c: number;
    replicate: number;
    sample_code: string;
  }> = [];

  for (const batch of batches) {
    for (const temp of moldTemps) {
      for (let r = 1; r <= replicates; r += 1) {
        const sampleCode = `${batch.batch_code}_T${String(temp).padStart(
          3,
          "0"
        )}_R${r}`;
        sampleRows.push({
          batch_id: batch.id,
          mold_temp_c: temp,
          replicate: r,
          sample_code: sampleCode,
        });
      }
    }
  }

  const randomized = randomize(sampleRows, experiment.seed + 101);

  await withTransaction(db, async () => {
    await deleteSamplesByExperiment(db, experimentId);
    for (const [idx, row] of randomized.entries()) {
      await insertSample(db, experimentId, {
        ...row,
        mold_order: idx + 1,
      });
    }
  });
}
