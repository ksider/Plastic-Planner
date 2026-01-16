async function loadImAnalysis() {
  const panel = document.getElementById("im-analysis");
  if (!panel) return;
  const endpoint = panel.getAttribute("data-analysis-endpoint");
  if (!endpoint) return;
  panel.innerHTML = "Loading...";
  try {
    const resp = await fetch(endpoint);
    if (!resp.ok) throw new Error("failed");
    const data = await resp.json();

    const quality = data.quality || {};
    const windowRows = data.window || [];
    const outputs = data.outputSummary || [];
    const defectsGood = data.defectListGood || [];
    const defectsBad = data.defectListBad || [];

    const qualityHtml = `
      <div class="inline-grid">
        <div><label>Runs</label><div>${quality.runs || 0}</div></div>
        <div><label>Good runs</label><div>${quality.goodRuns || 0}</div></div>
        <div><label>Defect rate</label><div>${quality.defectRate || 0}%</div></div>
      </div>
    `;

    const missingHtml = `
      <div style="margin-top:12px;">
        <h3>Missing key outputs</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Output</th><th>Missing</th></tr></thead>
            <tbody>
              ${quality.missingOutputs
                .map((r) => `<tr><td>${r.label}</td><td>${r.missing}</td></tr>`)
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const noteHtml = data.suggestedNote
      ? `<div class="note" style="margin-top:8px;">${data.suggestedNote}</div>`
      : "";
    const windowHtml = `
      <div style="margin-top:12px;">
        <h3>Suggested process window (defect-free runs)</h3>
        ${noteHtml}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Parameter</th><th>Suggested min</th><th>Suggested max</th><th>n</th><th>Observed min</th><th>Observed max</th></tr></thead>
            <tbody>
              ${windowRows
                .map((r) => {
                  const sMin = r.suggested_min === null ? "—" : r.suggested_min.toFixed(3);
                  const sMax = r.suggested_max === null ? "—" : r.suggested_max.toFixed(3);
                  const min = r.min === null ? "—" : r.min.toFixed(3);
                  const max = r.max === null ? "—" : r.max.toFixed(3);
                  return `<tr><td>${r.label}</td><td>${sMin} ${r.unit || ""}</td><td>${sMax} ${r.unit || ""}</td><td>${r.suggested_n || 0}</td><td>${min} ${r.unit || ""}</td><td>${max} ${r.unit || ""}</td></tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const outputHtml = `
      <div style="margin-top:12px;">
        <h3>Output summary (defect-free runs)</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Output</th><th>n</th><th>mean</th><th>sd</th></tr></thead>
            <tbody>
              ${outputs
                .map((r) => {
                  const mean = r.mean === null ? "—" : r.mean.toFixed(3);
                  const sd = r.sd === null ? "—" : r.sd.toFixed(3);
                  return `<tr><td>${r.label}</td><td>${r.n}</td><td>${mean} ${r.unit || ""}</td><td>${sd} ${r.unit || ""}</td></tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const defectHtml = `
      <div style="margin-top:12px;">
        <h3>Defect frequency</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Tag</th><th>Good runs</th><th>Bad runs</th></tr></thead>
            <tbody>
              ${(() => {
                const map = new Map();
                defectsGood.forEach((r) => map.set(r.tag, { good: r.count, bad: 0 }));
                defectsBad.forEach((r) => {
                  if (!map.has(r.tag)) map.set(r.tag, { good: 0, bad: 0 });
                  map.get(r.tag).bad = r.count;
                });
                return Array.from(map.entries())
                  .map(([tag, counts]) => `<tr><td>${tag}</td><td>${counts.good}</td><td>${counts.bad}</td></tr>`)
                  .join("");
              })()}
            </tbody>
          </table>
        </div>
      </div>
    `;

    panel.innerHTML = qualityHtml + missingHtml + windowHtml + outputHtml + defectHtml;
  } catch {
    panel.innerHTML = "<div class='note'>Failed to load analysis.</div>";
  }
}

document.addEventListener("DOMContentLoaded", loadImAnalysis);
