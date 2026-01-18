import type { Database } from "sqlite";
import { parseNumber, slugify } from "../utils.js";
import type { RecipeComponentInput } from "../types.js";

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
    const mode = raw.mode === "range" ? "range" : "static";
    const removeFlag = String(raw.remove || "0") === "1";
    if (!name || removeFlag) continue;

    const parts_static = parseNumber(raw.parts_static);
    const parts_min = parseNumber(raw.parts_min);
    const parts_max = parseNumber(raw.parts_max);

    if (mode === "static" && parts_static === null) continue;
    if (mode === "range" && (parts_min === null || parts_max === null)) continue;

    items.push({
      name,
      mode,
      parts_static,
      parts_min,
      parts_max,
      is_locked,
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

export function recipeComponentSearchText(components: RecipeComponentInput[]) {
  return components
    .map((c) => {
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
