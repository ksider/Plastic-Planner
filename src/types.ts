export type RecipeComponentInput = {
  name: string;
  mode: string;
  parts_static: number | null;
  parts_min: number | null;
  parts_max: number | null;
  is_locked: number;
  splits?: string | null;
};

export type SampleFieldDef = {
  key: string;
  label: string;
  type: "number" | "text" | "tags";
  options?: string[];
  analyze?: boolean;
  is_core?: boolean;
  is_default?: boolean;
};

export type ImParamDef = {
  id: number;
  code: string;
  label: string;
  unit: string | null;
  stage: string;
  group_label: string;
  min_default: number | null;
  max_default: number | null;
  options_json?: string | null;
  is_output: number;
};
