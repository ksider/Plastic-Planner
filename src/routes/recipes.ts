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
  buildStructureFromPairedComponents,
  defaultRecipeComponents,
  normalizeComponents,
  parseTagsJson,
  normalizeTagsInput,
  parseStructureDefinition,
  saveRecipeComponents,
} from "../domain/recipes.js";
import type { RecipeComponentInput } from "../types.js";
import {
  buildRecipeComponentsFromImport,
  deleteRecipe,
  deleteRecipeComponents,
  getAllRecipes,
  getImExperimentsByRecipe,
  getTpsExperimentsByRecipe,
  getCompoundingExperimentsByRecipe,
  getRecipeById,
  getRecipeComponents,
  getRecipeUsageCount,
  insertRecipe,
  listRecipes,
  listRecipeComponentsForRecipes,
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
      const recipeIds = recipes.map((r: any) => r.id);
      const components = await listRecipeComponentsForRecipes(db, recipeIds);
      const componentsByRecipe = new Map<number, any[]>();
      for (const row of components) {
        const list = componentsByRecipe.get(row.recipe_id) ?? [];
        list.push(row);
        componentsByRecipe.set(row.recipe_id, list);
      }
      const recipesWithComponents = recipes.map((r: any) => {
        const list = componentsByRecipe.get(r.id) ?? [];
        const sorted = [...list].sort(
          (a, b) => Number(a.position || 0) - Number(b.position || 0)
        );
        const starch = sorted.filter(
          (c) => Number(c.is_locked) === 1 || /starch/i.test(c.name)
        );
        const rest = sorted.filter(
          (c) => !starch.includes(c)
        );
        const baseList = [...starch, ...rest];
        const displayList = baseList
          .map((c) => {
            if (c.mode === "range" && c.parts_min !== null && c.parts_max !== null) {
              return { name: c.name, qty: `${c.parts_min}-${c.parts_max}` };
            }
            if (c.parts_static !== null && c.parts_static !== undefined) {
              return { name: c.name, qty: String(c.parts_static) };
            }
            return { name: c.name, qty: "" };
          });
        const tags = parseTagsJson(r.tags_json);
        return {
          ...r,
          tags,
          component_list: displayList,
          component_has_more: false,
        };
      });
      res.render("recipes_index", {
        recipes: recipesWithComponents,
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
              "Imported from BPACKs CSV",
              "standard",
              "[]",
              null
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
      const recipeType = String(req.body.recipe_type || "standard").trim();
      const tagsInput = String(req.body.tags || "").trim();
      const structureInput = String(req.body.structure_json || "").trim();
      const components = normalizeComponents(req.body.components);
      const tags = normalizeTagsInput(tagsInput);
      const structure =
        structureInput.length > 0 ? parseStructureDefinition(structureInput) : null;
      const pairedStructure =
        recipeType === "paired"
          ? buildStructureFromPairedComponents(components)
          : null;

      if (!name || components.length === 0) {
        return res.status(400).send("Invalid recipe inputs");
      }
      if (structureInput.length > 0 && !structure) {
        return res.status(400).send("Invalid structure JSON");
      }
      if (recipeType === "paired" && !pairedStructure) {
        return res.status(400).send("Paired recipe requires components like A/B");
      }
      if ((structure || pairedStructure) && !tags.includes("structure")) {
        tags.push("structure");
      }
      if (recipeType === "paired" && !tags.includes("paired")) {
        tags.push("paired");
      }

      await withTransaction(db, async () => {
        const expResult = await insertRecipe(
          db,
          name,
          description,
          recipeType,
          JSON.stringify(tags),
          recipeType === "paired"
            ? JSON.stringify(pairedStructure)
            : structureInput.length > 0
            ? structureInput
            : null
        );
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
        tpsExperiments: [],
        compExperiments: [],
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
      const tpsExperiments = await getTpsExperimentsByRecipe(db, recipeId);
      const compExperiments = await getCompoundingExperimentsByRecipe(
        db,
        recipeId
      );

      res.render("recipe_form", {
        recipe,
        components: components.length ? components : defaultRecipeComponents(),
        imExperiments,
        tpsExperiments,
        compExperiments,
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
      const recipeType = String(req.body.recipe_type || "standard").trim();
      const tagsInput = String(req.body.tags || "").trim();
      const structureInput = String(req.body.structure_json || "").trim();
      const components = normalizeComponents(req.body.components);
      const tags = normalizeTagsInput(tagsInput);
      const structure =
        structureInput.length > 0 ? parseStructureDefinition(structureInput) : null;
      const pairedStructure =
        recipeType === "paired"
          ? buildStructureFromPairedComponents(components)
          : null;

      if (!name || components.length === 0) {
        return res.status(400).send("Invalid recipe inputs");
      }
      if (structureInput.length > 0 && !structure) {
        return res.status(400).send("Invalid structure JSON");
      }
      if (recipeType === "paired" && !pairedStructure) {
        return res.status(400).send("Paired recipe requires components like A/B");
      }
      if ((structure || pairedStructure) && !tags.includes("structure")) {
        tags.push("structure");
      }
      if (recipeType === "paired" && !tags.includes("paired")) {
        tags.push("paired");
      }

      await withTransaction(db, async () => {
        await updateRecipe(
          db,
          recipeId,
          name,
          description,
          recipeType,
          JSON.stringify(tags),
          recipeType === "paired"
            ? JSON.stringify(pairedStructure)
            : structureInput.length > 0
            ? structureInput
            : null
        );
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
