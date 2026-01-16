function createTooltip() {
  let tooltip = document.getElementById("chart-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "chart-tooltip";
    tooltip.className = "chart-tooltip";
    document.body.appendChild(tooltip);
  }
  return tooltip;
}

function showTooltip(tooltip, html, x, y) {
  tooltip.innerHTML = html;
  tooltip.style.left = `${x + 12}px`;
  tooltip.style.top = `${y + 12}px`;
  tooltip.style.opacity = "1";
}

function hideTooltip(tooltip) {
  tooltip.style.opacity = "0";
}

function renderQuality(panel, quality, labels, selectedMetrics) {
  const metricLabel = selectedMetrics.join(", ");
  const severityClass =
    quality.severity === "OK"
      ? "badge ok"
      : quality.severity === "WARNING"
      ? "badge warn"
      : "badge bad";

  panel.innerHTML = `
    <div class="quality-grid">
      <div>
        <span class="${severityClass}">${quality.severity}</span>
        <div class="small" style="margin-top:6px;">Analyzing: ${metricLabel}</div>
        <div class="small">Runs: ${quality.counts.runs}</div>
      </div>
      <div>
        <div class="small">Missing ${labels.temp}: ${quality.missing.temp}%</div>
        <div class="small">Missing ${labels.scatter}: ${quality.missing.scatter}%</div>
        <div class="small">Missing metrics: ${Object.values(quality.missing.metrics).join("%, ")}%</div>
      </div>
      <div>
        <div class="small">Recipes: ${quality.coverage.recipes} · Temps: ${quality.coverage.temps}</div>
        <div class="small">Replicates: min ${quality.coverage.replicates.min}, avg ${quality.coverage.replicates.avg.toFixed(1)}, max ${quality.coverage.replicates.max}</div>
      </div>
    </div>
    <div class="quality-messages">
      ${quality.messages.blockers.map((m) => `<div class="bad">${m}</div>`).join("")}
      ${quality.messages.warnings.map((m) => `<div class="warn">${m}</div>`).join("")}
      ${quality.messages.actions.map((m) => `<div class="action">${m}</div>`).join("")}
    </div>
  `;
}

function renderInsights(container, metrics, tagsSummary, textNotes) {
  const blocks = metrics
    .map((metric) => {
      const items = metric.insights
        .map((i) => `<div class="insight ${i.severity}">${i.text}</div>`)
        .join("");
      const caveatHtml = metric.caveats.length
        ? `<div class="caveats"><strong>Caveats:</strong> ${metric.caveats.join(
            ", "
          )}</div>`
        : "";
      return `
        <div class="metric-block">
          <h4>${metric.label}</h4>
          <div class="insights-list">${items || "<div class='warn'>Not enough data for insights yet.</div>"}</div>
          ${caveatHtml}
        </div>
      `;
    })
    .join("");
  const tagsHtml = Object.keys(tagsSummary || {}).length
    ? `<div class="caveats"><strong>Tag frequency:</strong>${Object.entries(
        tagsSummary
      )
        .map(
          ([field, counts]) =>
            ` ${field}: ` +
            Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .map(([tag, count]) => `${tag} (${count})`)
              .join(", ")
        )
        .join(" · ")}</div>`
    : "";
  const textHtml = Object.keys(textNotes || {}).length
    ? `<div class="caveats"><strong>Notes:</strong>${Object.entries(textNotes)
        .map(
          ([field, rows]) =>
            ` ${field}: ` +
            rows
              .slice(0, 5)
              .map((r) => `${r.run}: ${r.value}`)
              .join(" | ")
        )
        .join(" · ")}</div>`
    : "";
  container.innerHTML = `${blocks}${tagsHtml}${textHtml}`;
}

function renderMetricTables(container, metrics, labels) {
  if (!container) return;
  if (!metrics.length) {
    container.innerHTML = "<div class='small'>No metrics selected.</div>";
    return;
  }
  const blocks = metrics
    .map((metric) => {
      const recipeRows = metric.recipeStats
        .map(
          (r) => `
          <tr>
            <td>${r.recipe}</td>
            <td>${r.n}</td>
            <td>${r.mean !== null ? r.mean.toFixed(3).replace(/\\.?0+$/, "") : ""}</td>
            <td>${r.sd !== null ? r.sd.toFixed(3).replace(/\\.?0+$/, "") : ""}</td>
          </tr>`
        )
        .join("");
      const tempRows = metric.recipeTempStats
        .map(
          (r) => `
          <tr>
            <td>${r.recipe}</td>
            <td>${r.temp}</td>
            <td>${r.n}</td>
            <td>${r.mean !== null ? r.mean.toFixed(3).replace(/\\.?0+$/, "") : ""}</td>
            <td>${r.sd !== null ? r.sd.toFixed(3).replace(/\\.?0+$/, "") : ""}</td>
          </tr>`
        )
        .join("");
      const topRows = metric.topSamples
        .map(
          (r) => `
          <tr>
            <td>${r.run_code}</td>
            <td>${r.recipe}</td>
            <td>${r.temp ?? ""}</td>
            <td>${r.value.toFixed(3).replace(/\\.?0+$/, "")}</td>
            <td>${r.scatter ?? ""}</td>
            <td>${r.notes ?? ""}</td>
          </tr>`
        )
        .join("");
      return `
        <div class="card">
          <h2>${metric.label} by Recipe</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipe</th>
                  <th>n</th>
                  <th>mean</th>
                  <th>sd</th>
                </tr>
              </thead>
              <tbody>${recipeRows}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <h2>${metric.label} by Recipe × ${labels.temp}</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipe</th>
                  <th>${labels.temp}</th>
                  <th>n</th>
                  <th>mean</th>
                  <th>sd</th>
                </tr>
              </thead>
              <tbody>${tempRows}</tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <h2>Top 10 Best (Lowest ${metric.label})</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>RunCode</th>
                  <th>Recipe</th>
                  <th>${labels.temp}</th>
                  <th>${metric.label}</th>
                  <th>${labels.scatter}</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>${topRows}</tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join("");
  container.innerHTML = blocks;
}

function renderLineChart(container, data, metricLabel, labels) {
  if (!data.length) {
    container.innerHTML = "<div class='small'>Not enough data for line chart.</div>";
    return;
  }
  const width = 520;
  const height = 320;
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const temps = Array.from(new Set(data.map((d) => d.temp))).sort((a, b) => a - b);
  const recipes = Array.from(new Set(data.map((d) => d.recipe)));

  const x = d3
    .scaleLinear()
    .domain(d3.extent(temps))
    .range([margin.left, width - margin.right]);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.mean || 0) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const color = d3.scaleOrdinal().domain(recipes).range(d3.schemeTableau10);

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x));
  svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y));

  const line = d3
    .line()
    .x((d) => x(d.temp))
    .y((d) => y(d.mean));

  const tooltip = createTooltip();
  const grouped = d3.group(data, (d) => d.recipe);
  for (const [recipe, points] of grouped) {
    points.sort((a, b) => a.temp - b.temp);
    svg
      .append("path")
      .datum(points)
      .attr("fill", "none")
      .attr("stroke", color(recipe))
      .attr("stroke-width", 2)
      .attr("d", line);
    svg
      .selectAll("circle.point")
      .data(points)
      .enter()
      .append("circle")
      .attr("class", "point")
      .attr("cx", (d) => x(d.temp))
      .attr("cy", (d) => y(d.mean))
      .attr("r", 4)
      .attr("fill", color(recipe))
      .on("mousemove", (event, d) => {
        showTooltip(
          tooltip,
        `${recipe}<br/>${labels.temp} ${d.temp}<br/>n=${d.n}, mean=${d.mean?.toFixed(2) ?? "n/a"}, sd=${d.sd?.toFixed(2) ?? "n/a"} ${metricLabel}`,
        event.pageX,
        event.pageY
      );
      })
      .on("mouseleave", () => hideTooltip(tooltip));
  }
}

function renderHeatmap(container, cells, metricLabel, labels) {
  if (!cells.length) {
    container.innerHTML = "<div class='small'>Not enough data for heatmap.</div>";
    return;
  }
  const width = 520;
  const height = 300;
  const margin = { top: 20, right: 20, bottom: 40, left: 120 };
  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const temps = Array.from(new Set(cells.map((c) => c.temp))).sort((a, b) => a - b);
  const recipes = Array.from(new Set(cells.map((c) => c.recipe)));
  const x = d3
    .scaleBand()
    .domain(temps.map(String))
    .range([margin.left, width - margin.right])
    .padding(0.05);
  const y = d3
    .scaleBand()
    .domain(recipes)
    .range([margin.top, height - margin.bottom])
    .padding(0.05);

  const maxVal = d3.max(cells, (d) => d.mean || 0) || 1;
  const color = d3.scaleSequential(d3.interpolateYlGnBu).domain([maxVal, 0]);

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x));
  svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y));

  const tooltip = createTooltip();
  svg
    .selectAll("rect")
    .data(cells)
    .enter()
    .append("rect")
    .attr("x", (d) => x(String(d.temp)))
    .attr("y", (d) => y(d.recipe))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("fill", (d) => color(d.mean || 0))
    .on("mousemove", (event, d) => {
      showTooltip(
        tooltip,
        `${d.recipe}<br/>${labels.temp} ${d.temp}<br/>n=${d.n}, mean=${d.mean?.toFixed(2) ?? "n/a"}, sd=${d.sd?.toFixed(2) ?? "n/a"} ${metricLabel}`,
        event.pageX,
        event.pageY
      );
    })
    .on("mouseleave", () => hideTooltip(tooltip));
}

function renderScatter(container, points, lines, metricLabel, labels) {
  if (!points.length) {
    container.innerHTML = "<div class='small'>Not enough data for scatter.</div>";
    return;
  }
  const width = 520;
  const height = 300;
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3
    .scaleLinear()
    .domain(d3.extent(points, (d) => d.x))
    .nice()
    .range([margin.left, width - margin.right]);
  const y = d3
    .scaleLinear()
    .domain(d3.extent(points, (d) => d.y))
    .nice()
    .range([height - margin.bottom, margin.top]);

  const recipes = Array.from(new Set(points.map((p) => p.recipe)));
  const color = d3.scaleOrdinal().domain(recipes).range(d3.schemeTableau10);

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x));
  svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y));

  const tooltip = createTooltip();
  svg
    .selectAll("circle")
    .data(points)
    .enter()
    .append("circle")
    .attr("cx", (d) => x(d.x))
    .attr("cy", (d) => y(d.y))
    .attr("r", 4)
    .attr("fill", (d) => color(d.recipe))
    .on("mousemove", (event, d) => {
      showTooltip(
        tooltip,
        `${d.recipe}<br/>${labels.scatter} ${d.x}<br/>${metricLabel} ${d.y.toFixed(2)}`,
        event.pageX,
        event.pageY
      );
    })
    .on("mouseleave", () => hideTooltip(tooltip));

  lines.forEach((line) => {
    const x1 = d3.min(points, (d) => d.x);
    const x2 = d3.max(points, (d) => d.x);
    if (x1 === undefined || x2 === undefined) return;
    const y1 = line.slope * x1 + line.intercept;
    const y2 = line.slope * x2 + line.intercept;
    svg
      .append("line")
      .attr("x1", x(x1))
      .attr("x2", x(x2))
      .attr("y1", y(y1))
      .attr("y2", y(y2))
      .attr("stroke", color(line.recipe))
      .attr("stroke-dasharray", "4 4");
  });
}

function renderVisuals(container, metrics, labels) {
  container.innerHTML = "";
  metrics.forEach((metric) => {
    const wrapper = document.createElement("div");
    wrapper.className = "metric-visual";
    wrapper.innerHTML = `
      <h3>${metric.label} vs ${labels.temp}</h3>
      <div class="chart-box"></div>
      <div class="chart-box"></div>
      <div class="chart-box"></div>
    `;
    const boxes = wrapper.querySelectorAll(".chart-box");
    renderLineChart(boxes[0], metric.charts.linePoints, metric.label, labels);
    renderHeatmap(boxes[1], metric.charts.heatmapCells, metric.label, labels);
    renderScatter(
      boxes[2],
      metric.charts.scatterPoints,
      metric.charts.scatterLines,
      metric.label,
      labels
    );
    container.appendChild(wrapper);
  });
}

async function loadTpsAnalysis() {
  const qualityPanel = document.getElementById("analysis-quality");
  const insightsPanel = document.getElementById("analysis-insights");
  const visualsPanel = document.getElementById("analysis-visuals");
  const tablesPanel = document.getElementById("analysis-metric-tables");
  if (!qualityPanel) return;
  const endpoint = qualityPanel.getAttribute("data-analysis-endpoint");
  if (!endpoint) return;

  const selected = Array.from(
    document.querySelectorAll("[data-tps-field-toggle]:checked")
  ).map((el) => el.getAttribute("data-field-key"));
  const metricsParam = selected.filter(Boolean).join(",");
  const url = metricsParam ? `${endpoint}?metrics=${metricsParam}` : endpoint;

  const resp = await fetch(url);
  if (!resp.ok) {
    qualityPanel.innerHTML = "<div class='small'>Analysis failed.</div>";
    return;
  }
  const data = await resp.json();
  const labels = data.labels || { temp: "Temp", scatter: "Scatter" };
  const selectedMetrics = data.metrics.map((m) => m.label);
  renderQuality(qualityPanel, data.quality, labels, selectedMetrics);
  if (insightsPanel) renderInsights(insightsPanel, data.metrics, data.tagsSummary, data.textNotes);
  if (visualsPanel) renderVisuals(visualsPanel, data.metrics, labels);
  if (tablesPanel) renderMetricTables(tablesPanel, data.metrics, labels);
}

window.loadTpsAnalysis = loadTpsAnalysis;

document.addEventListener("DOMContentLoaded", () => {
  loadTpsAnalysis();
});
