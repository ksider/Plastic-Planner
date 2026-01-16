import type { Database } from "sqlite";
import type { RecipeComponentInput } from "../types.js";
import { saveRecipeComponents } from "../domain/recipes.js";

export async function listRecipes(db: Database) {
  return db.all(
    `SELECT r.id, r.name, r.description, r.created_at,
            EXISTS(
              SELECT 1 FROM recipe_components rc
              WHERE rc.recipe_id = r.id AND rc.mode = 'range'
             ) as has_range
     FROM recipes r
     ORDER BY r.name`
  );
}

export async function listRecipeComponentsForRecipes(
  db: Database,
  recipeIds: number[]
) {
  if (!recipeIds.length) return [];
  const placeholders = recipeIds.map(() => "?").join(",");
  return db.all(
    `SELECT recipe_id, name, mode, parts_static, parts_min, parts_max, position, is_locked
     FROM recipe_components
     WHERE recipe_id IN (${placeholders})
     ORDER BY recipe_id, position`,
    recipeIds
  );
}

export async function getRecipeById(db: Database, recipeId: number) {
  return db.get("SELECT id, name, description FROM recipes WHERE id = ?", [
    recipeId,
  ]);
}

export async function getRecipeComponents(db: Database, recipeId: number) {
  return db.all(
    `SELECT id, name, mode, parts_static, parts_min, parts_max, position, is_locked
     FROM recipe_components
     WHERE recipe_id = ?
     ORDER BY position`,
    [recipeId]
  );
}

export async function getImExperimentsByRecipe(db: Database, recipeId: number) {
  return db.all(
    `SELECT e.id, e.name, e.created_at
     FROM im_experiments e
     JOIN im_experiment_recipes er ON er.experiment_id = e.id
     WHERE er.recipe_id = ?
     ORDER BY e.created_at DESC`,
    [recipeId]
  );
}

export async function getTpsExperimentsByRecipe(db: Database, recipeId: number) {
  return db.all(
    `SELECT e.id, e.name, e.created_at
     FROM tps_experiments e
     JOIN tps_experiment_recipes er ON er.experiment_id = e.id
     WHERE er.recipe_id = ?
     ORDER BY e.created_at DESC`,
    [recipeId]
  );
}

export async function getCompoundingExperimentsByRecipe(
  db: Database,
  recipeId: number
) {
  return db.all(
    `SELECT e.id, e.name, e.created_at
     FROM experiments e
     JOIN batches b ON b.experiment_id = e.id
     WHERE b.recipe_id = ?
     GROUP BY e.id
     ORDER BY e.created_at DESC`,
    [recipeId]
  );
}

export async function getAllRecipes(db: Database) {
  return db.all<{ id: number; name: string }>("SELECT id, name FROM recipes");
}

export async function insertRecipe(
  db: Database,
  name: string,
  description: string
) {
  return db.run(
    `INSERT INTO recipes (name, description, starch_parts, citric_parts, pers_parts, esbo_parts, water_parts)
     VALUES (?, ?, 100, ?, ?, ?, ?)`,
    [name, description, 0, 0, 0, 0]
  );
}

export async function updateRecipe(
  db: Database,
  recipeId: number,
  name: string,
  description: string
) {
  await db.run("UPDATE recipes SET name = ?, description = ? WHERE id = ?", [
    name,
    description,
    recipeId,
  ]);
}

export async function deleteRecipeComponents(db: Database, recipeId: number) {
  await db.run("DELETE FROM recipe_components WHERE recipe_id = ?", [recipeId]);
}

export async function deleteRecipe(db: Database, recipeId: number) {
  await db.run("DELETE FROM recipes WHERE id = ?", [recipeId]);
}

export async function getRecipeUsageCount(db: Database, recipeId: number) {
  return db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM batches WHERE recipe_id = ?",
    [recipeId]
  );
}

export async function buildRecipeComponentsFromImport(
  components: RecipeComponentInput[],
  recipeId: number,
  db: Database
) {
  await deleteRecipeComponents(db, recipeId);
  if (components.length > 0) {
    await saveRecipeComponents(db, recipeId, components);
  }
}
