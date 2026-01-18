function getExtrusionAnalysisData() {
  const node = document.getElementById("extrusion-analysis-data");
  if (!node) return null;
  try {
    return JSON.parse(node.textContent || "{}");
  } catch {
    return null;
  }
}

function createSvg(container, width, height) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  container.appendChild(svg);
  return svg;
}

function addText(svg, text, x, y, opts = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "text");
  node.textContent = text;
  node.setAttribute("x", String(x));
  node.setAttribute("y", String(y));
  node.setAttribute("font-size", opts.size || "12");
  node.setAttribute("fill", opts.color || "#1f2a24");
  if (opts.anchor) node.setAttribute("text-anchor", opts.anchor);
  if (opts.weight) node.setAttribute("font-weight", opts.weight);
  svg.appendChild(node);
}

function addLine(svg, x1, y1, x2, y2, color = "#d7d3c8") {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "line");
  node.setAttribute("x1", String(x1));
  node.setAttribute("y1", String(y1));
  node.setAttribute("x2", String(x2));
  node.setAttribute("y2", String(y2));
  node.setAttribute("stroke", color);
  node.setAttribute("stroke-width", "1");
  svg.appendChild(node);
}

function addRect(svg, x, y, width, height, fill) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  node.setAttribute("x", String(x));
  node.setAttribute("y", String(y));
  node.setAttribute("width", String(width));
  node.setAttribute("height", String(height));
  node.setAttribute("fill", fill);
  node.setAttribute("rx", "4");
  svg.appendChild(node);
}

function renderViscosityByRecipe(container, runs) {
  const grouped = new Map();
  runs.forEach((run) => {
    const value = run.metrics?.viscosity_pa_s;
    if (value === null || value === undefined) return;
    const list = grouped.get(run.recipe) || [];
    list.push(Number(value));
    grouped.set(run.recipe, list);
  });
  const items = Array.from(grouped.entries()).map(([recipe, values]) => {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    return { recipe, value: avg };
  });
  if (!items.length) {
    container.innerHTML = "<div class='small'>No viscosity data yet.</div>";
    return;
  }
  const width = Math.max(420, container.clientWidth || 420);
  const height = Math.max(240, items.length * 24 + 60);
  const margin = { top: 20, right: 60, bottom: 30, left: 140 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxValue = Math.max(...items.map((d) => d.value));
  const barHeight = chartHeight / items.length;

  const svg = createSvg(container, width, height);
  addText(svg, "Viscosity by recipe (Pa·s)", margin.left, 16, {
    size: "13",
    weight: "600",
  });

  items.forEach((d, i) => {
    const y = margin.top + i * barHeight;
    const barWidth = maxValue > 0 ? (d.value / maxValue) * chartWidth : 0;
    addText(svg, d.recipe, margin.left - 8, y + barHeight * 0.7, {
      size: "12",
      anchor: "end",
    });
    addRect(svg, margin.left, y + 4, barWidth, Math.max(8, barHeight - 8), "#2f6b4f");
    const labelX = Math.min(
      margin.left + barWidth + 6,
      margin.left + chartWidth + 40
    );
    addText(svg, d.value.toFixed(2), labelX, y + barHeight * 0.7, {
      size: "11",
      color: "#4b4b46",
    });
  });
}

function renderViscosityVsShear(container, runs) {
  const points = runs
    .map((run) => ({
      shear_kpa:
        run.metrics?.shear_stress_pa !== null && run.metrics?.shear_stress_pa !== undefined
          ? Number(run.metrics.shear_stress_pa) / 1000
          : null,
      viscosity: run.metrics?.viscosity_pa_s ?? null,
    }))
    .filter((p) => p.shear_kpa !== null && p.viscosity !== null);

  const shearValues = Array.from(new Set(points.map((p) => p.shear_kpa))).filter(
    (v) => Number.isFinite(v)
  );
  if (points.length === 0) {
    container.innerHTML = "<div class='small'>No shear stress data yet.</div>";
    return;
  }
  if (shearValues.length < 2) {
    container.innerHTML = "<div class='small'>Shear stress is fixed; no variability to chart.</div>";
    return;
  }

  const width = Math.max(420, container.clientWidth || 420);
  const height = 260;
  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const maxX = Math.max(...points.map((p) => p.shear_kpa));
  const maxY = Math.max(...points.map((p) => p.viscosity));

  const svg = createSvg(container, width, height);
  addText(svg, "Viscosity vs shear stress (kPa)", margin.left, 16, {
    size: "13",
    weight: "600",
  });

  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const t = i / ticks;
    const x = margin.left + t * chartWidth;
    const y = margin.top + chartHeight - t * chartHeight;
    addLine(svg, x, margin.top, x, margin.top + chartHeight, "#eee7d9");
    addLine(svg, margin.left, y, margin.left + chartWidth, y, "#eee7d9");
    addText(svg, (maxX * t).toFixed(1), x, margin.top + chartHeight + 16, {
      size: "11",
      anchor: "middle",
      color: "#4b4b46",
    });
    addText(svg, (maxY * t).toFixed(1), margin.left - 8, y + 4, {
      size: "11",
      anchor: "end",
      color: "#4b4b46",
    });
  }

  points.forEach((p) => {
    const x = margin.left + (p.shear_kpa / maxX) * chartWidth;
    const y = margin.top + chartHeight - (p.viscosity / maxY) * chartHeight;
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.setAttribute("r", "4");
    dot.setAttribute("fill", "#2f6b4f");
    svg.appendChild(dot);
  });
}

function renderExtrusionCharts() {
  const data = getExtrusionAnalysisData();
  if (!data || !data.runs) return;
  const container = document.getElementById("extrusion-charts");
  if (!container) return;
  container.innerHTML = "";

  const barCard = document.createElement("div");
  const scatterCard = document.createElement("div");
  barCard.className = "card";
  scatterCard.className = "card";
  container.appendChild(barCard);
  container.appendChild(scatterCard);

  renderViscosityByRecipe(barCard, data.runs);
  renderViscosityVsShear(scatterCard, data.runs);
}

function setupExtrusionRecalc() {
  const btn = document.querySelector("[data-extrusion-recalc]");
  if (!btn) return;
  btn.addEventListener("click", () => {
    window.location.reload();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderExtrusionCharts();
  setupExtrusionRecalc();
});
