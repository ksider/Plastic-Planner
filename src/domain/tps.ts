import type { SampleFieldDef } from "../types.js";
import { parseSampleFields } from "./experiments.js";
import { formatNumber } from "../lib/format.js";
import { mean, sd } from "../utils.js";
import { linearRegression, pooledSd } from "./experiments.js";

export function defaultTpsOutputFields(): SampleFieldDef[] {
  return [
    {
      key: "moisture_absorption_pct",
      label: "Moisture absorption %",
      type: "number",
      analyze: true,
      is_default: true,
    },
    {
      key: "solubility_pct",
      label: "Solubility %",
      type: "number",
      analyze: true,
      is_default: true,
    },
    {
      key: "flexibility_tags",
      label: "Flexibility",
      type: "tags",
      options: ["flexible", "brittle", "sticky"],
      analyze: false,
      is_default: true,
    },
  ];
}

export function parseTpsOutputFields(
  raw: string | null | undefined
): SampleFieldDef[] {
  const parsed = parseSampleFields(raw);
  return mergeTpsDefaultFields(parsed);
}

export function mergeTpsDefaultFields(fields: SampleFieldDef[]): SampleFieldDef[] {
  const defaults = defaultTpsOutputFields();
  const map = new Map(fields.map((f) => [f.key, f]));
  const merged: SampleFieldDef[] = [];
  for (const def of defaults) {
    const existing = map.get(def.key);
    if (existing) {
      merged.push({ ...def, ...existing, is_default: true });
      map.delete(def.key);
    } else {
      merged.push(def);
    }
  }
  for (const rest of map.values()) merged.push(rest);
  return merged;
}

export function parseTpsMetricKeys(raw: string | null | undefined): string[] {
  if (!raw) return ["moisture_absorption_pct", "solubility_pct"];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return ["moisture_absorption_pct", "solubility_pct"];
    }
    return parsed.map((k) => String(k));
  } catch {
    return ["moisture_absorption_pct", "solubility_pct"];
  }
}

export function defaultTpsParamConfig(code: string) {
  if (code === "mix_speed_level") {
    return {
      mode: "LIST",
      active: 1,
      fixed_value: null,
      range_min: null,
      range_max: null,
      list_json: JSON.stringify([1, 2, 3]),
    };
  }
  return {
    mode: "RANGE",
    active: 1,
    fixed_value: null,
    range_min: null,
    range_max: null,
    list_json: null,
  };
}

export function parseOutputsJson(
  raw: string | null | undefined
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}

export function getTpsMetricValue(
  outputs: Record<string, unknown>,
  field: SampleFieldDef
): number | null {
  const value = outputs[field.key];
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function buildTpsDecisionSupportAnalysis(input: {
  runs: Array<{
    run_code: string;
    recipe_name: string | null;
    recipe_variant?: string | null;
    temp: number | null;
    scatter: number | null;
    outputs: Record<string, unknown>;
    notes?: string | null;
  }>;
  outputFields: SampleFieldDef[];
  metricKeys: string[];
  tempLabel: string;
  scatterLabel: string;
}) {
  const { runs, outputFields, metricKeys, tempLabel, scatterLabel } = input;
  const numericFields = outputFields.filter((f) => f.type === "number");
  const resolvedMetricKeys =
    metricKeys && metricKeys.length ? metricKeys : ["moisture_absorption_pct"];
  const metricDefinitions = resolvedMetricKeys
    .map((key) => numericFields.find((f) => f.key === key))
    .filter(Boolean) as SampleFieldDef[];

  const runCount = runs.length;
  const missingTemp = runs.filter((r) => r.temp === null || r.temp === undefined).length;
  const missingScatter = runs.filter(
    (r) => r.scatter === null || r.scatter === undefined
  ).length;

  const percent = (count: number) =>
    runCount > 0 ? Math.round((count / runCount) * 100) : 0;

  const labelFor = (run: {
    recipe_name: string | null;
    recipe_variant?: string | null;
  }) => {
    const base = run.recipe_name || "Unassigned";
    return run.recipe_variant ? `${base} (${run.recipe_variant})` : base;
  };

  const tempSet = new Set(runs.map((r) => r.temp).filter((v) => v !== null));
  const recipeSet = new Set(runs.map((r) => labelFor(r)));

  const cellCounts: Record<string, number> = {};
  for (const r of runs) {
    const key = `${labelFor(r)}||${r.temp}`;
    cellCounts[key] = (cellCounts[key] || 0) + 1;
  }
  const cellReplicates = Object.values(cellCounts);
  const minRep = cellReplicates.length ? Math.min(...cellReplicates) : 0;
  const maxRep = cellReplicates.length ? Math.max(...cellReplicates) : 0;
  const avgRep =
    cellReplicates.length > 0
      ? cellReplicates.reduce((a, b) => a + b, 0) / cellReplicates.length
      : 0;

  const metricMissingPct: Record<string, number> = {};
  const metricMissingCount: Record<string, number> = {};
  for (const field of metricDefinitions) {
    const missingCount = runs.filter((r) => {
      const v = getTpsMetricValue(r.outputs, field);
      return v === null || v === undefined;
    }).length;
    metricMissingCount[field.key] = missingCount;
    metricMissingPct[field.key] = percent(missingCount);
  }

  const blockers: string[] = [];
  const warnings: string[] = [];
  const actions: string[] = [];

  if (runCount === 0) blockers.push("No runs to analyze.");
  if (tempSet.size === 0) {
    warnings.push(`No ${tempLabel} values found.`);
    actions.push(`Enable ${tempLabel} or enter values to see temperature effects.`);
  }
  if (recipeSet.size === 0) blockers.push("No recipes found.");

  if (recipeSet.size === 1 && blockers.length === 0) {
    warnings.push("Only one recipe present.");
  }
  if (minRep > 0 && minRep < 2) {
    warnings.push("Some Recipe × Temperature cells have <2 replicates.");
  }
  if (missingScatter > 0) {
    warnings.push(`Missing ${scatterLabel} values.`);
    actions.push(
      `Fill ${scatterLabel} for at least ${missingScatter} more runs.`
    );
  }

  let severity: "OK" | "WARNING" | "BLOCKER" = "OK";
  if (blockers.length > 0) severity = "BLOCKER";
  else if (warnings.length > 0) severity = "WARNING";

  const quality = {
    severity,
    counts: { runs: runCount },
    missing: {
      temp: percent(missingTemp),
      scatter: percent(missingScatter),
      metrics: metricMissingPct,
    },
    coverage: {
      recipes: recipeSet.size,
      temps: tempSet.size,
      replicates: { min: minRep, max: maxRep, avg: avgRep },
    },
    messages: { blockers, warnings, actions },
  };

  const tagsSummary: Record<string, Record<string, number>> = {};
  const textNotes: Record<string, Array<{ run: string; value: string }>> = {};
  const tagFields = outputFields.filter((f) => f.type === "tags");
  const textFields = outputFields.filter((f) => f.type === "text");
  for (const field of tagFields) tagsSummary[field.label] = {};
  for (const field of textFields) textNotes[field.label] = [];
  for (const r of runs) {
    for (const field of tagFields) {
      const value = r.outputs[field.key];
      const list = Array.isArray(value)
        ? value.map(String)
        : value
        ? [String(value)]
        : [];
      for (const tag of list) {
        tagsSummary[field.label][tag] =
          (tagsSummary[field.label][tag] || 0) + 1;
      }
    }
    for (const field of textFields) {
      const value = r.outputs[field.key];
      if (value) {
        textNotes[field.label].push({ run: r.run_code, value: String(value) });
      }
    }
  }

  const metricResults = metricDefinitions.map((metric) => {
    const groupedByRecipe: Record<string, number[]> = {};
    const groupedByTemp: Record<number, number[]> = {};
    const groupedByRecipeTemp: Record<string, number[]> = {};

    for (const r of runs) {
      const value = getTpsMetricValue(r.outputs, metric);
      if (value === null || value === undefined) continue;
      const recipe = labelFor(r);
      if (!groupedByRecipe[recipe]) groupedByRecipe[recipe] = [];
      groupedByRecipe[recipe].push(Number(value));
      if (r.temp !== null && r.temp !== undefined) {
        const tKey = Number(r.temp);
        if (!groupedByTemp[tKey]) groupedByTemp[tKey] = [];
        groupedByTemp[tKey].push(Number(value));
        const rtKey = `${recipe}||${tKey}`;
        if (!groupedByRecipeTemp[rtKey]) groupedByRecipeTemp[rtKey] = [];
        groupedByRecipeTemp[rtKey].push(Number(value));
      }
    }

    const recipeStats = Object.entries(groupedByRecipe).map(
      ([recipe, vals]) => ({
        recipe,
        n: vals.length,
        mean: mean(vals),
        sd: sd(vals),
      })
    );
    const tempStats = Object.entries(groupedByTemp).map(([temp, vals]) => ({
      temp: Number(temp),
      n: vals.length,
      mean: mean(vals),
      sd: sd(vals),
    }));
    const recipeTempStats = Object.entries(groupedByRecipeTemp).map(
      ([key, vals]) => {
        const [recipe, temp] = key.split("||");
        return {
          recipe,
          temp: Number(temp),
          n: vals.length,
          mean: mean(vals),
          sd: sd(vals),
        };
      }
    );

    const insights: Array<{ text: string; severity: "good" | "warn" | "bad" }> =
      [];
    const caveats: string[] = [];

    const effectTag = (effect: number | null) => {
      if (effect === null) return "warn";
      const abs = Math.abs(effect);
      if (abs >= 1.0) return "good";
      if (abs >= 0.5) return "warn";
      return "warn";
    };

    if (recipeStats.length >= 2) {
      const sorted = [...recipeStats].sort((a, b) =>
        (a.mean ?? 0) - (b.mean ?? 0)
      );
      const best = sorted[0];
      const worst = sorted[sorted.length - 1];
      const delta =
        best.mean !== null && worst.mean !== null
          ? worst.mean - best.mean
          : null;
      const pooled = pooledSd(best.sd, best.n, worst.sd, worst.n);
      const effect = delta !== null && pooled !== null ? delta / pooled : null;
      if (delta !== null) {
        insights.push({
          text: `${best.recipe} improves ${metric.label} by ~${formatNumber(
            delta
          )} vs ${worst.recipe}.`,
          severity: effectTag(effect),
        });
      }
    }

    if (tempStats.length >= 2) {
      const sorted = [...tempStats].sort((a, b) => a.temp - b.temp);
      const baseline = sorted[0];
      for (let i = 1; i < sorted.length; i += 1) {
        const current = sorted[i];
        const delta =
          baseline.mean !== null && current.mean !== null
            ? baseline.mean - current.mean
            : null;
        const pooled = pooledSd(
          baseline.sd,
          baseline.n,
          current.sd,
          current.n
        );
        const effect = delta !== null && pooled !== null ? delta / pooled : null;
        if (delta !== null) {
          insights.push({
            text: `${tempLabel} effect: ${baseline.temp}→${current.temp} changes by ~${formatNumber(
              delta
            )}.`,
            severity: effectTag(effect),
          });
        }
      }
    }

    const scatterPoints = runs
      .filter(
        (r) =>
          r.scatter !== null &&
          r.scatter !== undefined &&
          getTpsMetricValue(r.outputs, metric) !== null
      )
      .map((r) => ({
        recipe: labelFor(r),
        x: Number(r.scatter),
        y: Number(getTpsMetricValue(r.outputs, metric)),
      }));
    if (scatterPoints.length >= 3) {
      const reg = linearRegression(scatterPoints);
      if (reg) {
        insights.push({
          text: `${scatterLabel} sensitivity: +1 → ${formatNumber(
            reg.slope
          )} ${metric.label}.`,
          severity: "warn",
        });
      }
    }

    const bestCell = [...recipeTempStats]
      .filter((c) => c.mean !== null)
      .sort((a, b) => (a.mean ?? 0) - (b.mean ?? 0))[0];
    if (bestCell) {
      insights.push({
        text: `Best window: ${bestCell.recipe} at ${bestCell.temp} ${tempLabel}.`,
        severity: "good",
      });
    }

    if (minRep > 0 && minRep < 2) {
      caveats.push("Only 1 replicate in some recipe×temperature cells.");
    }
    if (metricMissingCount[metric.key] > 0) {
      caveats.push(`Some ${metric.label} values are missing.`);
    }

    const linePoints = recipeTempStats.map((row) => ({
      recipe: row.recipe,
      temp: row.temp,
      n: row.n,
      mean: row.mean,
      sd: row.sd,
    }));

    const heatmapCells = recipeTempStats.map((row) => ({
      recipe: row.recipe,
      temp: row.temp,
      n: row.n,
      mean: row.mean,
      sd: row.sd,
      defects: 0,
    }));

    const scatterLines: Array<{
      recipe: string;
      slope: number;
      intercept: number;
    }> = [];
    const scatterByRecipe: Record<string, Array<{ x: number; y: number }>> =
      {};
    for (const p of scatterPoints) {
      if (!scatterByRecipe[p.recipe]) scatterByRecipe[p.recipe] = [];
      scatterByRecipe[p.recipe].push({ x: p.x, y: p.y });
    }
    for (const [recipe, pts] of Object.entries(scatterByRecipe)) {
      if (pts.length < 3) continue;
      const reg = linearRegression(pts);
      if (reg) scatterLines.push({ recipe, ...reg });
    }

    const topSamples = runs
      .filter((r) => getTpsMetricValue(r.outputs, metric) !== null)
      .map((r) => ({
        run_code: r.run_code,
        recipe: labelFor(r),
        temp: r.temp,
        value: Number(getTpsMetricValue(r.outputs, metric)),
        scatter: r.scatter,
        notes: r.notes ?? "",
      }))
      .sort((a, b) => a.value - b.value)
      .slice(0, 10);

    return {
      key: metric.key,
      label: metric.label,
      missingPct: metricMissingPct[metric.key] ?? 0,
      insights,
      caveats,
      recipeStats,
      recipeTempStats,
      topSamples,
      charts: {
        linePoints,
        heatmapCells,
        scatterPoints,
        scatterLines,
      },
    };
  });

  return {
    labels: { temp: tempLabel, scatter: scatterLabel },
    quality,
    fields: outputFields,
    metrics: metricResults,
    tagsSummary,
    textNotes,
  };
}
