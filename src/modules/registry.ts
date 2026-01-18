import type { Router } from "express";
import type { Database } from "sqlite";
import { createIndexRouter } from "../routes/index.js";
import { createRecipesRouter } from "../routes/recipes.js";
import { createImRouter } from "../routes/im.js";
import { createTpsRouter } from "../routes/tps.js";
import { createExtrusionRouter } from "../routes/extrusion.js";
import { createExperimentsRouter } from "../routes/experiments.js";

export type ModuleDefinition = {
  name: string;
  mount: string;
  createRouter: (db: Database) => Router;
};

export const modules: ModuleDefinition[] = [
  { name: "index", mount: "/", createRouter: createIndexRouter },
  { name: "recipes", mount: "/", createRouter: createRecipesRouter },
  { name: "tps", mount: "/", createRouter: createTpsRouter },
  { name: "im", mount: "/", createRouter: createImRouter },
  { name: "extrusion", mount: "/", createRouter: createExtrusionRouter },
  { name: "experiments", mount: "/", createRouter: createExperimentsRouter },
];
