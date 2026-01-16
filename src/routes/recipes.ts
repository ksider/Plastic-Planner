import express from "express";
import path from "path";
import fs from "fs";
import ejs from "ejs";
import multer from "multer";
import type { Database } from "sqlite";
import { parseBpacksMatrix, normalizeComponent } from "../bpacks_import.js";
import type { BpacksComponentRow, BpacksRecipeColumn } from "../bpacks_import.js";
import { wrap } from "../lib/http.js";
import { withTransaction } from "../tx.js";
import {
  defaultRecipeComponents,
  normalizeComponents,
  saveRecipeComponents,
} from "../domain/recipes.js";
import type { RecipeComponentInput } from "../types.js";
import {
  buildRecipeComponentsFromImport,
  deleteRecipe,
  deleteRecipeComponents,
  getAllRecipes,
  getImExperimentsByRecipe,
  getRecipeById,
  getRecipeComponents,
  getRecipeUsageCount,
  insertRecipe,
  listRecipes,
  updateRecipe,
} from "../repos/recipes_repo.js";

const upload = multer({ storage: multer.memoryStorage() });

function renderEjs(
  res: express.Response,
  viewName: string,
  data: Record<string, unknown>
) {
  const viewPath = path.join(process.cwd(), "src", "views", `${viewName}.ejs`);
  const template = fs.readFileSync(viewPath, "utf8");
  const html = ejs.render(template, data, { filename: viewPath });
  res.send(html);
}

export function createRecipesRouter(db: Database) {
  const router = express.Router();

  router.get(
    "/recipes",
    wrap(async (req, res) => {
      const recipes = await listRecipes(db);
      res.render("recipes_index", {
        recipes,
      });
    })
  );

  router.get(
    "/recipes/import-bpacks",
    wrap(async (req, res) => {
      res.render("recipes_import_bpacks", { error: null });
    })
  );

  router.post(
    "/recipes/import-bpacks",
    upload.single("bpacks_file"),
    wrap(async (req, res) => {
      if (!req.file) {
        return res.status(400).render("recipes_import_bpacks", {
          error: "Please choose a CSV file.",
        });
      }
      const text = req.file.buffer.toString("utf8");
      let parsed;
      try {
        parsed = parseBpacksMatrix(text);
      } catch (err) {
        return res.status(400).render("recipes_import_bpacks", {
          error: "Could not parse CSV. Please check the file format.",
        });
      }

      const recipes = parsed.recipes.map((r) => ({
        name: r.name,
        norm: r.norm,
        columnIndex: r.columnIndex,
      }));

      const componentsByRecipe = new Map<string, number>();
      parsed.components.forEach((component) => {
        Object.keys(component.values).forEach((norm) => {
          componentsByRecipe.set(norm, (componentsByRecipe.get(norm) ?? 0) + 1);
        });
      });

      const payloadJson = JSON.stringify({
        recipes,
        components: parsed.components,
      });

      renderEjs(res, "recipes_import_bpacks_preview", {
        filename: req.file.originalname,
        delimiter: parsed.delimiter === "\t" ? "TSV (tab)" : "CSV (comma)",
        recipes,
        componentCounts: recipes.map((r) => ({
          name: r.name,
          count: componentsByRecipe.get(r.norm) ?? 0,
        })),
        warnings: parsed.warnings,
        payloadJson,
      });
    })
  );

  router.post(
    "/recipes/import-bpacks/confirm",
    wrap(async (req, res) => {
      const payloadRaw = String(req.body.payload_json || "");
      if (!payloadRaw) {
        return res.status(400).send("Missing import payload.");
      }
      let payload: {
        recipes: BpacksRecipeColumn[];
        components: BpacksComponentRow[];
      };
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        return res.status(400).send("Invalid import payload.");
      }

      const existingRecipes = await getAllRecipes(db);
      const existingByName = new Map(existingRecipes.map((r) => [r.name, r.id]));

      let created = 0;
      let updated = 0;
      let componentsInserted = 0;

      await withTransaction(db, async () => {
        for (const recipe of payload.recipes) {
          const existingId = existingByName.get(recipe.name);
          let recipeId: number;
          if (existingId) {
            recipeId = existingId;
            updated += 1;
          } else {
            const result = await insertRecipe(
              db,
              recipe.name,
              "Imported from BPACKs CSV"
            );
            recipeId = result.lastID as number;
            created += 1;
          }

          await deleteRecipeComponents(db, recipeId);

          const components: RecipeComponentInput[] = [];
          payload.components.forEach((component) => {
            const value = component.values[recipe.norm];
            if (value === null || value === undefined) return;
            const is_locked = normalizeComponent(component.name)
              .toLowerCase()
              .includes("starch")
              ? 1
              : 0;
            components.push({
              name: component.name,
              mode: "static",
              parts_static: value,
              parts_min: null,
              parts_max: null,
              is_locked,
            });
          });

          componentsInserted += components.length;
          await buildRecipeComponentsFromImport(components, recipeId, db);
        }
      });

      renderEjs(res, "recipes_import_bpacks_result", {
        created,
        updated,
        componentsInserted,
      });
    })
  );

  router.post(
    "/recipes",
    wrap(async (req, res) => {
      const name = String(req.body.name || "").trim();
      const description = String(req.body.description || "").trim();
      const components = normalizeComponents(req.body.components);

      if (!name || components.length === 0) {
        return res.status(400).send("Invalid recipe inputs");
      }

      await withTransaction(db, async () => {
        const expResult = await insertRecipe(db, name, description);
        const recipeId = expResult.lastID as number;
        await saveRecipeComponents(db, recipeId, components);
      });

      res.redirect("/recipes");
    })
  );

  router.get(
    "/recipes/new",
    wrap(async (req, res) => {
      const components = defaultRecipeComponents();
      res.render("recipe_form", {
        recipe: null,
        components,
        imExperiments: [],
        action: "/recipes",
      });
    })
  );

  router.get(
    "/recipes/:id",
    wrap(async (req, res) => {
      const recipeId = Number(req.params.id);
      const recipe = await getRecipeById(db, recipeId);
      if (!recipe) return res.status(404).send("Recipe not found");

      const components = await getRecipeComponents(db, recipeId);
      const imExperiments = await getImExperimentsByRecipe(db, recipeId);

      res.render("recipe_form", {
        recipe,
        components: components.length ? components : defaultRecipeComponents(),
        imExperiments,
        action: `/recipes/${recipeId}`,
      });
    })
  );

  router.post(
    "/recipes/:id",
    wrap(async (req, res) => {
      const recipeId = Number(req.params.id);
      const name = String(req.body.name || "").trim();
      const description = String(req.body.description || "").trim();
      const components = normalizeComponents(req.body.components);

      if (!name || components.length === 0) {
        return res.status(400).send("Invalid recipe inputs");
      }

      await withTransaction(db, async () => {
        await updateRecipe(db, recipeId, name, description);
        await deleteRecipeComponents(db, recipeId);
        await saveRecipeComponents(db, recipeId, components);
      });

      res.redirect("/recipes");
    })
  );

  router.post(
    "/recipes/:id/delete",
    wrap(async (req, res) => {
      const recipeId = Number(req.params.id);
      const inUse = await getRecipeUsageCount(db, recipeId);
      if (inUse && inUse.count > 0) {
        return res.status(400).send("Recipe is used in experiments");
      }

      await withTransaction(db, async () => {
        await deleteRecipeComponents(db, recipeId);
        await deleteRecipe(db, recipeId);
      });

      res.redirect("/recipes");
    })
  );

  return router;
}
