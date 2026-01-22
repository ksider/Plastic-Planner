import type { Db } from "../db.js";
import {
  createExperiment,
  getExperiment,
  getExperimentRecipes,
  setExperimentRecipes,
  upsertDesignMetadata
} from "../repos/experiments_repo.js";
import {
  createParamDefinition,
  listParamDefinitionsByKind,
  listParamConfigs,
  upsertParamConfig
} from "../repos/params_repo.js";
import { deleteRunsForExperiment, insertRuns } from "../repos/runs_repo.js";
import type { ParamDefinition, ParamConfig } from "../repos/params_repo.js";
import { buildBbdDesign, buildFfaDesign, buildScreenDesign, buildSimDesign } from "../domain/designs.js";
import { stableHash } from "../lib/hash.js";
import { DEFAULT_INPUT_VALUES } from "./seed.js";

export type ExperimentCreateInput = {
  name: string;
  design_type: string;
  seed: number;
  notes?: string | null;
  center_points?: number;
  max_runs?: number;
  replicate_count?: number;
  recipe_as_block?: number;
  recipe_ids?: number[];
};

export function createExperimentWithDefaults(db: Db, input: ExperimentCreateInput): number {
  const experimentId = createExperiment(db, {
    name: input.name,
    design_type: input.design_type,
    seed: input.seed,
    notes: input.notes ?? null,
    center_points: input.center_points ?? 3,
    max_runs: input.max_runs ?? 200,
    replicate_count: input.replicate_count ?? 1,
    recipe_as_block: input.recipe_as_block ?? 0
  });
  setExperimentRecipes(db, experimentId, input.recipe_ids ?? []);

  const inputParams = listParamDefinitionsByKind(db, experimentId, "INPUT");
  const defaultActive = new Set(["barrel_zone3", "clamp_tonnage", "inj_speed", "inj_press_limit"]);
  for (const param of inputParams) {
    const defaultValue = DEFAULT_INPUT_VALUES[param.code];
    upsertParamConfig(db, {
      experiment_id: experimentId,
      param_def_id: param.id,
      active: defaultActive.has(param.code) ? 1 : 0,
      mode: "FIXED",
      fixed_value_real: Number.isFinite(defaultValue) ? defaultValue : null,
      range_min_real: null,
      range_max_real: null,
      list_json: null,
      level_count: 2
    });
  }
  return experimentId;
}

export function createCustomParam(
  db: Db,
  experimentId: number,
  data: Omit<ParamDefinition, "id" | "scope" | "experiment_id">
) {
  const id = createParamDefinition(db, {
    scope: "EXPERIMENT",
    experiment_id: experimentId,
    code: data.code,
    label: data.label,
    unit: data.unit,
    field_kind: data.field_kind,
    field_type: data.field_type,
    group_label: data.group_label,
    allowed_values_json: data.allowed_values_json
  });
  if (data.field_kind === "INPUT") {
    upsertParamConfig(db, {
      experiment_id: experimentId,
      param_def_id: id,
      active: 0,
      mode: "FIXED",
      fixed_value_real: null,
      range_min_real: null,
      range_max_real: null,
      list_json: null,
      level_count: 2
    });
  }
}

function configToFactor(config: ParamConfig, param: ParamDefinition) {
  const list = config.list_json ? (JSON.parse(config.list_json) as number[]) : null;
  return {
    paramDefId: param.id,
    code: param.code,
    label: param.label,
    mode: config.mode,
    rangeMin: config.range_min_real,
    rangeMax: config.range_max_real,
    list,
    levelCount: config.level_count,
    fixedValue: config.fixed_value_real
  };
}

export function generateRuns(db: Db, experimentId: number) {
  const experiment = getExperiment(db, experimentId);
  if (!experiment) throw new Error("Experiment not found");

  const inputParams = listParamDefinitionsByKind(db, experimentId, "INPUT");
  const outputParams = listParamDefinitionsByKind(db, experimentId, "OUTPUT");
  const configs = listParamConfigs(db, experimentId);

  const activeFactors = configs
    .filter((config) => config.active === 1)
    .map((config) => ({
      config,
      param: inputParams.find((p) => p.id === config.param_def_id)
    }))
    .filter((entry) => entry.param != null) as Array<{ config: ParamConfig; param: ParamDefinition }>;

  const factorConfigs = activeFactors.map((entry) => {
    if (experiment.design_type === "BBD" && entry.config.mode === "RANGE") {
      return configToFactor({ ...entry.config, level_count: 3 }, entry.param);
    }
    return configToFactor(entry.config, entry.param);
  });

  let designRuns: { values: Record<number, number>; coded?: Record<number, number> }[] = [];
  let metadata: Record<string, unknown> = {};

  if (experiment.design_type === "SIM") {
    designRuns = buildSimDesign(factorConfigs, experiment.seed, experiment.max_runs);
    metadata = { design: "SIM", factors: factorConfigs };
  } else if (experiment.design_type === "FFA") {
    designRuns = buildFfaDesign(factorConfigs, experiment.seed, experiment.max_runs);
    metadata = { design: "FFA", factors: factorConfigs };
  } else if (experiment.design_type === "BBD") {
    const { runs, codedLevels } = buildBbdDesign(
      factorConfigs,
      experiment.seed,
      experiment.center_points
    );
    designRuns = runs;
    metadata = { design: "BBD", factors: factorConfigs, codedLevels };
  } else {
    designRuns = buildScreenDesign(factorConfigs, experiment.seed, experiment.max_runs);
    metadata = { design: "SCREEN_SAMPLE", factors: factorConfigs };
  }

  const recipeIds = getExperimentRecipes(db, experimentId);
  const recipeBlock = experiment.recipe_as_block === 1 && recipeIds.length > 0;
  const recipeList = recipeBlock
    ? recipeIds
    : recipeIds.length === 1
      ? [recipeIds[0]]
      : [null];

  const runsToInsert: Array<
    Omit<
      {
        id: number;
        experiment_id: number;
        run_order: number;
        run_code: string;
        recipe_id: number | null;
        replicate_key: string | null;
        replicate_index: number | null;
        done: number;
        exclude_from_analysis: number;
        created_at: string;
      },
      "id" | "created_at" | "experiment_id"
    >
  > = [];
  const valuesToInsert: Array<{
    run_id: number;
    param_def_id: number;
    value_real: number | null;
    value_text: string | null;
    value_tags_json: string | null;
  }> = [];

  let runOrder = 1;
  const inputMap = new Map<number, ParamDefinition>();
  inputParams.forEach((param) => inputMap.set(param.id, param));

  for (const recipeId of recipeList) {
    for (const baseRun of designRuns) {
      for (let r = 0; r < experiment.replicate_count; r += 1) {
        const runCode = `E${experimentId}-R${String(runOrder).padStart(3, "0")}`;
        const replicateKey = buildReplicateKey(baseRun.values, recipeId, recipeBlock);
        runsToInsert.push({
          experiment_id: experimentId,
          run_order: runOrder,
          run_code: runCode,
          recipe_id: recipeId,
          replicate_key: replicateKey,
          replicate_index: r + 1,
          done: 0,
          exclude_from_analysis: 0
        });

        for (const input of inputParams) {
          const config = configs.find((cfg) => cfg.param_def_id === input.id);
          const value = baseRun.values[input.id];
          const fallback = deriveFallbackValue(config);
          const finalValue = value ?? fallback ?? null;
          valuesToInsert.push({
            run_id: runOrder,
            param_def_id: input.id,
            value_real: finalValue,
            value_text: null,
            value_tags_json: null
          });
        }

        for (const output of outputParams) {
          valuesToInsert.push({
            run_id: runOrder,
            param_def_id: output.id,
            value_real: null,
            value_text: null,
            value_tags_json: null
          });
        }

        runOrder += 1;
      }
    }
  }

  deleteRunsForExperiment(db, experimentId);
  insertRuns(db, experimentId, runsToInsert, valuesToInsert);
  upsertDesignMetadata(db, experimentId, JSON.stringify(metadata));
}

function deriveFallbackValue(config: ParamConfig | undefined): number | null {
  if (!config) return null;
  if (config.mode === "FIXED") {
    return config.fixed_value_real ?? null;
  }
  if (config.mode === "RANGE") {
    const min = config.range_min_real;
    const max = config.range_max_real;
    if (min == null || max == null) return null;
    return (min + max) / 2;
  }
  if (config.mode === "LIST") {
    if (!config.list_json) return null;
    const list = JSON.parse(config.list_json) as number[];
    return list.length ? list[0] : null;
  }
  return null;
}

function buildReplicateKey(
  values: Record<number, number>,
  recipeId: number | null,
  includeRecipe: boolean
): string {
  const entries = Object.entries(values).sort((a, b) => Number(a[0]) - Number(b[0]));
  const payload = {
    values: entries,
    recipe_id: includeRecipe ? recipeId : null
  };
  return stableHash(JSON.stringify(payload));
}
