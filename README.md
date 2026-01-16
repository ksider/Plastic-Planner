# DOE Planning App (Local)

Minimal local web app for polymer compounding + molding DOE planning, data capture, and summaries.

## Requirements
- Node.js 20+ (tested on Node 24)

## Install + Run
```bash
npm install
npm run dev
```
Open `http://localhost:3000`.

## What you can do
- Create/edit recipes in a table (static or min/max parts per component)
- Create experiments and auto-generate Table A (compounding)
- Include head temperature variations for compounding runs
- Generate Table B (molding plan) from Table A
- Inline data entry for batch + sample fields
- Copy tables as TSV for Excel/Google Sheets
- Download CSV exports for Table A, Table B, and merged A+B
- View simple analysis summaries
- Decision-support analysis with quality checks, insights, and D3 visuals (Analysis tab)
- Add custom sample fields in Table B (number, text, tags) and toggle numeric fields for analysis
- Plan injection molding experiments with IM runs, scientific molding parameters, and run detail pages
- Plan TPS lab mixer experiments with custom process settings, run matrix, and output analysis

## Import from BPACKs CSV
Use `Recipes → Import from BPACKs CSV` to load a spreadsheet-style CSV with two header rows. The importer detects recipe PHR columns where row 0 has a recipe name and row 1 equals `phr`, then replaces each recipe’s component list with the imported values.

Demo parser output (prints column index + recipe name):
```bash
npm run bpacks:demo
```

## Notes
- SQLite database is stored locally as `doe.sqlite` in this folder.
- Two preset recipes (PS_min, PS_max) are added on first run if DB is empty.
- If a recipe uses Min-Max components, generating an experiment uses two variants: `recipe_min` and `recipe_max`.
- Molding generation will regenerate Table B (clears previous samples for that experiment).

## Key Routes
- `/` experiments list
- `/recipes` recipe builder
- `/experiments/new` create new experiment
- `/experiments/:id` data entry + analysis
- `/tps` TPS lab experiments
- `/tps/:id` TPS lab run matrix + analysis

## Architecture (overview)
- `src/app.ts` wires middleware, static assets, and routers. Routers are registered from `src/modules/registry.ts`.
- Routes (HTTP layer): `src/routes/*` handles request/response and delegates non-trivial logic to services.
- Services (business logic): `src/services/*` owns orchestration, validation, transactions, and multi-step workflows.
- Repos (data access): `src/repos/*` is the only place that should talk to SQLite.
- Domain helpers: `src/domain/*` holds parsing, normalization, and analysis helpers.
- Errors: `src/lib/errors.ts` defines `AppError` + middleware so routes can `throw` instead of `res.status(...).send(...)`.

## Adding a new experiment type (checklist)
1) Data model
   - Define tables/columns in `src/db.ts` (and any migration style ALTERs).
   - Keep schema changes isolated here so boot-time init can upgrade existing DBs.
2) Domain helpers
   - Add parsing/validation helpers in `src/domain/<new_type>.ts`.
   - Add analysis helpers if the UI needs derived summaries.
3) Repo layer
   - Add data access functions in `src/repos/<new_type>_repo.ts`.
   - Keep SQL local to the repo and return plain objects.
4) Service layer
   - Add `src/services/<new_type>_service.ts` for create/generate/update flows.
   - Use `withTransaction` for multi-step writes.
   - Throw `AppError` for validation or not-found cases.
5) Routes
   - Create `src/routes/<new_type>.ts` and wire endpoints to services.
   - Keep routes thin; no direct SQL.
6) Views + UI
   - Add pages in `src/views/*` for list/new/detail as needed.
   - Add a nav link in `src/views/partials/nav.ejs`.
7) Module registry
   - Register the router in `src/modules/registry.ts` so it mounts in the app.
8) Optional exports/imports
   - If you need CSV or bulk import, put parsing in `src/domain/*` and file IO in routes/services.

## Example module skeleton
```ts
// src/routes/foaming.ts
import express from "express";
import type { Database } from "sqlite";
import { wrap } from "../lib/http.js";
import { createFoamingExperiment } from "../services/foaming_service.js";

export function createFoamingRouter(db: Database) {
  const router = express.Router();
  router.get("/foaming/new", wrap(async (_req, res) => {
    res.render("foaming_new");
  }));
  router.post("/foaming", wrap(async (req, res) => {
    const id = await createFoamingExperiment(db, req.body);
    res.redirect(`/foaming/${id}`);
  }));
  return router;
}
```
