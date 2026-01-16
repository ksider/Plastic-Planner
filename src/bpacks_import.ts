import { parse as parseCsv } from "csv-parse/sync";

export type BpacksRecipeColumn = {
  name: string;
  norm: string;
  columnIndex: number;
};

export type BpacksComponentRow = {
  name: string;
  values: Record<string, number>;
};

export type BpacksParseResult = {
  delimiter: "," | "\t";
  recipes: BpacksRecipeColumn[];
  components: BpacksComponentRow[];
  warnings: string[];
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeComponent(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function detectDelimiter(text: string): "," | "\t" {
  const firstLine =
    text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  return tabCount > commaCount ? "\t" : ",";
}

export function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let cleaned = trimmed.replace(/\s+/g, "");
  if (cleaned.includes(",") && cleaned.includes(".")) {
    cleaned = cleaned.replace(/,/g, "");
  } else if (cleaned.includes(",")) {
    cleaned = cleaned.replace(/,/g, ".");
  }
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return value;
}

export function parseBpacksMatrix(text: string): BpacksParseResult {
  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, {
    delimiter,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: false,
    trim: false,
  }) as string[][];
  const rows = records.map((row) =>
    row.map((cell) => String(cell ?? ""))
  );
  const warnings: string[] = [];

  const nonEmptyIndexes = rows
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => row.some((cell) => String(cell ?? "").trim() !== ""));
  if (nonEmptyIndexes.length < 2) {
    return {
      delimiter,
      recipes: [],
      components: [],
      warnings: ["File must have at least 2 header rows."],
    };
  }

  const header0Index = nonEmptyIndexes[0].idx;
  const header1Index = nonEmptyIndexes[1].idx;
  const header0 = rows[header0Index] ?? [];
  const header1 = rows[header1Index] ?? [];
  if (header0.length > 0) {
    header0[0] = header0[0].replace(/^\uFEFF/, "");
  }
  const maxCols = Math.max(header0.length, header1.length);

  const recipes: BpacksRecipeColumn[] = [];
  const nameCounts = new Map<string, number>();

  for (let i = 0; i < maxCols; i += 1) {
    const recipeName = String(header0[i] ?? "").trim();
    const subheader = normalizeHeader(String(header1[i] ?? ""));
    if (!recipeName) continue;
    if (subheader !== "phr") continue;

    const norm = normalizeHeader(recipeName);
    const current = nameCounts.get(norm) ?? 0;
    nameCounts.set(norm, current + 1);
    const resolvedName =
      current === 0 ? recipeName : `${recipeName} #${current + 1}`;

    recipes.push({ name: resolvedName, norm: normalizeHeader(resolvedName), columnIndex: i });
  }

  if (recipes.length === 0) {
    warnings.push("No recipe PHR columns detected.");
  }

  const components: BpacksComponentRow[] = [];
  for (let r = header1Index + 1; r < rows.length; r += 1) {
    const row = rows[r] ?? [];
    const rawName = String(row[0] ?? "");
    const name = normalizeComponent(rawName);
    if (!name) {
      if (row.some((cell) => String(cell ?? "").trim() !== "")) {
        warnings.push(`Empty component name at row ${r + 1}`);
      }
      continue;
    }

    const values: Record<string, number> = {};
    for (const recipe of recipes) {
      const raw = String(row[recipe.columnIndex] ?? "");
      const value = parseNumber(raw);
      if (raw.trim() !== "" && value === null) {
        warnings.push(
          `Invalid PHR "${raw.trim()}" at row ${r + 1} for "${recipe.name}"`
        );
        continue;
      }
      if (value !== null && value > 0) {
        values[recipe.norm] = value;
      }
    }

    if (Object.keys(values).length > 0) {
      components.push({ name, values });
    }
  }

  return { delimiter, recipes, components, warnings };
}
