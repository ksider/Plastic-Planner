import type { Db } from "../db.js";

export type Experiment = {
  id: number;
  name: string;
  design_type: string;
  seed: number;
  created_at: string;
  notes: string | null;
  center_points: number;
  max_runs: number;
  replicate_count: number;
  recipe_as_block: number;
};

export function listExperiments(db: Db): Experiment[] {
  return db.prepare("SELECT * FROM experiments ORDER BY id DESC").all() as Experiment[];
}

export function getExperiment(db: Db, id: number): Experiment | undefined {
  return db.prepare("SELECT * FROM experiments WHERE id = ?").get(id) as Experiment | undefined;
}

export function deleteExperiment(db: Db, id: number) {
  db.prepare("DELETE FROM experiments WHERE id = ?").run(id);
}

export function createExperiment(
  db: Db,
  data: Omit<Experiment, "id" | "created_at">
): number {
  const createdAt = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO experiments
        (name, design_type, seed, created_at, notes, center_points, max_runs, replicate_count, recipe_as_block)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.name,
      data.design_type,
      data.seed,
      createdAt,
      data.notes ?? null,
      data.center_points ?? 3,
      data.max_runs ?? 200,
      data.replicate_count ?? 1,
      data.recipe_as_block ?? 0
    );
  return Number(result.lastInsertRowid);
}

export function setExperimentRecipes(db: Db, experimentId: number, recipeIds: number[]) {
  const del = db.prepare("DELETE FROM experiment_recipes WHERE experiment_id = ?");
  const insert = db.prepare(
    "INSERT INTO experiment_recipes (experiment_id, recipe_id) VALUES (?, ?)"
  );
  const tx = db.transaction(() => {
    del.run(experimentId);
    for (const recipeId of recipeIds) {
      insert.run(experimentId, recipeId);
    }
  });
  tx();
}

export function getExperimentRecipes(db: Db, experimentId: number): number[] {
  const rows = db
    .prepare("SELECT recipe_id FROM experiment_recipes WHERE experiment_id = ?")
    .all(experimentId) as Array<{ recipe_id: number }>;
  return rows.map((row) => row.recipe_id);
}

export function upsertDesignMetadata(db: Db, experimentId: number, jsonBlob: string) {
  const existing = db
    .prepare("SELECT experiment_id FROM design_metadata WHERE experiment_id = ?")
    .get(experimentId) as { experiment_id: number } | undefined;
  if (existing) {
    db.prepare("UPDATE design_metadata SET json_blob = ? WHERE experiment_id = ?").run(
      jsonBlob,
      experimentId
    );
  } else {
    db.prepare("INSERT INTO design_metadata (experiment_id, json_blob) VALUES (?, ?)").run(
      experimentId,
      jsonBlob
    );
  }
}

export function getDesignMetadata(db: Db, experimentId: number): string | null {
  const row = db
    .prepare("SELECT json_blob FROM design_metadata WHERE experiment_id = ?")
    .get(experimentId) as { json_blob: string } | undefined;
  return row?.json_blob ?? null;
}
