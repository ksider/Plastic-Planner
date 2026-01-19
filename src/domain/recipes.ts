import type { Database } from "sqlite";
import { parseNumber, slugify } from "../utils.js";
import type { RecipeComponentInput } from "../types.js";

type StructureFixed = { name: string; parts: number };
type StructureGroup = {
  name?: string;
  members: string[];
  sum_cap?: number;
  allowed_splits: number[][];
  independent?: boolean;
};
type StructureDefinition = {
  fixed?: StructureFixed[];
  groups?: StructureGroup[];
};

export function defaultRecipeComponents(): RecipeComponentInput[] {
  return [
    {
      name: "Corn starch (fg)",
      mode: "static",
      parts_static: 100,
      parts_min: null,
      parts_max: null,
      is_locked: 0,
    },
  ];
}

export function normalizeComponents(bodyComponents: any): RecipeComponentInput[] {
  if (!bodyComponents) return [];
  const rawItems = Array.isArray(bodyComponents)
    ? bodyComponents
    : Object.values(bodyComponents);
  const items: RecipeComponentInput[] = [];

  for (const raw of rawItems) {
    const name = String(raw.name || "").trim();
    const is_locked = 0;
    const mode =
      raw.mode === "range"
        ? "range"
        : raw.mode === "paired"
        ? "paired"
        : "static";
    const removeFlag = String(raw.remove || "0") === "1";
    if (!name || removeFlag) continue;

    const parts_static = parseNumber(raw.parts_static);
    const parts_min = parseNumber(raw.parts_min);
    const parts_max = parseNumber(raw.parts_max);
    const splits =
      raw.splits !== undefined && raw.splits !== null
        ? String(raw.splits).trim()
        : "";

    if (mode === "static" && parts_static === null) continue;
    if (mode === "range" && (parts_min === null || parts_max === null)) continue;
    if (mode === "paired" && parts_max === null) continue;

    items.push({
      name,
      mode,
      parts_static,
      parts_min,
      parts_max,
      is_locked,
      splits: splits.length ? splits : null,
    });
  }

  if (items.length === 0) {
    items.unshift({
      name: "Corn starch (fg)",
      mode: "static",
      parts_static: 100,
      parts_min: null,
      parts_max: null,
      is_locked: 0,
    });
  }

  return items;
}

export async function saveRecipeComponents(
  db: Database,
  recipeId: number,
  components: RecipeComponentInput[]
) {
  let position = 1;
  for (const component of components) {
    await db.run(
      `INSERT INTO recipe_components
        (recipe_id, name, mode, parts_static, parts_min, parts_max, position, is_locked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        recipeId,
        component.name,
        component.mode,
        component.parts_static,
        component.parts_min,
        component.parts_max,
        position,
        component.is_locked,
      ]
    );
    position += 1;
  }
}

export type RecipeVariant = {
  variant: string | null;
  partsEntries: Array<{ name: string; parts_used: number }>;
};

export function buildRecipeVariantsFromComponents(
  components: RecipeComponentInput[]
): RecipeVariant[] {
  const baseComponents = components.length ? components : defaultRecipeComponents();
  const rangeDefs = baseComponents.filter(
    (c) =>
      c.mode === "range" &&
      c.parts_min !== null &&
      c.parts_max !== null
  );
  if (rangeDefs.length === 0) {
    return [
      {
        variant: null,
        partsEntries: baseComponents.map((c) => ({
          name: c.name,
          parts_used: c.parts_static ?? 0,
        })),
      },
    ];
  }

  type VariantState = { tokens: string[]; valueMap: Map<string, number> };
  let variants: VariantState[] = [{ tokens: [], valueMap: new Map() }];

  for (const def of rangeDefs) {
    const tokenBase = slugify(def.name) || "component";
    const next: VariantState[] = [];
    for (const v of variants) {
      next.push({
        tokens: [...v.tokens, `${tokenBase}_min`],
        valueMap: new Map([...v.valueMap, [def.name, def.parts_min as number]]),
      });
      next.push({
        tokens: [...v.tokens, `${tokenBase}_max`],
        valueMap: new Map([...v.valueMap, [def.name, def.parts_max as number]]),
      });
    }
    variants = next;
  }

  return variants.map((variant) => {
    const partsEntries = baseComponents.map((c) => {
      const value = variant.valueMap.get(c.name);
      return {
        name: c.name,
        parts_used: value !== undefined ? value : c.parts_static ?? 0,
      };
    });
    return {
      variant: variant.tokens.join("-"),
      partsEntries,
    };
  });
}

export function parseTagsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((tag) => String(tag).trim()).filter((tag) => tag.length > 0);
  } catch {
    return [];
  }
}

export function normalizeTagsInput(input: string): string[] {
  if (!input) return [];
  return input
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function parseStructureDefinition(
  raw: string | null | undefined
): StructureDefinition | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const fixed = Array.isArray(parsed.fixed)
    ? parsed.fixed
        .map((item: any) => ({
          name: String(item?.name || "").trim(),
          parts: Number(item?.parts),
        }))
        .filter(
          (item: StructureFixed) =>
            item.name.length > 0 && Number.isFinite(item.parts)
        )
    : [];

  const groups = Array.isArray(parsed.groups)
    ? parsed.groups
        .map((group: any) => {
          const members = Array.isArray(group?.members)
            ? group.members.map((m: any) => String(m || "").trim()).filter(Boolean)
            : [];
          const allowedSplits = Array.isArray(group?.allowed_splits)
            ? group.allowed_splits
                .map((split: any) =>
                  Array.isArray(split)
                    ? split.map((v: any) => Number(v))
                    : []
                )
                .filter((split: number[]) => split.length > 0)
            : [];
          const sumCap = Number(group?.sum_cap);
          return {
            name: group?.name ? String(group.name).trim() : undefined,
            members,
            sum_cap: Number.isFinite(sumCap) ? sumCap : undefined,
            allowed_splits: allowedSplits,
            independent: Boolean(group?.independent),
          } as StructureGroup;
        })
        .filter(
          (group: StructureGroup) =>
            group.members.length > 0 && group.allowed_splits.length > 0
        )
    : [];

  if (fixed.length === 0 && groups.length === 0) return null;
  return { fixed, groups };
}

function parseSplitToken(
  value: string,
  sumCap: number,
  minVal?: number | null,
  maxVal?: number | null
) {
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "min" && minVal !== null && minVal !== undefined) return minVal;
  if (raw === "max") return sumCap;
  if (raw === "mid" && minVal !== null && minVal !== undefined && maxVal !== null && maxVal !== undefined) {
    return (minVal + maxVal) / 2;
  }
  if (raw === "max/2" || raw === "max*0.5") return sumCap / 2;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

export function parsePairedSplits(
  raw: string | null | undefined,
  membersCount: number,
  sumCap: number,
  minVal?: number | null,
  maxVal?: number | null
): number[][] {
  const text = String(raw || "").trim();
  if (!text) return [];
  const splitTokens = text
    .split(/[;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const splits: number[][] = [];
  splitTokens.forEach((entry) => {
    let parts = entry
      .split(/[, ]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (
      parts.length === 1 &&
      membersCount === 2 &&
      entry.includes("/") &&
      !entry.toLowerCase().includes("max/")
    ) {
      parts = entry
        .split("/")
        .map((p) => p.trim())
        .filter(Boolean);
    }
    if (parts.length !== membersCount) return;
    const values = parts
      .map((part) => parseSplitToken(part, sumCap, minVal, maxVal))
      .filter((v) => v !== null) as number[];
    if (values.length !== membersCount) return;
    splits.push(values);
  });
  return splits;
}

export function buildStructureFromPairedComponents(
  components: RecipeComponentInput[]
): StructureDefinition | null {
  const fixed: StructureFixed[] = [];
  const groups: StructureGroup[] = [];

  for (const component of components) {
    const name = String(component.name || "").trim();
    if (!name) continue;
    const members = name.split("/").map((m) => m.trim()).filter(Boolean);
    if (members.length > 1) {
      const minVal = component.parts_min ?? null;
      const maxVal = component.parts_max ?? null;
      const sumCapRaw =
        maxVal ?? component.parts_static ?? minVal ?? null;
      const sumCap = sumCapRaw !== null ? Number(sumCapRaw) : null;
      if (!Number.isFinite(sumCap) || sumCap === null) continue;
      const customSplits = parsePairedSplits(
        component.splits,
        members.length,
        sumCap,
        minVal,
        maxVal
      );
      let allowedSplits: number[][];
      if (customSplits.length > 0) {
        allowedSplits = customSplits;
      } else if (minVal !== null && maxVal !== null && Number.isFinite(minVal) && Number.isFinite(maxVal)) {
        const mid = (minVal + maxVal) / 2;
        allowedSplits = [
          [minVal, maxVal],
          [mid, mid],
          [maxVal, minVal],
        ];
      } else {
        allowedSplits = [
          Array(members.length).fill(0),
          [sumCap, ...Array(members.length - 1).fill(0)],
          Array(members.length).fill(sumCap / members.length),
          [...Array(members.length - 1).fill(0), sumCap],
        ];
      }
      groups.push({
        name,
        members,
        sum_cap: sumCap,
        allowed_splits: allowedSplits,
      });
    } else if (component.parts_static !== null && component.parts_static !== undefined) {
      fixed.push({ name, parts: component.parts_static });
    }
  }

  if (!fixed.length && !groups.length) return null;
  return { fixed, groups };
}

function buildStructureVariants(def: StructureDefinition): RecipeVariant[] {
  const fixed = def.fixed ?? [];
  const groups = def.groups ?? [];

  if (groups.length === 0) {
    return [
      {
        variant: null,
        partsEntries: fixed.map((item) => ({
          name: item.name,
          parts_used: item.parts,
        })),
      },
    ];
  }

  const groupSplits = groups.map((group) => {
    const cleanSplits = group.allowed_splits
      .map((split) => split.map((v) => Number(v)))
      .filter((split) => split.length === group.members.length)
      .filter((split) => split.every((v) => Number.isFinite(v) && v >= 0))
      .filter((split) => {
        if (group.sum_cap === undefined) return true;
        const total = split.reduce((sum, v) => sum + v, 0);
        return total <= group.sum_cap;
      });
    return {
      group,
      splits: cleanSplits,
    };
  });

  const base: Array<{
    tokens: string[];
    parts: Array<{ name: string; parts_used: number }>;
  }> = [{ tokens: [], parts: fixed.map((item) => ({ name: item.name, parts_used: item.parts })) }];

  let variants = base;
  groupSplits.forEach(({ group, splits }) => {
    const next: typeof variants = [];
    const tokenBase = slugify(group.name || group.members.join("-")) || "group";
    splits.forEach((split) => {
      variants.forEach((variant) => {
        const parts = [...variant.parts];
        split.forEach((value, idx) => {
          const name = group.members[idx];
          parts.push({ name, parts_used: value });
        });
        const token = `${tokenBase}_${split.join("_")}`;
        next.push({
          tokens: [...variant.tokens, token],
          parts,
        });
      });
    });
    variants = next;
  });

  return variants.map((variant) => {
    const mergedMap = new Map<string, number>();
    variant.parts.forEach((entry) => {
      mergedMap.set(entry.name, (mergedMap.get(entry.name) ?? 0) + entry.parts_used);
    });
    return {
      variant: variant.tokens.join("__"),
      partsEntries: Array.from(mergedMap.entries()).map(([name, parts_used]) => ({
        name,
        parts_used,
      })),
    };
  });
}

export function buildRecipeVariants(
  recipe: { tags_json?: string | null; structure_json?: string | null },
  components: RecipeComponentInput[]
): RecipeVariant[] {
  const tags = parseTagsJson(recipe.tags_json);
  const structure = parseStructureDefinition(recipe.structure_json);
  const hasStructureTag = tags.some((tag) =>
    ["structure", "paired", "discrete", "split"].includes(tag.toLowerCase())
  );
  if (structure && (hasStructureTag || tags.length === 0)) {
    return buildStructureVariants(structure);
  }
  return buildRecipeVariantsFromComponents(components);
}

export function getRecipeVariantCount(
  recipe: { tags_json?: string | null; structure_json?: string | null },
  components: RecipeComponentInput[]
) {
  const variants = buildRecipeVariants(recipe, components);
  return Math.max(1, variants.length);
}

export function recipeComponentSearchText(components: RecipeComponentInput[]) {
  return components
    .map((c) => {
      if (c.mode === "paired" && c.parts_max !== null) {
        if (c.parts_min !== null && c.parts_min !== undefined) {
          return `${c.name} ${c.parts_min}-${c.parts_max}`.trim();
        }
        return `${c.name} ${c.parts_max}`.trim();
      }
      if (c.mode === "range" && c.parts_min !== null && c.parts_max !== null) {
        return `${c.name} ${c.parts_min}-${c.parts_max}`.trim();
      }
      if (c.parts_static !== null && c.parts_static !== undefined) {
        return `${c.name} ${c.parts_static}`.trim();
      }
      return c.name;
    })
    .join(" ");
}

export function recipeSearchText(
  components: RecipeComponentInput[],
  recipe: { tags_json?: string | null; structure_json?: string | null }
) {
  const base = recipeComponentSearchText(components);
  const tags = parseTagsJson(recipe.tags_json).join(" ");
  const structure = parseStructureDefinition(recipe.structure_json);
  const structureText = structure
    ? [
        ...(structure.fixed || []).map((f) => `${f.name} ${f.parts}`),
        ...(structure.groups || []).map((g) => (g.name || g.members.join(" "))),
        ...(structure.groups || []).flatMap((g) => g.members),
      ].join(" ")
    : "";
  return [base, tags, structureText].filter(Boolean).join(" ");
}
