import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.resolve(process.cwd(), "im_doe.sqlite");

export type Db = Database.Database;

export function openDb(): Db {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  initDb(db);
  return db;
}

function hasColumn(db: Db, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function initDb(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recipe_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL,
      component_name TEXT NOT NULL,
      phr REAL NOT NULL,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      design_type TEXT NOT NULL,
      seed INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      notes TEXT,
      center_points INTEGER DEFAULT 3,
      max_runs INTEGER DEFAULT 200,
      replicate_count INTEGER DEFAULT 1,
      recipe_as_block INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS experiment_recipes (
      experiment_id INTEGER NOT NULL,
      recipe_id INTEGER NOT NULL,
      PRIMARY KEY (experiment_id, recipe_id),
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS param_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      experiment_id INTEGER,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      unit TEXT,
      field_kind TEXT NOT NULL,
      field_type TEXT NOT NULL,
      group_label TEXT,
      allowed_values_json TEXT,
      UNIQUE(scope, experiment_id, code),
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS param_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      param_def_id INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL,
      fixed_value_real REAL,
      range_min_real REAL,
      range_max_real REAL,
      list_json TEXT,
      level_count INTEGER,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
      FOREIGN KEY (param_def_id) REFERENCES param_definitions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      run_order INTEGER NOT NULL,
      run_code TEXT NOT NULL,
      recipe_id INTEGER,
      replicate_key TEXT,
      replicate_index INTEGER,
      done INTEGER NOT NULL DEFAULT 0,
      exclude_from_analysis INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS run_values (
      run_id INTEGER NOT NULL,
      param_def_id INTEGER NOT NULL,
      value_real REAL,
      value_text TEXT,
      value_tags_json TEXT,
      PRIMARY KEY (run_id, param_def_id),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (param_def_id) REFERENCES param_definitions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS design_metadata (
      experiment_id INTEGER PRIMARY KEY,
      json_blob TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
    );
  `);

  // Safe migrations for new columns.
  const experimentColumns = [
    ["center_points", "ALTER TABLE experiments ADD COLUMN center_points INTEGER DEFAULT 3"],
    ["max_runs", "ALTER TABLE experiments ADD COLUMN max_runs INTEGER DEFAULT 200"],
    ["replicate_count", "ALTER TABLE experiments ADD COLUMN replicate_count INTEGER DEFAULT 1"],
    ["recipe_as_block", "ALTER TABLE experiments ADD COLUMN recipe_as_block INTEGER DEFAULT 0"]
  ] as const;
  for (const [column, sql] of experimentColumns) {
    if (!hasColumn(db, "experiments", column)) {
      db.exec(sql);
    }
  }
}
