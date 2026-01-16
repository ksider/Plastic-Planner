import express from "express";
import type { Database } from "sqlite";
import { wrap } from "../lib/http.js";

export function createIndexRouter(db: Database) {
  const router = express.Router();

  router.get(
    "/",
    wrap(async (req, res) => {
      const experiments = await db.all(
        "SELECT id, name, final_mass_g, seed, created_at FROM experiments ORDER BY created_at DESC"
      );
      res.render("index", { experiments });
    })
  );

  return router;
}
