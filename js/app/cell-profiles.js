  function loadStage3StripCatalog() {
    const source = window.BATTERY_STRIP_PHYSICS;
    if (!source?.materials || !Array.isArray(source.presets)) {
      const active = $("stage3StripActive");
      const tree = $("stage3StripTree");
      if (active) active.textContent = "Dane taśm są niedostępne.";
      if (tree) tree.innerHTML = '<div class="stage3-strip-data-error">Nie znaleziono lokalnego katalogu data/physics/strip-catalog.js.</div>';
      return;
    }
    stage3StripCatalog = {
      materials: source.materials,
      presets: source.presets.filter(preset => Number(preset.width_mm) > 0 && Number(preset.width_mm) <= 10)
    };
    const selectedPreset = stage3StripCatalog.presets.find(preset => preset.id === stage3StripSelection.presetId) || stage3StripCatalog.presets[0];
    if (selectedPreset) applyStage3StripSelection(stage3StripSelection.materialId, selectedPreset.id, false);
  }

  function stage3ActiveStripMaterial() {
    return stage3StripCatalog.materials[stage3StripSelection.materialId] || null;
  }

  function stage3ActiveStripPreset() {
    return stage3StripCatalog.presets.find(preset => preset.id === stage3StripSelection.presetId) || null;
  }

  function stage3StripConnectionProperties() {
    return {
      strip_material_id: stage3StripSelection.materialId,
      strip_preset_id: stage3StripSelection.presetId,
      strip_width_mm: stage3StripSelection.width_mm,
      strip_thickness_mm: stage3StripSelection.thickness_mm,
      strip_layers: 1
    };
  }

  function applyActiveStripToAllConnections() {
    const strip = stage3StripConnectionProperties();
    ["front", "back"].forEach(side => {
      stage3NickelConnections[side].forEach(connection => Object.assign(connection, strip));
    });
  }

  function stage3StripResistanceMOhmPer100mm(materialId, preset) {
    const tabulated = preset.resistance_mohm_per_100mm?.[materialId];
    if (Number.isFinite(tabulated)) return tabulated;
    const material = stage3StripCatalog.materials[materialId];
    const resistivity = material?.electrical_resistivity_ohm_m?.nominal;
    if (!Number.isFinite(resistivity)) return null;
    return resistivity * 1e8 / (preset.width_mm * preset.thickness_mm);
  }

  function renderStage3StripPicker() {
    const active = $("stage3StripActive");
    const tree = $("stage3StripTree");
    if (!active || !tree) return;
    const selectedMaterial = stage3ActiveStripMaterial();
    const selectedPreset = stage3ActiveStripPreset();
    if (!selectedMaterial || !selectedPreset) return;
    const resistance = stage3StripResistanceMOhmPer100mm(stage3StripSelection.materialId, selectedPreset);
    active.innerHTML = `<span class="stage3-strip-swatch" style="background:${selectedMaterial.display_color_hex || "#cbd5e1"}"></span> ${selectedMaterial.name_pl} · ${selectedPreset.thickness_mm.toFixed(2).replace(".", ",")} × ${selectedPreset.width_mm} mm${Number.isFinite(resistance) ? ` · ${resistance.toFixed(2).replace(".", ",")} mΩ/100 mm` : ""}`;
    tree.innerHTML = Object.entries(stage3StripCatalog.materials).map(([materialId, material]) => {
      const selectedBranch = materialId === stage3StripSelection.materialId;
      const sizes = stage3StripCatalog.presets.map(preset => {
        const selected = selectedBranch && preset.id === stage3StripSelection.presetId;
        return `<button type="button" class="${selected ? "active" : ""}" data-strip-material="${materialId}" data-strip-preset="${preset.id}">${preset.thickness_mm.toFixed(2).replace(".", ",")} × ${preset.width_mm} mm</button>`;
      }).join("");
      return `<details class="${selectedBranch ? "selected" : ""}" ${selectedBranch ? "open" : ""}><summary><span class="stage3-strip-swatch" style="background:${material.display_color_hex || "#cbd5e1"}"></span>${material.name_pl}</summary><div class="stage3-strip-sizes">${sizes}</div></details>`;
    }).join("");
  }

  function applyStage3StripSelection(materialId, presetId, announce = true) {
    const material = stage3StripCatalog.materials[materialId];
    const preset = stage3StripCatalog.presets.find(item => item.id === presetId);
    if (!material || !preset || preset.width_mm > 10) {
      if (announce) stage3Notice = "Taśma może mieć maksymalnie 10 mm szerokości.";
      return;
    }
    stage3StripSelection = {
      materialId,
      presetId,
      width_mm: preset.width_mm,
      thickness_mm: preset.thickness_mm
    };
    applyActiveStripToAllConnections();
    renderStage3StripPicker();
    if (announce) stage3Notice = `Zmieniono wszystkie taśmy pakietu na: ${material.name_pl}, ${preset.thickness_mm.toFixed(2).replace(".", ",")} × ${preset.width_mm} mm.`;
    if (currentStage === 3) {
      if (stage3NickelConnections.front.length || stage3NickelConnections.back.length) stage3RefreshAnalysis();
      renderStage3();
    }
  }

function stage3SetCellField(id, value) {
const field = $(id);
if (field) field.value = value;
}

function stage3CellNumber(id, fallback = null) {
const value = Number($(id)?.value);
return Number.isFinite(value) ? value : fallback;
}

  function setCellProfileStatus(message, error = false) {
    const element = $("cellProfileStatus");
    if (!element) return;
    element.textContent = message;
    element.style.color = error ? "var(--danger)" : "var(--muted)";
  }

  function createSavedCellProfileId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `cell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function validateSavedCellProfile(source) {
    const errors = [];
    if (!source || typeof source !== "object" || Array.isArray(source)) return { valid: false, profile: null, errors: ["profil nie jest obiektem"] };
    const geometry = source.geometry && typeof source.geometry === "object" ? source.geometry : {};
    const model = source.model && typeof source.model === "object" ? source.model : {};
    const name = String(source.name ?? "").trim();
    if (!name) errors.push("brak nazwy");
    if (name.length > 80) errors.push("nazwa przekracza 80 znaków");
    const manufacturer = String(source.manufacturer ?? "").trim();
    const modelName = String(source.modelName ?? "").trim();
    const notes = String(source.notes ?? "");
    if (manufacturer.length > 80) errors.push("producent przekracza 80 znaków");
    if (modelName.length > 80) errors.push("model przekracza 80 znaków");
    if (notes.length > 4000) errors.push("notatki przekraczają 4000 znaków");

    const number = (value, label, predicate = Number.isFinite) => {
      const parsed = value === "" || value === null || value === undefined ? NaN : Number(value);
      if (!Number.isFinite(parsed) || !predicate(parsed)) errors.push(`${label}: nieprawidłowa wartość`);
      return parsed;
    };
    const positive = value => value > 0;
    const nonNegative = value => value >= 0;
    const range = (min, max) => value => value >= min && value <= max;
    const diameterMm = number(geometry.diameterMm, "średnica", positive);
    const heightMm = number(geometry.heightMm, "wysokość", positive);
    const massKg = number(geometry.massKg, "masa", positive);
    const numericModel = {
      capacityAh: number(model.capacityAh, "pojemność", positive),
      voltageMinV: number(model.voltageMinV, "napięcie minimalne", positive),
      voltageNominalV: number(model.voltageNominalV, "napięcie nominalne", positive),
      voltageMaxV: number(model.voltageMaxV, "napięcie maksymalne", positive),
      resistanceMohm: number(model.resistanceMohm, "rezystancja", positive),
      standardDischargeA: number(model.standardDischargeA, "standardowy prąd rozładowania", positive),
      maxDischargeA: number(model.maxDischargeA, "maksymalny prąd rozładowania", positive),
      standardChargeA: number(model.standardChargeA, "standardowy prąd ładowania", positive),
      maxChargeA: number(model.maxChargeA, "maksymalny prąd ładowania", positive),
      specificHeatJkgK: number(model.specificHeatJkgK, "ciepło właściwe", positive),
      heatTransferWm2K: number(model.heatTransferWm2K, "współczynnik oddawania ciepła", positive),
      initialSocPercent: number(model.initialSocPercent, "początkowy SOC", range(0, 100)),
      initialTemperatureC: number(model.initialTemperatureC, "temperatura początkowa"),
      stateOfHealthPercent: number(model.stateOfHealthPercent, "SOH", range(1, 100)),
      spreadCapacityPercent: number(model.spreadCapacityPercent, "rozrzut pojemności", nonNegative),
      spreadDcirPercent: number(model.spreadDcirPercent, "rozrzut DCIR", nonNegative),
      spreadSocPercent: number(model.spreadSocPercent, "rozrzut SOC", nonNegative),
      r1Fraction: number(model.r1Fraction, "udział R1", nonNegative),
      tau1S: number(model.tau1S, "stała czasowa", positive)
    };
    if (numericModel.voltageMinV >= numericModel.voltageNominalV || numericModel.voltageNominalV >= numericModel.voltageMaxV) errors.push("napięcia muszą spełniać min < nominalne < max");
    if (numericModel.standardDischargeA > numericModel.maxDischargeA) errors.push("standardowy prąd rozładowania przekracza maksymalny");
    if (numericModel.standardChargeA > numericModel.maxChargeA) errors.push("standardowy prąd ładowania przekracza maksymalny");

    const parseCurve = (value, label, options = {}) => {
      const text = String(value ?? "").trim();
      if (!text) {
        if (options.required) errors.push(`${label}: wymagane są co najmniej 2 punkty`);
        return text;
      }
      const points = text.split(/[;,\n]+/).map(item => item.trim()).filter(Boolean).map(item => {
        const separator = item.indexOf(":");
        return separator < 0 ? { x: NaN, y: NaN } : { x: Number(item.slice(0, separator).trim()), y: Number(item.slice(separator + 1).trim()) };
      });
      if (points.length < 2) errors.push(`${label}: wymagane są co najmniej 2 punkty`);
      if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) errors.push(`${label}: każdy punkt musi mieć postać x:y`);
      if (points.some((point, index) => index > 0 && point.x <= points[index - 1].x)) errors.push(`${label}: wartości x muszą być ściśle rosnące i unikalne`);
      if (options.soc && points.some(point => point.x < 0 || point.x > 100)) errors.push(`${label}: SOC musi mieścić się w zakresie 0–100%`);
      if (points.some(point => options.allowZero ? point.y < 0 : point.y <= 0)) errors.push(`${label}: wartości y muszą być ${options.allowZero ? "nieujemne" : "dodatnie"}`);
      return text;
    };
    const ocvMode = model.ocvMode === "custom" ? "custom" : model.ocvMode === "chemistry" ? "chemistry" : "";
    if (!ocvMode) errors.push("nieprawidłowy tryb krzywej OCV");
    const curves = {
      ocvPoints: parseCurve(model.ocvPoints, "krzywa OCV", { soc: true, required: ocvMode === "custom" }),
      resistanceSocPoints: parseCurve(model.resistanceSocPoints, "krzywa rezystancja/SOC", { soc: true }),
      resistanceTempPoints: parseCurve(model.resistanceTempPoints, "krzywa rezystancja/temperatura"),
      capacityTempPoints: parseCurve(model.capacityTempPoints, "krzywa pojemność/temperatura"),
      chargeTempPoints: parseCurve(model.chargeTempPoints, "krzywa ładowanie/temperatura", { allowZero: true })
    };
    const chemistryId = String(model.chemistryId ?? "").trim();
    if (!chemistryId || (Object.keys(stage3CellCatalog?.chemistries || {}).length && !stage3CellCatalog.chemistries[chemistryId])) errors.push("nieznana chemia ogniwa");
    const resistanceKind = String(model.resistanceKind ?? "");
    if (!["dcir", "acir", "unknown"].includes(resistanceKind)) errors.push("nieprawidłowy rodzaj rezystancji");
    if (errors.length) return { valid: false, profile: null, errors: [...new Set(errors)] };
    const inferredFormatId = diameterMm < 20 ? "18650" : diameterMm < 24 ? "21700" : `custom:${diameterMm.toFixed(2)}x${heightMm.toFixed(2)}`;
    const profile = {
      id: String(source.id || createSavedCellProfileId()),
      name,
      formatId: String(source.formatId || geometry.formatId || inferredFormatId),
      manufacturer,
      modelName,
      notes,
      updatedAt: String(source.updatedAt || new Date().toISOString()),
      geometry: { diameterMm, heightMm, massKg },
      model: {
        chemistryId,
        ...numericModel,
        resistanceKind,
        ocvMode,
        ...curves
      }
    };
    return { valid: true, profile, errors: [] };
  }

  function normalizeSavedCellProfile(source) {
    return validateSavedCellProfile(source).profile;
  }

  function persistSavedCellProfiles() {
    try {
      localStorage.setItem(savedCellProfilesStorageKey, JSON.stringify({
        schema: "ebike-battery-cell-profiles",
        version: 1,
        profiles: savedCellProfiles
      }));
      return true;
    } catch (error) {
      setCellProfileStatus("Przeglądarka zablokowała zapis lokalny. Użyj eksportu JSON.", true);
      return false;
    }
  }

  function loadSavedCellProfiles() {
    try {
      const raw = localStorage.getItem(savedCellProfilesStorageKey);
      if (!raw) {
        savedCellProfiles = [];
      } else {
        const parsed = JSON.parse(raw);
        const sources = Array.isArray(parsed) ? parsed : parsed?.profiles;
        savedCellProfiles = (Array.isArray(sources) ? sources : []).map(normalizeSavedCellProfile).filter(Boolean);
      }
    } catch (error) {
      savedCellProfiles = [];
      setCellProfileStatus("Nie udało się odczytać lokalnych profili. Możesz zaimportować kopię JSON.", true);
    }
    renderSavedCellProfileOptions();
  }

  function selectedCellFormatId() {
    return $("cellType")?.selectedOptions?.[0]?.dataset.formatId || "21700";
  }

  function activeSavedCellProfile() {
    const id = $("savedCellProfileSelect")?.value;
    return savedCellProfiles.find(profile => profile.id === id) || null;
  }

  function renderSavedCellFormatOptions(preferredFormatId = null) {
    const group = $("savedCellFormatOptions");
    const select = $("cellType");
    if (!group || !select) return;
    const activeFormatId = preferredFormatId || selectedCellFormatId();
    group.replaceChildren();
    const customFormats = new Map();
    savedCellProfiles.filter(profile => !["18650", "21700"].includes(profile.formatId)).forEach(profile => {
      if (!customFormats.has(profile.formatId)) customFormats.set(profile.formatId, profile);
    });
    customFormats.forEach(profile => {
      const option = document.createElement("option");
      option.value = String(profile.geometry.diameterMm);
      option.dataset.formatId = profile.formatId;
      option.dataset.heightMm = String(profile.geometry.heightMm);
      option.dataset.massKg = String(profile.geometry.massKg);
      option.dataset.geometrySource = `zapisany rozmiar: ${profile.formatId}`;
      option.textContent = `${profile.formatId.replace(/^custom:/, "Inny ")} · Ø${profile.geometry.diameterMm.toFixed(2)} × ${profile.geometry.heightMm.toFixed(2)} mm`;
      group.appendChild(option);
    });
    group.hidden = customFormats.size === 0;
    const matchingOption = Array.from(select.options).find(option => option.dataset.formatId === activeFormatId);
    if (matchingOption) matchingOption.selected = true;
  }

  function renderSavedCellProfileOptions(selectedProfileId = null) {
    const select = $("savedCellProfileSelect");
    if (!select) return;
    renderSavedCellFormatOptions();
    const formatId = selectedCellFormatId();
    const currentProfileId = selectedProfileId || select.value || null;
    select.replaceChildren();
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Bez zapisanego profilu";
    select.appendChild(empty);
    [...savedCellProfiles]
      .filter(profile => profile.formatId === formatId)
      .sort((a, b) => a.name.localeCompare(b.name, "pl"))
      .forEach(profile => {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profile.manufacturer || profile.modelName
          ? `${profile.name} · ${[profile.manufacturer, profile.modelName].filter(Boolean).join(" ")}`
          : profile.name;
        if (profile.id === currentProfileId) option.selected = true;
        select.appendChild(option);
      });
    const selected = savedCellProfiles.find(profile => profile.id === select.value) || null;
    if ($("editCellType")) $("editCellType").disabled = !selected;
    if ($("deleteCellType")) $("deleteCellType").disabled = !selected;
    setCellProfileStatus(selected
      ? `Aktywny profil: ${selected.name}.`
      : `Dostępne profile ${formatId}: ${Math.max(0, select.options.length - 1)}.`);
    renderStage3CellProfileOptions(selected?.id || null);
  }

  function renderStage3CellProfileOptions(selectedProfileId = null) {
    const select = $("stage3CellProfileSelect");
    if (!select) return;
    const formatId = selectedCellFormatId();
    const currentProfileId = selectedProfileId || activeSavedCellProfile()?.id || null;
    select.replaceChildren();

    const custom = document.createElement("option");
    custom.value = "";
    custom.textContent = "Własne parametry";
    select.appendChild(custom);

    [...savedCellProfiles]
      .filter(profile => profile.formatId === formatId)
      .sort((a, b) => a.name.localeCompare(b.name, "pl"))
      .forEach(profile => {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profile.manufacturer || profile.modelName
          ? `${profile.name} · ${[profile.manufacturer, profile.modelName].filter(Boolean).join(" ")}`
          : profile.name;
        if (profile.id === currentProfileId) option.selected = true;
        select.appendChild(option);
      });

    if (!savedCellProfiles.some(profile => profile.id === select.value && profile.formatId === formatId)) {
      select.value = "";
    }
    renderStage3CellProfileSummary();
  }

  function renderStage3CellProfileSummary() {
    const summary = $("stage3CellProfileSummary");
    if (!summary) return;
    const profile = activeSavedCellProfile();
    const formatId = selectedCellFormatId();
    const matchingProfiles = savedCellProfiles.filter(item => item.formatId === formatId).length;
    const chemistry = stage3CellCatalog.chemistries?.[$("stage3CellChemistry")?.value];
    const formatLabel = profile ? cellProfileFormatLabel(profile) : formatId.replace(/^custom:/, "Inny ");
    const capacityAh = stage3CellNumber("stage3CellCapacityAh", 0);
    const voltageNominal = stage3CellNumber("stage3CellVoltageNominal", 0);
    const dcirMohm = stage3CellNumber("stage3CellDcirMohm", 0);
    const maxDischargeA = stage3CellNumber("stage3CellMaxDischargeA", 0);

    const head = document.createElement("div");
    head.className = "stage3-cell-profile-summary-head";
    const identity = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = profile?.name || "Własne parametry";
    const meta = document.createElement("span");
    const producer = profile ? [profile.manufacturer, profile.modelName].filter(Boolean).join(" ") : "";
    meta.textContent = producer || (profile
      ? `${chemistry?.name_pl || profile.model.chemistryId} · profil zgodny z ${formatId}`
      : `${matchingProfiles} ${matchingProfiles === 1 ? "zgodny profil" : "zgodnych profili"} dla formatu ${formatId}`);
    identity.append(title, meta);

    const state = document.createElement("span");
    state.className = `stage3-cell-profile-state${profile && stage3CellProfileDirty ? " is-modified" : ""}`;
    state.textContent = profile
      ? stage3CellProfileDirty ? "Zmodyfikowany" : "Profil zapisany"
      : "Tryb własny";
    head.append(identity, state);

    const metrics = document.createElement("div");
    metrics.className = "stage3-cell-profile-metrics";
    [
      ["Format", formatLabel],
      ["Pojemność", `${capacityAh.toFixed(2)} Ah`],
      ["Napięcie", `${voltageNominal.toFixed(2)} V`],
      ["DCIR / maks. prąd", `${dcirMohm.toFixed(1)} mΩ / ${maxDischargeA.toFixed(1)} A`]
    ].forEach(([label, value]) => {
      const metric = document.createElement("div");
      const metricLabel = document.createElement("span");
      const metricValue = document.createElement("strong");
      metricLabel.textContent = label;
      metricValue.textContent = value;
      metric.append(metricLabel, metricValue);
      metrics.appendChild(metric);
    });

    summary.replaceChildren(head, metrics);
  }

  function setStage3CellProfileEditorState(profile) {
    const details = Array.from($("stage3CellModelCard")?.querySelectorAll(".stage3-cell-category") || []);
    details.forEach((category, index) => {
      category.open = !profile && index === 0;
    });
  }

  function applySavedCellProfile(profile) {
    if (!profile) return false;
    const model = profile.model;
    stage3CellProfileDirty = false;
    if ($("savedCellProfileSelect")) $("savedCellProfileSelect").value = profile.id;
    if ($("stage3CellProfileSelect")) $("stage3CellProfileSelect").value = profile.id;
    const chemistry = $("stage3CellChemistry");
    if (chemistry && Array.from(chemistry.options).some(option => option.value === model.chemistryId)) chemistry.value = model.chemistryId;
    stage3SetCellField("stage3CellDiameterMm", profile.geometry.diameterMm);
    stage3SetCellField("stage3CellHeightMm", profile.geometry.heightMm);
    stage3SetCellField("stage3CellMassKg", profile.geometry.massKg);
    stage3SetCellField("stage3CellCapacityAh", model.capacityAh);
    stage3SetCellField("stage3CellVoltageMin", model.voltageMinV);
    stage3SetCellField("stage3CellVoltageNominal", model.voltageNominalV);
    stage3SetCellField("stage3CellVoltageMax", model.voltageMaxV);
    stage3SetCellField("stage3CellDcirMohm", model.resistanceMohm);
    stage3SetCellField("stage3CellStandardDischargeA", model.standardDischargeA);
    stage3SetCellField("stage3CellMaxDischargeA", model.maxDischargeA);
    stage3SetCellField("stage3CellStandardChargeA", model.standardChargeA);
    stage3SetCellField("stage3CellMaxChargeA", model.maxChargeA);
    stage3SetCellField("stage3CellSpecificHeat", model.specificHeatJkgK);
    stage3SetCellField("stage3CellHeatTransfer", model.heatTransferWm2K);
    stage3SetCellField("stage3CellInitialSoc", model.initialSocPercent);
    stage3SetCellField("stage3CellInitialTemp", model.initialTemperatureC);
    stage3SetCellField("stage3CellSoh", model.stateOfHealthPercent);
    stage3SetCellField("stage3CellSpreadCapacity", model.spreadCapacityPercent);
    stage3SetCellField("stage3CellSpreadDcir", model.spreadDcirPercent);
    stage3SetCellField("stage3CellSpreadSoc", model.spreadSocPercent);
    stage3SetCellField("stage3CellOcvPoints", model.ocvPoints);
    $("stage3CellResistanceKind").value = model.resistanceKind;
    $("stage3CellOcvMode").value = model.ocvMode;
    $("stage3CellOcvCustomWrap").hidden = model.ocvMode !== "custom";
    stage3SetCellField("cellAh", model.capacityAh * 1000);
    stage3SetCellField("cellVoltage", model.voltageNominalV);
    stage3SetCellField("cellStandardDischarge", model.standardDischargeA);
    stage3SetCellField("cellMaxDischarge", model.maxDischargeA);
    stage3SetCellField("cellStandardCharge", model.standardChargeA);
    stage3SetCellField("cellMaxCharge", model.maxChargeA);
    collectStage3CellModel();
    setStage3CellProfileEditorState(profile);
    renderStage3CellProfileOptions(profile.id);
    if ($("editCellType")) $("editCellType").disabled = false;
    if ($("deleteCellType")) $("deleteCellType").disabled = false;
    setCellProfileStatus(`Wczytano profil „${profile.name}”.`);
    return true;
  }

  function setCellProfileFormValue(id, value) {
    const field = $(id);
    if (field) field.value = value ?? "";
  }

  function setCellProfileManagerStatus(message = "", isError = false) {
    [$("cellProfileManagerStatus"), $("cellProfileLibraryStatus")].filter(Boolean).forEach(status => {
      status.textContent = message;
      status.classList.toggle("error", isError);
      status.title = message;
    });
  }

  function cellProfileFormatLabel(profile) {
    if (["18650", "21700"].includes(profile?.formatId)) return profile.formatId;
    return `Ø${Number(profile?.geometry?.diameterMm || 0).toFixed(1)} × ${Number(profile?.geometry?.heightMm || 0).toFixed(1)} mm`;
  }

  function filteredCellProfiles() {
    const type = $("cellProfileTypeFilter")?.value || "all";
    const query = ($("cellProfileSearch")?.value || "").trim().toLocaleLowerCase("pl");
    return savedCellProfiles
      .filter(profile => type === "all" || (type === "custom" ? !["18650", "21700"].includes(profile.formatId) : profile.formatId === type))
      .filter(profile => {
        if (!query) return true;
        return [profile.name, profile.manufacturer, profile.modelName, profile.formatId]
          .some(value => String(value || "").toLocaleLowerCase("pl").includes(query));
      })
      .sort((a, b) => a.name.localeCompare(b.name, "pl", { sensitivity: "base" }));
  }

  function renderCellProfileManager() {
    const list = $("cellProfileManagerList");
    if (!list) return;
    const existingIds = new Set(savedCellProfiles.map(profile => profile.id));
    selectedCellProfileIds = new Set(Array.from(selectedCellProfileIds).filter(id => existingIds.has(id)));
    const profiles = filteredCellProfiles();
    list.replaceChildren();

    profiles.forEach(profile => {
      const item = document.createElement("div");
      item.className = "cell-profile-list-item";
      item.classList.toggle("active", profile.id === editingCellProfileId);
      item.classList.toggle("selected", selectedCellProfileIds.has(profile.id));
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", selectedCellProfileIds.has(profile.id) ? "true" : "false");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedCellProfileIds.has(profile.id);
      checkbox.setAttribute("aria-label", `Zaznacz profil ${profile.name}`);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedCellProfileIds.add(profile.id);
        else selectedCellProfileIds.delete(profile.id);
        renderCellProfileManager();
      });

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "cell-profile-list-open";
      openButton.title = `Edytuj profil ${profile.name}`;
      const name = document.createElement("strong");
      name.textContent = profile.name;
      const format = document.createElement("span");
      format.className = "cell-profile-list-format";
      format.textContent = cellProfileFormatLabel(profile);
      const details = document.createElement("small");
      const source = [profile.manufacturer, profile.modelName].filter(Boolean).join(" ") || "Profil użytkownika";
      details.textContent = `${source} · ${(profile.model.capacityAh * 1000).toFixed(0)} mAh · ${profile.model.voltageNominalV.toFixed(2)} V`;
      openButton.append(name, format, details);
      openButton.addEventListener("click", () => openCellProfileCreator(profile.id));

      item.append(checkbox, openButton);
      list.appendChild(item);
    });

    $("cellProfileManagerEmpty").hidden = profiles.length > 0;
    $("cellProfileManagerCount").textContent = `${profiles.length} z ${savedCellProfiles.length} profili`;
    const selectAll = $("selectAllCellProfiles");
    const selectedVisibleCount = profiles.filter(profile => selectedCellProfileIds.has(profile.id)).length;
    selectAll.checked = profiles.length > 0 && selectedVisibleCount === profiles.length;
    selectAll.indeterminate = selectedVisibleCount > 0 && selectedVisibleCount < profiles.length;
    selectAll.disabled = profiles.length === 0;
  }

  function clearCellProfileEditor() {
    editingCellProfileId = null;
    $("cellProfileEditorEmpty").hidden = false;
    $("cellProfileEditorBody").hidden = true;
    $("cellProfileDialogActions").hidden = true;
    setCellProfileManagerStatus("");
    renderCellProfileManager();
  }

  function openCellProfileManager(profileId = null) {
    if ($("cellProfileModal").hidden) cellProfileReturnFocus = document.activeElement;
    $("cellLibraryMenu").hidden = true;
    $("cellLibraryButton").setAttribute("aria-expanded", "false");
    $("cellProfileModal").hidden = false;
    selectedCellProfileIds.clear();
    renderCellProfileManager();
    if (profileId && savedCellProfiles.some(profile => profile.id === profileId)) openCellProfileCreator(profileId);
    else {
      clearCellProfileEditor();
      setTimeout(() => $("closeCellProfileModal")?.focus(), 0);
    }
  }

  function applyCellProfileFormatDefaults() {
    const format = $("profileCellFormat")?.value;
    const presets = {
      "18650": { diameter: 18, height: 65, massG: 47 },
      "21700": { diameter: 21, height: 70, massG: 70 }
    };
    const preset = presets[format];
    if (!preset) return;
    setCellProfileFormValue("profileCellDiameter", preset.diameter);
    setCellProfileFormValue("profileCellHeight", preset.height);
    setCellProfileFormValue("profileCellMassG", preset.massG);
  }

  function openCellProfileCreator(profileId = null) {
    if ($("cellProfileModal").hidden) cellProfileReturnFocus = document.activeElement;
    const active = profileId ? savedCellProfiles.find(profile => profile.id === profileId) || null : null;
    editingCellProfileId = active?.id || null;
    const model = active?.model || {};
    const chemistrySelect = $("profileCellChemistry");
    if (chemistrySelect) {
      chemistrySelect.replaceChildren(...Array.from($("stage3CellChemistry")?.options || []).map(source => {
        const option = document.createElement("option");
        option.value = source.value;
        option.textContent = source.textContent;
        return option;
      }));
    }
    const formatId = active?.formatId || selectedCellFormatId();
    setCellProfileFormValue("profileCellName", active?.name || "");
    setCellProfileFormValue("profileCellManufacturer", active?.manufacturer || "");
    setCellProfileFormValue("profileCellModelName", active?.modelName || "");
    setCellProfileFormValue("profileCellFormat", ["18650", "21700"].includes(formatId) ? formatId : "custom");
    setCellProfileFormValue("profileCellDiameter", active?.geometry.diameterMm ?? stage3CellNumber("stage3CellDiameterMm", readNumber("cellType") || 18));
    setCellProfileFormValue("profileCellHeight", active?.geometry.heightMm ?? stage3CellNumber("stage3CellHeightMm", readNumber("cellType") < 20 ? 65 : 70));
    setCellProfileFormValue("profileCellMassG", (active?.geometry.massKg ?? stage3CellNumber("stage3CellMassKg", 0.05)) * 1000);
    setCellProfileFormValue("profileCellChemistry", model.chemistryId || $("stage3CellChemistry")?.value || "NMC_NCA");
    setCellProfileFormValue("profileCellCapacityMah", (model.capacityAh ?? stage3CellNumber("stage3CellCapacityAh", readNumber("cellAh") / 1000)) * 1000);
    setCellProfileFormValue("profileCellVoltageMin", model.voltageMinV ?? stage3CellNumber("stage3CellVoltageMin", 2.8));
    setCellProfileFormValue("profileCellVoltageNominal", model.voltageNominalV ?? stage3CellNumber("stage3CellVoltageNominal", readNumber("cellVoltage")));
    setCellProfileFormValue("profileCellVoltageMax", model.voltageMaxV ?? stage3CellNumber("stage3CellVoltageMax", 4.2));
    setCellProfileFormValue("profileCellResistance", model.resistanceMohm ?? stage3CellNumber("stage3CellDcirMohm", readNumber("cellResistance")));
    setCellProfileFormValue("profileCellResistanceKind", model.resistanceKind || $("stage3CellResistanceKind")?.value || "dcir");
    setCellProfileFormValue("profileCellStandardDischarge", model.standardDischargeA ?? stage3CellNumber("stage3CellStandardDischargeA", readNumber("cellStandardDischarge")));
    setCellProfileFormValue("profileCellMaxDischarge", model.maxDischargeA ?? stage3CellNumber("stage3CellMaxDischargeA", readNumber("cellMaxDischarge")));
    setCellProfileFormValue("profileCellStandardCharge", model.standardChargeA ?? stage3CellNumber("stage3CellStandardChargeA", readNumber("cellStandardCharge")));
    setCellProfileFormValue("profileCellMaxCharge", model.maxChargeA ?? stage3CellNumber("stage3CellMaxChargeA", readNumber("cellMaxCharge")));
    setCellProfileFormValue("profileCellSpecificHeat", model.specificHeatJkgK ?? stage3CellNumber("stage3CellSpecificHeat", 1000));
    setCellProfileFormValue("profileCellHeatTransfer", model.heatTransferWm2K ?? stage3CellNumber("stage3CellHeatTransfer", 8));
    setCellProfileFormValue("profileCellR1Fraction", model.r1Fraction ?? stage3CellModel?.dynamic_model?.r1_fraction_of_dcir ?? 0.35);
    setCellProfileFormValue("profileCellTau1", model.tau1S ?? stage3CellModel?.dynamic_model?.tau1_s ?? 18);
    setCellProfileFormValue("profileCellInitialSoc", model.initialSocPercent ?? stage3CellNumber("stage3CellInitialSoc", 100));
    setCellProfileFormValue("profileCellInitialTemp", model.initialTemperatureC ?? stage3CellNumber("stage3CellInitialTemp", 25));
    setCellProfileFormValue("profileCellSoh", model.stateOfHealthPercent ?? stage3CellNumber("stage3CellSoh", 100));
    setCellProfileFormValue("profileCellSpreadCapacity", model.spreadCapacityPercent ?? stage3CellNumber("stage3CellSpreadCapacity", 2));
    setCellProfileFormValue("profileCellSpreadDcir", model.spreadDcirPercent ?? stage3CellNumber("stage3CellSpreadDcir", 5));
    setCellProfileFormValue("profileCellSpreadSoc", model.spreadSocPercent ?? stage3CellNumber("stage3CellSpreadSoc", 0.5));
    setCellProfileFormValue("profileCellOcvMode", model.ocvMode || $("stage3CellOcvMode")?.value || "chemistry");
    setCellProfileFormValue("profileCellOcvPoints", model.ocvPoints || $("stage3CellOcvPoints")?.value || "");
    setCellProfileFormValue("profileCellResistanceSocPoints", model.resistanceSocPoints || "");
    setCellProfileFormValue("profileCellResistanceTempPoints", model.resistanceTempPoints || "");
    setCellProfileFormValue("profileCellCapacityTempPoints", model.capacityTempPoints || "");
    setCellProfileFormValue("profileCellChargeTempPoints", model.chargeTempPoints || "");
    setCellProfileFormValue("profileCellNotes", active?.notes || "");
    $("cellProfileEditorTitle").textContent = active ? active.name : "Nowy profil ogniwa";
    $("cellProfileEditorMeta").textContent = active ? `${cellProfileFormatLabel(active)} · edycja profilu` : "Nie zapisano";
    $("saveCellProfileButton").textContent = active ? "Zapisz zmiany" : "Zapisz profil";
    $("deleteCellProfileFromForm").disabled = !active;
    $("cellLibraryMenu").hidden = true;
    $("cellLibraryButton").setAttribute("aria-expanded", "false");
    $("cellProfileModal").hidden = false;
    $("cellProfileEditorEmpty").hidden = true;
    $("cellProfileEditorBody").hidden = false;
    $("cellProfileDialogActions").hidden = false;
    $("cellProfileEditorBody").scrollTop = 0;
    setCellProfileManagerStatus(active ? `Edytujesz profil „${active.name}”.` : "Uzupełnij dane nowego profilu.");
    renderCellProfileManager();
    setTimeout(() => $("profileCellName")?.focus(), 0);
  }

  function closeCellProfileCreator() {
    $("cellProfileModal").hidden = true;
    editingCellProfileId = null;
    selectedCellProfileIds.clear();
    const returnFocus = cellProfileReturnFocus;
    cellProfileReturnFocus = null;
    const focusTarget = returnFocus?.isConnected && returnFocus.offsetParent !== null ? returnFocus : $("cellLibraryButton");
    if (focusTarget?.isConnected) setTimeout(() => focusTarget.focus(), 0);
  }

  function captureCellProfileFromForm() {
    const formatChoice = $("profileCellFormat").value;
    const diameterMm = Number($("profileCellDiameter").value);
    const heightMm = Number($("profileCellHeight").value);
    const formatId = formatChoice === "custom" ? `custom:${diameterMm.toFixed(2)}x${heightMm.toFixed(2)}` : formatChoice;
    const name = $("profileCellName").value.trim();
    const existing = savedCellProfiles.find(profile => profile.formatId === formatId && profile.name.toLocaleLowerCase("pl") === name.toLocaleLowerCase("pl"));
    return {
      id: editingCellProfileId || existing?.id || createSavedCellProfileId(),
      name,
      formatId,
      manufacturer: $("profileCellManufacturer").value,
      modelName: $("profileCellModelName").value,
      notes: $("profileCellNotes").value,
      updatedAt: new Date().toISOString(),
      geometry: { diameterMm, heightMm, massKg: Number($("profileCellMassG").value) / 1000 },
      model: {
        chemistryId: $("profileCellChemistry").value,
        capacityAh: Number($("profileCellCapacityMah").value) / 1000,
        voltageMinV: Number($("profileCellVoltageMin").value),
        voltageNominalV: Number($("profileCellVoltageNominal").value),
        voltageMaxV: Number($("profileCellVoltageMax").value),
        resistanceMohm: Number($("profileCellResistance").value),
        resistanceKind: $("profileCellResistanceKind").value,
        standardDischargeA: Number($("profileCellStandardDischarge").value),
        maxDischargeA: Number($("profileCellMaxDischarge").value),
        standardChargeA: Number($("profileCellStandardCharge").value),
        maxChargeA: Number($("profileCellMaxCharge").value),
        specificHeatJkgK: Number($("profileCellSpecificHeat").value),
        heatTransferWm2K: Number($("profileCellHeatTransfer").value),
        r1Fraction: Number($("profileCellR1Fraction").value),
        tau1S: Number($("profileCellTau1").value),
        initialSocPercent: Number($("profileCellInitialSoc").value),
        initialTemperatureC: Number($("profileCellInitialTemp").value),
        stateOfHealthPercent: Number($("profileCellSoh").value),
        spreadCapacityPercent: Number($("profileCellSpreadCapacity").value),
        spreadDcirPercent: Number($("profileCellSpreadDcir").value),
        spreadSocPercent: Number($("profileCellSpreadSoc").value),
        ocvMode: $("profileCellOcvMode").value,
        ocvPoints: $("profileCellOcvPoints").value,
        resistanceSocPoints: $("profileCellResistanceSocPoints").value,
        resistanceTempPoints: $("profileCellResistanceTempPoints").value,
        capacityTempPoints: $("profileCellCapacityTempPoints").value,
        chargeTempPoints: $("profileCellChargeTempPoints").value
      }
    };
  }

  function saveCellProfileFromForm(event) {
    event.preventDefault();
    const form = $("cellProfileForm");
    ["profileCellName", "profileCellVoltageNominal", "profileCellVoltageMax", "profileCellMaxDischarge", "profileCellMaxCharge"].forEach(id => $(id).setCustomValidity(""));
    const formatChoice = $("profileCellFormat").value;
    const profileFormatId = formatChoice === "custom"
      ? `custom:${Number($("profileCellDiameter").value).toFixed(2)}x${Number($("profileCellHeight").value).toFixed(2)}`
      : formatChoice;
    const normalizedName = $("profileCellName").value.trim().toLocaleLowerCase("pl");
    const duplicate = savedCellProfiles.find(profile => profile.id !== editingCellProfileId && profile.formatId === profileFormatId && profile.name.toLocaleLowerCase("pl") === normalizedName);
    if (duplicate) $("profileCellName").setCustomValidity("Profil o tej nazwie i rozmiarze już istnieje.");
    const voltageMin = Number($("profileCellVoltageMin").value);
    const voltageNominal = Number($("profileCellVoltageNominal").value);
    const voltageMax = Number($("profileCellVoltageMax").value);
    if (voltageNominal <= voltageMin) $("profileCellVoltageNominal").setCustomValidity("Napięcie nominalne musi być większe od minimalnego.");
    if (voltageMax <= voltageNominal) $("profileCellVoltageMax").setCustomValidity("Napięcie maksymalne musi być większe od nominalnego.");
    if (Number($("profileCellStandardDischarge").value) > Number($("profileCellMaxDischarge").value)) {
      $("profileCellMaxDischarge").setCustomValidity("Maksymalny prąd rozładowania nie może być mniejszy od standardowego.");
    }
    if (Number($("profileCellStandardCharge").value) > Number($("profileCellMaxCharge").value)) {
      $("profileCellMaxCharge").setCustomValidity("Maksymalny prąd ładowania nie może być mniejszy od standardowego.");
    }
    if (!form.checkValidity()) return form.reportValidity();
    const wasEditing = Boolean(editingCellProfileId);
    const profileSource = captureCellProfileFromForm();
    const validation = validateSavedCellProfile(profileSource);
    if (!validation.valid) {
      const message = `Nie zapisano profilu: ${validation.errors.slice(0, 4).join("; ")}.`;
      setCellProfileStatus(message, true);
      setCellProfileManagerStatus(message, true);
      return;
    }
    const profile = validation.profile;
    const index = savedCellProfiles.findIndex(item => item.id === profile.id);
    if (index >= 0) savedCellProfiles[index] = profile;
    else savedCellProfiles.push(profile);
    const persisted = persistSavedCellProfiles();
    renderSavedCellFormatOptions(profile.formatId);
    renderSavedCellProfileOptions(profile.id);
    $("savedCellProfileSelect").value = profile.id;
    applySavedCellProfile(profile);
    editingCellProfileId = profile.id;
    $("cellProfileEditorTitle").textContent = profile.name;
    $("cellProfileEditorMeta").textContent = `${cellProfileFormatLabel(profile)} · edycja profilu`;
    $("saveCellProfileButton").textContent = "Zapisz zmiany";
    $("deleteCellProfileFromForm").disabled = false;
    renderCellProfileManager();
    const savedMessage = `${wasEditing ? "Zaktualizowano" : "Zapisano"} profil „${profile.name}”.`;
    if (persisted) {
      setCellProfileStatus(`${savedMessage} Dane są dostępne w tej przeglądarce.`);
      setCellProfileManagerStatus(savedMessage);
    }
    if (stage1Substep === 2 && !manualMode) runSolve();
    else render();
  }

  function deleteCellProfilesByIds(ids) {
    const uniqueIds = Array.from(new Set(ids)).filter(id => savedCellProfiles.some(profile => profile.id === id));
    const profiles = savedCellProfiles.filter(profile => uniqueIds.includes(profile.id));
    if (!profiles.length) return false;
    const label = profiles.length === 1 ? `profil „${profiles[0].name}”` : `${profiles.length} zaznaczone profile`;
    if (!window.confirm(`Czy na pewno chcesz usunąć ${label}? Tej operacji nie można cofnąć.`)) return false;

    const removedEditingProfile = editingCellProfileId && uniqueIds.includes(editingCellProfileId);
    savedCellProfiles = savedCellProfiles.filter(profile => !uniqueIds.includes(profile.id));
    uniqueIds.forEach(id => selectedCellProfileIds.delete(id));
    persistSavedCellProfiles();
    renderSavedCellFormatOptions();
    renderSavedCellProfileOptions();
    syncStage3CellGeometryFromType(false);
    collectStage3CellModel();
    if (removedEditingProfile) clearCellProfileEditor();
    else renderCellProfileManager();
    const message = profiles.length === 1 ? `Usunięto profil „${profiles[0].name}”.` : `Usunięto ${profiles.length} profile.`;
    setCellProfileStatus(message);
    setCellProfileManagerStatus(message);
    if (stage1Substep === 2 && !manualMode) runSolve();
    else render();
    return true;
  }

  function deleteSelectedCellProfile() {
    const id = $("savedCellProfileSelect")?.value;
    const profile = savedCellProfiles.find(item => item.id === id);
    if (!profile) return setCellProfileStatus("Wybierz zapisany profil, który chcesz usunąć.", true);
    deleteCellProfilesByIds([id]);
  }

  function exportSavedCellProfiles() {
    const selectedProfiles = savedCellProfiles.filter(profile => selectedCellProfileIds.has(profile.id));
    const profilesToExport = selectedProfiles.length ? selectedProfiles : savedCellProfiles;
    const payload = JSON.stringify({
      schema: "ebike-battery-cell-profiles",
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles: profilesToExport
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "typy-ogniw-ebike-battery-creator.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    const message = `Wyeksportowano ${profilesToExport.length} profili.`;
    setCellProfileStatus(message);
    setCellProfileManagerStatus(message);
  }

  function importSavedCellProfiles(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const sources = Array.isArray(parsed) ? parsed : parsed?.profiles;
        if (!Array.isArray(sources)) throw new Error("missing_profiles");
        const results = sources.map((source, index) => ({ index, name: String(source?.name || `profil ${index + 1}`), validation: validateSavedCellProfile(source) }));
        const imported = results.filter(result => result.validation.valid).map(result => result.validation.profile);
        const skipped = results.filter(result => !result.validation.valid);
        if (!imported.length) {
          const details = skipped.slice(0, 3).map(result => `${result.name}: ${result.validation.errors.slice(0, 2).join(", ")}`).join("; ");
          throw new Error(details || "brak poprawnych profili");
        }
        imported.forEach(profile => {
          const existingIndex = savedCellProfiles.findIndex(item => item.id === profile.id || (item.formatId === profile.formatId && item.name.toLocaleLowerCase("pl") === profile.name.toLocaleLowerCase("pl")));
          if (existingIndex >= 0) savedCellProfiles[existingIndex] = profile;
          else savedCellProfiles.push(profile);
        });
        const persisted = persistSavedCellProfiles();
        renderSavedCellFormatOptions();
        renderSavedCellProfileOptions();
        renderCellProfileManager();
        if (persisted) {
          const rejectedDetails = skipped.slice(0, 3).map(result => `${result.name}: ${result.validation.errors.slice(0, 2).join(", ")}`).join("; ");
          const message = `Zaimportowano ${imported.length} z ${sources.length} profili.${skipped.length ? ` Pominięto ${skipped.length}: ${rejectedDetails}${skipped.length > 3 ? "; …" : ""}.` : ""}`;
          setCellProfileStatus(message);
          setCellProfileManagerStatus(message, skipped.length > 0);
        }
      } catch (error) {
        const detail = error?.message && !["missing_profiles", "empty_profiles"].includes(error.message) ? ` ${error.message}` : "";
        setCellProfileStatus(`Nieprawidłowy plik profili ogniw.${detail}`, true);
        setCellProfileManagerStatus(`Nieprawidłowy plik profili ogniw.${detail}`, true);
      }
    };
    reader.onerror = () => {
      setCellProfileStatus("Nie udało się odczytać pliku.", true);
      setCellProfileManagerStatus("Nie udało się odczytać pliku.", true);
    };
    reader.readAsText(file);
  }

  function stage3CellGeometryPresetFromType() {
    const profile = activeSavedCellProfile();
    if (profile) {
      return {
        type: `${profile.formatId} · ${profile.name}`,
        diameterMm: profile.geometry.diameterMm,
        heightMm: profile.geometry.heightMm,
        massKg: profile.geometry.massKg,
        source: `profil ogniwa: ${profile.name}`
      };
    }
    const selectedOption = $("cellType")?.selectedOptions?.[0];
    const nominalDiameter = Number(selectedOption?.value) || 18;
    const heightMm = Number(selectedOption?.dataset.heightMm);
    const massKg = Number(selectedOption?.dataset.massKg);
    return {
      type: selectedOption?.textContent?.trim() || (nominalDiameter < 20 ? "18650" : "21700"),
      diameterMm: nominalDiameter,
      heightMm: Number.isFinite(heightMm) && heightMm > 0 ? heightMm : nominalDiameter < 20 ? 65 : 70,
      massKg: Number.isFinite(massKg) && massKg > 0 ? massKg : nominalDiameter < 20 ? 0.047 : 0.070,
      source: selectedOption?.dataset.geometrySource || "wybrany typ ogniwa"
    };
  }

  function syncStage3CellGeometryFromType(rebuildModel = true) {
    if (!stage3CellCatalog?.chemistries || !$('stage3CellDiameterMm')) return;
    const preset = stage3CellGeometryPresetFromType();
    stage3SetCellField("stage3CellDiameterMm", preset.diameterMm);
    stage3SetCellField("stage3CellHeightMm", preset.heightMm);
    stage3SetCellField("stage3CellMassKg", preset.massKg);
    if (rebuildModel) collectStage3CellModel();
  }

  function syncStage3CellElectricalFromPackInputs(changedFieldId = null) {
    if (!stage3CellCatalog?.chemistries || !$('stage3CellCapacityAh')) return;
    const mappings = [
      ["cellAh", "stage3CellCapacityAh", value => value / 1000],
      ["cellVoltage", "stage3CellVoltageNominal", value => value],
      ["cellStandardDischarge", "stage3CellStandardDischargeA", value => value],
      ["cellMaxDischarge", "stage3CellMaxDischargeA", value => value],
      ["cellStandardCharge", "stage3CellStandardChargeA", value => value],
      ["cellMaxCharge", "stage3CellMaxChargeA", value => value]
    ];
    mappings.forEach(([sourceId, targetId, transform]) => {
      const value = readNumber(sourceId);
      if (Number.isFinite(value) && value > 0) stage3SetCellField(targetId, transform(value));
    });
    if (changedFieldId === "cellResistance") {
      const dcirMohm = readNumber("cellResistance");
      if (Number.isFinite(dcirMohm) && dcirMohm > 0) {
        stage3SetCellField("stage3CellDcirMohm", dcirMohm);
        $("stage3CellResistanceKind").value = "dcir";
      }
    }
    collectStage3CellModel();
  }

  function parseStage3CustomOcv(text) {
    const points = String(text || "").split(/[;,\n]+/).map(item => item.trim()).filter(Boolean).map(item => {
      const [socText, voltageText] = item.split(":").map(part => part.trim());
      return { x: Number(socText), y: Number(voltageText) };
    });
    if (points.length < 2 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 100 || point.y <= 0)) return null;
    points.sort((a, b) => a.x - b.x);
    if (points.some((point, index) => index > 0 && point.x === points[index - 1].x)) return null;
    return points;
  }

  function parseStage3FactorCurve(text, allowZero = false) {
    const points = String(text || "").split(/[;,\n]+/).map(item => item.trim()).filter(Boolean).map(item => {
      const separator = item.indexOf(":");
      if (separator < 0) return { x: NaN, y: NaN };
      return {
        x: Number(item.slice(0, separator).trim()),
        y: Number(item.slice(separator + 1).trim())
      };
    });
    const invalidY = point => allowZero ? point.y < 0 : point.y <= 0;
    if (points.length < 2 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || invalidY(point))) return null;
    points.sort((a, b) => a.x - b.x);
    if (points.some((point, index) => index > 0 && point.x === points[index - 1].x)) return null;
    return points;
  }

  function scaleStage3ChemistryOcv(chemistry, voltageMin, voltageMax) {
    const source = chemistry.ocv_soc;
    const sourceMin = source[0].y;
    const sourceMax = source[source.length - 1].y;
    const sourceRange = sourceMax - sourceMin;
    if (!(sourceRange > 0) || !(voltageMax > voltageMin)) return source.map(point => ({ ...point }));
    return source.map(point => ({
      x: point.x,
      y: voltageMin + ((point.y - sourceMin) / sourceRange) * (voltageMax - voltageMin)
    }));
  }

  function loadStage3CellCatalog() {
    const source = window.BATTERY_CELL_MODELS;
    const chemistrySelect = $("stage3CellChemistry");
    if (!source?.chemistries || !chemistrySelect) {
      $("stage3CellModelStatus").innerHTML = '<span class="estimated">Nie znaleziono lokalnego katalogu charakterystyk ogniw.</span>';
      return;
    }
    stage3CellCatalog = source;
    chemistrySelect.innerHTML = Object.entries(source.chemistries).map(([id, chemistry]) => `<option value="${id}">${chemistry.name_pl}</option>`).join("");
    chemistrySelect.value = "NMC_NCA";
    const chemistry = source.chemistries.NMC_NCA;
    const geometryPreset = stage3CellGeometryPresetFromType();
    stage3SetCellField("stage3CellCapacityAh", (readNumber("cellAh") || 5000) / 1000);
    stage3SetCellField("stage3CellDcirMohm", readNumber("cellResistance") || "");
    stage3SetCellField("stage3CellVoltageMax", chemistry.defaults.voltage_max_V);
    stage3SetCellField("stage3CellVoltageMin", chemistry.defaults.voltage_min_V);
    stage3SetCellField("stage3CellVoltageNominal", readNumber("cellVoltage") || chemistry.defaults.voltage_nominal_V);
    stage3SetCellField("stage3CellStandardDischargeA", readNumber("cellStandardDischarge") || 5);
    stage3SetCellField("stage3CellMaxDischargeA", readNumber("cellMaxDischarge") || 10);
    stage3SetCellField("stage3CellStandardChargeA", readNumber("cellStandardCharge") || 2);
    stage3SetCellField("stage3CellMaxChargeA", readNumber("cellMaxCharge") || 5);
    stage3SetCellField("stage3CellDiameterMm", geometryPreset.diameterMm);
    stage3SetCellField("stage3CellHeightMm", geometryPreset.heightMm);
    stage3SetCellField("stage3CellMassKg", geometryPreset.massKg);
    stage3SetCellField("stage3CellInitialSoc", 100);
    stage3SetCellField("stage3CellInitialTemp", 25);
    stage3SetCellField("stage3CellSoh", 100);
    stage3SetCellField("stage3CellSpecificHeat", chemistry.defaults.specific_heat_J_kgK);
    stage3SetCellField("stage3CellHeatTransfer", chemistry.defaults.heat_transfer_W_m2K);
    stage3SetCellField("stage3CellSpreadCapacity", source.default_spread_percent.capacity);
    stage3SetCellField("stage3CellSpreadDcir", source.default_spread_percent.dcir);
    stage3SetCellField("stage3CellSpreadSoc", source.default_spread_percent.initial_soc);
    $("stage3CellResistanceKind").value = "dcir";
    $("stage3CellOcvMode").value = "chemistry";
    collectStage3CellModel();
  }

  function applyStage3CellChemistryDefaults(chemistryId) {
    const chemistry = stage3CellCatalog.chemistries?.[chemistryId];
    if (!chemistry) return;
    stage3SetCellField("stage3CellVoltageMax", chemistry.defaults.voltage_max_V);
    stage3SetCellField("stage3CellVoltageMin", chemistry.defaults.voltage_min_V);
    stage3SetCellField("stage3CellVoltageNominal", chemistry.defaults.voltage_nominal_V);
    stage3SetCellField("stage3CellSpecificHeat", chemistry.defaults.specific_heat_J_kgK);
    stage3SetCellField("stage3CellHeatTransfer", chemistry.defaults.heat_transfer_W_m2K);
    if ($("stage3CellResistanceKind").value === "unknown" || $("stage3CellDcirMohm").value === "") {
      stage3SetCellField("stage3CellDcirMohm", "");
    }
    collectStage3CellModel();
  }

  function stage3FormatCellCurve(points, unit = "") {
    return (points || []).map(point => {
      const x = Number(point.x), y = Number(point.y);
      const format = value => Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
      return `${format(x)}→${format(y)}${unit}`;
    }).join(" · ");
  }

  function collectStage3CellModel() {
    const chemistryId = $("stage3CellChemistry")?.value;
    const chemistry = stage3CellCatalog.chemistries?.[chemistryId];
    if (!chemistry) return;
    const savedProfile = activeSavedCellProfile();
    const savedModel = savedProfile?.model || null;
    const resistanceKind = $("stage3CellResistanceKind").value;
    const enteredResistance = stage3CellNumber("stage3CellDcirMohm", null);
    let dcirReference = enteredResistance;
    let dcirSource = "manufacturer_dcir";
    if (resistanceKind === "unknown" || !Number.isFinite(enteredResistance) || enteredResistance <= 0) {
      dcirReference = chemistry.defaults.dcir_mohm;
      dcirSource = "chemistry_estimate";
    } else if (resistanceKind === "acir") {
      dcirReference = enteredResistance * stage3CellCatalog.dcir_acir_estimation.multiplier;
      dcirSource = "estimated_from_acir";
    }
    const soh = stage3CellNumber("stage3CellSoh", 100);
    const agedDcir = dcirReference * (1 + Math.max(0, 100 - soh) / 100 * 0.8);
    const ocvMode = $("stage3CellOcvMode").value;
    const customOcv = ocvMode === "custom" ? parseStage3CustomOcv($("stage3CellOcvPoints").value) : null;
    const ocvValid = ocvMode !== "custom" || Boolean(customOcv);
    const voltageMin = stage3CellNumber("stage3CellVoltageMin", chemistry.defaults.voltage_min_V);
    const voltageMax = stage3CellNumber("stage3CellVoltageMax", chemistry.defaults.voltage_max_V);
    const diameterMm = stage3CellNumber("stage3CellDiameterMm", 18);
    const heightMm = stage3CellNumber("stage3CellHeightMm", 65);
    const massKg = stage3CellNumber("stage3CellMassKg", 0.047);
    const selectedGeometryPreset = stage3CellGeometryPresetFromType();
    const geometryMatchesPreset = Math.abs(diameterMm - selectedGeometryPreset.diameterMm) < 1e-6
      && Math.abs(heightMm - selectedGeometryPreset.heightMm) < 1e-6
      && Math.abs(massKg - selectedGeometryPreset.massKg) < 1e-9;
    const specificHeat = stage3CellNumber("stage3CellSpecificHeat", chemistry.defaults.specific_heat_J_kgK);
    const radiusM = diameterMm * 0.0005;
    const heightM = heightMm * 0.001;
    const surfaceAreaM2 = 2 * Math.PI * radiusM * heightM + 2 * Math.PI * radiusM * radiusM;
    const resistanceTemperatureFactor = parseStage3FactorCurve(savedModel?.resistanceTempPoints) || chemistry.resistance_temperature_factor;
    const resistanceSocFactor = parseStage3FactorCurve(savedModel?.resistanceSocPoints) || chemistry.resistance_soc_factor;
    const capacityTemperatureFactor = parseStage3FactorCurve(savedModel?.capacityTempPoints) || chemistry.capacity_temperature_factor;
    const chargeCurrentTemperatureFactor = parseStage3FactorCurve(savedModel?.chargeTempPoints, true) || chemistry.charge_current_temperature_factor;
    const r1Fraction = Number.isFinite(savedModel?.r1Fraction)
      ? Math.max(0, savedModel.r1Fraction)
      : chemistry.dynamic_model.r1_fraction_of_dcir;
    const tau1S = Number.isFinite(savedModel?.tau1S)
      ? Math.max(0.01, savedModel.tau1S)
      : chemistry.dynamic_model.tau1_s;
    const r1Mohm = agedDcir * r1Fraction;
    const currentLimits = {
      standard_discharge_A: stage3CellNumber("stage3CellStandardDischargeA", 0),
      max_continuous_discharge_A: stage3CellNumber("stage3CellMaxDischargeA", 0),
      standard_charge_A: stage3CellNumber("stage3CellStandardChargeA", 0),
      max_charge_A: stage3CellNumber("stage3CellMaxChargeA", 0)
    };
    const currentFields = {
      standard_discharge_A: $("stage3CellStandardDischargeA"),
      max_continuous_discharge_A: $("stage3CellMaxDischargeA"),
      standard_charge_A: $("stage3CellStandardChargeA"),
      max_charge_A: $("stage3CellMaxChargeA")
    };
    Object.values(currentFields).forEach(field => field?.setCustomValidity(""));
    const currentValidation = window.BATTERY_CURRENT_MODEL.validate(currentLimits);
    currentValidation.errors.forEach(error => {
      currentFields[error.field]?.setCustomValidity(error.code === "standard_above_maximum"
        ? "Prąd standardowy nie może być większy od prądu maksymalnego."
        : "Podaj dodatnią wartość prądu.");
    });
    if (!currentValidation.valid) {
      stage3CellModel = null;
      window.batteryPackCellModel = null;
      $("stage3CellModelStatus").innerHTML = '<span class="estimated">Popraw zakresy prądów ogniwa: wartości muszą być dodatnie, a prąd standardowy nie może przekraczać maksymalnego.</span>';
      renderStage3CellProfileSummary();
      return;
    }

    stage3CellModel = {
      cell_profile_id: savedProfile?.id || null,
      cell_profile_modified: Boolean(savedProfile && stage3CellProfileDirty),
      selected_cell_type: $("cellType")?.selectedOptions?.[0]?.textContent?.trim() || null,
      chemistry_id: chemistryId,
      capacity_nominal_Ah: stage3CellNumber("stage3CellCapacityAh", 0),
      voltage_max_V: voltageMax,
      voltage_min_V: voltageMin,
      voltage_nominal_V: stage3CellNumber("stage3CellVoltageNominal", chemistry.defaults.voltage_nominal_V),
      standard_discharge_A: currentLimits.standard_discharge_A,
      max_continuous_discharge_A: currentLimits.max_continuous_discharge_A,
      standard_charge_A: currentLimits.standard_charge_A,
      max_charge_A: currentLimits.max_charge_A,
      dcir_reference_mohm: dcirReference,
      dcir_at_current_soh_mohm: agedDcir,
      dcir_source: dcirSource,
      resistance_measurement: {
        input_mohm: Number.isFinite(enteredResistance) && enteredResistance > 0 ? enteredResistance : null,
        input_kind: resistanceKind,
        acir_to_dcir_multiplier: resistanceKind === "acir" ? stage3CellCatalog.dcir_acir_estimation.multiplier : null,
        converted_dcir_reference_mohm: dcirReference,
        r0_plus_r1_reference_mohm: agedDcir + r1Mohm
      },
      initial_temperature_C: stage3CellNumber("stage3CellInitialTemp", 25),
      initial_soc_percent: stage3CellNumber("stage3CellInitialSoc", 100),
      state_of_health_percent: soh,
      geometry: {
        diameter_mm: diameterMm,
        height_mm: heightMm,
        mass_kg: massKg,
        surface_area_m2: surfaceAreaM2,
        source: geometryMatchesPreset ? selectedGeometryPreset.source : "wartości ręczne"
      },
      thermal: {
        specific_heat_J_kgK: specificHeat,
        heat_capacity_J_K: massKg * specificHeat,
        heat_transfer_W_m2K: stage3CellNumber("stage3CellHeatTransfer", chemistry.defaults.heat_transfer_W_m2K)
      },
      spread_percent: {
        capacity: stage3CellNumber("stage3CellSpreadCapacity", 2),
        dcir: stage3CellNumber("stage3CellSpreadDcir", 5),
        initial_soc: stage3CellNumber("stage3CellSpreadSoc", 0.5)
      },
      ocv_soc: customOcv || scaleStage3ChemistryOcv(chemistry, voltageMin, voltageMax),
      ocv_source: customOcv ? "manufacturer_curve" : "chemistry_default",
      resistance_temperature_factor: resistanceTemperatureFactor,
      resistance_soc_factor: resistanceSocFactor,
      capacity_temperature_factor: capacityTemperatureFactor,
      charge_current_temperature_factor: chargeCurrentTemperatureFactor,
      dynamic_model: {
        ...chemistry.dynamic_model,
        r1_fraction_of_dcir: r1Fraction,
        tau1_s: tau1S,
        r1_mohm: r1Mohm,
        c1_F: r1Mohm > 0 ? tau1S / (r1Mohm * 0.001) : 0
      }
    };
    window.batteryPackCellModel = stage3CellModel;

    stage3SetCellField("cellAh", stage3CellModel.capacity_nominal_Ah * 1000);
    stage3SetCellField("cellVoltage", stage3CellModel.voltage_nominal_V);
    stage3SetCellField("cellStandardDischarge", stage3CellModel.standard_discharge_A);
    stage3SetCellField("cellMaxDischarge", stage3CellModel.max_continuous_discharge_A);
    stage3SetCellField("cellStandardCharge", stage3CellModel.standard_charge_A);
    stage3SetCellField("cellMaxCharge", stage3CellModel.max_charge_A);
    stage3SetCellField("cellResistance", dcirReference);

    const sourceLabel = dcirSource === "manufacturer_dcir"
      ? "DCIR użytkownika"
      : dcirSource === "estimated_from_acir"
        ? "DCIR oszacowane z ACIR × " + stage3CellCatalog.dcir_acir_estimation.multiplier
        : "DCIR szacunkowe dla chemii";
    const statusClass = dcirSource === "manufacturer_dcir" ? "" : "estimated";
    $("stage3CellModelStatus").innerHTML = `<strong>${chemistry.name_pl}</strong> · OCV: ${customOcv ? "krzywa producenta" : "automatyczna krzywa chemii"}<br><span class="${statusClass}">${sourceLabel}: ${dcirReference.toFixed(3)} mΩ</span> · R0+R1 odniesienia: ${(agedDcir + r1Mohm).toFixed(3)} mΩ${ocvValid ? "" : '<br><span class="estimated">Nieprawidłowa krzywa OCV. Wpisz co najmniej dwa punkty SOC:napięcie.</span>'}`;
    const simulationData = $("stage3CellSimulationData");
    if (simulationData) {
      const model = stage3CellModel;
      simulationData.innerHTML = `<strong>Dane automatycznie używane przez symulację</strong><br>Prąd rozładowania standard / maks. ciągły: ${model.standard_discharge_A.toFixed(2)} / ${model.max_continuous_discharge_A.toFixed(2)} A<br>Prąd ładowania standard / maks.: ${model.standard_charge_A.toFixed(2)} / ${model.max_charge_A.toFixed(2)} A<br>Geometria: Ø ${model.geometry.diameter_mm.toFixed(2)} × ${model.geometry.height_mm.toFixed(2)} mm · masa ${(model.geometry.mass_kg * 1000).toFixed(1)} g<br>Powierzchnia ogniwa: ${model.geometry.surface_area_m2.toFixed(5)} m² · pojemność cieplna: ${model.thermal.heat_capacity_J_K.toFixed(1)} J/K<br>Model dynamiczny RC: R1 ${model.dynamic_model.r1_mohm.toFixed(2)} mΩ · C1 ${model.dynamic_model.c1_F.toFixed(0)} F · stała czasowa ${model.dynamic_model.tau1_s.toFixed(1)} s<div class="stage3-cell-curve"><strong>OCV(SOC)</strong>: ${stage3FormatCellCurve(model.ocv_soc, " V")}</div><div class="stage3-cell-curve"><strong>R(T) — mnożnik DCIR</strong>: ${stage3FormatCellCurve(model.resistance_temperature_factor, "×")}</div><div class="stage3-cell-curve"><strong>R(SOC) — mnożnik DCIR</strong>: ${stage3FormatCellCurve(model.resistance_soc_factor, "×")}</div><div class="stage3-cell-curve"><strong>Q(T) — dostępna pojemność</strong>: ${stage3FormatCellCurve(model.capacity_temperature_factor, "×")}</div><div class="stage3-cell-curve"><strong>Limit prądu ładowania wg T</strong>: ${stage3FormatCellCurve(model.charge_current_temperature_factor, "×")}</div>`;
    }
    renderStage3CellProfileSummary();
  }
