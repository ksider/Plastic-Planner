import express from "express";
import path from "path";
import ejs from "ejs";
import { dbReady } from "./db.js";
import { modules } from "./modules/registry.js";
import { errorHandler, notFoundHandler } from "./lib/errors.js";

export async function createApp() {
  const app = express();
  const db = await dbReady;

  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "src", "views"));
  app.engine("ejs", ejs.renderFile);

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use("/public", express.static(path.join(process.cwd(), "src", "public")));

  modules.forEach((mod) => {
    app.use(mod.mount, mod.createRouter(db));
  });
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
