#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${DB_PATH:-doe.sqlite}"
ARG="${1:-}"

if [[ -z "$ARG" ]]; then
  echo "Usage: scripts/fill_im_outputs.sh <experiment name | id>"
  exit 1
fi

if [[ "$ARG" =~ ^[0-9]+$ ]]; then
  EXP_ID="$ARG"
else
EXP_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM im_experiments WHERE name = '${ARG//\'/''}' ORDER BY id DESC LIMIT 1;")
fi

if [[ -z "$EXP_ID" ]]; then
  echo "Experiment not found: $ARG"
  exit 1
fi

get_param_id() {
  local code="$1"
  sqlite3 "$DB_PATH" "SELECT id FROM im_param_definitions WHERE code = '${code//\'/''}' LIMIT 1;"
}

ID_CYCLE_TIME="$(get_param_id cycle_time)"
ID_PART_WEIGHT="$(get_param_id part_weight)"
ID_WALL_THICKNESS="$(get_param_id wall_thickness)"
ID_EJECT_TEMP="$(get_param_id eject_temp)"
ID_SHOTS_PER_RUN="$(get_param_id shots_per_run)"
ID_SHOTS_OK="$(get_param_id shots_ok)"
ID_SHOTS_SCRAP="$(get_param_id shots_scrap)"
ID_DEFECT_TAGS="$(get_param_id defect_tags)"
ID_OUTPUT_NOTES="$(get_param_id output_notes)"

if [[ -z "$ID_CYCLE_TIME" || -z "$ID_PART_WEIGHT" || -z "$ID_WALL_THICKNESS" || -z "$ID_EJECT_TEMP" || -z "$ID_SHOTS_PER_RUN" || -z "$ID_SHOTS_OK" || -z "$ID_SHOTS_SCRAP" || -z "$ID_DEFECT_TAGS" || -z "$ID_OUTPUT_NOTES" ]]; then
  echo "Missing output parameter IDs. Check im_param_definitions table."
  exit 1
fi

sqlite3 "$DB_PATH" <<SQL
BEGIN;

DELETE FROM im_run_param_values
WHERE run_id IN (SELECT id FROM im_runs WHERE experiment_id = $EXP_ID)
  AND param_def_id IN (
    SELECT id FROM im_param_definitions WHERE is_output = 1
  );

WITH runs AS (
  SELECT id as run_id, run_order
  FROM im_runs
  WHERE experiment_id = $EXP_ID
  ORDER BY run_order
)
INSERT INTO im_run_param_values (run_id, param_def_id, value_real, value_text)
SELECT run_id, $ID_CYCLE_TIME, 22.0 + 0.6*run_order, NULL FROM runs;

WITH runs AS (
  SELECT id as run_id, run_order
  FROM im_runs
  WHERE experiment_id = $EXP_ID
  ORDER BY run_order
)
INSERT INTO im_run_param_values (run_id, param_def_id, value_real, value_text)
SELECT run_id, $ID_PART_WEIGHT, 12.5 + 0.12*run_order, NULL FROM runs;

WITH runs AS (
  SELECT id as run_id, run_order
  FROM im_runs
  WHERE experiment_id = $EXP_ID
  ORDER BY run_order
)
INSERT INTO im_run_param_values (run_id, param_def_id, value_real, value_text)
SELECT run_id, $ID_WALL_THICKNESS, 1.15 + 0.01*run_order, NULL FROM runs;

WITH runs AS (
  SELECT id as run_id, run_order
  FROM im_runs
  WHERE experiment_id = $EXP_ID
  ORDER BY run_order
)
INSERT INTO im_run_param_values (run_id, param_def_id, value_real, value_text)
SELECT run_id, $ID_EJECT_TEMP, 62.0 + 0.5*run_order, NULL FROM runs;

WITH runs AS (
  SELECT id as run_id, run_order
  FROM im_runs
  WHERE experiment_id = $EXP_ID
  ORDER BY run_order
)
INSERT INTO im_run_param_values (run_id, param_def_id, value_real, value_text)
SELECT run_id, $ID_SHOTS_PER_RUN, 10 + (run_order % 3), NULL FROM runs;

WITH runs AS (
  SELECT id as run_id, run_order
  FROM im_runs
  WHERE experiment_id = $EXP_ID
  ORDER BY run_order
)
INSERT INTO im_run_param_values (run_id, param_def_id, value_real, value_text)
SELECT run_id, $ID_SHOTS_OK, CASE WHEN run_order % 4 = 0 THEN 8 WHEN run_order % 3 = 0 THEN 9 ELSE 10 END, NULL FROM runs;

WITH runs AS (
  SELECT id as run_id, run_order
  FROM im_runs
  WHERE experiment_id = $EXP_ID
  ORDER BY run_order
)
INSERT INTO im_run_param_values (run_id, param_def_id, value_real, value_text)
SELECT run_id, $ID_SHOTS_SCRAP, CASE WHEN run_order % 4 = 0 THEN 2 WHEN run_order % 3 = 0 THEN 1 ELSE 0 END, NULL FROM runs;

WITH runs AS (
  SELECT id as run_id, run_order
  FROM im_runs
  WHERE experiment_id = $EXP_ID
  ORDER BY run_order
)
INSERT INTO im_run_param_values (run_id, param_def_id, value_real, value_text)
SELECT run_id, $ID_DEFECT_TAGS, NULL,
CASE
  WHEN run_order % 4 = 0 THEN 'warpage'
  WHEN run_order % 3 = 0 THEN 'bubbles / foaming'
  ELSE ''
END
FROM runs;

WITH runs AS (
  SELECT id as run_id, run_order
  FROM im_runs
  WHERE experiment_id = $EXP_ID
  ORDER BY run_order
)
INSERT INTO im_run_param_values (run_id, param_def_id, value_real, value_text)
SELECT run_id, $ID_OUTPUT_NOTES, NULL,
CASE
  WHEN run_order % 4 = 0 THEN 'minor warp'
  WHEN run_order % 3 = 0 THEN 'small bubbles'
  ELSE 'ok'
END
FROM runs;

COMMIT;
SQL

echo "Filled IM outputs for experiment '$ARG' (id $EXP_ID)."
