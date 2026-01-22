import express from "express";
import path from "path";
import { openDb } from "./db.js";
import { ensureSeedParams } from "./services/seed.js";
import { createHomeRouter } from "./routes/home.js";
import { createRecipesRouter } from "./routes/recipes.js";
import { createExperimentsRouter } from "./routes/experiments.js";
import { createRunsRouter } from "./routes/runs.js";

const app = express();
const db = openDb();
ensureSeedParams(db);

app.locals.formatNumber = (value: unknown, maxDecimals = 3) => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return "-";
  const factor = Math.pow(10, maxDecimals);
  const rounded = Math.round(num * factor) / factor;
  const fixed = rounded.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, "");
};

const viewsPath = path.resolve(process.cwd(), "src", "views");
const publicPath = path.resolve(process.cwd(), "src", "public");

app.set("view engine", "ejs");
app.set("views", viewsPath);

app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicPath));
app.use("/vendor", express.static(path.resolve(process.cwd(), "node_modules")));

app.use(createHomeRouter(db));
app.use(createRecipesRouter(db));
app.use(createExperimentsRouter(db));
app.use(createRunsRouter(db));

app.use((_req, res) => {
  res.status(404).send("Not found");
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`IM-DOE Planner running on http://localhost:${PORT}`);
});
