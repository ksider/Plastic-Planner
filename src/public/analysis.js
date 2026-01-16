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

function renderQuality(panel, quality, selectedMetrics) {
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
        <div class="small">Batches: ${quality.counts.batches} · Samples: ${quality.counts.samples} · Joined: ${quality.counts.joined}</div>
      </div>
      <div>
        <div class="small">Missing ${metricLabel}: ${quality.missing.solubles_pct}%</div>
        <div class="small">Missing MoldTemp: ${quality.missing.mold_temp_c}%</div>
        <div class="small">Missing Moisture: ${quality.missing.moist_before_mold}%</div>
      </div>
      <div>
        <div class="small">Moisture range: ${quality.moisture_range.min ?? "n/a"} – ${quality.moisture_range.max ?? "n/a"}</div>
        <div class="small">Recipes: ${quality.coverage.recipes} · Temps: ${quality.coverage.moldTemps}</div>
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
              .map((r) => `${r.sample}: ${r.value}`)
              .join(" | ")
        )
        .join(" · ")}</div>`
    : "";
  container.innerHTML = `
    ${blocks}
    ${tagsHtml}
    ${textHtml}
  `;
}

function renderMetricTables(container, metrics) {
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
            <td>${r.moldTemp}</td>
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
            <td>${r.sample_code}</td>
            <td>${r.batch_code}</td>
            <td>${r.recipe}</td>
            <td>${r.mold_temp_c}</td>
            <td>${r.value.toFixed(3).replace(/\\.?0+$/, "")}</td>
            <td>${r.moist_before_mold ?? ""}</td>
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
          <h2>${metric.label} by Recipe x Mold Temp</h2>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Recipe</th>
                  <th>Mold temp</th>
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
                  <th>SampleCode</th>
                  <th>BatchCode</th>
                  <th>Recipe</th>
                  <th>Mold temp</th>
                  <th>${metric.label}</th>
                  <th>Moist before mold</th>
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

function clearChart(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = "";
}

function renderLineChart(data, metricLabel, containerId = "chart-lines") {
  const container = document.getElementById(containerId);
  if (!container || data.length === 0) {
    if (container) container.innerHTML = "<div class='small'>Not enough data.</div>";
    return;
  }

  const width = container.clientWidth || 500;
  const height = 260;
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const recipes = Array.from(new Set(data.map((d) => d.recipe)));
  const temps = Array.from(new Set(data.map((d) => d.moldTemp))).sort(
    (a, b) => a - b
  );

  const x = d3
    .scaleLinear()
    .domain(d3.extent(temps))
    .range([margin.left, width - margin.right]);

  const yMax = d3.max(data, (d) => (d.mean !== null ? d.mean : 0)) || 0;
  const y = d3
    .scaleLinear()
    .domain([0, yMax * 1.1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickValues(temps));

  svg
    .append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  const color = d3.scaleOrdinal().domain(recipes).range(d3.schemeTableau10);
  const tooltip = createTooltip();

  recipes.forEach((recipe) => {
    const series = data
      .filter((d) => d.recipe === recipe)
      .sort((a, b) => a.moldTemp - b.moldTemp);

    const line = d3
      .line()
      .x((d) => x(d.moldTemp))
      .y((d) => y(d.mean ?? 0));

    svg
      .append("path")
      .datum(series)
      .attr("fill", "none")
      .attr("stroke", color(recipe))
      .attr("stroke-width", 2)
      .attr("d", line);

    svg
      .selectAll(`.point-${recipe}`)
      .data(series)
      .enter()
      .append("circle")
      .attr("cx", (d) => x(d.moldTemp))
      .attr("cy", (d) => y(d.mean ?? 0))
      .attr("r", 4)
      .attr("fill", color(recipe))
      .on("mousemove", (event, d) => {
        showTooltip(
          tooltip,
          `${recipe}<br/>Temp ${d.moldTemp}°C<br/>n=${d.n}, mean=${d.mean?.toFixed(2) ?? "n/a"}, sd=${d.sd?.toFixed(2) ?? "n/a"} ${metricLabel}`,
          event.pageX,
          event.pageY
        );
      })
      .on("mouseout", () => hideTooltip(tooltip));

    series.forEach((d) => {
      if (d.sd !== null && d.sd !== undefined && d.n >= 2) {
        const yTop = y((d.mean ?? 0) + d.sd);
        const yBottom = y((d.mean ?? 0) - d.sd);
        svg
          .append("line")
          .attr("x1", x(d.moldTemp))
          .attr("x2", x(d.moldTemp))
          .attr("y1", yTop)
          .attr("y2", yBottom)
          .attr("stroke", color(recipe))
          .attr("stroke-width", 1);
      }
    });
  });
}

function renderHeatmap(cells, useCrosslink, containerId = "chart-heatmap") {
  const container = document.getElementById(containerId);
  if (!container || cells.length === 0) {
    if (container) container.innerHTML = "<div class='small'>Not enough data.</div>";
    return;
  }

  const crosslinkAvailable = cells.every((c) => c.crosslinkIndex !== null);
  const useCross = useCrosslink && crosslinkAvailable;

  const temps = Array.from(new Set(cells.map((c) => c.moldTemp))).sort(
    (a, b) => a - b
  );

  const yValues = useCross
    ? Array.from(new Set(cells.map((c) => c.crosslinkIndex))).sort((a, b) => a - b)
    : Array.from(new Set(cells.map((c) => c.recipe))).sort();

  const width = container.clientWidth || 500;
  const height = 260;
  const margin = { top: 20, right: 20, bottom: 40, left: 90 };

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3
    .scaleBand()
    .domain(temps.map(String))
    .range([margin.left, width - margin.right])
    .padding(0.05);

  const y = d3
    .scaleBand()
    .domain(yValues.map(String))
    .range([margin.top, height - margin.bottom])
    .padding(0.05);

  const means = cells.map((c) => c.mean ?? 0);
  const color = d3
    .scaleSequential(d3.interpolateYlGnBu)
    .domain([d3.max(means) || 1, d3.min(means) || 0]);

  const bestMean = d3.min(means);

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x));

  svg
    .append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  const tooltip = createTooltip();

  svg
    .selectAll("rect")
    .data(cells)
    .enter()
    .append("rect")
    .attr("x", (d) => x(String(d.moldTemp)))
    .attr("y", (d) => y(String(useCross ? d.crosslinkIndex : d.recipe)))
    .attr("width", x.bandwidth())
    .attr("height", y.bandwidth())
    .attr("fill", (d) => color(d.mean ?? 0))
    .attr("stroke", (d) => (d.mean === bestMean ? "#2b6d4d" : "none"))
    .attr("stroke-width", 2)
    .on("mousemove", (event, d) => {
      showTooltip(
        tooltip,
        `${d.recipe}<br/>Temp ${d.moldTemp}°C<br/>n=${d.n}, mean=${d.mean?.toFixed(2) ?? "n/a"}, sd=${d.sd?.toFixed(2) ?? "n/a"}`,
        event.pageX,
        event.pageY
      );
    })
    .on("mouseout", () => hideTooltip(tooltip));

  svg
    .selectAll("text.cell")
    .data(cells)
    .enter()
    .append("text")
    .attr("x", (d) => x(String(d.moldTemp)) + x.bandwidth() / 2)
    .attr("y", (d) => y(String(useCross ? d.crosslinkIndex : d.recipe)) + y.bandwidth() / 2)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "middle")
    .attr("font-size", "10px")
    .attr("fill", "#1f2a24")
    .text((d) => `${d.mean?.toFixed(1) ?? "n/a"} ± ${d.sd?.toFixed(1) ?? "n/a"} (n=${d.n})`);

  const warningCells = cells.filter((c) => c.defects > 0);
  svg
    .selectAll("circle.warning")
    .data(warningCells)
    .enter()
    .append("circle")
    .attr("cx", (d) => x(String(d.moldTemp)) + x.bandwidth() - 8)
    .attr("cy", (d) => y(String(useCross ? d.crosslinkIndex : d.recipe)) + 10)
    .attr("r", 4)
    .attr("fill", "#c75b2a")
    .attr("stroke", "#fff")
    .attr("stroke-width", 1);
}

function renderScatter(points, lines, metricLabel, containerId = "chart-scatter") {
  const container = document.getElementById(containerId);
  if (!container || points.length === 0) {
    if (container) container.innerHTML = "<div class='small'>Not enough data.</div>";
    return;
  }

  const width = container.clientWidth || 500;
  const height = 260;
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3
    .scaleLinear()
    .domain(d3.extent(points, (d) => d.moist))
    .nice()
    .range([margin.left, width - margin.right]);

  const y = d3
    .scaleLinear()
    .domain(d3.extent(points, (d) => d.solubles))
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x));

  svg
    .append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y));

  const recipes = Array.from(new Set(points.map((d) => d.recipe)));
  const color = d3.scaleOrdinal().domain(recipes).range(d3.schemeTableau10);
  const tooltip = createTooltip();

  svg
    .selectAll("circle")
    .data(points)
    .enter()
    .append("circle")
    .attr("cx", (d) => x(d.moist))
    .attr("cy", (d) => y(d.solubles))
    .attr("r", 4)
    .attr("fill", (d) => color(d.recipe))
    .attr("opacity", 0.85)
    .on("mousemove", (event, d) => {
      showTooltip(
        tooltip,
        `${d.recipe}<br/>Moist ${d.moist.toFixed(2)}<br/>${metricLabel} ${d.solubles.toFixed(2)}`,
        event.pageX,
        event.pageY
      );
    })
    .on("mouseout", () => hideTooltip(tooltip));

  lines.forEach((line) => {
    const xVals = d3.extent(points, (p) => p.moist);
    const x1 = xVals[0];
    const x2 = xVals[1];
    const y1 = line.slope * x1 + line.intercept;
    const y2 = line.slope * x2 + line.intercept;
    svg
      .append("line")
      .attr("x1", x(x1))
      .attr("y1", y(y1))
      .attr("x2", x(x2))
      .attr("y2", y(y2))
      .attr("stroke", color(line.recipe))
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", "4 3");
  });
}

async function loadAnalysis(alpha) {
  const panel = document.getElementById("analysis-quality");
  if (!panel) return;
  const endpoint = panel.getAttribute("data-analysis-endpoint");
  if (!endpoint) return;
  const toggles = Array.from(
    document.querySelectorAll("[data-field-toggle]")
  );
  const selected = toggles
    .filter((t) => t.checked)
    .map((t) => t.getAttribute("data-field-key"))
    .filter(Boolean);
  const metricParam =
    selected.length > 0 ? `&metrics=${encodeURIComponent(selected.join(","))}` : "";
  const url = `${endpoint}?alpha=${encodeURIComponent(alpha)}${metricParam}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    panel.innerHTML = "<div class='bad'>Failed to load analysis.</div>";
    return;
  }
  const data = await resp.json();
  renderQuality(panel, data.quality, data.selectedMetrics || []);
  renderInsights(
    document.getElementById("analysis-insights"),
    data.metrics || [],
    data.tagsSummary,
    data.textNotes
  );
  renderMetricTables(
    document.getElementById("analysis-metric-tables"),
    data.metrics || []
  );
  const visuals = document.getElementById("analysis-visuals");
  if (visuals) visuals.innerHTML = "";

  const toggle = document.querySelector("[data-crosslink-toggle]");
  const useCrosslink = toggle ? toggle.checked : false;

  (data.metrics || []).forEach((metric, idx) => {
    const wrapper = document.createElement("div");
    wrapper.className = "metric-visual";
    wrapper.innerHTML = `
      <h3>${metric.label} vs Mold Temp</h3>
      <div class="chart-box" id="chart-lines-${idx}"></div>
      <h3 style="margin-top:12px;">Decision Map</h3>
      <div class="chart-box" id="chart-heatmap-${idx}"></div>
      <h3 style="margin-top:12px;">Moisture vs ${metric.label}</h3>
      <div class="chart-box" id="chart-scatter-${idx}"></div>
    `;
    visuals.appendChild(wrapper);
    renderLineChart(metric.charts.linePoints, metric.label, `chart-lines-${idx}`);
    renderHeatmap(metric.charts.heatmapCells, useCrosslink, `chart-heatmap-${idx}`);
    renderScatter(metric.charts.scatterPoints, metric.charts.scatterLines, metric.label, `chart-scatter-${idx}`);
  });
}

window.loadAnalysis = loadAnalysis;

document.addEventListener("DOMContentLoaded", () => {
  const alphaInput = document.querySelector("[data-alpha-input]");
  const toggle = document.querySelector("[data-crosslink-toggle]");
  const alpha = alphaInput ? alphaInput.value : 1.5;
  loadAnalysis(alpha);

  if (alphaInput) {
    alphaInput.addEventListener("change", () => {
      loadAnalysis(alphaInput.value);
    });
  }
  if (toggle) {
    toggle.addEventListener("change", () => {
      loadAnalysis(alphaInput ? alphaInput.value : 1.5);
    });
  }
});
