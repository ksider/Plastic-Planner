function formatValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return Number(value).toFixed(3);
}

function buildQuery(selection) {
  const params = new URLSearchParams();
  if (selection.output) params.set("output", selection.output);
  if (selection.factors && selection.factors.length) {
    params.set("factors", selection.factors.join(","));
  }
  if (selection.recipe_ids && selection.recipe_ids.length) {
    params.set("recipe_ids", selection.recipe_ids.join(","));
  }
  if (selection.defect_tags && selection.defect_tags.length) {
    params.set("defect_tags", selection.defect_tags.join(","));
  }
  if (selection.include_excluded) {
    params.set("include_excluded", "1");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

function createCheckboxList(items, selected, name) {
  return items
    .map((item) => {
      const checked = selected.includes(item.value) ? "checked" : "";
      return `
        <label class="analysis-chip">
          <input type="checkbox" name="${name}" value="${item.value}" ${checked} />
          <span>${item.label}</span>
        </label>
      `;
    })
    .join("");
}

function renderLineChart(node, rows, factorCode, factorLabel) {
  if (!window.d3) {
    node.innerHTML = "<div class='note'>Chart unavailable (D3 missing).</div>";
    return;
  }
  const data = rows
    .map((r) => ({
      x: r.factors[factorCode],
      mean: r.mean,
    }))
    .filter((r) => r.mean !== null && r.x !== null && r.x !== undefined);
  if (!data.length) {
    node.innerHTML = "<div class='note'>Not enough data for chart.</div>";
    return;
  }
  const numeric = data.every((d) => typeof d.x === "number");
  const sorted = [...data].sort((a, b) => {
    if (numeric) return Number(a.x) - Number(b.x);
    return String(a.x).localeCompare(String(b.x));
  });

  const width = 720;
  const height = 320;
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };

  node.innerHTML = "";
  const svg = d3
    .select(node)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const xScale = numeric
    ? d3
        .scaleLinear()
        .domain(d3.extent(sorted, (d) => d.x))
        .range([margin.left, width - margin.right])
    : d3
        .scalePoint()
        .domain(sorted.map((d) => String(d.x)))
        .range([margin.left, width - margin.right])
        .padding(0.4);

  const yScale = d3
    .scaleLinear()
    .domain([0, d3.max(sorted, (d) => d.mean) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(xScale));
  svg
    .append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(yScale));

  const line = d3
    .line()
    .x((d) => xScale(numeric ? d.x : String(d.x)))
    .y((d) => yScale(d.mean));

  svg
    .append("path")
    .datum(sorted)
    .attr("fill", "none")
    .attr("stroke", "#2f6b4f")
    .attr("stroke-width", 2)
    .attr("d", line);

  svg
    .selectAll("circle")
    .data(sorted)
    .enter()
    .append("circle")
    .attr("cx", (d) => xScale(numeric ? d.x : String(d.x)))
    .attr("cy", (d) => yScale(d.mean))
    .attr("r", 4)
    .attr("fill", "#2f6b4f");

  svg
    .append("text")
    .attr("x", margin.left)
    .attr("y", margin.top - 6)
    .attr("font-size", 12)
    .attr("fill", "#3c3c36")
    .text(`Mean output vs ${factorLabel}`);
}

function renderHeatmap(node, rows, xCode, yCode, labels) {
  if (!window.d3) {
    node.innerHTML = "<div class='note'>Chart unavailable (D3 missing).</div>";
    return;
  }
  const cells = rows
    .map((r) => ({
      x: r.factors[xCode],
      y: r.factors[yCode],
      mean: r.mean,
    }))
    .filter((r) => r.mean !== null && r.x !== null && r.y !== null);
  if (!cells.length) {
    node.innerHTML = "<div class='note'>Not enough data for heatmap.</div>";
    return;
  }
  const xVals = Array.from(new Set(cells.map((c) => String(c.x))));
  const yVals = Array.from(new Set(cells.map((c) => String(c.y))));

  const width = 720;
  const height = 360;
  const margin = { top: 20, right: 20, bottom: 60, left: 80 };

  node.innerHTML = "";
  const svg = d3
    .select(node)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`);

  const xScale = d3
    .scaleBand()
    .domain(xVals)
    .range([margin.left, width - margin.right])
    .padding(0.05);
  const yScale = d3
    .scaleBand()
    .domain(yVals)
    .range([height - margin.bottom, margin.top])
    .padding(0.05);

  const maxVal = d3.max(cells, (d) => d.mean) || 1;
  const color = d3.scaleSequential(d3.interpolateYlGnBu).domain([maxVal, 0]);

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(xScale));
  svg
    .append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(yScale));

  svg
    .selectAll("rect")
    .data(cells)
    .enter()
    .append("rect")
    .attr("x", (d) => xScale(String(d.x)))
    .attr("y", (d) => yScale(String(d.y)))
    .attr("width", xScale.bandwidth())
    .attr("height", yScale.bandwidth())
    .attr("fill", (d) => color(d.mean));

  svg
    .append("text")
    .attr("x", margin.left)
    .attr("y", margin.top - 6)
    .attr("font-size", 12)
    .attr("fill", "#3c3c36")
    .text(`Heatmap: ${labels[xCode]} vs ${labels[yCode]}`);
}

function loadPlotly() {
  if (window.Plotly) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plot.ly/plotly-2.32.0.min.js";
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function renderPlotlySurface(node, rows, xCode, yCode, labels) {
  const points = rows
    .map((r) => ({ x: r.factors[xCode], y: r.factors[yCode], z: r.mean }))
    .filter((p) => typeof p.x === "number" && typeof p.y === "number" && p.z !== null);
  if (points.length < 4) {
    node.innerHTML = "<div class='note'>Not enough data for 3D surface.</div>";
    return;
  }
  const xVals = Array.from(new Set(points.map((p) => p.x))).sort((a, b) => a - b);
  const yVals = Array.from(new Set(points.map((p) => p.y))).sort((a, b) => a - b);
  const zGrid = yVals.map((y) =>
    xVals.map((x) => {
      const match = points.find((p) => p.x === x && p.y === y);
      return match ? match.z : null;
    })
  );
  node.innerHTML = "";
  window.Plotly.newPlot(
    node,
    [
      {
        type: "surface",
        x: xVals,
        y: yVals,
        z: zGrid,
        showscale: true,
      },
    ],
    {
      title: `3D surface: ${labels[xCode]} vs ${labels[yCode]}`,
      autosize: true,
      margin: { t: 40, r: 10, b: 40, l: 40 },
    }
  );
}

async function loadImAnalysis(selectionOverride = null) {
  const panel = document.getElementById("im-analysis");
  if (!panel) return;
  const endpoint = panel.getAttribute("data-analysis-endpoint");
  if (!endpoint) return;

  panel.innerHTML = "Loading...";
  const query = selectionOverride ? buildQuery(selectionOverride) : "";
  try {
    const resp = await fetch(`${endpoint}${query}`);
    if (!resp.ok) throw new Error("failed");
    const data = await resp.json();

    const selection = data.selection || {};
    const outputs = data.outputs || [];
    const factors = data.factors || [];
    const recipes = data.recipes || [];
    const defectOptions = data.defect_options || [];
    const aggregates = data.aggregates || [];
    const stats = data.stats || {};

    const factorLabelMap = factors.reduce((acc, f) => {
      acc[f.code] = f.label || f.code;
      return acc;
    }, {});

    const controlsHtml = `
      <div class="analysis-controls">
        <div class="analysis-control">
          <label>Output</label>
          <select data-output-select>
            ${outputs
              .map(
                (o) =>
                  `<option value="${o.code}" ${
                    o.code === selection.output ? "selected" : ""
                  }>${o.label}${o.unit ? ` (${o.unit})` : ""}</option>`
              )
              .join("")}
          </select>
        </div>
        <div class="analysis-control">
          <label>Factors</label>
          <div class="analysis-chip-list">
            ${createCheckboxList(
              factors.map((f) => ({ value: f.code, label: f.label })),
              selection.factors || [],
              "factors"
            )}
          </div>
        </div>
        <div class="analysis-control">
          <label>Recipe filter</label>
          <div class="analysis-chip-list">
            ${createCheckboxList(
              recipes.map((r) => ({ value: String(r.id), label: r.name })),
              (selection.recipe_ids || []).map(String),
              "recipes"
            )}
          </div>
        </div>
        <div class="analysis-control">
          <label>Defect filter</label>
          <div class="analysis-chip-list">
            ${createCheckboxList(
              defectOptions.map((tag) => ({ value: tag, label: tag })),
              selection.defect_tags || [],
              "defects"
            )}
          </div>
        </div>
        <label class="analysis-toggle">
          <input type="checkbox" data-include-excluded ${
            selection.include_excluded ? "checked" : ""
          } />
          <span>Include excluded runs</span>
        </label>
      </div>
    `;

    const statsHtml = `
      <div class="analysis-stats">
        <div class="analysis-stat-grid">
          <div><label>R2 adj</label><div>${formatValue(stats.r2_adj)}</div></div>
          <div><label>Residual SE</label><div>${formatValue(stats.residual_se)}</div></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Factor</th><th>Δmean</th><th>Pooled SD</th><th>Std effect</th></tr></thead>
            <tbody>
              ${(stats.delta_mean || [])
                .map(
                  (row) => `
                    <tr>
                      <td>${row.label || row.code}</td>
                      <td>${formatValue(row.delta_mean)}</td>
                      <td>${formatValue(row.pooled_sd)}</td>
                      <td>${formatValue(row.effect)}</td>
                    </tr>
                  `
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const factorHeaders = (selection.factors || []).map(
      (code) => `<th>${factorLabelMap[code] || code}</th>`
    );

    const aggregateTable = `
      <div class="analysis-table">
        <h3>Replicate aggregates</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                ${factorHeaders.join("")}
                <th>n</th>
                <th>mean</th>
                <th>sd</th>
              </tr>
            </thead>
            <tbody>
              ${aggregates
                .map((row) => {
                  const factorCells = (selection.factors || []).map(
                    (code) => `<td>${row.factors[code] ?? ""}</td>`
                  );
                  return `
                    <tr>
                      ${factorCells.join("")}
                      <td>${row.n}</td>
                      <td>${formatValue(row.mean)}</td>
                      <td>${formatValue(row.sd)}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    panel.innerHTML = `
      ${controlsHtml}
      ${statsHtml}
      <div class="analysis-visuals"></div>
      ${aggregateTable}
    `;

    const visuals = panel.querySelector(".analysis-visuals");
    if (visuals) {
      const activeFactors = selection.factors || [];
      if (activeFactors.length === 1) {
        const chart = document.createElement("div");
        chart.className = "analysis-chart";
        visuals.appendChild(chart);
        renderLineChart(chart, aggregates, activeFactors[0], factorLabelMap[activeFactors[0]]);
      } else if (activeFactors.length >= 2) {
        const chart = document.createElement("div");
        chart.className = "analysis-chart";
        visuals.appendChild(chart);
        renderHeatmap(
          chart,
          aggregates,
          activeFactors[0],
          activeFactors[1],
          factorLabelMap
        );
        const surfaceEligible = aggregates.some(
          (row) =>
            typeof row.factors[activeFactors[0]] === "number" &&
            typeof row.factors[activeFactors[1]] === "number" &&
            row.mean !== null
        );
        if (surfaceEligible) {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn secondary";
          btn.textContent = "Show 3D surface";
          const surface = document.createElement("div");
          surface.className = "analysis-chart";
          btn.addEventListener("click", async () => {
            btn.disabled = true;
            btn.textContent = "Loading 3D...";
            try {
              await loadPlotly();
              renderPlotlySurface(
                surface,
                aggregates,
                activeFactors[0],
                activeFactors[1],
                factorLabelMap
              );
              btn.remove();
            } catch {
              btn.disabled = false;
              btn.textContent = "Show 3D surface";
              surface.innerHTML = "<div class='note'>Failed to load 3D surface.</div>";
            }
          });
          visuals.appendChild(btn);
          visuals.appendChild(surface);
        }
      } else {
        visuals.innerHTML = "<div class='note'>Select at least one factor to visualize.</div>";
      }
    }

    const updateSelection = () => {
      const output = panel.querySelector("[data-output-select]").value;
      const factorChecks = Array.from(
        panel.querySelectorAll("input[name='factors']")
      );
      const recipeChecks = Array.from(
        panel.querySelectorAll("input[name='recipes']")
      );
      const defectChecks = Array.from(
        panel.querySelectorAll("input[name='defects']")
      );
      const includeExcluded = panel.querySelector("[data-include-excluded]").checked;
      const next = {
        output,
        factors: factorChecks.filter((c) => c.checked).map((c) => c.value),
        recipe_ids: recipeChecks.filter((c) => c.checked).map((c) => c.value),
        defect_tags: defectChecks.filter((c) => c.checked).map((c) => c.value),
        include_excluded: includeExcluded ? 1 : 0,
      };
      loadImAnalysis(next);
    };

    panel.querySelector("[data-output-select]").addEventListener("change", updateSelection);
    panel.querySelectorAll("input[name='factors']").forEach((input) => {
      input.addEventListener("change", updateSelection);
    });
    panel.querySelectorAll("input[name='recipes']").forEach((input) => {
      input.addEventListener("change", updateSelection);
    });
    panel.querySelectorAll("input[name='defects']").forEach((input) => {
      input.addEventListener("change", updateSelection);
    });
    panel.querySelector("[data-include-excluded]").addEventListener("change", updateSelection);
  } catch {
    panel.innerHTML = "<div class='note'>Failed to load analysis.</div>";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadImAnalysis();
});
