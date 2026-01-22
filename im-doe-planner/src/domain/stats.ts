import jStat from "jstat";

export function mean(values: number[]): number {
  if (!values.length) return NaN;
  return jStat.mean(values);
}

export function sd(values: number[]): number {
  if (values.length < 2) return NaN;
  return jStat.stdev(values, true);
}

export function linearRegression(y: number[], x: number[][]) {
  if (y.length === 0) {
    return { coefficients: [], r2: NaN };
  }
  const model = jStat.models.ols(y, x);
  return { coefficients: model.coef, r2: model.r2 };
}
