function getCellValue(cell) {
  const input = cell.querySelector("input, textarea, select");
  if (input) {
    if (input.tagName === "SELECT" && input.multiple) {
      return Array.from(input.selectedOptions)
        .map((o) => o.value)
        .join(",");
    }
    return input.value.trim();
  }
  return cell.textContent.trim();
}

function tableToMatrix(table) {
  const rows = Array.from(table.querySelectorAll("tr"));
  return rows.map((row) =>
    Array.from(row.querySelectorAll("th, td")).map(getCellValue)
  );
}

async function copyTsv(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const matrix = tableToMatrix(table);
  const tsv = matrix.map((r) => r.join("\t")).join("\n");
  await navigator.clipboard.writeText(tsv);
  alert("TSV copied to clipboard");
}

function setupCopyButtons() {
  document.querySelectorAll("[data-copy-table]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tableId = btn.getAttribute("data-copy-table");
      if (tableId) copyTsv(tableId);
    });
  });
}

function setupTabs() {
  const buttons = document.querySelectorAll("[data-tab-target]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-tab-target");
      if (!target) return;
      document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === target);
      });
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      if (history.replaceState) {
        history.replaceState(null, "", `#${target}`);
      } else {
        window.location.hash = target;
      }
      localStorage.setItem("activeTab", target);
    });
  });

  const saved = localStorage.getItem("activeTab");
  const hash = window.location.hash.replace("#", "");
  const target = hash || saved;
  if (target) {
    const match = Array.from(buttons).find(
      (b) => b.getAttribute("data-tab-target") === target
    );
    if (match) match.click();
  }
}

async function saveInline(url, payload) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    alert("Save failed");
  }
}

function setupInlineEdits() {
  document.querySelectorAll("[data-inline-save]").forEach((input) => {
    input.addEventListener("change", () => {
      const url = input.getAttribute("data-url");
      const field = input.getAttribute("name");
      if (!url || !field) return;
      if (input.tagName === "SELECT" && input.multiple) {
        const selected = Array.from(input.selectedOptions).map((o) => o.value);
        saveInline(url, { [field]: selected });
      } else {
        saveInline(url, { [field]: input.value });
      }
    });
  });
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

document.addEventListener("DOMContentLoaded", () => {
  setupCopyButtons();
  setupTabs();
  setupModals();
  setupInlineEdits();
  setupBackLinks();
  setupRecipeSelectSearch();
  setupRecipeComponents();
  setupRecipePaste();
  setupRecipeList();
  setupRecipeSearch();
  setupExperimentValidation();
  setupMoldingConfirm();
  setupFieldToggles();
  setupFieldModal();
  updateAnalysisMetricBlocks();
});

function setupBackLinks() {
  const links = document.querySelectorAll("[data-back-link]");
  if (!links.length) return;
  const path = window.location.pathname.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  const backPath = parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : "/";
  links.forEach((link) => {
    link.setAttribute("href", backPath);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = backPath;
    });
  });
}

function setupRecipeSelectSearch() {
  document.querySelectorAll("[data-recipe-select]").forEach((wrapper) => {
    const input = wrapper.querySelector("[data-recipe-select-search]");
    if (!input) return;
    const cards = Array.from(wrapper.querySelectorAll(".recipe-select-card"));
    if (!cards.length) return;
    const runFilter = () => {
      const query = (input.value || "").trim().toLowerCase();
      if (!query) {
        cards.forEach((card) => {
          card.style.display = "";
        });
        return;
      }
      cards.forEach((card) => {
        const hay = (card.getAttribute("data-recipe-text") || "").toLowerCase();
        card.style.display = hay.includes(query) ? "" : "none";
      });
    };
    input.addEventListener("input", runFilter);
    input.addEventListener("search", runFilter);
  });
}

function getRecipeType() {
  const select = document.querySelector("[data-recipe-type]");
  return select ? select.value : "standard";
}

function updateComponentRow(row) {
  const nameInput = row.querySelector("input[name$='[name]']");
  const toggle = row.querySelector("[data-mode-toggle]");
  const modeInput = row.querySelector("[data-mode-input]");
  const staticInput = row.querySelector("[data-mode-static]");
  const minInput = row.querySelector("[data-mode-min]");
  const maxInput = row.querySelector("[data-mode-max]");
  const splitsInput = row.querySelector("[data-splits-input]");
  if (!staticInput || !minInput || !maxInput) return;

  const recipeType = getRecipeType();
  const isPair =
    recipeType === "paired" &&
    nameInput &&
    nameInput.value &&
    nameInput.value.includes("/");

  if (recipeType === "paired") {
    if (toggle) {
      toggle.checked = false;
      toggle.disabled = true;
    }
    const mode = isPair ? "paired" : "static";
    if (modeInput) modeInput.value = mode;
    staticInput.disabled = isPair;
    minInput.disabled = !isPair;
    maxInput.disabled = !isPair;
    staticInput.parentElement.classList.toggle("cell-disabled", isPair);
    minInput.parentElement.classList.toggle("cell-disabled", !isPair);
    maxInput.parentElement.classList.toggle("cell-disabled", !isPair);
    if (splitsInput) splitsInput.disabled = !isPair;
    return;
  }

  if (toggle) toggle.disabled = false;
  const mode = toggle && toggle.checked ? "range" : "static";
  if (modeInput) modeInput.value = mode;
  const isRange = mode === "range";
  staticInput.disabled = isRange;
  minInput.disabled = !isRange;
  maxInput.disabled = !isRange;
  staticInput.parentElement.classList.toggle("cell-disabled", isRange);
  minInput.parentElement.classList.toggle("cell-disabled", !isRange);
  maxInput.parentElement.classList.toggle("cell-disabled", !isRange);
  if (splitsInput) splitsInput.disabled = true;
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
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  });
}

function setupRecipeSearch() {
  const input = document.querySelector("[data-recipe-search]");
  if (!input) return;
  const cards = Array.from(document.querySelectorAll(".recipe-card"));
  if (cards.length === 0) return;

  const runFilter = () => {
    const query = (input.value || "").trim().toLowerCase();
    if (!query) {
      cards.forEach((card) => {
        card.style.display = "";
      });
      return;
    }
    cards.forEach((card) => {
      const hay = (card.getAttribute("data-recipe-text") || "").toLowerCase();
      card.style.display = hay.includes(query) ? "" : "none";
    });
  };

  input.addEventListener("input", runFilter);
  input.addEventListener("search", runFilter);
}

function setupRecipeComponents() {
  const table = document.getElementById("recipe-components");
  if (!table) return;
  const typeSelect = document.querySelector("[data-recipe-type]");

  table.querySelectorAll(".component-row").forEach((row) => {
    updateComponentRow(row);
  });

  table.addEventListener("change", (e) => {
    const target = e.target;
    if (target && target.matches("[data-mode-toggle]")) {
      const row = target.closest(".component-row");
      if (row) updateComponentRow(row);
    }
    if (target && target.matches("input[name$='[name]']")) {
      const row = target.closest(".component-row");
      if (row) updateComponentRow(row);
    }
  });
  table.addEventListener("input", (e) => {
    const target = e.target;
    if (target && target.matches("input[name$='[name]']")) {
      const row = target.closest(".component-row");
      if (row) updateComponentRow(row);
    }
  });

  table.addEventListener("click", (e) => {
    const target = e.target;
    if (!target) return;
    const button = target.closest("[data-remove-component]");
    if (!button) return;
    const row = button.closest(".component-row");
    if (!row) return;
    const removeFlag = row.querySelector("[data-remove-flag]");
    if (removeFlag) removeFlag.value = "1";
    row.classList.add("hidden");
  });

  const addButton = document.querySelector("[data-add-component]");
  const template = document.getElementById("component-row-template");
  if (addButton && template) {
    addButton.addEventListener("click", () => {
      const nextIndex = Number(table.getAttribute("data-next-index") || 0);
      const html = template.innerHTML.replace(/__INDEX__/g, String(nextIndex));
      const temp = document.createElement("tbody");
      temp.innerHTML = html.trim();
      const newRow = temp.firstElementChild;
      if (newRow) {
        table.querySelector("tbody").appendChild(newRow);
        table.setAttribute("data-next-index", String(nextIndex + 1));
        updateComponentRow(newRow);
      }
    });
  }

  if (typeSelect) {
    typeSelect.addEventListener("change", () => {
      table.querySelectorAll(".component-row").forEach((row) => {
        updateComponentRow(row);
      });
    });
  }
}

function setupRecipePaste() {
  const modal = document.getElementById("paste-modal");
  if (!modal) return;
  const openBtn = document.querySelector("[data-open-paste]");
  const closeBtns = modal.querySelectorAll("[data-close-paste]");
  const applyBtn = modal.querySelector("[data-apply-paste]");
  const input = modal.querySelector("[data-paste-input]");
  const table = document.getElementById("recipe-components");
  const nameInput = document.querySelector("input[name='name']");
  const template = document.getElementById("component-row-template");
  if (!table || !template) return;

  const open = () => {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  };
  const close = () => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  };

  if (openBtn) openBtn.addEventListener("click", open);
  closeBtns.forEach((btn) => btn.addEventListener("click", close));

  const addRow = (name, partsValue, mode, minVal, maxVal) => {
    const nextIndex = Number(table.getAttribute("data-next-index") || 0);
    const html = template.innerHTML.replace(/__INDEX__/g, String(nextIndex));
    const temp = document.createElement("tbody");
    temp.innerHTML = html.trim();
    const newRow = temp.firstElementChild;
    if (!newRow) return;
    const nameInputEl = newRow.querySelector("input[name$='[name]']");
    const staticInput = newRow.querySelector("[data-mode-static]");
    const minInput = newRow.querySelector("[data-mode-min]");
    const maxInput = newRow.querySelector("[data-mode-max]");
    const toggle = newRow.querySelector("[data-mode-toggle]");
    if (nameInputEl) nameInputEl.value = name;
    if (staticInput) staticInput.value = partsValue;
    if (minInput) minInput.value = minVal || "";
    if (maxInput) maxInput.value = maxVal || "";
    if (toggle) toggle.checked = mode === "range";
    table.querySelector("tbody").appendChild(newRow);
    table.setAttribute("data-next-index", String(nextIndex + 1));
    updateComponentRow(newRow);
  };

  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      if (!input) return;
      const text = input.value.trim();
      if (!text) return;
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) return;
      let startIdx = 0;
      const firstLine = lines[0];
      const hasDelimiter =
        firstLine.indexOf("\t") !== -1 ||
        / {2,}/.test(firstLine) ||
        /^(.*?)[ ]+(-?\d+(?:\.\d+)?(?:[ ]*-[ ]*-?\d+(?:\.\d+)?)?)$/.test(firstLine);
      if (!hasDelimiter) {
        if (nameInput && !nameInput.value.trim()) {
          nameInput.value = firstLine;
        }
        startIdx = 1;
      }
      const existingRows = Array.from(
        table.querySelectorAll(".component-row")
      );
      const byName = new Map();
      existingRows.forEach((row) => {
        const nameInputEl = row.querySelector("input[name$='[name]']");
        if (nameInputEl && nameInputEl.value.trim()) {
          byName.set(nameInputEl.value.trim().toLowerCase(), row);
        }
      });

      for (let i = startIdx; i < lines.length; i += 1) {
        const line = lines[i];
        let parts = line.split(/\t+| {2,}/);
        if (parts.length < 2) {
          const match = line.match(
            /^(.*?)[ ]+(-?\d+(?:\.\d+)?(?:[ ]*-[ ]*-?\d+(?:\.\d+)?)?)$/
          );
          if (match) {
            parts = [match[1], match[2]];
          }
        }
        if (parts.length < 2) continue;
        const comp = parts[0].trim();
        const value = parts.slice(1).join(" ").trim();
        if (!comp) continue;
        const rangeMatch = value.match(
          /^(-?\d+(?:\.\d+)?)[ ]*-[ ]*(-?\d+(?:\.\d+)?)$/
        );
        const mode = rangeMatch ? "range" : "static";
        const staticVal = rangeMatch ? "" : value;
        const minVal = rangeMatch ? rangeMatch[1] : "";
        const maxVal = rangeMatch ? rangeMatch[2] : "";

        const existing = byName.get(comp.toLowerCase());
        if (existing) {
          const staticInput = existing.querySelector("[data-mode-static]");
          const minInput = existing.querySelector("[data-mode-min]");
          const maxInput = existing.querySelector("[data-mode-max]");
          const toggle = existing.querySelector("[data-mode-toggle]");
          if (staticInput) staticInput.value = staticVal;
          if (minInput) minInput.value = minVal;
          if (maxInput) maxInput.value = maxVal;
          if (toggle) toggle.checked = mode === "range";
          updateComponentRow(existing);
        } else {
          addRow(comp, staticVal, mode, minVal, maxVal);
        }
      }
      input.value = "";
      close();
    });
  }
}

function setupExperimentValidation() {
  const form = document.querySelector("[data-experiment-form]");
  if (!form) return;
  const generateBtn = form.querySelector("[data-generate-btn]");
  const hint = form.querySelector("[data-recipe-hint]");
  const totalRunsInput = form.querySelector("[name='total_runs']");
  const totalRunsHint = form.querySelector("[data-total-runs-hint]");
  const recipeInputs = Array.from(
    form.querySelectorAll("input[name='recipe_ids']")
  );
  const requiredFields = [
    "name",
    "final_mass_g",
    "total_runs",
    "replicates_per_temp",
    "mold_temps",
    "head_temps",
  ];

  const parseHeadTemps = () => {
    const input = form.querySelector("[name='head_temps']");
    if (!input) return [];
    return String(input.value || "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t) => Number(t))
      .filter((t) => Number.isFinite(t));
  };

  const computeVariantTotal = (selected) =>
    selected.reduce((sum, input) => {
      const count = Number(input.getAttribute("data-variant-count") || "1");
      return sum + (Number.isFinite(count) && count > 0 ? count : 1);
    }, 0);

  const updateState = () => {
    const selected = recipeInputs.filter((input) => input.checked);
    const hasVariants = selected.some(
      (input) =>
        input.getAttribute("data-has-variants") === "1" ||
        input.getAttribute("data-has-range") === "1"
    );
    const valid = selected.length >= 2 || (selected.length === 1 && hasVariants);
    const headTemps = parseHeadTemps();
    const variantTotal = computeVariantTotal(selected);
    const comboCount =
      variantTotal > 0 && headTemps.length > 0
        ? variantTotal * headTemps.length
        : 0;

    if (totalRunsInput && totalRunsInput.getAttribute("data-auto-total-runs") === "1") {
      if (comboCount > 0) {
        totalRunsInput.value = String(comboCount);
      }
    }
    if (totalRunsHint) {
      totalRunsHint.textContent =
        comboCount > 0
          ? `Suggested: ${comboCount} (variants × head temps)`
          : "";
    }

    const fieldsValid = requiredFields.every((name) => {
      const el = form.querySelector(`[name="${name}"]`);
      return el && String(el.value || "").trim().length > 0;
    });
    const totalRunsValue = Number(totalRunsInput?.value || 0);
    const runsOk =
      comboCount > 0
        ? totalRunsValue > 0 && totalRunsValue % comboCount === 0
        : false;
    const allValid = valid && fieldsValid && runsOk;
    if (generateBtn) generateBtn.disabled = !allValid;
    if (hint) {
      hint.textContent = allValid
        ? "Form is ready."
        : "Fill all fields and select at least two recipes, or one recipe that has min-max.";
    }
  };

  recipeInputs.forEach((input) => {
    input.addEventListener("change", updateState);
  });
  requiredFields.forEach((name) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el) {
      el.addEventListener("input", updateState);
      el.addEventListener("change", updateState);
    }
  });
  if (totalRunsInput) {
    totalRunsInput.addEventListener("input", () => {
      totalRunsInput.setAttribute("data-auto-total-runs", "0");
      updateState();
    });
    totalRunsInput.addEventListener("change", () => {
      totalRunsInput.setAttribute("data-auto-total-runs", "0");
      updateState();
    });
  }
  updateState();
}

function setupMoldingConfirm() {
  const form = document.querySelector("[data-confirm-reset]");
  if (!form) return;
  const hasData = form.getAttribute("data-confirm-reset") === "1";
  if (!hasData) return;
  form.addEventListener("submit", (e) => {
    const ok = confirm(
      "Table B already has data. Regenerating will delete existing entries. Continue?"
    );
    if (!ok) {
      e.preventDefault();
    }
  });
}

function setupFieldToggles() {
  const toggles = document.querySelectorAll("[data-field-toggle]");
  if (!toggles.length) return;
  const match = window.location.pathname.match(/experiments\/(\d+)/);
  const experimentId = match ? match[1] : null;
  if (!experimentId) return;

  toggles.forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const key = toggle.getAttribute("data-field-key");
      if (!key) return;
      fetch(`/experiments/${experimentId}/fields/${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          analyze: toggle.checked,
          core: toggle.getAttribute("data-field-core") === "1",
        }),
      }).then(() => {
        if (window.loadAnalysis) {
          window.loadAnalysis(
            document.querySelector("[data-alpha-input]")?.value || 1.5
          );
        }
        updateAnalysisMetricBlocks();
      });
    });
  });
}

function updateAnalysisMetricBlocks() {
  const toggles = Array.from(
    document.querySelectorAll("[data-field-toggle]")
  );
  const selected = toggles
    .filter((t) => t.checked)
    .map((t) => t.getAttribute("data-field-key"));
  document.querySelectorAll("[data-metric-block]").forEach((block) => {
    const key = block.getAttribute("data-metric-block");
    if (!key) return;
    block.classList.toggle("hidden", !selected.includes(key));
  });
}

function setupFieldModal() {
  const modal = document.getElementById("field-modal");
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
      if (title) title.textContent = "Add Table B Field";
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
      if (title) title.textContent = "Edit Table B Field";
      if (form && key) {
        const experimentIdMatch = window.location.pathname.match(
          /experiments\/(\d+)/
        );
        const experimentId = experimentIdMatch ? experimentIdMatch[1] : "";
        form.action = `/experiments/${experimentId}/fields/${key}/update`;
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
