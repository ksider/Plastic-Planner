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
    CREATE TABLE IF NOT EXISTS analysis_fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope_type TEXT NOT NULL,
      scope_id INTEGER,
      code TEXT NOT NULL,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL,
      unit TEXT,
      group_label TEXT,
      allowed_values_json TEXT,
      is_standard INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(scope_type, scope_id, code)
    );
    CREATE TABLE IF NOT EXISTS analysis_run_values (
      run_id INTEGER NOT NULL,
      field_id INTEGER NOT NULL,
      value_real REAL,
      value_text TEXT,
      value_tags_json TEXT,
      PRIMARY KEY (run_id, field_id),
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (field_id) REFERENCES analysis_fields(id) ON DELETE CASCADE
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

  if (!hasColumn(db, "analysis_fields", "is_standard")) {
    db.exec("ALTER TABLE analysis_fields ADD COLUMN is_standard INTEGER NOT NULL DEFAULT 0");
  }
  if (!hasColumn(db, "analysis_fields", "is_active")) {
    db.exec("ALTER TABLE analysis_fields ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0");
  }

  const standardFields: Array<{
    code: string;
    label: string;
    field_type: string;
    unit: string | null;
    group_label: string;
    allowed_values_json: string | null;
  }> = [
    { code: "part_weight_g", label: "Part weight", field_type: "number", unit: "g", group_label: "Core quality", allowed_values_json: null },
    { code: "density_g_cm3", label: "Density", field_type: "number", unit: "g/cm3", group_label: "Core quality", allowed_values_json: null },
    { code: "critical_dim_mm", label: "Critical dimension", field_type: "number", unit: "mm", group_label: "Core quality", allowed_values_json: null },
    { code: "shrinkage_pct", label: "Shrinkage", field_type: "number", unit: "%", group_label: "Core quality", allowed_values_json: null },
    { code: "water_solubility_pct", label: "Water solubility", field_type: "number", unit: "%", group_label: "Water / bio properties", allowed_values_json: null },
    { code: "water_uptake_g_g", label: "Water uptake / swelling", field_type: "number", unit: "g/g", group_label: "Water / bio properties", allowed_values_json: null },
    { code: "flexural_strength_mpa", label: "Flexural strength", field_type: "number", unit: "MPa", group_label: "Mechanical", allowed_values_json: null },
    { code: "flexural_modulus_mpa", label: "Flexural modulus", field_type: "number", unit: "MPa", group_label: "Mechanical", allowed_values_json: null },
    { code: "impact_strength_kj_m2", label: "Impact strength", field_type: "number", unit: "kJ/m2", group_label: "Mechanical", allowed_values_json: null },
    { code: "tensile_strength_mpa", label: "Tensile strength", field_type: "number", unit: "MPa", group_label: "Mechanical", allowed_values_json: null },
    { code: "surface_roughness_ra_um", label: "Surface roughness Ra", field_type: "number", unit: "um", group_label: "Surface & demolding", allowed_values_json: null },
    { code: "demold_ok", label: "Demolding OK", field_type: "boolean", unit: null, group_label: "Surface & demolding", allowed_values_json: null },
    { code: "visual_score_1_5", label: "Visual score", field_type: "number", unit: "score_1_5", group_label: "Surface & demolding", allowed_values_json: null },
    { code: "fill_time_s", label: "Fill time", field_type: "number", unit: "s", group_label: "Process proxies", allowed_values_json: null },
    { code: "peak_injection_pressure_bar", label: "Peak injection pressure", field_type: "number", unit: "bar", group_label: "Process proxies", allowed_values_json: null },
    { code: "actual_cushion_mm", label: "Actual cushion", field_type: "number", unit: "mm", group_label: "Process proxies", allowed_values_json: null },
    { code: "cycle_time_s", label: "Cycle time", field_type: "number", unit: "s", group_label: "Process proxies", allowed_values_json: null },
    {
      code: "defects",
      label: "Defect tags",
      field_type: "tag",
      unit: null,
      group_label: "Defects",
      allowed_values_json: JSON.stringify([
        "short_shot",
        "flash",
        "sticking",
        "warpage",
        "bubbles",
        "burn_marks",
        "sink_marks",
        "brittle",
        "poor_surface",
        "demold_damage"
      ])
    }
  ];

  const existingStandard = new Set(
    db.prepare("SELECT code FROM analysis_fields WHERE scope_type = 'GLOBAL'").all()
      .map((row: { code: string }) => row.code)
  );
  const insertStandard = db.prepare(
    `INSERT INTO analysis_fields
     (scope_type, scope_id, code, label, field_type, unit, group_label, allowed_values_json, is_standard, is_active)
     VALUES ('GLOBAL', NULL, ?, ?, ?, ?, ?, ?, 1, 0)`
  );
  for (const field of standardFields) {
    if (existingStandard.has(field.code)) continue;
    insertStandard.run(
      field.code,
      field.label,
      field.field_type,
      field.unit,
      field.group_label,
      field.allowed_values_json
    );
  }

  const experimentFieldCount = db
    .prepare("SELECT COUNT(*) as count FROM analysis_fields WHERE scope_type = 'EXPERIMENT'")
    .get() as { count: number };
  if (experimentFieldCount.count === 0) {
    const experiments = db.prepare("SELECT id FROM experiments").all() as Array<{ id: number }>;
    const outputParams = db
      .prepare("SELECT code, label, field_type, unit, group_label, allowed_values_json FROM param_definitions WHERE field_kind = 'OUTPUT'")
      .all() as Array<{
        code: string;
        label: string;
        field_type: string;
        unit: string | null;
        group_label: string | null;
        allowed_values_json: string | null;
      }>;
    const insertExperimentField = db.prepare(
      `INSERT INTO analysis_fields
       (scope_type, scope_id, code, label, field_type, unit, group_label, allowed_values_json, is_standard, is_active)
       VALUES ('EXPERIMENT', ?, ?, ?, ?, ?, ?, ?, 0, 1)`
    );
    for (const experiment of experiments) {
      for (const output of outputParams) {
        insertExperimentField.run(
          experiment.id,
          output.code,
          output.label,
          output.field_type,
          output.unit,
          output.group_label,
          output.allowed_values_json
        );
      }
    }

    const experimentFieldRows = db
      .prepare("SELECT id, scope_id, code, field_type FROM analysis_fields WHERE scope_type = 'EXPERIMENT'")
      .all() as Array<{ id: number; scope_id: number; code: string; field_type: string }>;
    const fieldMap = new Map(
      experimentFieldRows.map((row) => [`${row.scope_id}:${row.code}`, row])
    );
    const outputValues = db
      .prepare(
        `SELECT r.id as run_id, r.experiment_id, p.code, rv.value_real, rv.value_text, rv.value_tags_json
         FROM run_values rv
         JOIN runs r ON r.id = rv.run_id
         JOIN param_definitions p ON p.id = rv.param_def_id
         WHERE p.field_kind = 'OUTPUT'`
      )
      .all() as Array<{
        run_id: number;
        experiment_id: number;
        code: string;
        value_real: number | null;
        value_text: string | null;
        value_tags_json: string | null;
      }>;
    const insertAnalysisValue = db.prepare(
      `INSERT OR REPLACE INTO analysis_run_values
       (run_id, field_id, value_real, value_text, value_tags_json)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const row of outputValues) {
      const field = fieldMap.get(`${row.experiment_id}:${row.code}`);
      if (!field) continue;
      insertAnalysisValue.run(
        row.run_id,
        field.id,
        row.value_real,
        row.value_text,
        row.value_tags_json
      );
    }
  }
}
