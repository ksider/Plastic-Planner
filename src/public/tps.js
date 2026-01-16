function updateParamRow(row) {
  const mode = row.getAttribute("data-mode") || "FIXED";
  const fixed = row.querySelectorAll(".mode-fixed");
  const range = row.querySelectorAll(".mode-range");
  const list = row.querySelectorAll(".mode-list");
  const show = (nodes, on) => {
    nodes.forEach((node) => {
      node.style.display = on ? "" : "none";
    });
  };
  show(fixed, mode === "FIXED");
  show(range, mode === "RANGE");
  show(list, mode === "LIST");
}

function setupParamModes() {
  document.querySelectorAll("[data-param-row]").forEach((row) => {
    const select = row.querySelector("[data-mode-select]");
    if (!select) return;
    updateParamRow(row);
    select.addEventListener("change", () => {
      row.setAttribute("data-mode", select.value);
      updateParamRow(row);
    });
  });
}

function collectParamPayload(form) {
  const params = {};
  form.querySelectorAll("tr[data-param-row]").forEach((row) => {
    const paramId = row.getAttribute("data-param-id");
    if (!paramId) return;
    const active = row.querySelector('input[type="checkbox"]')?.checked;
    const mode = row.querySelector("[data-mode-select]")?.value || "FIXED";
    const fixed = row.querySelector('[data-field="fixed_value"]')?.value || "";
    const rangeMin = row.querySelector('[data-field="range_min"]')?.value || "";
    const rangeMax = row.querySelector('[data-field="range_max"]')?.value || "";
    const list = row.querySelector('[data-field="list_values"]')?.value || "";
    params[paramId] = {
      active: active ? "1" : "0",
      mode,
      fixed_value: fixed,
      range_min: rangeMin,
      range_max: rangeMax,
      list_values: list,
    };
  });
  return { params };
}

let suspendParamSaves = false;

function setupParamForms() {
  document.querySelectorAll("[data-tps-param-form]").forEach((form) => {
    let saving = false;
    let pending = false;
    const save = async () => {
      if (suspendParamSaves) return;
      if (saving) {
        pending = true;
        return;
      }
      saving = true;
      const payload = collectParamPayload(form);
      const resp = await fetch(form.getAttribute("action"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      saving = false;
      if (!resp.ok) {
        alert("Save failed");
        return;
      }
      if (pending) {
        pending = false;
        save();
      }
    };

    form.addEventListener("submit", (event) => {
      event.preventDefault();
    });

    form.addEventListener("change", () => {
      save();
    });

    form.addEventListener(
      "focusout",
      (event) => {
        if (form.contains(event.relatedTarget)) return;
        save();
      },
      true
    );
  });
}

function setupParamDeletes() {
  document.querySelectorAll("[data-tps-delete-param]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.getAttribute("data-tps-delete-param");
      if (!url) return;
      if (!confirm("Remove this setting?")) return;
      suspendParamSaves = true;
      const resp = await fetch(url, { method: "POST" });
      if (!resp.ok) {
        suspendParamSaves = false;
        alert("Remove failed");
        return;
      }
      window.location.reload();
    });
  });
}

function setupRunAutosave() {
  document.querySelectorAll("[data-tps-run-form]").forEach((form) => {
    const url = form.getAttribute("data-tps-run-url");
    if (!url) return;
    let saving = false;
    let pending = false;
    const save = async (payload) => {
      if (saving) {
        pending = payload;
        return;
      }
      saving = true;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      saving = false;
      if (!resp.ok) {
        alert("Save failed");
        return;
      }
      if (pending) {
        const next = pending;
        pending = false;
        save(next);
      }
    };

    form.addEventListener("change", (event) => {
      const target = event.target;
      if (
        !(
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target instanceof HTMLSelectElement
        )
      ) {
        return;
      }
      const name = target.name;
      if (!name) return;
      if (target.tagName === "SELECT" && target.multiple) {
        const values = Array.from(target.selectedOptions).map((o) => o.value);
        save({ [name]: values });
        return;
      }
      if (target.type === "checkbox") {
        save({ [name]: target.checked ? "1" : "0" });
        return;
      }
      save({ [name]: target.value });
    });
  });
}

function setupFieldToggles() {
  const toggles = document.querySelectorAll("[data-tps-field-toggle]");
  if (!toggles.length) return;
  const match = window.location.pathname.match(/tps\/(\d+)/);
  const experimentId = match ? match[1] : null;
  if (!experimentId) return;

  toggles.forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const key = toggle.getAttribute("data-field-key");
      if (!key) return;
      fetch(`/tps/${experimentId}/fields/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyze: toggle.checked }),
      }).then(() => {
        if (window.loadTpsAnalysis) {
          window.loadTpsAnalysis();
        }
      });
    });
  });
}

function setupFieldModal() {
  const modal = document.getElementById("tps-field-modal");
  if (!modal) return;
  const openBtn = document.querySelector("[data-open-field-modal]");
  const form = modal.querySelector("[data-field-form]");
  const title = modal.querySelector("[data-field-modal-title]");
  const keyInput = modal.querySelector("[data-field-key-input]");
  const labelInput = modal.querySelector("[data-field-label-input]");
  const typeInput = modal.querySelector("[data-field-type-input]");
  const optionsInput = modal.querySelector("[data-field-options-input]");
  const closeBtns = modal.querySelectorAll("[data-close-field-modal]");

  const open = () => {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  };
  const close = () => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  };

  if (openBtn) {
    openBtn.addEventListener("click", () => {
      if (title) title.textContent = "Add Output Field";
      if (form && form.getAttribute("data-add-action")) {
        form.action = form.getAttribute("data-add-action");
      }
      if (keyInput) keyInput.value = "";
      if (labelInput) labelInput.value = "";
      if (typeInput) {
        typeInput.value = "number";
        typeInput.disabled = false;
      }
      if (optionsInput) optionsInput.value = "";
      open();
    });
  }

  document.querySelectorAll("[data-edit-field]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-field-key");
      const label = btn.getAttribute("data-field-label") || "";
      const type = btn.getAttribute("data-field-type") || "text";
      const options = btn.getAttribute("data-field-options") || "";
      const isCore = btn.getAttribute("data-field-core") === "1";
      const isDefault = btn.getAttribute("data-field-default") === "1";
      if (title) title.textContent = "Edit Output Field";
      if (form && key) {
        const experimentIdMatch = window.location.pathname.match(/tps\/(\d+)/);
        const experimentId = experimentIdMatch ? experimentIdMatch[1] : "";
        form.action = `/tps/${experimentId}/fields/${key}/update`;
      }
      if (keyInput && key) keyInput.value = key;
      if (labelInput) labelInput.value = label;
      if (typeInput) {
        typeInput.value = type;
        typeInput.disabled = isCore || isDefault;
      }
      if (optionsInput) optionsInput.value = options;
      open();
    });
  });
  closeBtns.forEach((btn) => btn.addEventListener("click", close));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function updateModeInputs(container, mode) {
  if (!container) return;
  container.querySelectorAll("[data-mode-inputs]").forEach((wrap) => {
    const fixed = wrap.querySelectorAll(".mode-fixed");
    const range = wrap.querySelectorAll(".mode-range");
    const list = wrap.querySelectorAll(".mode-list");
    const show = (nodes, on) => {
      nodes.forEach((node) => {
        const parent = node.parentElement;
        if (parent) parent.style.display = on ? "" : "none";
      });
    };
    show(fixed, mode === "FIXED");
    show(range, mode === "RANGE");
    show(list, mode === "LIST");
  });
}

function setupModalModeSwitches() {
  document.querySelectorAll("[data-modal-mode]").forEach((select) => {
    const container = select.closest("form");
    updateModeInputs(container, select.value);
    select.addEventListener("change", () => {
      updateModeInputs(container, select.value);
    });
  });
}

function setupStandardSettingDefaults() {
  const select = document.querySelector("[data-standard-setting]");
  if (!select) return;
  const update = () => {
    const option = select.selectedOptions[0];
    if (!option) return;
    const min = option.getAttribute("data-default-min") || "";
    const max = option.getAttribute("data-default-max") || "";
    const form = select.closest("form");
    if (!form) return;
    const fixed = form.querySelector('input[name="fixed_value"]');
    const rangeMin = form.querySelector('input[name="range_min"]');
    const rangeMax = form.querySelector('input[name="range_max"]');
    if (fixed && min) fixed.value = min;
    if (rangeMin && min) rangeMin.value = min;
    if (rangeMax && max) rangeMax.value = max;
  };
  select.addEventListener("change", update);
  update();
}

function parseListValues(text) {
  if (!text) return [];
  const matches = text.match(/-?\d+(?:[.,]\d+)?/g) || [];
  return matches
    .map((v) => v.replace(",", "."))
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));
}

function computeMaxRunsFromParams() {
  let total = 1;
  document.querySelectorAll("tr[data-param-row]").forEach((row) => {
    const active = row.querySelector('input[type="checkbox"]')?.checked;
    if (!active) return;
    const mode = row.querySelector("[data-mode-select]")?.value || "FIXED";
    const fixed = row.querySelector('[data-field="fixed_value"]')?.value || "";
    const rangeMin = row.querySelector('[data-field="range_min"]')?.value || "";
    const rangeMax = row.querySelector('[data-field="range_max"]')?.value || "";
    const list = row.querySelector('[data-field="list_values"]')?.value || "";
    if (mode === "LIST") {
      const values = parseListValues(list);
      total *= Math.max(1, values.length);
    } else if (mode === "RANGE") {
      total *= rangeMin && rangeMax ? 2 : 1;
    } else {
      total *= fixed ? 1 : 1;
    }
  });
  if (!Number.isFinite(total)) return 1;
  const recipeCount = (() => {
    const el = document.querySelector("[data-recipe-count]");
    if (!el) return 1;
    const count = Number(el.getAttribute("data-recipe-count") || "1");
    return Number.isFinite(count) && count > 0 ? count : 1;
  })();
  return Math.max(1, Math.round(total * recipeCount));
}

function setupMaxRunsAuto() {
  const input = document.querySelector("[data-max-runs-input][data-auto]");
  const label = document.querySelector("[data-max-runs-label]");
  if (!input || !label) return;
  const update = () => {
    const total = computeMaxRunsFromParams();
    label.textContent = `Total combinations: ${total}`;
    if (input.getAttribute("data-auto") === "1") {
      input.value = total;
    }
  };
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("tr[data-param-row]")) update();
  });
  update();
}

document.addEventListener("DOMContentLoaded", () => {
  setupParamModes();
  setupParamForms();
  setupParamDeletes();
  setupRunAutosave();
  setupFieldToggles();
  setupFieldModal();
  setupStandardSettingDefaults();
  setupModalModeSwitches();
  setupMaxRunsAuto();
});
