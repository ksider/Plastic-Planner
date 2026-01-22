import express from "express";
import type { Db } from "../db.js";
import { listExperiments } from "../repos/experiments_repo.js";

export function createHomeRouter(db: Db) {
  const router = express.Router();

  router.get("/", (_req, res) => {
    const experiments = listExperiments(db);
    res.render("home", { experiments });
  });

  return router;
}
