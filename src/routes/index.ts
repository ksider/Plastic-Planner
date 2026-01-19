import express from "express";
import type { Database } from "sqlite";
import { wrap } from "../lib/http.js";

export function createIndexRouter(db: Database) {
  const router = express.Router();

  router.get(
    "/",
    wrap(async (_req, res) => {
      const [
        compoundingCount,
        tpsCount,
        imCount,
        extrusionCount,
      ] = await Promise.all([
        db.get("SELECT COUNT(*) as count FROM experiments"),
        db.get("SELECT COUNT(*) as count FROM tps_experiments"),
        db.get("SELECT COUNT(*) as count FROM im_experiments"),
        db.get("SELECT COUNT(*) as count FROM extrusion_experiments"),
      ]);

      res.render("home/index", {
        counts: {
          compounding: compoundingCount?.count ?? 0,
          tps: tpsCount?.count ?? 0,
          im: imCount?.count ?? 0,
          extrusion: extrusionCount?.count ?? 0,
        },
      });
    })
  );

  return router;
}

