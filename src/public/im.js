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
  document.querySelectorAll("[data-im-param-form]").forEach((form) => {
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
  document.querySelectorAll("[data-im-delete-param]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.getAttribute("data-im-delete-param");
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
  document.querySelectorAll("[data-im-run-form]").forEach((form) => {
    const url = form.getAttribute("data-im-run-url");
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
      if (target.type === "checkbox" && name.startsWith("param_")) {
        const values = Array.from(
          form.querySelectorAll(`input[name="${name}"]:checked`)
        ).map((el) => el.value);
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

document.addEventListener("DOMContentLoaded", () => {
  setupParamModes();
  setupParamForms();
  setupParamDeletes();
  setupRunAutosave();
  setupModals();
  setupRecipeList();
  setupStandardSettingDefaults();
  setupModalModeSwitches();
  setupMaxRunsAuto();
});

function parseListValues(text) {
  if (!text) return [];
  const matches = text.match(/-?\d+(?:[.,]\d+)?/g) || [];
  return matches.map((v) => v.replace(",", ".")).map((v) => Number(v)).filter((v) => Number.isFinite(v));
}

function computeMaxRunsFromParams() {
  let total = 1;
  let varyingFactors = 0;
  document.querySelectorAll("tr[data-param-row]").forEach((row) => {
    const active = row.querySelector('input[type="checkbox"]')?.checked;
    if (!active) return;
    const mode = row.querySelector("[data-mode-select]")?.value || "FIXED";
    const fixed = row.querySelector('[data-field="fixed_value"]')?.value || "";
    const rangeMin = row.querySelector('[data-field="range_min"]')?.value || "";
    const rangeMax = row.querySelector('[data-field="range_max"]')?.value || "";
    const list = row.querySelector('[data-field="list_values"]')?.value || "";
    let levels = 1;
    if (mode === "LIST") {
      const items = parseListValues(list);
      levels = Math.max(1, items.length);
    } else if (mode === "RANGE") {
      levels = rangeMin !== "" && rangeMax !== "" ? 2 : 1;
    } else if (mode === "FIXED") {
      levels = fixed !== "" ? 1 : 1;
    }
    if (levels > 1) varyingFactors += 1;
    total *= levels;
  });
  const recipeCount = (() => {
    const el = document.querySelector("[data-recipe-count]");
    if (!el) return 1;
    const count = Number(el.getAttribute("data-recipe-count") || "1");
    return Number.isFinite(count) && count > 0 ? count : 1;
  })();
  const designSelect = document.querySelector('select[name="design"]');
  const design = designSelect ? String(designSelect.value || "FULL") : "FULL";
  if (design === "BBD" && varyingFactors >= 3) {
    const base = 2 * varyingFactors * (varyingFactors - 1) + 1;
    return Math.max(1, Math.round(base * recipeCount));
  }
  return Math.max(1, Math.round(total * recipeCount));
}

function setupMaxRunsAuto() {
  const input = document.querySelector("[data-max-runs-input]");
  const label = document.querySelector("[data-max-runs-label]");
  if (!(input instanceof HTMLInputElement)) return;
  const update = () => {
    const total = computeMaxRunsFromParams();
    if (label) {
      label.textContent = `Total combinations: ${total}`;
    }
    if (input.getAttribute("data-auto") === "1") {
      input.value = String(total);
    }
  };
  input.addEventListener("input", () => {
    input.setAttribute("data-auto", "0");
  });
  document.addEventListener("change", (event) => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.closest("tr[data-param-row]") || target.closest('select[name="design"]'))
    ) {
      update();
    }
  });
  update();
}

function setupModals() {
  document.querySelectorAll("[data-open-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-open-modal");
      if (!target) return;
      const modal = document.querySelector(`[data-modal="${target}"]`);
      if (modal) modal.classList.add("open");
    });
  });
  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-close-modal");
      if (!target) return;
      const modal = document.querySelector(`[data-modal="${target}"]`);
      if (modal) modal.classList.remove("open");
    });
  });
  document.querySelectorAll("[data-modal]").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      const target = event.target;
      if (
        target === modal ||
        (target instanceof HTMLElement && target.classList.contains("modal-backdrop"))
      ) {
        modal.classList.remove("open");
      }
    });
  });
}

function setupRecipeList() {
  document.querySelectorAll("[data-recipe-list]").forEach((list) => {
    list.querySelectorAll("[data-recipe-pill]").forEach((pill) => {
      const input = pill.querySelector('input[type="checkbox"]');
      if (!input) return;
      const sync = () => {
        pill.classList.toggle("active", input.checked);
      };
      sync();
      pill.addEventListener("click", () => {
        input.checked = !input.checked;
        sync();
      });
    });
  });
}

function setupStandardSettingDefaults() {
  document.querySelectorAll("[data-standard-setting]").forEach((select) => {
    const form = select.closest("form");
    if (!form) return;
    const modeSelect = form.querySelector('select[name="mode"]');
    const fixedInput = form.querySelector('input[name="fixed_value"]');
    const minInput = form.querySelector('input[name="range_min"]');
    const maxInput = form.querySelector('input[name="range_max"]');

    const applyDefaults = (force) => {
      const option = select.options[select.selectedIndex];
      const min = option ? option.getAttribute("data-min") : "";
      const max = option ? option.getAttribute("data-max") : "";
      const mode = modeSelect ? modeSelect.value : "FIXED";
      updateModeInputs(form, mode);
      if (mode === "FIXED") {
        if (fixedInput && (force || fixedInput.value === "")) {
          fixedInput.value = min || "";
        }
      } else if (mode === "RANGE") {
        if (minInput && (force || minInput.value === "")) {
          minInput.value = min || "";
        }
        if (maxInput && (force || maxInput.value === "")) {
          maxInput.value = max || min || "";
        }
      }
    };

    select.addEventListener("change", () => applyDefaults(true));
    if (modeSelect) {
      modeSelect.addEventListener("change", () => applyDefaults(false));
    }
    updateModeInputs(form, modeSelect ? modeSelect.value : "FIXED");
  });
}

function setupModalModeSwitches() {
  document.querySelectorAll("[data-mode-inputs]").forEach((wrap) => {
    const form = wrap.closest("form");
    if (!form) return;
    const modeSelect = form.querySelector('select[name="mode"]');
    if (!modeSelect) return;
    updateModeInputs(form, modeSelect.value || "FIXED");
    modeSelect.addEventListener("change", () => {
      updateModeInputs(form, modeSelect.value || "FIXED");
    });
  });
}
