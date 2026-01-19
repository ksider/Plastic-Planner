import sqlite3 from "sqlite3";
import { open, type Database } from "sqlite";

const dbPromise = open({
  filename: "doe.sqlite",
  driver: sqlite3.Database,
});

async function init(): Promise<Database> {
  const db = await dbPromise;

  await db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      recipe_type TEXT NOT NULL DEFAULT 'standard',
      tags_json TEXT NOT NULL DEFAULT '[]',
      structure_json TEXT,
      starch_parts REAL NOT NULL DEFAULT 100,
      citric_parts REAL NOT NULL,
      pers_parts REAL NOT NULL,
      esbo_parts REAL NOT NULL,
      water_parts REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      final_mass_g REAL NOT NULL,
      seed INTEGER NOT NULL,
      mold_temps_json TEXT NOT NULL,
      head_temps_json TEXT NOT NULL DEFAULT '[]',
      sample_fields_json TEXT NOT NULL DEFAULT '[]',
      analysis_metric_key TEXT NOT NULL DEFAULT 'solubles_pct',
      analysis_metric_keys_json TEXT NOT NULL DEFAULT '["solubles_pct"]',
      replicates_per_temp INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      recipe_id INTEGER NOT NULL,
      compound_order INTEGER NOT NULL,
      batch_code TEXT NOT NULL,
      starch_g REAL NOT NULL,
      citric_g REAL NOT NULL,
      pers_g REAL NOT NULL,
      esbo_g REAL NOT NULL,
      water_g REAL NOT NULL,
      total_g REAL NOT NULL,
      head_set REAL,
      head_actual REAL,
      moist_after_dry REAL,
      moist_before_mold REAL,
      notes_compound TEXT,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      batch_id INTEGER NOT NULL,
      mold_order INTEGER NOT NULL,
      mold_temp_c INTEGER NOT NULL,
      replicate INTEGER NOT NULL,
      sample_code TEXT NOT NULL,
      solubles_pct REAL,
      swelling_g_g REAL,
      density_g_cm3 REAL,
      notes_mold TEXT,
      extra_json TEXT,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id),
      FOREIGN KEY (batch_id) REFERENCES batches(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS recipe_components (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'static',
      parts_static REAL,
      parts_min REAL,
      parts_max REAL,
      position INTEGER NOT NULL DEFAULT 1,
      is_locked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS im_machine_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      barrel_zones_count INTEGER NOT NULL DEFAULT 5,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS im_param_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      unit TEXT,
      stage TEXT NOT NULL,
      group_label TEXT NOT NULL,
      min_default REAL,
      max_default REAL,
      options_json TEXT,
      is_output INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS im_experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      machine_profile_id INTEGER,
      seed INTEGER NOT NULL,
      default_material_moisture_pct REAL,
      default_material_density_g_cm3 REAL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (machine_profile_id) REFERENCES im_machine_profiles(id)
    );

    CREATE TABLE IF NOT EXISTS im_experiment_recipes (
      experiment_id INTEGER NOT NULL,
      recipe_id INTEGER NOT NULL,
      PRIMARY KEY (experiment_id, recipe_id),
      FOREIGN KEY (experiment_id) REFERENCES im_experiments(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    CREATE TABLE IF NOT EXISTS im_param_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      param_def_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'FIXED',
      fixed_value REAL,
      range_min REAL,
      range_max REAL,
      list_json TEXT,
      active INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (experiment_id) REFERENCES im_experiments(id),
      FOREIGN KEY (param_def_id) REFERENCES im_param_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS im_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      run_order INTEGER NOT NULL,
      run_code TEXT NOT NULL,
      recipe_id INTEGER,
      recipe_variant TEXT,
      mold_temp_c REAL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (experiment_id) REFERENCES im_experiments(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    CREATE TABLE IF NOT EXISTS im_run_param_values (
      run_id INTEGER NOT NULL,
      param_def_id INTEGER NOT NULL,
      value_real REAL,
      value_text TEXT,
      PRIMARY KEY (run_id, param_def_id),
      FOREIGN KEY (run_id) REFERENCES im_runs(id),
      FOREIGN KEY (param_def_id) REFERENCES im_param_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS im_run_material_props (
      run_id INTEGER PRIMARY KEY,
      moisture_pct REAL,
      density_g_cm3 REAL,
      FOREIGN KEY (run_id) REFERENCES im_runs(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tps_param_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      unit TEXT,
      min_default REAL,
      max_default REAL,
      is_default INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS tps_experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      seed INTEGER NOT NULL,
      notes TEXT,
      output_fields_json TEXT NOT NULL DEFAULT '[]',
      analysis_metric_keys_json TEXT NOT NULL DEFAULT '["moisture_absorption_pct","solubility_pct"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tps_experiment_recipes (
      experiment_id INTEGER NOT NULL,
      recipe_id INTEGER NOT NULL,
      PRIMARY KEY (experiment_id, recipe_id),
      FOREIGN KEY (experiment_id) REFERENCES tps_experiments(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    CREATE TABLE IF NOT EXISTS tps_param_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      param_def_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'FIXED',
      fixed_value REAL,
      range_min REAL,
      range_max REAL,
      list_json TEXT,
      active INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (experiment_id) REFERENCES tps_experiments(id),
      FOREIGN KEY (param_def_id) REFERENCES tps_param_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS tps_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      run_order INTEGER NOT NULL,
      run_code TEXT NOT NULL,
      recipe_id INTEGER,
      recipe_variant TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      outputs_json TEXT NOT NULL DEFAULT '{}',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (experiment_id) REFERENCES tps_experiments(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    CREATE TABLE IF NOT EXISTS tps_run_param_values (
      run_id INTEGER NOT NULL,
      param_def_id INTEGER NOT NULL,
      value_real REAL,
      PRIMARY KEY (run_id, param_def_id),
      FOREIGN KEY (run_id) REFERENCES tps_runs(id),
      FOREIGN KEY (param_def_id) REFERENCES tps_param_definitions(id)
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS extrusion_param_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      unit TEXT,
      min_default REAL,
      max_default REAL,
      is_default INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS extrusion_experiments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      seed INTEGER NOT NULL,
      notes TEXT,
      output_fields_json TEXT NOT NULL DEFAULT '[]',
      analysis_metric_keys_json TEXT NOT NULL DEFAULT '["shear_rate_s"]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS extrusion_experiment_recipes (
      experiment_id INTEGER NOT NULL,
      recipe_id INTEGER NOT NULL,
      PRIMARY KEY (experiment_id, recipe_id),
      FOREIGN KEY (experiment_id) REFERENCES extrusion_experiments(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    CREATE TABLE IF NOT EXISTS extrusion_param_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      param_def_id INTEGER NOT NULL,
      mode TEXT NOT NULL DEFAULT 'FIXED',
      fixed_value REAL,
      range_min REAL,
      range_max REAL,
      list_json TEXT,
      active INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (experiment_id) REFERENCES extrusion_experiments(id),
      FOREIGN KEY (param_def_id) REFERENCES extrusion_param_definitions(id)
    );

    CREATE TABLE IF NOT EXISTS extrusion_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      experiment_id INTEGER NOT NULL,
      run_order INTEGER NOT NULL,
      run_code TEXT NOT NULL,
      recipe_id INTEGER,
      recipe_variant TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      outputs_json TEXT NOT NULL DEFAULT '{}',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (experiment_id) REFERENCES extrusion_experiments(id),
      FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    );

    CREATE TABLE IF NOT EXISTS extrusion_run_param_values (
      run_id INTEGER NOT NULL,
      param_def_id INTEGER NOT NULL,
      value_real REAL,
      PRIMARY KEY (run_id, param_def_id),
      FOREIGN KEY (run_id) REFERENCES extrusion_runs(id),
      FOREIGN KEY (param_def_id) REFERENCES extrusion_param_definitions(id)
    );
  `);

  await db.exec(`
    DELETE FROM im_param_configs
    WHERE id NOT IN (
      SELECT MAX(id)
      FROM im_param_configs
      GROUP BY experiment_id, param_def_id
    );
  `);

  await db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS im_param_configs_unique ON im_param_configs (experiment_id, param_def_id)"
  );

  await db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS tps_param_configs_unique ON tps_param_configs (experiment_id, param_def_id)"
  );

  await db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS extrusion_param_configs_unique ON extrusion_param_configs (experiment_id, param_def_id)"
  );

  const batchColumns = await db.all<{ name: string }>(
    "PRAGMA table_info(batches)"
  );
  const batchColumnNames = new Set(batchColumns.map((c) => c.name));
  if (!batchColumnNames.has("weights_json")) {
    await db.exec("ALTER TABLE batches ADD COLUMN weights_json TEXT");
  }
  if (!batchColumnNames.has("parts_json")) {
    await db.exec("ALTER TABLE batches ADD COLUMN parts_json TEXT");
  }
  if (!batchColumnNames.has("recipe_variant")) {
    await db.exec("ALTER TABLE batches ADD COLUMN recipe_variant TEXT");
  }
  if (!batchColumnNames.has("done")) {
    await db.exec(
      "ALTER TABLE batches ADD COLUMN done INTEGER NOT NULL DEFAULT 0"
    );
  }

  const experimentColumns = await db.all<{ name: string }>(
    "PRAGMA table_info(experiments)"
  );
  const experimentColumnNames = new Set(experimentColumns.map((c) => c.name));
  if (!experimentColumnNames.has("head_temps_json")) {
    await db.exec(
      "ALTER TABLE experiments ADD COLUMN head_temps_json TEXT NOT NULL DEFAULT '[]'"
    );
  }
  if (!experimentColumnNames.has("sample_fields_json")) {
    await db.exec(
      "ALTER TABLE experiments ADD COLUMN sample_fields_json TEXT NOT NULL DEFAULT '[]'"
    );
  }
  if (!experimentColumnNames.has("analysis_metric_key")) {
    await db.exec(
      "ALTER TABLE experiments ADD COLUMN analysis_metric_key TEXT NOT NULL DEFAULT 'solubles_pct'"
    );
  }
  if (!experimentColumnNames.has("analysis_metric_keys_json")) {
    await db.exec(
      "ALTER TABLE experiments ADD COLUMN analysis_metric_keys_json TEXT NOT NULL DEFAULT '[\"solubles_pct\"]'"
    );
  }
  if (!experimentColumnNames.has("notes")) {
    await db.exec("ALTER TABLE experiments ADD COLUMN notes TEXT");
  }

  const sampleColumns = await db.all<{ name: string }>(
    "PRAGMA table_info(samples)"
  );
  const sampleColumnNames = new Set(sampleColumns.map((c) => c.name));
  if (!sampleColumnNames.has("extra_json")) {
    await db.exec("ALTER TABLE samples ADD COLUMN extra_json TEXT");
  }
  if (!sampleColumnNames.has("done")) {
    await db.exec(
      "ALTER TABLE samples ADD COLUMN done INTEGER NOT NULL DEFAULT 0"
    );
  }

  const imRunColumns = await db.all<{ name: string }>(
    "PRAGMA table_info(im_runs)"
  );
  if (imRunColumns.length > 0) {
    const imRunColumnNames = new Set(imRunColumns.map((c) => c.name));
    if (!imRunColumnNames.has("recipe_variant")) {
      await db.exec("ALTER TABLE im_runs ADD COLUMN recipe_variant TEXT");
    }
  }

  const tpsRunColumns = await db.all<{ name: string }>(
    "PRAGMA table_info(tps_runs)"
  );
  if (tpsRunColumns.length > 0) {
    const tpsRunColumnNames = new Set(tpsRunColumns.map((c) => c.name));
    if (!tpsRunColumnNames.has("recipe_variant")) {
      await db.exec("ALTER TABLE tps_runs ADD COLUMN recipe_variant TEXT");
    }
  }

  const tpsExperimentColumns = await db.all<{ name: string }>(
    "PRAGMA table_info(tps_experiments)"
  );
  const tpsExperimentColumnNames = new Set(
    tpsExperimentColumns.map((c) => c.name)
  );
  if (!tpsExperimentColumnNames.has("output_fields_json")) {
    await db.exec(
      "ALTER TABLE tps_experiments ADD COLUMN output_fields_json TEXT NOT NULL DEFAULT '[]'"
    );
  }
  if (!tpsExperimentColumnNames.has("analysis_metric_keys_json")) {
    await db.exec(
      "ALTER TABLE tps_experiments ADD COLUMN analysis_metric_keys_json TEXT NOT NULL DEFAULT '[\"moisture_absorption_pct\"]'"
    );
  }

  const tpsParamColumns = await db.all<{ name: string }>(
    "PRAGMA table_info(tps_param_definitions)"
  );
  const tpsParamColumnNames = new Set(tpsParamColumns.map((c) => c.name));
  if (!tpsParamColumnNames.has("is_default")) {
    await db.exec(
      "ALTER TABLE tps_param_definitions ADD COLUMN is_default INTEGER NOT NULL DEFAULT 1"
    );
  }

  const imParamColumns = await db.all<{ name: string }>(
    "PRAGMA table_info(im_param_definitions)"
  );
  if (imParamColumns.length > 0) {
    const imParamColumnNames = new Set(imParamColumns.map((c) => c.name));
    if (!imParamColumnNames.has("options_json")) {
      await db.exec("ALTER TABLE im_param_definitions ADD COLUMN options_json TEXT");
    }
  }

  const recipeColumns = await db.all<{ name: string }>(
    "PRAGMA table_info(recipes)"
  );
  const recipeColumnNames = new Set(recipeColumns.map((c) => c.name));
  if (!recipeColumnNames.has("tags_json")) {
    await db.exec("ALTER TABLE recipes ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!recipeColumnNames.has("structure_json")) {
    await db.exec("ALTER TABLE recipes ADD COLUMN structure_json TEXT");
  }
  if (!recipeColumnNames.has("recipe_type")) {
    await db.exec("ALTER TABLE recipes ADD COLUMN recipe_type TEXT NOT NULL DEFAULT 'standard'");
  }

  const recipeCount = (await db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM recipes"
  )) ?? { count: 0 };

  if (recipeCount.count === 0) {
    await db.run(
      `INSERT INTO recipes (name, description, starch_parts, citric_parts, pers_parts, esbo_parts, water_parts)
       VALUES (?, ?, 100, ?, ?, ?, ?)`,
      ["PS_min", "Preset min recipe", 10, 2, 1.5, 18]
    );

    await db.run(
      `INSERT INTO recipes (name, description, starch_parts, citric_parts, pers_parts, esbo_parts, water_parts)
       VALUES (?, ?, 100, ?, ?, ?, ?)`,
      ["PS_max", "Preset max recipe", 20, 6, 1.5, 18]
    );
  }

  const recipes = await db.all<{
    id: number;
    starch_parts: number;
    citric_parts: number;
    pers_parts: number;
    esbo_parts: number;
    water_parts: number;
  }>(
    "SELECT id, starch_parts, citric_parts, pers_parts, esbo_parts, water_parts FROM recipes"
  );

  for (const recipe of recipes) {
    const existing = await db.get<{ count: number }>(
      "SELECT COUNT(*) as count FROM recipe_components WHERE recipe_id = ?",
      [recipe.id]
    );
    if (existing && existing.count > 0) continue;

    const rows = [
      {
        name: "Corn starch (fg)",
        mode: "static",
        parts_static: 100,
        parts_min: null,
        parts_max: null,
        position: 1,
        is_locked: 1,
      },
      {
        name: "Citric Acid",
        mode: "static",
        parts_static: recipe.citric_parts ?? 0,
        parts_min: null,
        parts_max: null,
        position: 2,
        is_locked: 0,
      },
      {
        name: "Sod. Persulfate",
        mode: "static",
        parts_static: recipe.pers_parts ?? 0,
        parts_min: null,
        parts_max: null,
        position: 3,
        is_locked: 0,
      },
      {
        name: "ESBO",
        mode: "static",
        parts_static: recipe.esbo_parts ?? 0,
        parts_min: null,
        parts_max: null,
        position: 4,
        is_locked: 0,
      },
      {
        name: "Water",
        mode: "static",
        parts_static: recipe.water_parts ?? 0,
        parts_min: null,
        parts_max: null,
        position: 5,
        is_locked: 0,
      },
    ];

    for (const row of rows) {
      await db.run(
        `INSERT INTO recipe_components
          (recipe_id, name, mode, parts_static, parts_min, parts_max, position, is_locked)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          recipe.id,
          row.name,
          row.mode,
          row.parts_static,
          row.parts_min,
          row.parts_max,
          row.position,
          row.is_locked,
        ]
      );
    }
  }

  const profileCount = (await db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM im_machine_profiles"
  )) ?? { count: 0 };
  if (profileCount.count === 0) {
    await db.run(
      "INSERT INTO im_machine_profiles (name, barrel_zones_count, notes) VALUES (?, ?, ?)",
      ["Default profile", 5, "Default 5-zone barrel"]
    );
  }

  const paramCount = (await db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM im_param_definitions"
  )) ?? { count: 0 };
  const params: Array<
    [
      string,
      string,
      string,
      string,
      string,
      number | null,
      number | null,
      string | null
    ]
  > = [
      // Mold / Thermal
      ["mold_temp", "Mold temperature", "°C", "COOL_EJECT", "Mold", 60, 120, null],
      ["cooling_time", "Cooling time", "s", "COOL_EJECT", "Mold", 15, 15, null],
      ["nozzle_temp", "Nozzle temperature", "°C", "PLASTICATION", "Barrel temps", 120, 120, null],
      ["barrel_zone1_temp", "Barrel zone 1 temp", "°C", "PLASTICATION", "Barrel temps", 100, 100, null],
      ["barrel_zone2_temp", "Barrel zone 2 temp", "°C", "PLASTICATION", "Barrel temps", 80, 80, null],
      ["barrel_zone3_temp", "Barrel zone 3 temp", "°C", "PLASTICATION", "Barrel temps", 80, 80, null],
      ["barrel_zone4_temp", "Barrel zone 4 temp", "°C", "PLASTICATION", "Barrel temps", 80, 80, null],
      ["barrel_zone5_temp", "Barrel zone 5 temp", "°C", "PLASTICATION", "Barrel temps", 80, 80, null],
      // Fill
      ["inj_speed_1", "Injection speed (stage 1)", "mm/s", "FILL", "Injection", 40, 40, null],
      ["inj_press_limit", "Injection pressure limit", "bar", "FILL", "Injection", 1200, 1200, null],
      ["v_to_p_transfer_pos", "V->P transfer position", "mm", "FILL", "Injection", 8, 18],
      ["shot_size", "Shot size", "mm", "FILL", "Injection", 18, 28],
      ["cushion_target", "Cushion target", "mm", "PACK_HOLD", "Pack/Hold", 2, 3, null],
      // Pack / Hold
      ["pack_press", "Pack pressure", "bar", "PACK_HOLD", "Pack/Hold", 400, 400, null],
      ["pack_time", "Pack time", "s", "PACK_HOLD", "Pack/Hold", 2, 2, null],
      ["hold_press", "Hold pressure", "bar", "PACK_HOLD", "Pack/Hold", 300, 300, null],
      ["hold_time", "Hold time", "s", "PACK_HOLD", "Pack/Hold", 4, 4, null],
      // Plastication / Screw
      ["screw_rpm", "Screw rotation speed", "rpm", "PLASTICATION", "Screw", 80, 80, null],
      ["back_pressure", "Back pressure", "bar", "PLASTICATION", "Screw", 50, 50, null],
      ["decompression", "Decompression", "mm", "PLASTICATION", "Screw", 2, 2, null],
      ["screw_recovery_time", "Screw recovery time", "s", "PLASTICATION", "Screw", null, null, null],
      // Machine
      ["clamp_tonnage", "Clamp tonnage", "ton", "MACHINE", "Machine", 110, 110, null],
      ["screw_diameter", "Screw diameter", "mm", "MACHINE", "Machine", 30, 30, null],
      ["max_shot_volume", "Max shot volume", "cm3", "MACHINE", "Machine", 110, 110, null],
      ["max_injection_pressure", "Max injection pressure", "bar", "MACHINE", "Machine", 2000, 2000, null],
      // Material
      ["material_moisture_pct", "Material moisture", "%", "MATERIAL", "Material", 0.3, 1.2, null],
      ["material_density_g_cm3", "Material density", "g/cm3", "MATERIAL", "Material", 1.1, 1.3, null],
      // Outputs
      ["melt_temp", "Melt temperature", "°C", "PLASTICATION", "Outputs", null, null, null],
      ["fill_time", "Fill time", "s", "FILL", "Outputs", null, null, null],
      ["cycle_time", "Cycle time", "s", "COOL_EJECT", "Outputs", null, null, null],
      ["peak_inj_pressure", "Peak injection pressure", "bar", "FILL", "Outputs", null, null, null],
      ["cushion", "Cushion actual", "mm", "PACK_HOLD", "Outputs", null, null, null],
      ["part_weight", "Part weight", "g", "COOL_EJECT", "Outputs", null, null, null],
      ["wall_thickness", "Wall thickness", "mm", "COOL_EJECT", "Outputs", null, null, null],
      ["eject_temp", "Part temp after ejection", "°C", "COOL_EJECT", "Outputs", null, null, null],
      ["shots_per_run", "Shots per run", "", "COOL_EJECT", "Outputs", null, null, null],
      ["shots_ok", "Good shots", "", "COOL_EJECT", "Outputs", null, null, null],
      ["shots_scrap", "Scrap shots", "", "COOL_EJECT", "Outputs", null, null, null],
      [
        "defect_tags",
        "Defect tags",
        "",
        "COOL_EJECT",
        "Outputs",
        null,
        null,
        JSON.stringify([
          "sticking / demolding issues",
          "flash",
          "short shot",
          "overheating / burn marks",
          "bubbles / foaming",
          "warpage",
          "sink marks",
          "brittle fracture",
        ]),
      ],
      ["output_notes", "Output notes", "", "COOL_EJECT", "Outputs", null, null, null],
    ];
  if (paramCount.count === 0) {
    for (const p of params) {
      const isOutput = p[4] === "Outputs" ? 1 : 0;
      await db.run(
        `INSERT INTO im_param_definitions
         (code, label, unit, stage, group_label, min_default, max_default, options_json, is_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], isOutput]
      );
    }
  } else {
    for (const p of params) {
      const existing = await db.get(
        "SELECT id FROM im_param_definitions WHERE code = ?",
        [p[0]]
      );
      if (existing) continue;
      const isOutput = p[4] === "Outputs" ? 1 : 0;
      await db.run(
        `INSERT INTO im_param_definitions
         (code, label, unit, stage, group_label, min_default, max_default, options_json, is_output)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], isOutput]
      );
    }

    for (const p of params) {
      if (p[5] === null && p[6] === null) continue;
      await db.run(
        `UPDATE im_param_definitions
         SET min_default = COALESCE(?, min_default),
             max_default = COALESCE(?, max_default)
         WHERE code = ?`,
        [p[5], p[6], p[0]]
      );
    }

    for (const p of params) {
      if (!p[7]) continue;
      await db.run(
        `UPDATE im_param_definitions
         SET options_json = COALESCE(options_json, ?),
             label = ?
         WHERE code = ?`,
        [p[7], p[1], p[0]]
      );
    }
  }

  const tpsParamCount = (await db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM tps_param_definitions"
  )) ?? { count: 0 };

  const tpsParams: Array<
    [string, string, string, number | null, number | null, number]
  > = [
      ["heating_temp_c", "Heating temperature", "°C", 120, 160, 1],
      ["gelation_time_min", "Gelation time", "min", 5, 15, 1],
      ["post_add_time_min", "Post-add time", "min", 3, 10, 1],
      ["mix_speed_level", "Mixing speed (1-3)", "level", 1, 3, 1],
    ];

  if (tpsParamCount.count === 0) {
    for (const p of tpsParams) {
      await db.run(
        `INSERT INTO tps_param_definitions
         (code, label, unit, min_default, max_default, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [p[0], p[1], p[2], p[3], p[4], p[5]]
      );
    }
  } else {
    for (const p of tpsParams) {
      const existing = await db.get(
        "SELECT id FROM tps_param_definitions WHERE code = ?",
        [p[0]]
      );
      if (existing) continue;
      await db.run(
        `INSERT INTO tps_param_definitions
         (code, label, unit, min_default, max_default, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [p[0], p[1], p[2], p[3], p[4], p[5]]
      );
    }
  }

  const extrusionParamCount = (await db.get<{ count: number }>(
    "SELECT COUNT(*) as count FROM extrusion_param_definitions"
  )) ?? { count: 0 };

  const extrusionParams: Array<
    [string, string, string, number | null, number | null, number]
  > = [
      ["pellet_weight_g", "Pellet weight", "g", 5, 10, 1],
      ["pellet_moisture_pct", "Pellet moisture", "%", 0.5, 2, 1],
      ["cylinder_temp_c", "Cylinder temperature", "°C", 160, 200, 1],
      ["pressure_bar", "Hydraulic pressure", "bar", 4, 6, 1],
      ["hold_time_s", "Hold time", "s", 30, 120, 1],
      ["piston_diameter_mm", "Piston diameter", "mm", 35, 35, 1],
      ["nozzle_diameter_mm", "Nozzle diameter", "mm", 5, 5, 1],
      ["nozzle_length_mm", "Nozzle length (hot)", "mm", 5, 5, 1],
      ["cold_capillary_diameter_mm", "Cold capillary diameter", "mm", 8, 8, 1],
      ["cold_capillary_length_mm", "Cold capillary length", "mm", 19.5, 19.5, 1],
      ["wheel_diameter_mm", "Wheel diameter", "mm", 33, 33, 1],
      ["pressure_coeff_kp", "Pressure coefficient kP", "", 1, 1, 1],
    ];

  if (extrusionParamCount.count === 0) {
    for (const p of extrusionParams) {
      await db.run(
        `INSERT INTO extrusion_param_definitions
         (code, label, unit, min_default, max_default, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [p[0], p[1], p[2], p[3], p[4], p[5]]
      );
    }
  } else {
    for (const p of extrusionParams) {
      const existing = await db.get(
        "SELECT id FROM extrusion_param_definitions WHERE code = ?",
        [p[0]]
      );
      if (existing) continue;
      await db.run(
        `INSERT INTO extrusion_param_definitions
         (code, label, unit, min_default, max_default, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [p[0], p[1], p[2], p[3], p[4], p[5]]
      );
    }
  }

  return db;
}

export const dbReady = init();
