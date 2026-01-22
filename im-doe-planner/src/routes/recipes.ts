import express from "express";
import multer from "multer";
import type { Db } from "../db.js";
import { listRecipes, getRecipeComponents, deleteAllRecipes } from "../repos/recipes_repo.js";
import { importRecipesFromText } from "../services/recipes_service.js";

const upload = multer({ storage: multer.memoryStorage() });

export function createRecipesRouter(db: Db) {
  const router = express.Router();

  router.get("/recipes", (_req, res) => {
    const importedCount = _req.query.imported ? Number(_req.query.imported) : null;
    const error = _req.query.error ? String(_req.query.error) : null;
    const recipes = listRecipes(db).map((recipe) => ({
      ...recipe,
      components: getRecipeComponents(db, recipe.id)
    }));
    res.render("recipes", {
      recipes,
      importedCount: Number.isFinite(importedCount) ? importedCount : null,
      error
    });
  });

  router.post("/recipes/import", upload.single("matrix"), (req, res) => {
    const file = req.file;
    if (!file) {
      return res.redirect("/recipes?error=No%20file%20uploaded.");
    }
    const text = file.buffer.toString("utf8");
    const count = importRecipesFromText(db, text);
    return res.redirect(`/recipes?imported=${count}`);
  });

  router.post("/recipes/clear", (_req, res) => {
    deleteAllRecipes(db);
    res.redirect("/recipes");
  });

  return router;
}
