import { mean, sd, slugify } from "../utils.js";
import { formatNumber } from "../lib/format.js";
import type { SampleFieldDef } from "../types.js";

export function parseMoldTemps(raw: string): number[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => Number(t))
    .filter((t) => Number.isFinite(t))
    .map((t) => Math.round(t));
}

export function parseHeadTemps(raw: string): number[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => Number(t))
    .filter((t) => Number.isFinite(t))
    .map((t) => Math.round(t));
}

export function parseSampleFields(raw: string | null | undefined): SampleFieldDef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((f) => ({
        key: String(f.key || ""),
        label: String(f.label || ""),
        type: f.type === "tags" ? "tags" : f.type === "number" ? "number" : "text",
        options: Array.isArray(f.options)
          ? f.options.map((o: string) => String(o))
          : [],
        analyze: Boolean(f.analyze),
        is_core: Boolean(f.is_core),
        is_default: Boolean(f.is_default),
      }))
      .filter((f) => f.key && f.label);
  } catch {
    return [];
  }
}

export function defaultSampleFields(): SampleFieldDef[] {
  return [
    { key: "solubles_pct", label: "Solubles %", type: "number", analyze: true, is_core: true, is_default: true },
    { key: "swelling_g_g", label: "Water absorption g/g", type: "number", analyze: false, is_core: true, is_default: true },
    { key: "strength_mpa", label: "Strength MPa", type: "number", analyze: false, is_core: false, is_default: true },
  ];
}

export function mergeDefaultSampleFields(fields: SampleFieldDef[]): SampleFieldDef[] {
  const defaults = defaultSampleFields();
  const map = new Map(fields.map((f) => [f.key, f]));
  const merged: SampleFieldDef[] = [];
  for (const def of defaults) {
    const existing = map.get(def.key);
    if (existing) {
      merged.push({ ...def, ...existing, is_core: def.is_core, is_default: def.is_default });
      map.delete(def.key);
    } else {
      merged.push(def);
    }
  }
  for (const rest of map.values()) {
    merged.push(rest);
  }
  return merged;
}

export function parseMetricKeys(raw: string | null | undefined): string[] {
  if (!raw) return ["solubles_pct"];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return ["solubles_pct"];
    return parsed.map((k) => String(k));
  } catch {
    return ["solubles_pct"];
  }
}

export function uniqueFieldKey(label: string, existing: SampleFieldDef[]) {
  const base = slugify(label) || "field";
  let key = base;
  let i = 2;
  const used = new Set(existing.map((f) => f.key));
  while (used.has(key)) {
    key = `${base}_${i}`;
    i += 1;
  }
  return key;
}

export function normalizeBatchComponents(batches: any[]) {
  const componentOrder: string[] = [];
  const normalized = batches.map((b) => {
    let weights: Record<string, number> = {};
    let partsList: Array<{ name: string; parts_used: number }> = [];

    if (b.weights_json) {
      try {
        weights = JSON.parse(b.weights_json);
      } catch {
        weights = {};
      }
    } else {
      weights = {
        "Corn starch (fg)": b.starch_g,
        "Citric Acid": b.citric_g,
        "Sod. Persulfate": b.pers_g,
        ESBO: b.esbo_g,
        Water: b.water_g,
      };
    }

    if (b.parts_json) {
      try {
        partsList = JSON.parse(b.parts_json);
      } catch {
        partsList = [];
      }
    }

    if (partsList.length) {
      for (const entry of partsList) {
        if (!componentOrder.includes(entry.name)) {
          componentOrder.push(entry.name);
        }
      }
    } else {
      for (const name of Object.keys(weights)) {
        if (!componentOrder.includes(name)) {
          componentOrder.push(name);
        }
      }
    }

    return { ...b, weights, partsList };
  });

  return { batches: normalized, componentOrder };
}

export function buildWeightRows(batch: any) {
  let weights: Record<string, number> = {};
  let partsList: Array<{ name: string; parts_used: number }> = [];

  if (batch.weights_json) {
    try {
      weights = JSON.parse(batch.weights_json);
    } catch {
      weights = {};
    }
  } else {
    weights = {
      "Corn starch (fg)": batch.starch_g,
      "Citric Acid": batch.citric_g,
      "Sod. Persulfate": batch.pers_g,
      ESBO: batch.esbo_g,
      Water: batch.water_g,
    };
  }

  if (batch.parts_json) {
    try {
      partsList = JSON.parse(batch.parts_json);
    } catch {
      partsList = [];
    }
  }

  const partsMap = new Map(partsList.map((p) => [p.name, p.parts_used]));

  return Object.entries(weights)
    .map(([name, grams]) => ({
      name,
      grams,
      phr: partsMap.get(name) ?? null,
    }))
    .filter((row) => Number(row.grams) > 0);
}

export function parseExtra(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

export function getMetricValue(sample: any, field: SampleFieldDef): number | null {
  if (field.key === "solubles_pct") {
    return sample.solubles_pct ?? null;
  }
  const extra = parseExtra(sample.extra_json);
  const value = extra[field.key];
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export type DecisionSupportInput = {
  batchesCount: number;
  samplesCount: number;
  joinedCount: number;
  samples: any[];
  sampleFields: SampleFieldDef[];
  metricKeys: string[];
  alpha: number;
};

export function buildDecisionSupportAnalysis(input: DecisionSupportInput) {
  const { batchesCount, samplesCount, joinedCount, samples, sampleFields, metricKeys, alpha } = input;
  const extraFields = sampleFields ?? [];
  const numericFields = extraFields.filter((f) => f.type === "number");
  const resolvedMetricKeys =
    metricKeys && metricKeys.length ? metricKeys : ["solubles_pct"];
  const metricDefinitions = resolvedMetricKeys.map((key) => {
    const field =
      numericFields.find((f) => f.key === key) ||
      ({
        key,
        label:
          key === "swelling_g_g"
            ? "Swelling g/g"
            : key === "density_g_cm3"
            ? "Density g/cm3"
            : "Solubles %",
        type: "number",
        analyze: true,
      } as SampleFieldDef);
    return field;
  });
  const missingMoldTemp = samples.filter(
    (s) => s.mold_temp_c === null || s.mold_temp_c === undefined
  ).length;
  const missingMoist = samples.filter(
    (s) => s.moist_before_mold === null || s.moist_before_mold === undefined
  ).length;

  const percent = (count: number) =>
    joinedCount > 0 ? Math.round((count / joinedCount) * 100) : 0;

  const moistValues = samples
    .map((s) => s.moist_before_mold)
    .filter((v) => v !== null && v !== undefined)
    .map(Number);

  const recipeSet = new Set(samples.map((s) => s.recipe_name));
  const tempSet = new Set(samples.map((s) => s.mold_temp_c));

  const cellCounts: Record<string, number> = {};
  for (const s of samples) {
    const key = `${s.recipe_name}||${s.mold_temp_c}`;
    cellCounts[key] = (cellCounts[key] || 0) + 1;
  }
  const cellReplicates = Object.values(cellCounts);
  const minRep = cellReplicates.length ? Math.min(...cellReplicates) : 0;
  const maxRep = cellReplicates.length ? Math.max(...cellReplicates) : 0;
  const avgRep =
    cellReplicates.length > 0
      ? cellReplicates.reduce((a, b) => a + b, 0) / cellReplicates.length
      : 0;

  const joinFailures = Math.max(samplesCount - joinedCount, 0);
  const missingMoistPct = percent(missingMoist);

  const blockers: string[] = [];
  const warnings: string[] = [];
  const actions: string[] = [];

  if (joinedCount === 0 || batchesCount === 0 || samplesCount === 0) {
    blockers.push("No joined data to analyze.");
  }
  if (joinFailures > 0) {
    blockers.push("Some samples are missing matching batches.");
    actions.push(`Fix ${joinFailures} samples with missing batch links.`);
  }
  if (tempSet.size === 0) {
    blockers.push("No mold temperatures found.");
  }
  if (recipeSet.size === 0) {
    blockers.push("No recipes found in samples.");
  }

  if (recipeSet.size === 1 && blockers.length === 0) {
    warnings.push("Only one recipe present.");
  }
  if (minRep > 0 && minRep < 2) {
    warnings.push("Some Recipe A- MoldTemp cells have <2 replicates.");
  }
  if (missingMoistPct > 0) {
    warnings.push("Missing Moist_before_mold values.");
    actions.push(
      `Fill Moist_before_mold for at least ${missingMoist} more samples.`
    );
  }
  const metricMissingPct: Record<string, number> = {};
  const metricMissingCount: Record<string, number> = {};
  for (const field of metricDefinitions) {
    const missingCount = samples.filter((s) => {
      const v = getMetricValue(s, field);
      return v === null || v === undefined;
    }).length;
    metricMissingCount[field.key] = missingCount;
    metricMissingPct[field.key] = percent(missingCount);
  }

  let severity: "OK" | "WARNING" | "BLOCKER" = "OK";
  if (blockers.length > 0) severity = "BLOCKER";
  else if (warnings.length > 0) severity = "WARNING";

  const quality = {
    severity,
    counts: {
      batches: batchesCount,
      samples: samplesCount,
      joined: joinedCount,
    },
    missing: {
      solubles_pct: metricMissingPct["solubles_pct"] ?? 0,
      mold_temp_c: percent(missingMoldTemp),
      moist_before_mold: missingMoistPct,
    },
    moisture_range: {
      min: moistValues.length ? Math.min(...moistValues) : null,
      max: moistValues.length ? Math.max(...moistValues) : null,
    },
    coverage: {
      recipes: recipeSet.size,
      moldTemps: tempSet.size,
      replicates: {
        min: minRep,
        max: maxRep,
        avg: avgRep,
      },
      perCell: cellCounts,
    },
    messages: {
      blockers,
      warnings,
      actions,
    },
  };

  const defectsByCell: Record<string, number> = {};
  const defectKeywords = ["foaming", "warpage", "bubbles", "sticky"];

  for (const s of samples) {
    const notes = String(s.notes_mold || "").toLowerCase();
    if (defectKeywords.some((k) => notes.includes(k))) {
      const cellKey = `${s.recipe_name}||${s.mold_temp_c}`;
      defectsByCell[cellKey] = (defectsByCell[cellKey] || 0) + 1;
    }
  }

  const metricResults = metricDefinitions.map((metric) => {
    const groupedByRecipe: Record<string, number[]> = {};
    const groupedByTemp: Record<number, number[]> = {};
    const groupedByRecipeTemp: Record<string, number[]> = {};
    for (const s of samples) {
      const value = getMetricValue(s, metric);
      if (value !== null && value !== undefined) {
        const rKey = s.recipe_name;
        if (!groupedByRecipe[rKey]) groupedByRecipe[rKey] = [];
        groupedByRecipe[rKey].push(Number(value));
        const tKey = Number(s.mold_temp_c);
        if (!groupedByTemp[tKey]) groupedByTemp[tKey] = [];
        groupedByTemp[tKey].push(Number(value));
        const rtKey = `${rKey}||${tKey}`;
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
      moldTemp: Number(temp),
      n: vals.length,
      mean: mean(vals),
      sd: sd(vals),
    }));

    const recipeTempStats = Object.entries(groupedByRecipeTemp).map(
      ([key, vals]) => {
        const [recipe, moldTemp] = key.split("||");
        return {
          recipe,
          moldTemp: Number(moldTemp),
          n: vals.length,
          mean: mean(vals),
          sd: sd(vals),
          defects: defectsByCell[key] ?? 0,
        };
      }
    );

    const insights: Array<{
      text: string;
      severity: "good" | "warn" | "bad";
    }> = [];
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
          )} vs ${worst.recipe} (mean ${formatNumber(
            best.mean
          )} vs ${formatNumber(worst.mean)}).`,
          severity: effectTag(effect),
        });
      }
    }

    if (tempStats.length >= 2) {
      const sorted = [...tempStats].sort((a, b) => a.moldTemp - b.moldTemp);
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
            text: `MoldTemp effect: ${baseline.moldTemp}?${current.moldTemp} improves by ~${formatNumber(
              delta
            )}.`,
            severity: effectTag(effect),
          });
        }
      }
    }

    const moistPoints = samples
      .filter(
        (s) =>
          s.moist_before_mold !== null &&
          s.moist_before_mold !== undefined &&
          getMetricValue(s, metric) !== null &&
          getMetricValue(s, metric) !== undefined
      )
      .map((s) => ({
        x: Number(s.moist_before_mold),
        y: Number(getMetricValue(s, metric)),
      }));
    if (moistPoints.length >= 3) {
      const reg = linearRegression(moistPoints);
      if (reg) {
        insights.push({
          text: `Moisture sensitivity: +1% moisture ? ${formatNumber(
            reg.slope
          )} ${metric.label} change.`,
          severity: Math.abs(reg.slope) >= 1 ? "warn" : "warn",
        });
      }
    }

    const bestCell = [...recipeTempStats]
      .filter((c) => c.mean !== null)
      .sort((a, b) => (a.mean ?? 0) - (b.mean ?? 0))[0];
    if (bestCell) {
      insights.push({
        text: `Best operating window: ${bestCell.recipe} at ${bestCell.moldTemp}°C (mean ${formatNumber(
          bestCell.mean
        )}).`,
        severity: bestCell.defects > 0 ? "warn" : "good",
      });
    }

    if (minRep > 0 && minRep < 2) {
      caveats.push("Only 1 replicate in some Recipe A- MoldTemp cells.");
    }
    if (metricMissingCount[metric.key] > 0) {
      caveats.push(`Some ${metric.label} values are missing.`);
    }
    const highVarianceCells = recipeTempStats.filter(
      (c) => c.sd !== null && c.mean !== null && c.sd > c.mean * 0.3 && c.n >= 2
    );
    if (highVarianceCells.length > 0) {
      caveats.push("High variance in some cells indicates instability.");
    }

    const linePoints = recipeTempStats.map((row) => ({
      recipe: row.recipe,
      moldTemp: row.moldTemp,
      n: row.n,
      mean: row.mean,
      sd: row.sd,
    }));

    const heatmapCells = recipeTempStats.map((row) => ({
      recipe: row.recipe,
      moldTemp: row.moldTemp,
      n: row.n,
      mean: row.mean,
      sd: row.sd,
      defects: row.defects,
    }));

    const scatterPoints = samples
      .filter(
        (s) =>
          s.moist_before_mold !== null &&
          s.moist_before_mold !== undefined &&
          getMetricValue(s, metric) !== null &&
          getMetricValue(s, metric) !== undefined
      )
      .map((s) => ({
        recipe: s.recipe_name,
        moist: Number(s.moist_before_mold),
        solubles: Number(getMetricValue(s, metric)),
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
      scatterByRecipe[p.recipe].push({ x: p.moist, y: p.solubles });
    }
    for (const [recipe, pts] of Object.entries(scatterByRecipe)) {
      if (pts.length < 3) continue;
      const reg = linearRegression(pts);
      if (reg) scatterLines.push({ recipe, ...reg });
    }

    const topSamples = samples
      .filter((s) => getMetricValue(s, metric) !== null)
      .map((s) => ({
        sample_code: s.sample_code,
        batch_code: s.batch_code,
        recipe: s.recipe_name,
        mold_temp_c: s.mold_temp_c,
        value: Number(getMetricValue(s, metric)),
        moist_before_mold: s.moist_before_mold,
        notes: s.notes_mold,
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

  const tagFields = extraFields.filter((f) => f.type === "tags");
  const textFields = extraFields.filter((f) => f.type === "text");
  const tagsSummary: Record<string, Record<string, number>> = {};
  for (const field of tagFields) {
    tagsSummary[field.label] = {};
  }
  for (const s of samples) {
    const extra = parseExtra(s.extra_json);
    for (const field of tagFields) {
      const values = extra[field.key];
      const list = Array.isArray(values) ? values : [];
      for (const tag of list) {
        tagsSummary[field.label][tag] =
          (tagsSummary[field.label][tag] || 0) + 1;
      }
    }
  }

  const textNotes: Record<string, Array<{ sample: string; value: string }>> =
    {};
  for (const field of textFields) {
    textNotes[field.label] = [];
  }
  for (const s of samples) {
    const extra = parseExtra(s.extra_json);
    for (const field of textFields) {
      const value = extra[field.key];
      if (value) {
        textNotes[field.label].push({
          sample: s.sample_code,
          value: String(value),
        });
      }
    }
  }

  const recipeCrosslink: Record<string, number | null> = {};
  for (const s of samples) {
    if (!s.parts_json) continue;
    if (recipeCrosslink[s.recipe_name] !== undefined) continue;
    try {
      const parts = JSON.parse(s.parts_json) as Array<{
        name: string;
        parts_used: number;
      }>;
      let citric = 0;
      let pers = 0;
      for (const p of parts) {
        const name = p.name.toLowerCase();
        if (name.includes("citric")) citric = p.parts_used;
        if (name.includes("pers")) pers = p.parts_used;
      }
      recipeCrosslink[s.recipe_name] = citric + alpha * pers;
    } catch {
      recipeCrosslink[s.recipe_name] = null;
    }
  }

  const metrics = metricResults.map((m) => ({
    ...m,
    charts: {
      ...m.charts,
      heatmapCells: m.charts.heatmapCells.map((cell) => ({
        ...cell,
        crosslinkIndex:
          recipeCrosslink[cell.recipe] !== undefined
            ? recipeCrosslink[cell.recipe]
            : null,
      })),
    },
  }));

  return {
    alpha,
    quality,
    fields: extraFields,
    selectedMetrics: metrics.map((m) => m.label),
    metrics,
    tagsSummary,
    textNotes,
  };
}

export function pooledSd(sd1: number | null, n1: number, sd2: number | null, n2: number) {
  if (sd1 === null || sd2 === null) return null;
  if (n1 < 2 || n2 < 2) return null;
  const v1 = sd1 * sd1;
  const v2 = sd2 * sd2;
  const pooled =
    ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2);
  return Math.sqrt(pooled);
}

export function linearRegression(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return null;
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumX2 = points.reduce((a, p) => a + p.x * p.x, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

export function buildAnalysis(batches: any[], samples: any[]) {
  const missingBatch = {
    head_set: batches.filter((b) => b.head_set === null || b.head_set === undefined)
      .length,
    head_actual: batches.filter((b) => b.head_actual === null || b.head_actual === undefined)
      .length,
    moist_after_dry: batches.filter(
      (b) => b.moist_after_dry === null || b.moist_after_dry === undefined
    ).length,
    moist_before_mold: batches.filter(
      (b) => b.moist_before_mold === null || b.moist_before_mold === undefined
    ).length,
  };

  const missingSample = {
    solubles_pct: samples.filter(
      (s) => s.solubles_pct === null || s.solubles_pct === undefined
    ).length,
    swelling_g_g: samples.filter(
      (s) => s.swelling_g_g === null || s.swelling_g_g === undefined
    ).length,
    density_g_cm3: samples.filter(
      (s) => s.density_g_cm3 === null || s.density_g_cm3 === undefined
    ).length,
  };

  const batchMoist = batches
    .map((b) => b.moist_before_mold)
    .filter((v) => v !== null && v !== undefined)
    .map(Number)
    .filter((v) => Number.isFinite(v));

  const dataQualityOk =
    missingBatch.head_set === 0 &&
    missingBatch.head_actual === 0 &&
    missingBatch.moist_after_dry === 0 &&
    missingBatch.moist_before_mold === 0 &&
    missingSample.solubles_pct === 0 &&
    missingSample.swelling_g_g === 0 &&
    missingSample.density_g_cm3 === 0;

  return {
    missingBatch,
    missingSample,
    batchMoistMin: batchMoist.length ? Math.min(...batchMoist) : null,
    batchMoistMax: batchMoist.length ? Math.max(...batchMoist) : null,
    dataQualityOk,
  };
}
