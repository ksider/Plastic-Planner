import type { Db } from "../db.js";

export type Recipe = {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
};

export type RecipeComponent = {
  recipe_id: number;
  component_name: string;
  phr: number;
};

export function listRecipes(db: Db): Recipe[] {
  return db.prepare("SELECT * FROM recipes ORDER BY id DESC").all() as Recipe[];
}

export function getRecipe(db: Db, id: number): Recipe | undefined {
  return db.prepare("SELECT * FROM recipes WHERE id = ?").get(id) as Recipe | undefined;
}

export function getRecipeComponents(db: Db, recipeId: number): RecipeComponent[] {
  return db
    .prepare("SELECT recipe_id, component_name, phr FROM recipe_components WHERE recipe_id = ? ORDER BY id")
    .all(recipeId) as RecipeComponent[];
}

export function createRecipe(db: Db, name: string, description: string | null): number {
  const createdAt = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO recipes (name, description, created_at) VALUES (?, ?, ?)")
    .run(name, description ?? null, createdAt);
  return Number(result.lastInsertRowid);
}

export function replaceRecipeComponents(db: Db, recipeId: number, components: RecipeComponent[]) {
  const del = db.prepare("DELETE FROM recipe_components WHERE recipe_id = ?");
  const insert = db.prepare(
    "INSERT INTO recipe_components (recipe_id, component_name, phr) VALUES (?, ?, ?)"
  );
  const tx = db.transaction(() => {
    del.run(recipeId);
    for (const component of components) {
      insert.run(recipeId, component.component_name, component.phr);
    }
  });
  tx();
}

export function deleteAllRecipes(db: Db) {
  db.prepare("DELETE FROM recipes").run();
}
