(function (global) {
  "use strict";

  const $ = id => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const num = (id, fallback = 0) => {
    const value = Number($(id)?.value);
    return Number.isFinite(value) ? value : fallback;
  };
  const interp = (points, x) => {
    if (!points?.length) return 1;
    if (x <= points[0].x) return points[0].y;
    for (let i = 1; i < points.length; i++) {
      if (x <= points[i].x) {
        const a = points[i - 1], b = points[i], t = (x - a.x) / (b.x - a.x || 1);
        return a.y + (b.y - a.y) * t;
      }
    }
    return points[points.length - 1].y;
  };
  const fmt = (v, digits = 2) => Number.isFinite(v) ? v.toFixed(digits) : "—";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const currentModel = global.BATTERY_CURRENT_MODEL;
  const THERMAL_COLOR_STOPS = [[23,37,84],[14,165,233],[34,197,94],[250,204,21],[239,68,68],[255,255,255]];

  class Stage4Simulation {
    constructor(dataProvider) {
      this.dataProvider = dataProvider;
      this.package = null;
      this.cells = [];
      this.tapeSegments = [];
      this.nodes = [];
      this.groupVoltages = [];
      this.history = [];
      this.loadHistory = [];
      this.loadControlHistory = [];
      this.events = [];
      this.eventSequence = 0;
      this.eventCategoryCounters = {};
      this.weakRecords = {};
      this.bmsBalanceBranches = [];
      this.bmsBalanceEnergyWh = 0;
      this.energyBalance = null;
      this.settingsCache = null;
      this.settingsDirty = true;
      this.cellsBySection = [];
      this.sectionBmsAttachments = [];
      this.tapeThermalAxialPairs = [];
      this.tapeThermalContactPairs = [];
      this.thermalScratch = null;
      this.airZones = [];
      this.caseNodes = [];
      this.thermalMaxima = {};
      this.calibrationDataset = null;
      this.calibrationEvaluation = null;
      this.visualLayout = null;
      this.commandedPackCurrentA = 0;
      this.solvedPackCurrentA = 0;
      this.lastElectricalValidation = null;
      this.lastControlTest = null;
      this.adaptiveStepReported = false;
      this.overrides = new Map();
      this.selectedCell = null;
      this.selectedStrip = null;
      this.status = "idle";
      this.time = 0;
      this.energyWh = 0;
      this.lossEnergyWh = 0;
      this.bmsBalanceEnergyWh = 0;
      this.commandedPackCurrentA = 0;
      this.solvedPackCurrentA = 0;
      this.lastFrame = 0;
      this.simulationTimeBudget = 0;
      this.integrationStepS = null;
      this.integrationStepConfiguredDt = null;
      this.electricalStepRemainingS = 0;
      this.simulationGeneration = 0;
      this.workerFallbackReported = false;
      this.workerPool = global.Stage4WorkerPool ? new global.Stage4WorkerPool(new URL("./js/workers/stage4-compute-worker.js", document.baseURI).href) : null;
      this.visualAccumulator = 0;
      this.resultsAccumulator = 0;
      this.activeTab = "summary";
      this.bms = { connected: true, state: "CZUWANIE", timers: {}, lastTrip: null };
      this.boundLoop = timestamp => { this.loop(timestamp).catch(error => {
        if (this.status === "running") this.stop(`Błąd wątku symulacji: ${error?.message || error}`);
      }); };
      this.bindUi();
      this.renderEmpty();
    }

    bindUi() {
      $("stage4Start")?.addEventListener("click", () => this.start());
      $("stage4Pause")?.addEventListener("click", () => this.pause());
      $("stage4Resume")?.addEventListener("click", () => this.resume());
      $("stage4Stop")?.addEventListener("click", () => this.stop("Zatrzymano ręcznie"));
      $("stage4Reset")?.addEventListener("click", () => this.reset());
      $("stage4Regenerate")?.addEventListener("click", () => {
        $("stage4Seed").value = (Number($("stage4Seed").value) + 1) || 1;
        this.reset(true);
      });
      $("stage4BmsDefaults")?.addEventListener("click", () => this.applyBmsDefaults());
      $("stage4BmsReconnect")?.addEventListener("click", () => this.reconnectBms());
      $("stage4Quality")?.addEventListener("change", event => {
        const values = { low: [40, 2], medium: [20, 1], high: [10, 0.25] }[event.target.value];
        if (values) { $("stage4SegmentLengthMm").value = values[0]; $("stage4TimeStepS").value = values[1]; this.invalidateSettings(); }
      });
      $("stage4Mode")?.addEventListener("change", () => this.updateModeUi(true));
      $("stage4LoadMode")?.addEventListener("change", () => this.updateModeUi());
      document.querySelectorAll("[data-stage4-live-mode]").forEach(button => button.addEventListener("click", () => {
        $("stage4Mode").value = button.dataset.stage4LiveMode;
        this.updateModeUi(true);
        this.captureLoadControlChange("przełącznik trybu pracy");
      }));
      $("stage4CurrentRange")?.addEventListener("input", event => {
        const usePower = $("stage4Mode").value !== "charge" && $("stage4LoadMode").value === "power";
        $(usePower ? "stage4PowerW" : "stage4CurrentA").value = event.target.value;
        this.syncLiveControls();
        this.captureLoadControlChange(usePower ? "suwak mocy" : "suwak prądu");
      });
      $("stage4CurrentA")?.addEventListener("input", () => { this.syncLiveControls(); this.captureLoadControlChange("pole prądu"); });
      $("stage4PowerW")?.addEventListener("input", () => { this.syncLiveControls(); this.captureLoadControlChange("pole mocy"); });
      $("stage4LoadMode")?.addEventListener("change", () => this.captureLoadControlChange("tryb obciążenia"));
      $("stage4Mode")?.addEventListener("change", () => this.captureLoadControlChange("tryb pracy"));
      $("stage4Speed")?.addEventListener("change", () => { this.simulationTimeBudget = 0; this.renderLivePanel(); });
      ["stage4ThermalEnabled", "stage4BmsEnabled", "stage4TemperatureProtection", "stage4PowerW", "stage4CvEndCurrentA"].forEach(id => $(id)?.addEventListener("input", () => this.renderLivePanel()));
      $("stage4InitialPackVoltageV")?.addEventListener("input", () => { this.syncInitialVoltageFields("pack"); this.invalidateSettings(); });
      $("stage4InitialCellVoltageV")?.addEventListener("input", () => { this.syncInitialVoltageFields("cell"); this.invalidateSettings(); });
      $("stage-4")?.addEventListener("input", () => this.invalidateSettings());
      $("stage-4")?.addEventListener("change", () => this.invalidateSettings());
      document.querySelectorAll("[data-stage4-tab]").forEach(button => button.addEventListener("click", () => {
        this.activeTab = button.dataset.stage4Tab;
        this.activateTab(this.activeTab);
        this.renderResults();
      }));
      [$("stage4State"), $("stage4ResultBody"), $("stage4LastBmsEvent")].filter(Boolean).forEach(host => host.addEventListener("click", event => {
        const link = event.target.closest?.("[data-stage4-event-link]");
        if (!link) return;
        event.preventDefault();
        this.openEventReference(link.dataset.stage4EventLink);
      }));
      $("stage4ExportCsv")?.addEventListener("click", () => this.exportCsv());
      $("stage4ExportJson")?.addEventListener("click", () => this.exportJson());
      $("stage4ExportDiagnostic")?.addEventListener("click", () => this.exportDiagnosticLog());
      $("stage4ExportCalibrationTemplate")?.addEventListener("click", () => this.exportThermalCalibrationTemplate());
      $("stage4ExportSensitivityPlan")?.addEventListener("click", () => this.exportThermalSensitivityPlan());
      $("stage4CalibrationFile")?.addEventListener("change", event => this.importThermalCalibrationData(event.target.files?.[0]));
      $("stage4ControlTest")?.addEventListener("click", () => this.run10S10P50AControlTest());
      ["stage4LeadMinus", "stage4LeadPlus"].forEach(id => $(id)?.addEventListener("change", () => {
        if (!this.package) return;
        this.reset();
        this.setState("Zmieniono fizyczny punkt PACK i zresetowano stan symulacji.");
      }));
      ["stage4ScaleMin", "stage4ScaleMax", "stage4AutoScale", "stage4ScaleMode", "stage4VisualLayer"].forEach(id => $(id)?.addEventListener("input", () => this.renderVisual()));
      ["stage4ScaleMode", "stage4VisualLayer"].forEach(id => $(id)?.addEventListener("change", () => this.renderVisual()));
      ["stage4ThermalFidelity", "stage4ThermalEnvironment", "stage4ThermalAirZoneSize", "stage4ThermalAirDepth", "stage4ThermalHolderCoverage", "stage4ThermalTapeCoverage", "stage4ThermalEndExposure"].forEach(id => $(id)?.addEventListener("change", () => {
        this.invalidateSettings();
        if (this.package) { this.reset(); this.setState("Przebudowano geometrię i węzły modelu termicznego po zmianie ustawień."); }
      }));
      this.bindResultsPanel();
      this.bindVisualNavigation();
    }

    bindResultsPanel() {
      const stage = document.querySelector(".stage4-stage"), panel = $("stage4Results"), handle = $("stage4ResultsResizer"), toggle = $("stage4ResultsToggle");
      if (!stage || !panel || !handle || !toggle) return;
      this.resultsExpandedHeight = Math.max(120, panel.getBoundingClientRect().height || 190);
      const setCollapsed = collapsed => {
        if (!collapsed) stage.style.setProperty("--stage4-results-height", `${this.resultsExpandedHeight}px`);
        stage.classList.toggle("stage4-results-collapsed", collapsed);
        toggle.textContent = collapsed ? "Rozwiń" : "Zwiń";
        toggle.title = collapsed ? "Rozwiń panel wyników" : "Zwiń panel wyników";
        toggle.setAttribute("aria-expanded", String(!collapsed));
      };
      toggle.addEventListener("click", () => {
        const collapsed = stage.classList.contains("stage4-results-collapsed");
        if (!collapsed) this.resultsExpandedHeight = Math.max(120, panel.getBoundingClientRect().height);
        setCollapsed(!collapsed);
      });
      handle.addEventListener("dblclick", () => toggle.click());
      handle.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle.click(); return; }
        if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
        event.preventDefault();
        if (stage.classList.contains("stage4-results-collapsed")) setCollapsed(false);
        const direction = event.key === "ArrowUp" ? 1 : -1;
        const maximum = Math.max(120, stage.clientHeight - ($("stage4Metrics")?.offsetHeight || 0) - 170);
        this.resultsExpandedHeight = clamp(this.resultsExpandedHeight + direction * 20, 120, maximum);
        stage.style.setProperty("--stage4-results-height", `${this.resultsExpandedHeight}px`);
      });
      handle.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault();
        if (stage.classList.contains("stage4-results-collapsed")) setCollapsed(false);
        this.resultsResize = { pointerId: event.pointerId, startY: event.clientY, startHeight: Math.max(120, panel.getBoundingClientRect().height) };
        stage.classList.add("stage4-results-resizing");
        handle.setPointerCapture(event.pointerId);
      });
      handle.addEventListener("pointermove", event => {
        if (!this.resultsResize || this.resultsResize.pointerId !== event.pointerId) return;
        const maximum = Math.max(120, stage.clientHeight - ($("stage4Metrics")?.offsetHeight || 0) - 170);
        this.resultsExpandedHeight = clamp(this.resultsResize.startHeight + this.resultsResize.startY - event.clientY, 120, maximum);
        stage.style.setProperty("--stage4-results-height", `${this.resultsExpandedHeight}px`);
      });
      const finishResize = event => {
        if (!this.resultsResize || this.resultsResize.pointerId !== event.pointerId) return;
        this.resultsResize = null;
        stage.classList.remove("stage4-results-resizing");
        if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      };
      handle.addEventListener("pointerup", finishResize);
      handle.addEventListener("pointercancel", finishResize);
    }

    bindVisualNavigation() {
      const svg = $("stage4Drawing");
      if (!svg) return;
      $("stage4FitView")?.addEventListener("click", () => this.fitVisualView());
      svg.addEventListener("dblclick", event => { if (!event.target.closest?.(".stage4-cell-hit, .stage4-strip-hit")) this.fitVisualView(); });
      svg.addEventListener("pointerdown", event => {
        const overElement = event.target.closest?.(".stage4-cell-hit, .stage4-strip-hit");
        if (event.button !== 1 && (event.button !== 0 || overElement)) return;
        event.preventDefault();
        this.visualPan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        svg.classList.add("panning");
        svg.setPointerCapture(event.pointerId);
      });
      svg.addEventListener("pointermove", event => {
        if (!this.visualPan || this.visualPan.pointerId !== event.pointerId || !this.visualViewBox) return;
        const dx = event.clientX - this.visualPan.x, dy = event.clientY - this.visualPan.y;
        const matrix = svg.getScreenCTM();
        const scaleX = matrix ? Math.hypot(matrix.a, matrix.b) : 0;
        const scaleY = matrix ? Math.hypot(matrix.c, matrix.d) : 0;
        this.visualViewBox.x -= dx / Math.max(1e-6, scaleX);
        this.visualViewBox.y -= dy / Math.max(1e-6, scaleY);
        this.visualPan.x = event.clientX; this.visualPan.y = event.clientY;
        svg.setAttribute("viewBox", `${this.visualViewBox.x} ${this.visualViewBox.y} ${this.visualViewBox.width} ${this.visualViewBox.height}`);
      });
      const finishPan = event => {
        if (!this.visualPan || (event.pointerId !== undefined && this.visualPan.pointerId !== event.pointerId)) return;
        if (event.pointerId !== undefined && svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
        this.visualPan = null; svg.classList.remove("panning");
      };
      svg.addEventListener("pointerup", finishPan);
      svg.addEventListener("pointercancel", finishPan);
      svg.addEventListener("mouseover", event => {
        const cell = event.target.closest?.(".stage4-cell-hit");
        if (cell) return this.showCellTooltip(cell.dataset.cellId);
        const strip = event.target.closest?.(".stage4-strip-hit");
        if (strip) {
          this.showStripTooltip(strip.dataset.stripId);
          svg.querySelectorAll(".stage4-current-indicator.visible").forEach(label => label.classList.remove("visible"));
          svg.querySelector(`.stage4-current-indicator[data-current-group="${strip.dataset.currentGroup}"]`)?.classList.add("visible");
        }
      });
      svg.addEventListener("mouseout", event => {
        const strip = event.target.closest?.(".stage4-strip-hit");
        if (!strip) return;
        const nextStrip = event.relatedTarget?.closest?.(".stage4-strip-hit");
        if (nextStrip?.dataset.currentGroup === strip.dataset.currentGroup) return;
        svg.querySelector(`.stage4-current-indicator[data-current-group="${strip.dataset.currentGroup}"]`)?.classList.remove("visible");
      });
      svg.addEventListener("click", event => {
        const cell = event.target.closest?.(".stage4-cell-hit");
        if (cell) {
          this.selectedCell = cell.dataset.cellId; this.activeTab = "cells"; this.activateTab("cells"); this.renderResults();
          return;
        }
        const strip = event.target.closest?.(".stage4-strip-hit");
        if (strip) {
          this.selectedStrip = strip.dataset.stripId; this.activeTab = "strips"; this.activateTab("strips"); this.renderResults();
        }
      });
      svg.addEventListener("mouseleave", () => {
        $("stage4Tooltip").innerHTML = "";
        svg.querySelectorAll(".stage4-current-indicator.visible").forEach(label => label.classList.remove("visible"));
      });
      svg.addEventListener("wheel", event => {
        if (!this.visualViewBox || !this.visualBaseViewBox) return;
        event.preventDefault();
        const matrix = svg.getScreenCTM();
        const cursor = matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : { x: this.visualViewBox.x + this.visualViewBox.width / 2, y: this.visualViewBox.y + this.visualViewBox.height / 2 };
        const px = clamp((cursor.x - this.visualViewBox.x) / Math.max(1e-9, this.visualViewBox.width), 0, 1);
        const py = clamp((cursor.y - this.visualViewBox.y) / Math.max(1e-9, this.visualViewBox.height), 0, 1);
        const factor = event.deltaY > 0 ? 1.14 : 0.877;
        const minWidth = this.visualBaseViewBox.width * .18, maxWidth = this.visualBaseViewBox.width * 8;
        const nextWidth = clamp(this.visualViewBox.width * factor, minWidth, maxWidth);
        const nextHeight = nextWidth * (this.visualViewBox.height / this.visualViewBox.width);
        const anchorX = this.visualViewBox.x + this.visualViewBox.width * px;
        const anchorY = this.visualViewBox.y + this.visualViewBox.height * py;
        this.visualViewBox = { x: anchorX - nextWidth * px, y: anchorY - nextHeight * py, width: nextWidth, height: nextHeight };
        svg.setAttribute("viewBox", `${this.visualViewBox.x} ${this.visualViewBox.y} ${this.visualViewBox.width} ${this.visualViewBox.height}`);
      }, { passive: false });
    }

    fitVisualView() {
      if (!this.visualBaseViewBox) { this.visualViewNeedsFit = true; this.renderVisual(); return; }
      this.visualViewBox = { ...this.visualBaseViewBox };
      this.visualViewNeedsFit = false;
      $("stage4Drawing")?.setAttribute("viewBox", `${this.visualViewBox.x} ${this.visualViewBox.y} ${this.visualViewBox.width} ${this.visualViewBox.height}`);
    }

    enter() {
      let incoming = this.dataProvider?.();
      if (!incoming?.cells?.length) {
        this.setState("Brak przypisanych ogniw. Uzupełnij etapy 1–3.", "tripped");
        return;
      }
      if (!incoming.cellModel) {
        this.setState("Brak modelu ogniwa z etapu 3. Uzupełnij parametry ogniwa przed uruchomieniem symulacji.", "tripped");
        return;
      }
      incoming = { ...incoming, cellModel: currentModel.normalize(incoming.cellModel) };
      const signature = JSON.stringify({ cells: incoming.cells.map(c => [c.id, c.x, c.y, c.section]), tapes: incoming.tapes, strip: incoming.stripSelection, model: incoming.cellModel, visualCellDiameterMm: incoming.visualCellDiameterMm, packLeads: incoming.routing?.mainLeads || null });
      if (signature !== this.signature) {
        this.signature = signature;
        this.package = incoming;
        this.visualViewBox = null;
        this.visualViewNeedsFit = true;
        this.baseCellModel = JSON.parse(JSON.stringify(incoming.cellModel));
        this.populateInputs();
        this.applyBmsDefaults();
        this.reset();
      } else {
        this.renderAll();
      }
    }

    populateInputs() {
      const cells = this.package.cells;
      const firstGroup = cells.filter(c => c.section === 0);
      const lastGroup = cells.filter(c => c.section === this.package.series - 1);
      const options = list => list.map(c => `<option value="${esc(c.id)}">${esc(c.id)} · S${c.section + 1}</option>`).join("");
      $("stage4LeadMinus").innerHTML = options(firstGroup);
      $("stage4LeadPlus").innerHTML = options(lastGroup);
      const automaticLeads = this.package.routing?.mainLeads || {};
      const preferredMinus = String(automaticLeads.negative?.[0] ?? "");
      const preferredPlus = String(automaticLeads.positive?.[0] ?? "");
      if (firstGroup.length) $("stage4LeadMinus").value = firstGroup.some(cell => String(cell.id) === preferredMinus) ? preferredMinus : String(firstGroup.slice().sort((a, b) => a.x - b.x)[0].id);
      if (lastGroup.length) $("stage4LeadPlus").value = lastGroup.some(cell => String(cell.id) === preferredPlus) ? preferredPlus : String(lastGroup.slice().sort((a, b) => b.x - a.x)[0].id);
      const material = this.package.stripMaterial;
      if (material) {
        $("stage4StripResistivity").value = material.electrical_resistivity_ohm_m.nominal;
        $("stage4StripTcr").value = material.temperature_coefficient_1_K;
        $("stage4StripDensity").value = material.density_kg_m3;
        $("stage4StripSpecificHeat").value = material.specific_heat_J_kgK;
        $("stage4StripThermalConductivity").value = material.thermal_conductivity_W_mK;
      }
      const model = this.package.cellModel;
      if (model) {
        $("stage4SpreadCapacity").value = model.spread_percent.capacity;
        $("stage4SpreadDcir").value = model.spread_percent.dcir;
        $("stage4SpreadSoc").value = model.spread_percent.initial_soc;
        $("stage4AmbientC").value = model.initial_temperature_C;
        $("stage4CurrentA").value = Math.max(0.1, this.package.parallel * model.standard_discharge_A);
        $("stage4InitialPackVoltageV").value = (this.package.series * interp(model.ocv_soc, model.initial_soc_percent)).toFixed(2);
        $("stage4InitialCellVoltageV").value = interp(model.ocv_soc, model.initial_soc_percent).toFixed(2);
        this.updateModeUi();
      }
    }

    applyBmsDefaults() {
      const model = this.package?.cellModel;
      if (!model) return;
      $("stage4BmsVmax").value = model.voltage_max_V;
      $("stage4BmsVmin").value = model.voltage_min_V;
      $("stage4BmsDischargeA").value = currentModel.packLimits(model, "discharge", this.package.parallel).maximumA;
      $("stage4BmsChargeA").value = currentModel.packLimits(model, "charge", this.package.parallel).maximumA;
      $("stage4BalanceStartV").value = Math.max(model.voltage_min_V, model.voltage_max_V - 0.15).toFixed(2);
      this.invalidateSettings();
    }

    updateModeUi(useRecommendedCurrent = false) {
      this.invalidateSettings();
      const charge = $("stage4Mode").value === "charge";
      if (useRecommendedCurrent && this.package?.cellModel) {
        const limits = currentModel.packLimits(this.package.cellModel, charge ? "charge" : "discharge", this.package.parallel);
        $("stage4CurrentA").value = Math.max(0.1, limits.standardA).toFixed(2);
      }
      $("stage4LoadMode").disabled = charge;
      document.querySelectorAll("[data-stage4-live-mode]").forEach(button => button.classList.toggle("active", button.dataset.stage4LiveMode === $("stage4Mode").value));
      document.querySelectorAll(".stage4-live-charge").forEach(element => { element.hidden = !charge; });
      this.syncLiveControls();
      this.renderAll();
    }

    invalidateSettings() { this.settingsDirty = true; this.electricalStepRemainingS = 0; }

    cellCurrentLimits(cell, mode) {
      return mode === "charge"
        ? { standardA: cell.standardChargeCurrentA, maximumA: cell.maxChargeCurrentA }
        : { standardA: cell.standardCurrentA, maximumA: cell.maxCurrentA };
    }

    packCurrentLimits(mode) {
      const fallback = currentModel.packLimits(this.package?.cellModel || {}, mode, this.package?.parallel || 1);
      if (!this.cellsBySection?.length || !this.cells.length) return fallback;
      const sectionLimits = this.cellsBySection.filter(section => section.length).map(section => section.reduce((sum, cell) => {
        const limits = this.cellCurrentLimits(cell, mode);
        sum.standardA += limits.standardA;
        sum.maximumA += limits.maximumA;
        return sum;
      }, { standardA: 0, maximumA: 0 }));
      return sectionLimits.length ? {
        standardA: Math.min(...sectionLimits.map(limits => limits.standardA)),
        maximumA: Math.min(...sectionLimits.map(limits => limits.maximumA))
      } : fallback;
    }

    temperatureAdjustedChargeLimitA() {
      const curve = this.package?.cellModel?.charge_current_temperature_factor;
      const factorAt = temperatureC => {
        const factor = Number(interp(curve, Number(temperatureC)));
        return Number.isFinite(factor) ? clamp(factor, 0, 1) : 0;
      };
      if (!this.cellsBySection?.length || !this.cells.length) {
        const factor = factorAt(this.package?.cellModel?.initial_temperature_C ?? 25);
        return this.packCurrentLimits("charge").maximumA * factor;
      }
      const sectionLimits = this.cellsBySection.filter(section => section.length).map(section => section.reduce((sum, cell) => {
        const maximumA = Number(cell.maxChargeCurrentA);
        return sum + (Number.isFinite(maximumA) && maximumA > 0 ? maximumA : 0) * factorAt(cell.tempC);
      }, 0));
      return sectionLimits.length ? Math.min(...sectionLimits) : 0;
    }

    syncLiveControls() {
      const currentInput = $("stage4CurrentA"), powerInput = $("stage4PowerW"), range = $("stage4CurrentRange"), readout = $("stage4CurrentReadout");
      if (!currentInput || !powerInput || !range || !readout) return;
      const model = this.package?.cellModel;
      const mode = $("stage4Mode").value;
      const usePower = mode !== "charge" && $("stage4LoadMode").value === "power";
      const limits = model ? this.packCurrentLimits(mode) : { standardA: 50, maximumA: 100 };
      const current = Math.max(.01, Number(currentInput.value) || .01);
      const referenceVoltage = Math.max(.1, Math.abs(this.packVoltage || (this.package?.series || 1) * (model?.voltage_nominal_V || 3.6)));
      const power = Math.max(.1, Number(powerInput.value) || .1);
      const value = usePower ? power : current;
      const unit = usePower ? "W" : "A";
      const standardLimit = usePower ? limits.standardA * referenceVoltage : limits.standardA;
      const maximumLimit = usePower ? limits.maximumA * referenceVoltage : limits.maximumA;
      const maximum = Math.max(1, maximumLimit * 1.25, standardLimit * 1.5, value);
      range.max = maximum;
      range.min = usePower ? 1 : .1;
      range.step = usePower ? 1 : .1;
      range.value = value;
      currentInput.hidden = usePower;
      powerInput.hidden = !usePower;
      currentInput.max = usePower ? "" : maximum;
      powerInput.max = usePower ? maximum : "";
      const valueLabel = $("stage4LoadValueLabel"), rangeLabel = $("stage4LoadRangeLabel");
      if (valueLabel) valueLabel.textContent = usePower ? "Moc [W]" : "Prąd [A]";
      if (rangeLabel) rangeLabel.textContent = usePower ? "Moc zadana" : "Prąd zadany";
      readout.textContent = `${fmt(value, 1)} ${unit}`;
      const currentControl = range.closest(".stage4-current-control");
      if (currentControl && this.cells.length) {
        const commandedEquivalentCurrent = usePower ? power / referenceVoltage : current;
        const commandedStandardRatio = commandedEquivalentCurrent / Math.max(.0001, limits.standardA);
        const commandedMaximumRatio = commandedEquivalentCurrent / Math.max(.0001, limits.maximumA);
        const actualStandardRatio = Math.max(...this.cells.map(cell => Math.abs(cell.currentA) / Math.max(.0001, this.cellCurrentLimits(cell, mode).standardA)));
        const actualMaximumRatio = Math.max(...this.cells.map(cell => Math.abs(cell.currentA) / Math.max(.0001, this.cellCurrentLimits(cell, mode).maximumA)));
        const standardRatio = Math.max(commandedStandardRatio, actualStandardRatio);
        const maximumRatio = Math.max(commandedMaximumRatio, actualMaximumRatio);
        const warningVisible = standardRatio > 1.0001;
        const overCurrent = maximumRatio > 1.0001;
        const warningWidth = clamp((standardRatio - 1) * 100, 0, 100);
        const warningStart = 100 - warningWidth;
        const overcurrentWidth = clamp((maximumRatio - 1) * 100, 0, 100);
        const overcurrentStart = 100 - overcurrentWidth;
        const overcurrentEnd = 100;
        const rangeSpan = Math.max(.0001, maximum - Number(range.min || 0));
        const thumbPosition = clamp((value - Number(range.min || 0)) / rangeSpan * 100, 0, 100);
        const aboveStandard = warningVisible && thumbPosition >= warningStart - .0001;
        currentControl.classList.toggle("warning-visible", warningVisible);
        currentControl.classList.toggle("above-standard", aboveStandard);
        currentControl.classList.toggle("overcurrent", overCurrent);
        currentControl.style.setProperty("--stage4-warning-start", `${warningStart}%`);
        currentControl.style.setProperty("--stage4-warning-end", "100%");
        currentControl.style.setProperty("--stage4-overcurrent-start", `${overcurrentStart}%`);
        currentControl.style.setProperty("--stage4-overcurrent-end", `${overcurrentEnd}%`);
        const band = $("stage4CurrentBand");
        if (band) band.textContent = overCurrent
          ? `Ponad maksimum ${fmt(maximumLimit, 1)} ${unit} · ${fmt((maximumRatio - 1) * 100, 1)}%`
          : aboveStandard
            ? `Podwyższone obciążenie · standard ${fmt(standardLimit, 1)} ${unit} · maks. ${fmt(maximumLimit, 1)} ${unit}`
            : `Zakres standardowy ≤ ${fmt(standardLimit, 1)} ${unit} · maks. ${fmt(maximumLimit, 1)} ${unit}`;
        currentControl.title = overCurrent
          ? mode === "charge"
            ? `Żądany prąd przekracza maksymalny prąd ładowania ${fmt(limits.maximumA, 1)} A. Model ładowarki ograniczy prąd dodatkowo według temperatury ogniw.`
            : `Przekroczony maksymalny ciągły prąd pakietu: ${fmt(limits.maximumA, 1)} A. Ochrona BMS zadziała zgodnie z ustawionym opóźnieniem.`
          : aboveStandard
            ? `Praca powyżej prądu standardowego ${fmt(limits.standardA, 1)} A zwiększa spadek napięcia i straty I²R.`
            : mode === "charge"
              ? `Zalecany prąd ładowania pakietu: do ${fmt(limits.standardA, 1)} A; maksymalny prąd ładowania ${fmt(limits.maximumA, 1)} A.`
              : `Zalecany prąd rozładowania pakietu: do ${fmt(limits.standardA, 1)} A; maksimum ciągłe ${fmt(limits.maximumA, 1)} A.`;
      }
      if (model && $("stage4InitialPackVoltageV")) {
        const initial = $("stage4InitialPackVoltageV");
        initial.min = (this.package.series * model.voltage_min_V).toFixed(2);
        initial.max = (this.package.series * model.voltage_max_V).toFixed(2);
        const cellInitial = $("stage4InitialCellVoltageV");
        cellInitial.min = Number(model.voltage_min_V).toFixed(2);
        cellInitial.max = Number(model.voltage_max_V).toFixed(2);
        if (Number.isFinite(Number(initial.value))) cellInitial.value = (Number(initial.value) / Math.max(1, this.package.series)).toFixed(2);
        else if (Number.isFinite(Number(cellInitial.value))) initial.value = (Number(cellInitial.value) * this.package.series).toFixed(2);
        else {
          const defaultCellVoltage = interp(model.ocv_soc, model.initial_soc_percent);
          cellInitial.value = defaultCellVoltage.toFixed(2);
          initial.value = (this.package.series * defaultCellVoltage).toFixed(2);
        }
      }
    }

    syncInitialVoltageFields(source) {
      if (!this.package?.series) return;
      const packInput = $("stage4InitialPackVoltageV"), cellInput = $("stage4InitialCellVoltageV");
      if (!packInput || !cellInput) return;
      if (source === "cell") {
        const cellVoltage = Number(cellInput.value);
        if (Number.isFinite(cellVoltage)) packInput.value = (cellVoltage * this.package.series).toFixed(2);
      } else {
        const packVoltage = Number(packInput.value);
        if (Number.isFinite(packVoltage)) cellInput.value = (packVoltage / this.package.series).toFixed(2);
      }
    }

    packVoltageToSoc(packVoltageV) {
      const model = this.package?.cellModel;
      if (!model?.ocv_soc?.length || !(this.package?.series > 0) || !Number.isFinite(packVoltageV)) return model?.initial_soc_percent ?? 50;
      const targetV = packVoltageV / this.package.series, points = model.ocv_soc;
      if (targetV <= points[0].y) return points[0].x;
      for (let index = 1; index < points.length; index++) {
        const left = points[index - 1], right = points[index];
        if (targetV <= right.y) return clamp(left.x + (targetV - left.y) / Math.max(1e-9, right.y - left.y) * (right.x - left.x), 0, 100);
      }
      return points[points.length - 1].x;
    }

    settings() {
      if (!this.settingsDirty && this.settingsCache) return this.settingsCache;
      const thermalEnvironment = $("stage4ThermalEnvironment")?.value || "sealed-natural";
      this.settingsCache = {
        mode: $("stage4Mode").value,
        loadMode: $("stage4LoadMode").value,
        currentA: Math.max(0, num("stage4CurrentA", 20)),
        initialPackVoltageV: num("stage4InitialPackVoltageV", NaN),
        powerW: Math.max(0, num("stage4PowerW", 500)),
        cvEndA: Math.max(0, num("stage4CvEndCurrentA", 1)),
        ambientC: num("stage4AmbientC", 25),
        durationS: Math.max(1, num("stage4DurationS", 7200)),
        dt: Math.max(0.01, num("stage4TimeStepS", 1)),
        speed: Math.max(1, num("stage4Speed", 10)),
        thermal: $("stage4ThermalEnabled").checked,
        temperatureProtection: $("stage4TemperatureProtection").checked,
        quality: $("stage4Quality").value,
        maxSegmentMm: Math.max(1, num("stage4SegmentLengthMm", 20)),
        thermalModel: {
          fidelity: $("stage4ThermalFidelity")?.value || "two-node",
          environment: thermalEnvironment,
          coreCapacityFraction: clamp(num("stage4ThermalCoreCapacityFraction", .78), .1, .95),
          coreToSurfaceConductanceWK: Math.max(.001, num("stage4ThermalCoreToSurface", 1.6)),
          exteriorCoolingFactor: Math.max(0, num("stage4ThermalExteriorCooling", 1)),
          transitionCoolingFactor: Math.max(0, num("stage4ThermalTransitionCooling", .75)),
          interiorCoolingFactor: Math.max(0, num("stage4ThermalInteriorCooling", .55)),
          holderCoverageFraction: clamp(num("stage4ThermalHolderCoverage", 18) / 100, 0, .95),
          tapeCoverageFraction: clamp(num("stage4ThermalTapeCoverage", 8) / 100, 0, .95),
          endExposureFraction: clamp(num("stage4ThermalEndExposure", 80) / 100, 0, 1),
          cellToCellConductanceWK: Math.max(0, num("stage4ThermalCellToCell", .12)),
          tapeCellConductanceWK: Math.max(0, num("stage4ThermalTapeToCell", .18)),
          tapeToTapeContactConductanceWK: Math.max(0, num("stage4ThermalTapeToTape", .06)),
          tapeConvectionCoefficientWm2K: Math.max(0, num("stage4ThermalTapeConvection", 10)),
          cellAirCoefficientWm2K: Math.max(0, num("stage4ThermalCellAirH", 6)),
          stillAirCoefficientWm2K: Math.max(0, num("stage4ThermalStillAirH", 2)),
          forcedAirCoefficientWm2K: Math.max(0, num("stage4ThermalForcedAirH", 28)),
          airZoneSizeMm: Math.max(20, num("stage4ThermalAirZoneSize", 80)),
          airDepthMm: Math.max(1, num("stage4ThermalAirDepth", 30)),
          airMixingConductanceWK: Math.max(0, num("stage4ThermalAirMixing", .08)),
          airToCaseCoefficientWm2K: Math.max(0, num("stage4ThermalAirToCase", 5)),
          caseToAmbientCoefficientWm2K: Math.max(0, num("stage4ThermalCaseToAmbient", 8)),
          caseThicknessMm: Math.max(.1, num("stage4ThermalCaseThickness", 2)),
          caseDensityKgM3: Math.max(1, num("stage4ThermalCaseDensity", 1200)),
          caseSpecificHeatJKgK: Math.max(1, num("stage4ThermalCaseSpecificHeat", 1000)),
          caseLateralConductanceWK: Math.max(0, num("stage4ThermalCaseLateral", .2)),
          cellToCaseCoefficientWm2K: Math.max(0, num("stage4ThermalCellToCase", 35)),
          cellToHolderCoefficientWm2K: Math.max(0, num("stage4ThermalCellToHolder", 12)),
          caseContactFraction: clamp(Math.max(num("stage4ThermalCaseContactFraction", 0) / 100, thermalEnvironment === "case-contact" ? .2 : 0), 0, 1),
          caseEmissivity: clamp(num("stage4ThermalCaseEmissivity", .85), 0, 1)
        },
        spread: {
          enabled: $("stage4SpreadEnabled").checked,
          seed: Math.trunc(num("stage4Seed", 12345)),
          capacity: Math.max(0, num("stage4SpreadCapacity", 2)),
          dcir: Math.max(0, num("stage4SpreadDcir", 5)),
          soc: Math.max(0, num("stage4SpreadSoc", 0.5))
        },
        bmsEnabled: $("stage4BmsEnabled").checked,
        balance: {
          enabled: $("stage4BalanceEnabled").checked,
          startV: num("stage4BalanceStartV", 4),
          deltaV: Math.max(0, num("stage4BalanceDeltaV", .02)),
          targetCurrentA: Math.max(0, num("stage4BalanceCurrentA", .1)),
          maxGroups: Math.max(1, Math.round(num("stage4BalanceMaxGroups", 2)))
        }
      };
      this.settingsDirty = false;
      return this.settingsCache;
    }

    reset(regenerated = false) {
      if (!this.package) return;
      this.simulationGeneration++;
      cancelAnimationFrame(this.raf);
      this.status = "idle";
      this.time = 0;
      this.energyWh = 0;
      this.lossEnergyWh = 0;
      this.finishReason = "";
      this.history = [];
      this.loadHistory = [];
      this.loadControlHistory = [];
      this.events = [];
      this.eventSequence = 0;
      this.eventCategoryCounters = {};
      this.weakRecords = {};
      this.bmsBalanceBranches = [];
      this.energyBalance = null;
      this.lastElectricalValidation = null;
      this.lastControlTest = null;
      this.commandedPackCurrentA = 0;
      this.solvedPackCurrentA = 0;
      this.adaptiveStepReported = false;
      this.simulationTimeBudget = 0;
      this.integrationStepS = null;
      this.integrationStepConfiguredDt = null;
      this.electricalStepRemainingS = 0;
      this.visualAccumulator = 0;
      this.resultsAccumulator = 0;
      this.thermalMaxima = {};
      this.pcgRecoveryReported = false;
      this.bms = { connected: true, state: "CZUWANIE", timers: {}, lastTrip: null };
      this.chargePhase = "CC";
      this.package.cellModel = JSON.parse(JSON.stringify(this.baseCellModel));
      this.applyCustomCharacteristics();
      this.generateCells();
      this.buildTopology();
      // Pierwsze rozwiązanie ustala napięcia punktów pomiaru BMS, drugie
      // uwzględnia ewentualne rezystory balansujące już w stanie początkowym.
      this.solveElectrical(0);
      this.solveElectrical(0);
      this.updateBms(0, 0);
      this.captureLoadControlChange("reset", true);
      this.recordSolvedLoadState(0, "stan początkowy", true);
      this.updateThermalMaxima();
      this.recordHistory(true);
      this.setState(regenerated ? `Wygenerowano nowy zestaw ogniw. Seed: ${this.settings().spread.seed}.` : "Model gotowy. Ogniwa, taśmy, wyprowadzenia PACK i balanser BMS są rozwiązywane w jednej sieci fizycznej.");
      this.renderAll();
    }

    parsePointTable(text) {
      const points = String(text || "").split(/[;,\n]+/).map(item => item.trim()).filter(Boolean).map(item => {
        const separator = item.lastIndexOf(":");
        return { x: Number(item.slice(0, separator).trim()), y: Number(item.slice(separator + 1).trim()) };
      });
      if (points.length < 2 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.y <= 0)) return null;
      points.sort((a, b) => a.x - b.x);
      return points.some((point, index) => index && point.x === points[index - 1].x) ? null : points;
    }

    applyCustomCharacteristics() {
      const mappings = [
        ["stage4CustomRSoc", "resistance_soc_factor", "R(SOC)"],
        ["stage4CustomRTemp", "resistance_temperature_factor", "R(T)"],
        ["stage4CustomQTemp", "capacity_temperature_factor", "Q(T)"]
      ];
      mappings.forEach(([id, property, label]) => {
        const raw = $(id)?.value.trim();
        if (!raw) return;
        const parsed = this.parsePointTable(raw);
        if (parsed) this.package.cellModel[property] = parsed;
        else this.logEvent("DANE", `Pominięto nieprawidłową tabelę ${label}; użyto charakterystyki chemii.`);
      });
    }

    generateCells() {
      const model = this.package.cellModel;
      const settings = this.settings(), spread = settings.spread;
      const packVoltageSoc = this.packVoltageToSoc(settings.initialPackVoltageV);
      const random = this.seededRandom(spread.seed);
      this.cells = this.package.cells.map((source, index) => {
        const capacityFactor = spread.enabled ? 1 + this.boundedNormal(random, spread.capacity) / 100 : 1;
        const dcirFactor = spread.enabled ? 1 + this.boundedNormal(random, spread.dcir) / 100 : 1;
        const socOffset = spread.enabled ? this.boundedNormal(random, spread.soc) : 0;
        const override = this.overrides.get(String(source.id)) || {};
        const capacityAh = override.capacityAh ?? model.capacity_nominal_Ah * capacityFactor;
        const initialSoc = clamp(override.soc ?? packVoltageSoc + socOffset, 0, 100);
        const r1ReferenceOhm = Math.max(1e-6, (model.dynamic_model?.r1_mohm ?? (model.dcir_at_current_soh_mohm * (model.dynamic_model?.r1_fraction_of_dcir ?? .35))) * 1e-3 * dcirFactor);
        const c1F = Math.max(1e-3, model.dynamic_model?.c1_F ?? (model.dynamic_model?.tau1_s ?? 18) / r1ReferenceOhm);
        return {
          ...source,
          index,
          capacityAh,
          referenceCapacityAh: capacityAh,
          nominalCapacityAh: model.capacity_nominal_Ah,
          baseDcirMohm: override.dcirMohm ?? model.dcir_at_current_soh_mohm * dcirFactor,
          absoluteChargeAh: capacityAh * initialSoc / 100,
          soc: initialSoc,
          referenceSocPercent: initialSoc,
          availableCapacityAh: capacityAh,
          availableChargeAh: capacityAh * initialSoc / 100,
          temperatureLimitedChargeAh: 0,
          availableSocPercent: initialSoc,
          tempC: override.tempC ?? model.initial_temperature_C,
          coreTempC: override.tempC ?? model.initial_temperature_C,
          surfaceTempC: override.tempC ?? model.initial_temperature_C,
          coolingFactor: override.coolingFactor ?? 1,
          standardCurrentA: override.standardCurrentA ?? model.standard_discharge_A,
          maxCurrentA: override.maxCurrentA ?? model.max_continuous_discharge_A,
          standardChargeCurrentA: override.standardChargeCurrentA ?? model.standard_charge_A,
          maxChargeCurrentA: override.maxChargeCurrentA ?? model.max_charge_A,
          voltageMinV: override.voltageMinV ?? model.voltage_min_V,
          voltageMaxV: override.voltageMaxV ?? model.voltage_max_V,
          chargeTempMinC: num("stage4BmsChargeTmin", 0), chargeTempMaxC: num("stage4BmsChargeTmax", 45),
          dischargeTempMinC: num("stage4BmsDischargeTmin", -20), dischargeTempMaxC: num("stage4BmsDischargeTmax", 80),
          currentA: 0, voltageV: 0, localVoltageV: 0, ocvV: 0,
          r0Ohm: 0, r1Ohm: r1ReferenceOhm, r1ToR0Ratio: r1ReferenceOhm / Math.max(1e-6, (override.dcirMohm ?? model.dcir_at_current_soh_mohm * dcirFactor) * 1e-3), c1F, polarizationVoltageV: 0, polarizationEnergyJ: 0,
          resistanceOhm: 0, r0LossPowerW: 0, r1LossPowerW: 0, reversiblePowerW: 0, powerW: 0, lossEnergyWh: 0,
          currentExposure: { throughputAh: 0, secondsAboveStandard: 0, secondsAboveMaximum: 0, peakStandardRatio: 0, peakMaximumRatio: 0 }
        };
      });
      this.buildCellNeighbours();
      this.buildSectionCache();
    }

    updateCellSocViews(cell) {
      const referenceCapacityAh = Math.max(.001, cell.referenceCapacityAh || cell.capacityAh);
      cell.absoluteChargeAh = clamp(cell.absoluteChargeAh ?? referenceCapacityAh * (cell.soc || 0) / 100, 0, referenceCapacityAh);
      cell.referenceSocPercent = 100 * cell.absoluteChargeAh / referenceCapacityAh;
      // "soc" pozostaje referencyjnym SOC ogniwa. Zmiana temperatury nie
      // dodaje ładunku; wpływa jedynie na raportowaną pojemność dostępną.
      cell.soc = cell.referenceSocPercent;
      const temperatureFactor = Math.max(.05, interp(this.package.cellModel.capacity_temperature_factor, cell.tempC));
      cell.availableCapacityAh = referenceCapacityAh * temperatureFactor;
      cell.availableChargeAh = Math.min(cell.absoluteChargeAh, cell.availableCapacityAh);
      cell.temperatureLimitedChargeAh = Math.max(0, cell.absoluteChargeAh - cell.availableChargeAh);
      cell.availableSocPercent = clamp(100 * cell.availableChargeAh / Math.max(.001, cell.availableCapacityAh), 0, 100);
    }

    seededRandom(seed) {
      let value = seed >>> 0;
      return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    }

    boundedNormal(random, limit) {
      if (!(limit > 0)) return 0;
      let z;
      do {
        const u = Math.max(1e-12, random()), v = random();
        z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * (limit / 3);
      } while (Math.abs(z) > limit);
      return z;
    }

    buildCellNeighbours() {
      let nearest = Infinity;
      for (let i = 0; i < this.cells.length; i++) for (let j = i + 1; j < this.cells.length; j++) {
        const d = Math.hypot(this.cells[i].x - this.cells[j].x, this.cells[i].y - this.cells[j].y);
        if (d > 0.1 && d < nearest) nearest = d;
      }
      this.neighbourPairs = [];
      this.cells.forEach(c => c.neighbourCount = 0);
      if (!Number.isFinite(nearest)) return;
      for (let i = 0; i < this.cells.length; i++) for (let j = i + 1; j < this.cells.length; j++) {
        const d = Math.hypot(this.cells[i].x - this.cells[j].x, this.cells[i].y - this.cells[j].y);
        if (d <= nearest * 1.18) { this.neighbourPairs.push([i, j]); this.cells[i].neighbourCount++; this.cells[j].neighbourCount++; }
      }
    }

    buildSectionCache() {
      const series = this.package?.series || 0;
      this.cellsBySection = Array.from({ length: series }, () => []);
      this.cells.forEach(cell => { if (this.cellsBySection[cell.section]) this.cellsBySection[cell.section].push(cell); });
      this.sectionBmsAttachments = this.cellsBySection.map(group => {
        if (!group.length) return null;
        let x = 0, y = 0;
        group.forEach(cell => { x += cell.x; y += cell.y; });
        x /= group.length; y /= group.length;
        let best = group[0], bestDistance = Infinity;
        group.forEach(cell => {
          const distance = (cell.x - x) ** 2 + (cell.y - y) ** 2;
          if (distance < bestDistance || (distance === bestDistance && String(cell.id).localeCompare(String(best.id)) < 0)) {
            best = cell; bestDistance = distance;
          }
        });
        return best;
      });
      this.maxNeighbourCount = Math.max(1, ...this.cells.map(cell => cell.neighbourCount || 0));
    }

    buildTopology() {
      this.nodeCount = this.cells.length * 2;
      const cellById = new Map(this.cells.map(cell => [String(cell.id), cell]));
      const terminalNode = (cell, side) => {
        const frontStartsPositive = !this.package.polarityReversed;
        const sideStartsPositive = side === "front" ? frontStartsPositive : !frontStartsPositive;
        const positive = sideStartsPositive ? cell.section % 2 === 0 : cell.section % 2 !== 0;
        return cell.index * 2 + (positive ? 1 : 0);
      };
      this.tapeSegments = [];
      const material = {
        resistivity: num("stage4StripResistivity", 9e-8), tcr: num("stage4StripTcr", .005), density: num("stage4StripDensity", 8900),
        specificHeat: num("stage4StripSpecificHeat", 456), thermalConductivity: num("stage4StripThermalConductivity", 71)
      };
      ["front", "back"].forEach(side => (this.package.tapes[side] || []).forEach((tape, tapeIndex) => {
        const from = cellById.get(String(tape.from)), to = cellById.get(String(tape.to));
        if (!from || !to) return;
        const dx = to.x - from.x, dy = to.y - from.y, denom = dx * dx + dy * dy || 1;
        const ids = [...new Set([tape.from, ...(tape.cellIds || []), tape.to].map(String))];
        const touched = ids.map(id => cellById.get(id)).filter(Boolean).sort((a, b) => (((a.x - from.x) * dx + (a.y - from.y) * dy) - ((b.x - from.x) * dx + (b.y - from.y) * dy)) / denom);
        for (let pair = 1; pair < touched.length; pair++) {
          const a = touched[pair - 1], b = touched[pair], span = Math.hypot(b.x - a.x, b.y - a.y);
          if (!(span > 0)) continue;
          const count = Math.max(1, Math.ceil(span / this.settings().maxSegmentMm));
          let previousNode = terminalNode(a, side);
          for (let part = 0; part < count; part++) {
            const finalPart = part === count - 1;
            const nextNode = finalPart ? terminalNode(b, side) : this.nodeCount++;
            const t0 = part / count, t1 = (part + 1) / count;
            const lengthMm = span / count;
            const widthMm = tape.strip_width_mm || this.package.stripSelection.width_mm;
            const thicknessMm = tape.strip_thickness_mm || this.package.stripSelection.thickness_mm;
            const volumeM3 = lengthMm * widthMm * thicknessMm * 1e-9;
            // Kontakt cieplny istnieje wyłącznie w rzeczywistym punkcie zgrzewu.
            // Nie wolno przypisywać obu końców całej sekcji do każdego jej
            // technicznego podziału, bo wielokrotnie dodałoby to samo ciepło.
            const contactCells = [];
            if (pair === 1 && part === 0) contactCells.push(a.index);
            if (finalPart) contactCells.push(b.index);
            this.tapeSegments.push({
              id: `${side}-${tapeIndex}-${pair - 1}-${part}`, tapeId: tape.id, side, n1: previousNode, n2: nextNode,
              x1: a.x + (b.x - a.x) * t0, y1: a.y + (b.y - a.y) * t0, x2: a.x + (b.x - a.x) * t1, y2: a.y + (b.y - a.y) * t1,
              lengthMm, widthMm, thicknessMm, areaM2: widthMm * thicknessMm * 1e-6,
              massKg: volumeM3 * material.density, heatCapacityJK: Math.max(1e-6, volumeM3 * material.density * material.specificHeat),
              material, materialName: this.package.stripMaterial?.name_pl || this.package.stripSelection.materialId,
              tempC: this.package.cellModel.initial_temperature_C, currentA: 0, voltageV: 0, resistanceOhm: 0, powerW: 0, lossEnergyWh: 0,
              contactCells
            });
            previousNode = nextNode;
          }
        }
      }));
      this.leadMinusIndex = this.cells.find(c => String(c.id) === String($("stage4LeadMinus").value))?.index ?? 0;
      this.leadPlusIndex = this.cells.find(c => String(c.id) === String($("stage4LeadPlus").value))?.index ?? this.cells.length - 1;
      this.leadMinusAttachmentNode = this.leadMinusIndex * 2;
      this.leadPlusAttachmentNode = this.leadPlusIndex * 2 + 1;
      // PACK jest idealnie złączony z wybraną magistralą. Nie wstawiamy
      // sztucznego rezystora 1 nΩ, który psuje uwarunkowanie macierzy.
      this.leadMinusNode = this.leadMinusAttachmentNode;
      this.leadPlusNode = this.leadPlusAttachmentNode;
      this.externalLeads = [
        { id: "PACK−", node: this.leadMinusNode, attachmentNode: this.leadMinusAttachmentNode, ideal: true, voltageV: 0, currentA: 0, powerW: 0 },
        { id: "PACK+", node: this.leadPlusNode, attachmentNode: this.leadPlusAttachmentNode, ideal: true, voltageV: 0, currentA: 0, powerW: 0 }
      ];
      this.nodeVoltages = new Float64Array(this.nodeCount);
      this.cells.forEach(cell => { const base = cell.section * this.package.cellModel.voltage_nominal_V; this.nodeVoltages[cell.index * 2] = base; this.nodeVoltages[cell.index * 2 + 1] = base + this.package.cellModel.voltage_nominal_V; });
      this.buildThermalCache();
      this.buildVisualLayoutCache();
      this.topologyDiagnostics = this.analyzeTopology();
      const topologyMessage = this.formatTopologyDiagnostics(this.topologyDiagnostics);
      this.logEvent(this.topologyDiagnostics.valid ? "TOPOLOGIA" : "BŁĄD TOPOLOGII", topologyMessage, { diagnostics: this.topologyDiagnostics });
    }

    buildThermalCache() {
      const segmentsByTape = new Map();
      this.tapeSegments.forEach((segment, index) => {
        const key = `${segment.side}:${segment.tapeId}`;
        if (!segmentsByTape.has(key)) segmentsByTape.set(key, []);
        segmentsByTape.get(key).push(index);
      });
      this.tapeThermalAxialPairs = [];
      segmentsByTape.forEach(indices => {
        for (let index = 1; index < indices.length; index++) this.tapeThermalAxialPairs.push([indices[index - 1], indices[index]]);
      });
      this.tapeThermalContactPairs = this.buildTapeThermalContactPairs();
      this.buildCellThermalGeometry();
      this.buildEnvironmentalThermalNodes();
      this.thermalScratch = {
        cellCoreHeat: new Float64Array(this.cells.length), cellSurfaceHeat: new Float64Array(this.cells.length), tapeHeat: new Float64Array(this.tapeSegments.length),
        cellCoreConductance: new Float64Array(this.cells.length), cellSurfaceConductance: new Float64Array(this.cells.length), tapeConductance: new Float64Array(this.tapeSegments.length),
        airHeat: new Float64Array(this.airZones.length), airConductance: new Float64Array(this.airZones.length),
        caseHeat: new Float64Array(this.caseNodes.length), caseConductance: new Float64Array(this.caseNodes.length)
      };
    }

    buildCellThermalGeometry() {
      const geometry = this.package.cellModel.geometry || {};
      const thermal = this.settings().thermalModel;
      const diameterMm = Math.max(1, Number(geometry.diameter_mm) || this.package.visualCellDiameterMm || 21);
      const heightMm = Math.max(1, Number(geometry.height_mm) || 70);
      const radiusMm = diameterMm * .5;
      const sideAreaM2 = Math.PI * diameterMm * heightMm * 1e-6;
      const endAreaM2 = 2 * Math.PI * radiusMm * radiusMm * 1e-6;
      const unionLength = intervals => {
        if (!intervals.length) return 0;
        intervals.sort((a, b) => a[0] - b[0]);
        let total = 0, start = intervals[0][0], end = intervals[0][1];
        for (let index = 1; index < intervals.length; index++) {
          const [nextStart, nextEnd] = intervals[index];
          if (nextStart <= end) end = Math.max(end, nextEnd);
          else { total += end - start; start = nextStart; end = nextEnd; }
        }
        return total + end - start;
      };
      const contactsPerCell = Array.from({ length: this.cells.length }, () => []);
      this.tapeSegments.forEach(segment => segment.contactCells.forEach(index => contactsPerCell[index]?.push(segment)));
      this.cells.forEach((cell, index) => {
        const intervals = [];
        this.neighbourPairs.forEach(([a, b]) => {
          if (a !== index && b !== index) return;
          const other = this.cells[a === index ? b : a];
          const dx = other.x - cell.x, dy = other.y - cell.y, distance = Math.hypot(dx, dy);
          if (!(distance > radiusMm)) return;
          const center = Math.atan2(dy, dx);
          const half = Math.asin(clamp(radiusMm / distance, 0, .999));
          let start = center - half, end = center + half;
          while (start < 0) { start += Math.PI * 2; end += Math.PI * 2; }
          while (start >= Math.PI * 2) { start -= Math.PI * 2; end -= Math.PI * 2; }
          if (end > Math.PI * 2) { intervals.push([start, Math.PI * 2], [0, end - Math.PI * 2]); }
          else intervals.push([start, end]);
        });
        const blockedAngularFraction = clamp(unionLength(intervals) / (Math.PI * 2), 0, 1);
        const holderBlockedM2 = sideAreaM2 * thermal.holderCoverageFraction;
        const cellBlockedM2 = Math.max(0, sideAreaM2 - holderBlockedM2) * blockedAngularFraction;
        const actualTapeAreaM2 = contactsPerCell[index].reduce((sum, segment) => sum + Math.min(segment.widthMm * segment.widthMm, Math.PI * radiusMm * radiusMm) * 1e-6, 0);
        const tapeBlockedM2 = Math.min(endAreaM2, Math.max(endAreaM2 * thermal.tapeCoverageFraction, actualTapeAreaM2));
        const exposedSideM2 = Math.max(0, sideAreaM2 - holderBlockedM2 - cellBlockedM2);
        const exposedEndsM2 = Math.max(0, endAreaM2 * thermal.endExposureFraction - tapeBlockedM2);
        const exposedAreaM2 = exposedSideM2 + exposedEndsM2;
        const areaToCaseM2 = thermal.environment === "open" ? 0 : (sideAreaM2 + endAreaM2) * thermal.caseContactFraction;
        const areaToThermalMaterialM2 = thermal.environment === "open" ? 0 : holderBlockedM2;
        const areaToInternalAirM2 = thermal.environment === "open" ? 0 : exposedAreaM2;
        const areaDirectlyExposedM2 = thermal.environment === "open" ? exposedAreaM2 : 0;
        const effectiveExchangeAreaM2 = areaToInternalAirM2 + areaToCaseM2 + areaToThermalMaterialM2 + areaDirectlyExposedM2;
        const exposedFraction = clamp(exposedAreaM2 / Math.max(1e-12, sideAreaM2 + endAreaM2), 0, 1);
        const coolingClass = exposedFraction < .32 ? "interior" : exposedFraction < .58 ? "transition" : "exterior";
        const configuredFactor = coolingClass === "interior" ? thermal.interiorCoolingFactor : coolingClass === "transition" ? thermal.transitionCoolingFactor : thermal.exteriorCoolingFactor;
        cell.thermalGeometry = {
          diameterMm, heightMm, sideAreaM2, endAreaM2, totalAreaM2: sideAreaM2 + endAreaM2,
          blockedAngularFraction, blockedByCellsM2: cellBlockedM2, blockedByHolderM2: holderBlockedM2, blockedByTapeM2: tapeBlockedM2,
          exposedSideM2, exposedEndsM2, exposedAreaM2, exposedFraction, areaToInternalAirM2, areaToCaseM2, areaToThermalMaterialM2, areaDirectlyExposedM2, effectiveExchangeAreaM2,
          coolingClass, configuredCoolingFactor: configuredFactor, overrideCoolingFactor: cell.coolingFactor,
          appliedCoolingFactor: configuredFactor * cell.coolingFactor, airZoneIndex: -1, caseNodeIndex: -1
        };
      });
    }

    buildEnvironmentalThermalNodes() {
      const thermal = this.settings().thermalModel, ambient = this.settings().ambientC;
      this.airZones = []; this.caseNodes = []; this.airZonePairs = []; this.caseNodePairs = [];
      if (!this.cells.length) return;
      const zoneSize = thermal.airZoneSizeMm;
      const minX = Math.floor(Math.min(...this.cells.map(cell => cell.x)) / zoneSize) * zoneSize;
      const minY = Math.floor(Math.min(...this.cells.map(cell => cell.y)) / zoneSize) * zoneSize;
      const zoneMap = new Map();
      const ensureZone = (x, y) => {
        const col = Math.floor((x - minX) / zoneSize), row = Math.floor((y - minY) / zoneSize), key = `${col}:${row}`;
        if (!zoneMap.has(key)) {
          const volumeM3 = zoneSize * zoneSize * thermal.airDepthMm * 1e-9;
          const faceAreaM2 = zoneSize * zoneSize * 1e-6;
          const zone = { id: `air-${col}-${row}`, index: this.airZones.length, col, row, x1: minX + col * zoneSize, y1: minY + row * zoneSize, x2: minX + (col + 1) * zoneSize, y2: minY + (row + 1) * zoneSize, tempC: ambient, volumeM3, faceAreaM2, heatCapacityJK: Math.max(.001, volumeM3 * 1.184 * 1005), cellIndices: [], tapeIndices: [], thermal: {} };
          zoneMap.set(key, zone); this.airZones.push(zone);
        }
        return zoneMap.get(key);
      };
      const maxX = Math.max(...this.cells.map(cell => cell.x), ...this.tapeSegments.flatMap(segment => [segment.x1, segment.x2]));
      const maxY = Math.max(...this.cells.map(cell => cell.y), ...this.tapeSegments.flatMap(segment => [segment.y1, segment.y2]));
      const maxCol = Math.max(0, Math.floor((maxX - minX) / zoneSize)), maxRow = Math.max(0, Math.floor((maxY - minY) / zoneSize));
      for (let row = 0; row <= maxRow; row++) for (let col = 0; col <= maxCol; col++) ensureZone(minX + (col + .5) * zoneSize, minY + (row + .5) * zoneSize);
      this.cells.forEach((cell, index) => { const zone = ensureZone(cell.x, cell.y); zone.cellIndices.push(index); cell.thermalGeometry.airZoneIndex = zone.index; cell.thermalGeometry.caseNodeIndex = zone.index; });
      this.tapeSegments.forEach((segment, index) => { const zone = ensureZone((segment.x1 + segment.x2) * .5, (segment.y1 + segment.y2) * .5); zone.tapeIndices.push(index); segment.airZoneIndex = zone.index; segment.caseNodeIndex = zone.index; });
      const caseThicknessM = thermal.caseThicknessMm * 1e-3;
      this.caseNodes = this.airZones.map(zone => ({
        id: `case-${zone.col}-${zone.row}`, index: zone.index, airZoneIndex: zone.index, tempC: ambient,
        x1: zone.x1, y1: zone.y1, x2: zone.x2, y2: zone.y2, areaM2: zone.faceAreaM2 * 2,
        heatCapacityJK: Math.max(.001, zone.faceAreaM2 * caseThicknessM * thermal.caseDensityKgM3 * thermal.caseSpecificHeatJKgK), thermal: {}
      }));
      this.airZones.forEach(zone => [[1, 0], [0, 1]].forEach(([dc, dr]) => {
        const other = zoneMap.get(`${zone.col + dc}:${zone.row + dr}`);
        if (other) { this.airZonePairs.push([zone.index, other.index]); this.caseNodePairs.push([zone.index, other.index]); }
      }));
    }

    buildTapeThermalContactPairs() {
      const contacts = [], seen = new Set();
      const cross = (ax, ay, bx, by) => ax * by - ay * bx;
      const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
      const epsilonMm = .03;
      const contactFor = (left, right) => {
        const rx = left.x2 - left.x1, ry = left.y2 - left.y1;
        const sx = right.x2 - right.x1, sy = right.y2 - right.y1;
        const leftLength = Math.hypot(rx, ry), rightLength = Math.hypot(sx, sy);
        if (leftLength < epsilonMm || rightLength < epsilonMm) return null;
        const qpx = right.x1 - left.x1, qpy = right.y1 - left.y1;
        const rxs = cross(rx, ry, sx, sy);
        const qpxr = cross(qpx, qpy, rx, ry);
        const minWidthMm = Math.max(epsilonMm, Math.min(left.widthMm, right.widthMm));
        if (Math.abs(rxs) < epsilonMm) {
          if (Math.abs(qpxr) >= epsilonMm) return null;
          const start = (qpx * rx + qpy * ry) / (leftLength * leftLength);
          const end = start + (sx * rx + sy * ry) / (leftLength * leftLength);
          const from = clamp(Math.min(start, end), 0, 1), to = clamp(Math.max(start, end), 0, 1);
          const overlapMm = Math.max(0, (to - from) * leftLength);
          if (overlapMm < epsilonMm) return null;
          const position = (from + to) * .5;
          return {
            kind: "overlap", xMm: left.x1 + rx * position, yMm: left.y1 + ry * position,
            overlapMm, contactAreaMm2: minWidthMm * overlapMm,
            coverage: clamp(overlapMm / minWidthMm, 1, 8)
          };
        }
        const t = cross(qpx, qpy, sx, sy) / rxs, u = cross(qpx, qpy, rx, ry) / rxs;
        const tolerance = epsilonMm / Math.min(leftLength, rightLength);
        if (t < -tolerance || t > 1 + tolerance || u < -tolerance || u > 1 + tolerance) return null;
        const sine = Math.max(.1, Math.abs(rxs) / (leftLength * rightLength));
        const contactAreaMm2 = Math.min(minWidthMm * Math.max(left.widthMm, right.widthMm) / sine, minWidthMm * Math.min(leftLength, rightLength));
        return {
          kind: "crossing", xMm: left.x1 + rx * clamp(t, 0, 1), yMm: left.y1 + ry * clamp(t, 0, 1),
          overlapMm: 0, contactAreaMm2, coverage: 1
        };
      };
      for (let leftIndex = 0; leftIndex < this.tapeSegments.length; leftIndex++) {
        const left = this.tapeSegments[leftIndex];
        for (let rightIndex = leftIndex + 1; rightIndex < this.tapeSegments.length; rightIndex++) {
          const right = this.tapeSegments[rightIndex];
          if (left.side !== right.side || String(left.tapeId) === String(right.tapeId)) continue;
          const contact = contactFor(left, right);
          if (!contact) continue;
          const tapeA = String(left.tapeId) < String(right.tapeId) ? String(left.tapeId) : String(right.tapeId);
          const tapeB = tapeA === String(left.tapeId) ? String(right.tapeId) : String(left.tapeId);
          const pointKey = `${left.side}:${tapeA}:${tapeB}:${Math.round(contact.xMm * 10)}:${Math.round(contact.yMm * 10)}`;
          if (seen.has(pointKey)) continue;
          seen.add(pointKey);
          contacts.push({ leftIndex, rightIndex, insulated: false, electricallyConnected: false, ...contact });
        }
      }
      return contacts;
    }

    buildVisualLayoutCache() {
      const geometryPoints = [...this.cells, ...(this.package.boundary || [])];
      const xs = geometryPoints.map(point => point.x), ys = geometryPoints.map(point => point.y), pad = 35;
      const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
      const viewWidth = maxX - minX, viewHeight = maxY - minY, viewGap = Math.max(28, viewWidth * .08), backOffsetX = viewWidth + viewGap;
      const project = (side, x, y) => side === "back" ? { x: minX + maxX - x + backOffsetX, y } : { x, y };
      const boundaryMarkup = ["front", "back"].map(side => {
        const points = (this.package.boundary || []).map(point => { const p = project(side, point.x, point.y); return `${p.x},${p.y}`; }).join(" ");
        return points ? `<polygon points="${points}" fill="rgba(14,165,233,.025)" stroke="rgba(148,203,255,.34)" stroke-width="1.2"/>` : "";
      }).join("");
      const stripGroups = new Map();
      this.tapeSegments.forEach(segment => {
        const key = `${segment.side}:${segment.tapeId}`;
        if (!stripGroups.has(key)) stripGroups.set(key, []);
        stripGroups.get(key).push(segment);
      });
      const visualCellDiameterMm = Math.max(1, Number(this.package.visualCellDiameterMm) || this.package.cellModel.geometry.diameter_mm);
      this.visualLayout = {
        minX, maxX, minY, maxY, viewWidth, viewHeight, viewGap, backOffsetX, project, boundaryMarkup,
        baseViewBox: { x: minX, y: minY, width: viewWidth * 2 + viewGap, height: viewHeight },
        radius: visualCellDiameterMm / 2, stripEntries: [...stripGroups.values()]
      };
    }

    analyzeTopology() {
      const graph = Array.from({ length: this.nodeCount }, () => []);
      const connect = (a, b) => { graph[a].push(b); graph[b].push(a); };
      this.cells.forEach(cell => connect(cell.index * 2, cell.index * 2 + 1));
      this.tapeSegments.forEach(segment => connect(segment.n1, segment.n2));
      this.externalLeads.forEach(lead => { if (lead.node !== lead.attachmentNode) connect(lead.node, lead.attachmentNode); });
      const componentOf = new Int32Array(this.nodeCount).fill(-1), components = [];
      for (let start = 0; start < this.nodeCount; start++) {
        if (componentOf[start] !== -1) continue;
        const index = components.length, queue = [start], nodes = [];
        componentOf[start] = index;
        while (queue.length) {
          const node = queue.shift(); nodes.push(node);
          graph[node].forEach(next => { if (componentOf[next] === -1) { componentOf[next] = index; queue.push(next); } });
        }
        const cellIds = this.cells.filter(cell => componentOf[cell.index * 2] === index || componentOf[cell.index * 2 + 1] === index).map(cell => String(cell.id));
        components.push({ index, nodeCount: nodes.length, cellIds });
      }
      const mainComponent = componentOf[this.leadMinusNode], plusComponent = componentOf[this.leadPlusNode];
      const disconnectedCells = this.cells.filter(cell => componentOf[cell.index * 2] !== mainComponent).map(cell => String(cell.id));
      const sectionCoverage = Array.from({ length: this.package.series }, (_, section) => {
        const sectionCells = this.cells.filter(cell => cell.section === section);
        const connected = sectionCells.filter(cell => componentOf[cell.index * 2] === mainComponent);
        return { section: section + 1, total: sectionCells.length, connected: connected.length, disconnectedIds: sectionCells.filter(cell => componentOf[cell.index * 2] !== mainComponent).map(cell => String(cell.id)) };
      });
      const emptySections = sectionCoverage.filter(item => item.total === 0).map(item => item.section);
      const incompleteSections = sectionCoverage.filter(item => item.connected !== item.total).map(item => item.section);
      const reasons = [];
      if (!this.tapeSegments.length) reasons.push("nie utworzono żadnego segmentu taśmy");
      if (mainComponent !== plusComponent) reasons.push("wyprowadzenie B+ nie ma ciągłej drogi elektrycznej do B−");
      if (disconnectedCells.length) reasons.push(`${disconnectedCells.length} ogniw znajduje się poza komponentem B−`);
      if (emptySections.length) reasons.push(`brak ogniw w sekcjach: ${emptySections.map(s => `S${s}`).join(", ")}`);
      if (incompleteSections.length) reasons.push(`niepełna ciągłość sekcji: ${incompleteSections.map(s => `S${s}`).join(", ")}`);
      return {
        valid: reasons.length === 0,
        reasons,
        nodeCount: this.nodeCount,
        cellCount: this.cells.length,
        tapeSegmentCount: this.tapeSegments.length,
        componentCount: components.length,
        components,
        mainComponent,
        plusComponent,
        leadMinusCell: String(this.cells[this.leadMinusIndex]?.id ?? "?"),
        leadPlusCell: String(this.cells[this.leadPlusIndex]?.id ?? "?"),
        leadsConnected: mainComponent === plusComponent,
        disconnectedCells,
        sectionCoverage
      };
    }

    formatTopologyDiagnostics(diagnostics) {
      const coverage = diagnostics.sectionCoverage.map(item => `S${item.section}:${item.connected}/${item.total}`).join(", ");
      const base = `węzły ${diagnostics.nodeCount}, ogniwa ${diagnostics.cellCount}, segmenty taśm ${diagnostics.tapeSegmentCount}, komponenty ${diagnostics.componentCount}, B− ${diagnostics.leadMinusCell}, B+ ${diagnostics.leadPlusCell}, pokrycie [${coverage}]`;
      if (diagnostics.valid) return `Topologia poprawna: ${base}.`;
      const components = diagnostics.components.filter(item => item.cellIds.length).map(item => `komponent ${item.index}: ${item.cellIds.slice(0, 12).join(", ")}${item.cellIds.length > 12 ? ` (+${item.cellIds.length - 12})` : ""}`).join("; ");
      return `Topologia niepoprawna: ${diagnostics.reasons.join("; ")}. ${base}. ${components}`;
    }

    start() {
      if (!this.package) this.enter();
      if (!this.cells.length) return;
      if (this.status === "idle") this.reset();
      if (this.status === "finished") this.reset();
      this.status = "running";
      this.simulationGeneration++;
      this.bms.state = this.settings().mode === "charge" ? "ŁADOWANIE" : "ROZŁADOWANIE";
      this.lastFrame = performance.now();
      this.simulationTimeBudget = 0;
      this.setState("Symulacja działa.", "running");
      this.renderSimulationProgress();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.boundLoop);
    }

    pause() { if (this.status === "running") { this.simulationGeneration++; this.status = "paused"; cancelAnimationFrame(this.raf); this.setState("Pauza — stan fizyczny został zachowany."); this.renderAll(); } }
    resume() { if (this.status === "paused") { this.simulationGeneration++; this.status = "running"; this.lastFrame = performance.now(); this.simulationTimeBudget = 0; this.setState("Kontynuacja symulacji.", "running"); this.raf = requestAnimationFrame(this.boundLoop); } }
    stop(reason = "Zatrzymano", linkedEvent = null) { this.simulationGeneration++; cancelAnimationFrame(this.raf); this.status = "finished"; this.finishReason = reason; const endEvent = this.logEvent("KONIEC", reason); this.setState(reason, reason.includes("BMS") || reason.includes("temperatur") ? "tripped" : "", linkedEvent || endEvent); this.renderAll(); }

    async loop(timestamp) {
      if (this.status !== "running") return;
      const generation = this.simulationGeneration;
      const realDelta = Math.min(.1, Math.max(.001, (timestamp - this.lastFrame) / 1000));
      this.lastFrame = timestamp;
      const settings = this.settings();
      if (this.integrationStepConfiguredDt !== settings.dt) {
        this.integrationStepConfiguredDt = settings.dt;
        this.integrationStepS = settings.dt;
      }
      const maximumBacklogS = Math.max(settings.dt * 2, settings.speed * .25 + settings.dt);
      this.simulationTimeBudget = Math.min(maximumBacklogS, this.simulationTimeBudget + realDelta * settings.speed);
      const computeStartedAt = performance.now();
      const computeBudgetMs = settings.speed >= 300 ? 100 : settings.speed >= 60 ? 45 : settings.speed >= 10 ? 14 : 8;
      const presentationStepS = Math.min(settings.dt, .5);
      let guard = 0;
      while (this.status === "running" && guard++ < 500 && performance.now() - computeStartedAt < computeBudgetMs) {
        const remainingDurationS = Math.max(0, settings.durationS - this.time);
        const requiredBudgetS = Math.min(this.integrationStepS || presentationStepS, presentationStepS, remainingDurationS);
        if (!(requiredBudgetS > 0) || this.simulationTimeBudget + 1e-9 < requiredBudgetS) break;
        const requested = Math.min(presentationStepS, remainingDurationS);
        const used = await this.step(requested, generation);
        if (generation !== this.simulationGeneration || this.status !== "running") return;
        if (!(used > 0)) break;
        this.simulationTimeBudget = Math.max(0, this.simulationTimeBudget - used);
        this.integrationStepS = used < settings.dt * .999 ? used : settings.dt;
      }
      this.visualAccumulator += realDelta;
      this.resultsAccumulator += realDelta;
      this.renderSimulationProgress();
      const visualRefreshIntervalS = settings.speed >= 300 ? .75 : settings.speed >= 60 ? .4 : .2;
      if (this.visualAccumulator >= visualRefreshIntervalS) {
        this.visualAccumulator = 0;
        this.renderSimulationFrame(this.resultsAccumulator >= .75);
        if (this.resultsAccumulator >= .75) this.resultsAccumulator = 0;
      }
      if (this.status === "running") this.raf = requestAnimationFrame(this.boundLoop);
    }

    requestedPackCurrent() {
      const settings = this.settings();
      const direction = settings.mode === "charge" ? -1 : 1;
      if (settings.mode === "charge") {
        const temperatureLimit = this.temperatureAdjustedChargeLimitA();
        const maximumChargeCurrentA = Math.max(0, Math.min(settings.currentA, temperatureLimit));
        if (!(maximumChargeCurrentA > 0)) return 0;
        if (this.chargePhase === "CV") {
          const target = this.package.series * this.package.cellModel.voltage_max_V;
          const estimatedR = this.cells.reduce((sum, cell) => sum + cell.resistanceOhm, 0) / Math.max(1, this.package.parallel * this.package.parallel);
          const previousChargeCurrentA = clamp(Math.max(0, -this.solvedPackCurrentA), 0, maximumChargeCurrentA);
          const packCandidateA = estimatedR > 0
            ? previousChargeCurrentA + (target - (this.packVoltage || 0)) / estimatedR
            : maximumChargeCurrentA;
          const limitingCell = this.cells.reduce((highest, cell) => !highest || cell.localVoltageV > highest.localVoltageV ? cell : highest, null);
          let cellCandidateA = maximumChargeCurrentA;
          if (limitingCell && Number.isFinite(limitingCell.localVoltageV)) {
            const sectionParallel = Math.max(1, this.cellsBySection[limitingCell.section]?.length || this.package.parallel || 1);
            const cellResponseVPerPackA = Math.max(1e-6, limitingCell.r0Ohm / sectionParallel);
            cellCandidateA = previousChargeCurrentA
              + (limitingCell.voltageMaxV - limitingCell.localVoltageV) / cellResponseVPerPackA;
          }
          return -clamp(Math.min(packCandidateA, cellCandidateA), 0, maximumChargeCurrentA);
        }
        return -maximumChargeCurrentA;
      }
      if (settings.loadMode === "power") return settings.powerW / Math.max(.1, Math.abs(this.packVoltage || this.package.series * this.package.cellModel.voltage_nominal_V));
      return direction * settings.currentA;
    }

    captureLoadControlChange(reason = "interfejs użytkownika", force = false) {
      const state = {
        timeS: this.time,
        mode: $("stage4Mode")?.value || "discharge",
        loadMode: $("stage4LoadMode")?.value || "current",
        requestedCurrentA: Math.max(0, num("stage4CurrentA", 0)),
        requestedPowerW: Math.max(0, num("stage4PowerW", 0)),
        cvEndCurrentA: Math.max(0, num("stage4CvEndCurrentA", 0)),
        source: "user",
        reason
      };
      const previous = this.loadControlHistory[this.loadControlHistory.length - 1];
      const changed = !previous || previous.mode !== state.mode || previous.loadMode !== state.loadMode
        || Math.abs(previous.requestedCurrentA - state.requestedCurrentA) > .0001
        || Math.abs(previous.requestedPowerW - state.requestedPowerW) > .01
        || Math.abs(previous.cvEndCurrentA - state.cvEndCurrentA) > .0001;
      if (force || changed) this.loadControlHistory.push(state);
    }

    loadCommandDescriptor(commandedPackCurrentA) {
      const settings = this.settings();
      if (!this.bms.connected) return { source: "BMS", reason: "obciążenie odłączone przez BMS" };
      if (this.status !== "running" && Math.abs(commandedPackCurrentA) <= 1e-9) return { source: "model", reason: "stan spoczynkowy przed uruchomieniem symulacji" };
      if (settings.mode === "charge" && this.chargePhase === "CV") return { source: "CC/CV", reason: "regulacja napięcia w fazie CV" };
      if (settings.mode === "charge") {
        const limited = Math.abs(commandedPackCurrentA) + 1e-6 < settings.currentA;
        return { source: limited ? "ograniczenie temperaturowe ładowarki" : "CC/CV", reason: limited ? "prąd ograniczony charakterystyką temperaturową ogniwa" : "faza stałego prądu CC" };
      }
      if (settings.loadMode === "power") return { source: "regulator stałej mocy", reason: "prąd obliczony z zadanej mocy i napięcia pakietu" };
      return { source: "user", reason: "zadany stały prąd" };
    }

    recordSolvedLoadState(commandedPackCurrentA, explicitReason = "", force = false) {
      const descriptor = this.loadCommandDescriptor(commandedPackCurrentA);
      const entry = {
        timeS: this.time,
        mode: this.settings().mode,
        loadMode: this.settings().loadMode,
        commandedPackCurrentA,
        solvedPackCurrentA: this.solvedPackCurrentA,
        packVoltageV: this.packVoltage,
        commandedPowerW: this.settings().loadMode === "power" ? this.settings().powerW : Math.abs((this.packVoltage || 0) * commandedPackCurrentA),
        solvedPowerW: (this.packVoltage || 0) * (this.solvedPackCurrentA || 0),
        source: descriptor.source,
        reason: explicitReason || descriptor.reason,
        chargePhase: this.chargePhase
      };
      const previous = this.loadHistory[this.loadHistory.length - 1];
      const changed = !previous || previous.source !== entry.source || previous.mode !== entry.mode || previous.loadMode !== entry.loadMode
        || Math.abs(previous.commandedPackCurrentA - entry.commandedPackCurrentA) > Math.max(.01, Math.abs(entry.commandedPackCurrentA) * .01)
        || this.time - previous.timeS >= 60;
      if (force || changed) this.loadHistory.push(entry);
    }

    sectionCells(section) {
      return this.cellsBySection?.[section] || [];
    }

    sectionBalanceAttachment(section) {
      return this.sectionBmsAttachments?.[section] || null;
    }

    summarizeTapes() {
      const groups = new Map();
      this.tapeSegments.forEach(segment => {
        const key = `${segment.side}:${segment.tapeId}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(segment);
      });
      return [...groups.values()].map(segments => {
        const first = segments[0], last = segments[segments.length - 1];
        const hottest = this.maxItem(segments, segment => segment.tempC)?.item;
        const peakCurrent = this.maxItem(segments, segment => Math.abs(segment.currentA))?.item;
        const peakDensity = this.maxItem(segments, segment => Math.abs(segment.currentA) / Math.max(1e-12, segment.areaM2))?.item;
        return {
          tapeId: first.tapeId, side: first.side, segmentIds: segments.map(segment => segment.id),
          endpointNodes: [first.n1, last.n2], totalResistanceOhm: segments.reduce((sum, segment) => sum + segment.resistanceOhm, 0),
          endpointVoltageDropV: (this.nodeVoltages?.[first.n1] ?? 0) - (this.nodeVoltages?.[last.n2] ?? 0),
          totalLossPowerW: segments.reduce((sum, segment) => sum + segment.powerW, 0),
          lossEnergyWh: segments.reduce((sum, segment) => sum + segment.lossEnergyWh, 0),
          peakSegmentCurrentA: Math.abs(peakCurrent?.currentA || 0), peakCurrentDensityAmm2: Math.abs(peakDensity?.currentA || 0) / Math.max(1e-12, (peakDensity?.widthMm || 0) * (peakDensity?.thicknessMm || 0)),
          hottestSegmentId: hottest?.id || null, maximumTemperatureC: hottest?.tempC ?? null
        };
      });
    }

    refreshPassiveBalanceBranches() {
      const settings = this.settings(), balance = settings.balance;
      const previous = new Map((this.bmsBalanceBranches || []).map(branch => [branch.id, branch]));
      this.bmsBalanceBranches = [];
      // Balanser pasywny jest zewnętrzną gałęzią rezystancyjną. Włączamy go
      // wyłącznie podczas ładowania; nie modyfikuje on bezpośrednio SOC.
      if (!settings.bmsEnabled || !this.bms.connected || settings.mode !== "charge" || !balance.enabled || !(balance.targetCurrentA > 0)) return;
      const voltages = Array.from({ length: this.package.series }, (_, section) => {
        const cell = this.sectionBalanceAttachment(section);
        return cell ? (cell.localVoltageV || cell.voltageV || 0) : NaN;
      });
      if (voltages.some(value => !Number.isFinite(value))) return;
      const minimum = Math.min(...voltages);
      voltages.map((voltageV, section) => ({ section, voltageV }))
        .filter(item => item.voltageV >= balance.startV && item.voltageV - minimum >= balance.deltaV)
        .sort((a, b) => b.voltageV - a.voltageV || a.section - b.section)
        .slice(0, balance.maxGroups)
        .forEach(item => {
          const cell = this.sectionBalanceAttachment(item.section);
          if (!cell) return;
          const id = `BMS-BLEED-S${item.section + 1}`;
          const existing = previous.get(id);
          // Rezystancja jest ustalana w chwili załączenia z żądanego prądu,
          // a potem pozostaje stała: I = U/R, bez ukrytej regulacji prądowej.
          const resistanceOhm = existing?.resistanceOhm ?? Math.max(1e-6, Math.abs(item.voltageV) / balance.targetCurrentA);
          this.bmsBalanceBranches.push({
            id, section: item.section, attachmentCellId: String(cell.id), n: cell.index * 2, p: cell.index * 2 + 1,
            resistanceOhm, targetCurrentA: balance.targetCurrentA, activationVoltageV: item.voltageV,
            voltageV: 0, currentA: 0, powerW: 0, energyWh: existing?.energyWh || 0
          });
        });
    }

    async step(requestedDt, generation = this.simulationGeneration) {
      const settings = this.settings();
      const requiresElectricalSolve = !(this.electricalStepRemainingS > 1e-9);
      let commandedPackCurrentA = this.commandedPackCurrentA;
      if (requiresElectricalSolve) {
        const preparedInWorkers = await this.prepareElectricalStateParallel(generation);
        if (generation !== this.simulationGeneration || this.status !== "running") return 0;
        commandedPackCurrentA = this.bms.connected ? this.requestedPackCurrent() : 0;
        if (!this.solveElectrical(commandedPackCurrentA, preparedInWorkers)) {
          const details = this.formatSolverDiagnostics(this.lastSolverDiagnostics);
          this.logEvent("SOLVER", details, { diagnostics: this.lastSolverDiagnostics });
          this.stop(`Solver nie osiągnął zbieżności. Przyczyna: ${this.lastSolverDiagnostics?.cause || "nieznana"}. Szczegóły zapisano w dzienniku.`);
          return 0;
        }
        const electricalValidation = this.validateElectricalSolution();
        if (!electricalValidation.valid) {
          this.logEvent("WALIDACJA ELEKTRYCZNA", electricalValidation.reason, { validation: electricalValidation, diagnostics: this.lastSolverDiagnostics });
          this.stop(`Odrzucono krok elektryczny: ${electricalValidation.reason}`);
          return 0;
        }
        this.recordSolvedLoadState(commandedPackCurrentA);
        this.electricalStepRemainingS = settings.dt;
      }
      if (!this.validateFinite()) { this.stop("Utrata stabilności numerycznej: wykryto NaN, Infinity lub ujemną rezystancję."); return 0; }
      let remainingDt = requestedDt, usedTotalDt = 0, thermalGuard = 0;
      while (remainingDt > 1e-9 && this.status === "running" && thermalGuard++ < 5000) {
        const thermalStep = await this.updateThermalAndSoc(remainingDt, generation);
        if (thermalStep.cancelled) return usedTotalDt;
        if (!thermalStep.valid) {
          this.logEvent("BILANS ENERGII", thermalStep.reason, { energyBalance: this.energyBalance });
          this.stop(`Odrzucono krok fizyczny: ${thermalStep.reason}`);
          return usedTotalDt;
        }
        const dt = Math.min(remainingDt, thermalStep.dt);
        if (dt <= .0001001 && remainingDt > .01) { this.stop("Granica stabilności modelu: wymagany krok czasowy jest zbyt mały."); return usedTotalDt; }
        this.time += dt;
        usedTotalDt += dt;
        remainingDt = Math.max(0, remainingDt - dt);
        this.energyWh += Math.abs(this.packVoltage * this.solvedPackCurrentA) * dt / 3600;
        this.lossEnergyWh += (this.cells.reduce((s, c) => s + c.powerW, 0) + this.tapeSegments.reduce((s, t) => s + t.powerW, 0) + this.externalLeads.reduce((s, lead) => s + (lead.powerW || 0), 0)) * dt / 3600;
        this.bmsBalanceBranches.forEach(branch => { branch.energyWh += branch.powerW * dt / 3600; });
        this.bmsBalanceEnergyWh += this.bmsBalancePowerW * dt / 3600;
        this.updateBms(dt, this.solvedPackCurrentA);
        this.updateWeakPoints();
        this.updateThermalMaxima();
        this.recordHistory();
        this.checkEndConditions(this.solvedPackCurrentA);
        if (!this.validateFinite()) { this.stop("Utrata stabilności numerycznej podczas podkroku cieplnego."); return usedTotalDt; }
      }
      if (thermalGuard >= 5000 && remainingDt > 1e-9) {
        this.stop("Granica stabilności modelu: przekroczono limit podkroków cieplnych.");
      }
      this.electricalStepRemainingS = Math.max(0, this.electricalStepRemainingS - usedTotalDt);
      return usedTotalDt;
    }

    calculateKclResidual(V, diag, adjacency, b) {
      let maxResidualA = 0, worstNode = -1, sumResidualA = 0;
      for (let node = 0; node < V.length; node++) {
        let gv = diag[node] * V[node];
        for (const [other, conductance] of adjacency[node]) gv -= conductance * V[other];
        const residualA = gv - b[node];
        const magnitude = Math.abs(residualA);
        if (magnitude > maxResidualA) { maxResidualA = magnitude; worstNode = node; }
        sumResidualA += residualA;
      }
      return { maxResidualA, worstNode, sumResidualA };
    }

    validateElectricalSolution() {
      const toleranceA = 1e-3;
      const solver = this.lastSolverDiagnostics;
      const sectionMismatch = Math.max(0, ...(this.sectionCurrentBalance || []).map(item => Math.abs(item.residualA)));
      const plus = this.externalLeads?.find(lead => lead.id === "PACK+");
      const minus = this.externalLeads?.find(lead => lead.id === "PACK−");
      const leadMismatchA = Math.abs(Math.abs(plus?.currentA || 0) - Math.abs(minus?.currentA || 0));
      const solvedMismatchA = Math.abs(this.solvedPackCurrentA - this.commandedPackCurrentA);
      const maxKclResidualA = solver?.maxKclResidualA ?? Infinity;
      const injectionSumA = Math.abs(solver?.currentInjectionSumA ?? Infinity);
      const failures = [];
      if (!(maxKclResidualA <= toleranceA)) failures.push(`KCL ${fmt(maxKclResidualA, 6)} A > ${fmt(toleranceA, 6)} A`);
      if (!(injectionSumA <= 1e-9)) failures.push(`suma wymuszeń prądowych ${fmt(injectionSumA, 12)} A ≠ 0`);
      if (!(sectionMismatch <= toleranceA)) failures.push(`bilans sekcji ${fmt(sectionMismatch, 6)} A > ${fmt(toleranceA, 6)} A`);
      if (!(leadMismatchA <= toleranceA)) failures.push(`różnica |PACK+|/|PACK−| ${fmt(leadMismatchA, 6)} A > ${fmt(toleranceA, 6)} A`);
      if (!(solvedMismatchA <= toleranceA)) failures.push(`prąd rozwiązany/rzeczywisty ${fmt(solvedMismatchA, 6)} A > ${fmt(toleranceA, 6)} A`);
      const validation = { valid: failures.length === 0, toleranceA, maxKclResidualA, injectionSumA, sectionMismatchA: sectionMismatch, leadMismatchA, commandedPackCurrentA: this.commandedPackCurrentA, solvedPackCurrentA: this.solvedPackCurrentA, reason: failures.join("; ") || "KCL, PACK i sekcje poprawne" };
      this.lastElectricalValidation = validation;
      return validation;
    }

    prepareElectricalStateSync() {
      const model = this.package.cellModel;
      this.cells.forEach(cell => {
        this.updateCellSocViews(cell);
        cell.ocvV = interp(model.ocv_soc, cell.referenceSocPercent);
        const kT = interp(model.resistance_temperature_factor, cell.tempC), kSoc = interp(model.resistance_soc_factor, cell.soc);
        cell.r0Ohm = Math.max(1e-6, cell.baseDcirMohm * 1e-3 * kT * kSoc);
        cell.r1Ohm = Math.max(1e-6, cell.r0Ohm * cell.r1ToR0Ratio);
        cell.resistanceOhm = cell.r0Ohm;
      });
      this.tapeSegments.forEach(segment => {
        const rhoT = segment.material.resistivity * (1 + segment.material.tcr * (segment.tempC - 20));
        segment.resistanceOhm = Math.max(1e-7, rhoT * segment.lengthMm * 1e-3 / segment.areaM2);
      });
    }

    async prepareElectricalStateParallel(generation) {
      const pool = this.workerPool;
      if (!pool?.size) { this.prepareElectricalStateSync(); return true; }
      this.cells.forEach(cell => this.updateCellSocViews(cell));
      const partitionCount = Math.min(pool.size, Math.max(this.cells.length, this.tapeSegments.length));
      const partitions = Array.from({ length: partitionCount }, () => ({ cells: [], segments: [] }));
      this.cells.forEach((cell, index) => partitions[index % partitionCount].cells.push({
        index,
        referenceSocPercent: cell.referenceSocPercent,
        soc: cell.soc,
        tempC: cell.tempC,
        baseDcirMohm: cell.baseDcirMohm,
        polarizationVoltageV: cell.polarizationVoltageV,
        r1ToR0Ratio: cell.r1ToR0Ratio
      }));
      this.tapeSegments.forEach((segment, index) => partitions[index % partitionCount].segments.push({
        index,
        tempC: segment.tempC,
        resistivity: segment.material.resistivity,
        tcr: segment.material.tcr,
        lengthMm: segment.lengthMm,
        areaM2: segment.areaM2
      }));
      const model = this.package.cellModel;
      const sharedModel = { ocvSoc: model.ocv_soc, resistanceTemperatureFactor: model.resistance_temperature_factor, resistanceSocFactor: model.resistance_soc_factor };
      try {
        const results = await Promise.all(partitions.map(partition => pool.run("prepare-electrical", { ...partition, model: sharedModel })));
        if (generation !== this.simulationGeneration || this.status !== "running") return false;
        results.forEach(result => {
          result.cells.forEach(values => {
            const cell = this.cells[values.index];
            cell.ocvV = values.ocvV;
            cell.r0Ohm = values.r0Ohm;
            cell.r1Ohm = values.r1Ohm;
            cell.resistanceOhm = values.r0Ohm;
          });
          result.segments.forEach(values => { this.tapeSegments[values.index].resistanceOhm = values.resistanceOhm; });
        });
        return true;
      } catch (error) {
        this.prepareElectricalStateSync();
        if (!this.workerFallbackReported) {
          this.workerFallbackReported = true;
          this.logEvent("WĄTKI", `Wyłączono obliczenia równoległe i użyto trybu zgodności: ${error?.message || error}`);
        }
        return true;
      }
    }

    solveElectrical(packCurrent, statePrepared = false) {
      if (this.topologyDiagnostics && !this.topologyDiagnostics.valid) {
        this.lastSolverDiagnostics = { phase: "topology", converged: false, packCurrent, topology: this.topologyDiagnostics, cause: this.topologyDiagnostics.reasons.join("; ") };
        return false;
      }
      const N = this.nodeCount, adjacency = Array.from({ length: N }, () => []), diag = new Float64Array(N), b = new Float64Array(N), cellSourceB = new Float64Array(N);
      const addBranch = (n1, n2, resistance) => {
        const r = Math.max(1e-7, resistance), g = 1 / r;
        adjacency[n1].push([n2, g]); adjacency[n2].push([n1, g]); diag[n1] += g; diag[n2] += g;
      };
      const model = this.package.cellModel;
      if (!statePrepared) this.prepareElectricalStateSync();
      this.cells.forEach(cell => {
        const effectiveOcvV = cell.ocvV - cell.polarizationVoltageV;
        const n = cell.index * 2, p = n + 1, g = 1 / cell.r0Ohm;
        addBranch(n, p, cell.r0Ohm);
        b[p] += effectiveOcvV * g; b[n] -= effectiveOcvV * g;
        cellSourceB[p] += effectiveOcvV * g; cellSourceB[n] -= effectiveOcvV * g;
      });
      this.tapeSegments.forEach(segment => {
        addBranch(segment.n1, segment.n2, segment.resistanceOhm);
      });
      this.refreshPassiveBalanceBranches();
      this.bmsBalanceBranches.forEach(branch => addBranch(branch.n, branch.p, branch.resistanceOhm));
      // Obciążenie jest źródłem prądowym między idealnie scalonymi PACK+ i
      // PACK−. Wymuszenia mają przeciwne znaki, więc suma b pozostaje równa 0.
      this.commandedPackCurrentA = packCurrent;
      b[this.leadPlusNode] -= packCurrent; b[this.leadMinusNode] += packCurrent;
      const currentInjectionSumA = Array.from(b).reduce((sum, value) => sum + value, 0);
      // Walidacja projektu dopuszcza 1 mA, ale solver pracuje z zapasem
      // 100×. Dzięki temu suma prądów całej sekcji nie kumuluje residualów
      // pojedynczych węzłów do wartości granicznej.
      const voltageToleranceV = 1e-9, kclToleranceA = 1e-5;
      const ref = this.leadMinusNode, V = this.nodeVoltages, iterations = { low: 60, medium: 100, high: 180 }[this.settings().quality] || 100;
      let converged = false, iterationsUsed = 0, finalMaxDiff = Infinity, worstNode = -1, initialMaxDiff = null, pcgResult = null, solverMethod = "Gauss-Seidel";
      let kcl = { maxResidualA: Infinity, worstNode: -1, sumResidualA: Infinity };
      for (let iter = 0; iter < iterations; iter++) {
        let maxDiff = 0, maxDiffNode = -1; V[ref] = 0;
        for (let node = 0; node < N; node++) {
          if (node === ref || !(diag[node] > 0)) continue;
          let sum = b[node];
          for (const [other, g] of adjacency[node]) sum += g * V[other];
          const next = sum / diag[node], diff = Math.abs(next - V[node]);
          if (diff > maxDiff) { maxDiff = diff; maxDiffNode = node; }
          V[node] = next;
        }
        if (initialMaxDiff === null) initialMaxDiff = maxDiff;
        finalMaxDiff = maxDiff; worstNode = maxDiffNode; iterationsUsed = iter + 1;
        // Sam brak zmiany napięcia nie jest zbieżnością fizyczną. Każda
        // iteracja jest zatwierdzana dopiero po sprawdzeniu residualu KCL.
        kcl = this.calculateKclResidual(V, diag, adjacency, b);
        if (maxDiff < voltageToleranceV && kcl.maxResidualA <= kclToleranceA) { converged = true; break; }
      }
      const gaussSeidelIterations = iterationsUsed;
      const gaussSeidelFinalDiff = finalMaxDiff;
      if (!converged) {
        const pcgLimit = Math.max(100, Math.min(2500, N * ({ low: 2, medium: 4, high: 8 }[this.settings().quality] || 4)));
        pcgResult = this.solveGroundedPcg(V, diag, adjacency, b, ref, pcgLimit, voltageToleranceV, kclToleranceA);
        solverMethod = "Gauss-Seidel + PCG";
        iterationsUsed += pcgResult.iterationsUsed;
        finalMaxDiff = pcgResult.maxVoltageCorrectionV;
        worstNode = pcgResult.worstNode;
        converged = pcgResult.converged;
        kcl = { maxResidualA: pcgResult.maxKclResidualA, worstNode: pcgResult.kclWorstNode, sumResidualA: pcgResult.kclSumResidualA };
      }
      kcl = this.calculateKclResidual(V, diag, adjacency, b);
      converged = converged && finalMaxDiff <= voltageToleranceV && kcl.maxResidualA <= kclToleranceA;
      this.packVoltage = V[this.leadPlusNode] - V[this.leadMinusNode];
      this.cells.forEach(cell => {
        const n = cell.index * 2, p = n + 1;
        cell.localVoltageV = V[p] - V[n];
        cell.voltageV = cell.localVoltageV;
        cell.currentA = (cell.ocvV - cell.polarizationVoltageV - cell.localVoltageV) / cell.r0Ohm;
        cell.r0LossPowerW = cell.currentA * cell.currentA * cell.r0Ohm;
        cell.r1LossPowerW = cell.polarizationVoltageV * cell.polarizationVoltageV / Math.max(1e-6, cell.r1Ohm);
        // dOCV/dT nie jest dostępne w katalogu producenta, dlatego składnik
        // odwracalny jest jawnie ustawiony na zero zamiast ukryty w stratach.
        cell.reversiblePowerW = 0;
        cell.powerW = cell.r0LossPowerW + cell.r1LossPowerW + cell.reversiblePowerW;
      });
      this.tapeSegments.forEach(segment => {
        segment.voltageV = V[segment.n1] - V[segment.n2];
        segment.currentA = segment.voltageV / segment.resistanceOhm;
        segment.powerW = segment.currentA * segment.currentA * segment.resistanceOhm;
      });
      const nodeConductiveCurrent = node => {
        let currentA = diag[node] * V[node];
        for (const [other, conductance] of adjacency[node]) currentA -= conductance * V[other];
        return currentA;
      };
      const plusReconstructedCurrentA = cellSourceB[this.leadPlusNode] - nodeConductiveCurrent(this.leadPlusNode);
      const minusReconstructedCurrentA = nodeConductiveCurrent(this.leadMinusNode) - cellSourceB[this.leadMinusNode];
      // Prąd idealnego źródła prądowego jest z definicji dokładnie jego
      // wartością zadaną. Rekonstrukcja z G·V i źródeł Nortona odejmuje od
      // siebie duże wartości i służy wyłącznie jako diagnostyka numeryczna.
      const plusNetworkCurrentA = packCurrent;
      const minusNetworkCurrentA = packCurrent;
      this.externalLeads.forEach(lead => {
        lead.voltageV = 0;
        lead.currentA = lead.id === "PACK+" ? plusNetworkCurrentA : minusNetworkCurrentA;
        lead.powerW = 0;
      });
      this.solvedPackCurrentA = packCurrent;
      this.packCurrent = this.solvedPackCurrentA;
      this.bmsBalanceBranches.forEach(branch => {
        branch.voltageV = V[branch.p] - V[branch.n];
        branch.currentA = branch.voltageV / branch.resistanceOhm;
        branch.powerW = branch.currentA * branch.currentA * branch.resistanceOhm;
      });
      this.bmsBalancePowerW = this.bmsBalanceBranches.reduce((sum, branch) => sum + branch.powerW, 0);
      this.groupVoltages = Array.from({ length: this.package.series }, (_, section) => {
        const group = this.sectionCells(section);
        if (!group.length) return 0;
        return group.reduce((sum, cell) => sum + cell.localVoltageV, 0) / group.length;
      });
      // Odczyty BMS pochodzą z jednego rzeczywistego punktu przyłączenia
      // każdej sekcji; średnia grupy pozostaje wyłącznie informacją wizualną.
      this.sectionBmsVoltages = Array.from({ length: this.package.series }, (_, section) => this.sectionBalanceAttachment(section)?.localVoltageV ?? NaN);
      const balanceCurrentBySection = new Float64Array(this.package.series);
      this.bmsBalanceBranches.forEach(branch => { balanceCurrentBySection[branch.section] += branch.currentA; });
      this.sectionCurrentBalance = Array.from({ length: this.package.series }, (_, section) => {
        const cellCurrentA = this.sectionCells(section).reduce((sum, cell) => sum + cell.currentA, 0);
        const balanceCurrentA = balanceCurrentBySection[section];
        const expectedCurrentA = this.solvedPackCurrentA + balanceCurrentA;
        return { section: section + 1, cellCurrentA, commandedPackCurrentA: packCurrent, solvedPackCurrentA: this.solvedPackCurrentA, balanceCurrentA, expectedCurrentA, residualA: cellCurrentA - expectedCurrentA };
      });
      if (this.settings().mode === "charge" && this.chargePhase === "CC" && Math.max(...this.cells.map(cell => cell.localVoltageV)) >= this.package.cellModel.voltage_max_V * .995) {
        this.chargePhase = "CV"; this.logEvent("ŁADOWARKA", "Przejście z CC do CV");
      }
      const positiveDiagonal = Array.from(diag).filter(value => value > 0);
      const cellResistances = this.cells.map(cell => cell.resistanceOhm);
      const stripResistances = this.tapeSegments.map(segment => segment.resistanceOhm);
      const allResistances = [...cellResistances, ...stripResistances, ...this.bmsBalanceBranches.map(branch => branch.resistanceOhm)].filter(value => value > 0);
      const minResistance = allResistances.length ? Math.min(...allResistances) : NaN;
      const maxResistance = allResistances.length ? Math.max(...allResistances) : NaN;
      const minDiagonal = positiveDiagonal.length ? Math.min(...positiveDiagonal) : NaN;
      const maxDiagonal = positiveDiagonal.length ? Math.max(...positiveDiagonal) : NaN;
      const convergenceRatio = initialMaxDiff > 0 ? finalMaxDiff / initialMaxDiff : 0;
      let cause = "zbieżność osiągnięta";
      if (!converged) {
        if (this.topologyDiagnostics && !this.topologyDiagnostics.valid) cause = this.topologyDiagnostics.reasons.join("; ");
        else if (pcgResult?.breakdown) cause = `solver PCG został przerwany: ${pcgResult.breakdown}`;
        else if (kcl.maxResidualA > kclToleranceA) cause = `residual KCL ${fmt(kcl.maxResidualA, 9)} A przekracza tolerancję ${fmt(kclToleranceA, 9)} A`;
        else if (Number.isFinite(minResistance) && Number.isFinite(maxResistance) && maxResistance / minResistance > 1e7) cause = "sieć jest źle uwarunkowana: bardzo duża różnica między rezystancją ogniw i taśm";
        else if (convergenceRatio > .9) cause = "iteracje praktycznie nie zmniejszają błędu; możliwy wiszący komponent lub osobliwość macierzy";
        else cause = "osiągnięto limit iteracji przed uzyskaniem wymaganej dokładności";
      }
      this.lastSolverDiagnostics = {
        phase: "solver", converged, cause, solverMethod, commandedPackCurrentA: packCurrent, solvedPackCurrentA: this.solvedPackCurrentA, packVoltage: this.packVoltage,
        nodeCount: N, branchCount: this.cells.length + this.tapeSegments.length + this.bmsBalanceBranches.length,
        iterationsLimit: iterations + (pcgResult?.iterationsLimit || 0), iterationsUsed, gaussSeidelIterations, gaussSeidelFinalDiffV: gaussSeidelFinalDiff,
        pcgIterations: pcgResult?.iterationsUsed || 0, pcgRelativeResidual: pcgResult?.relativeResidual ?? null, pcgBreakdown: pcgResult?.breakdown || null,
        toleranceV: voltageToleranceV, kclToleranceA, currentInjectionSumA, maxKclResidualA: kcl.maxResidualA, kclWorstNode: kcl.worstNode, kclWorstNodeDescription: this.describeNode(kcl.worstNode), kclSumResidualA: kcl.sumResidualA,
        packCurrentReconstruction: { plusA: plusReconstructedCurrentA, minusA: minusReconstructedCurrentA, plusErrorA: plusReconstructedCurrentA - packCurrent, minusErrorA: minusReconstructedCurrentA - packCurrent }, initialMaxDiffV: initialMaxDiff, finalMaxDiffV: finalMaxDiff,
        convergenceRatio, worstNode, worstNodeDescription: this.describeNode(worstNode),
        resistanceMinOhm: minResistance, resistanceMaxOhm: maxResistance,
        resistanceRatio: Number.isFinite(minResistance) && minResistance > 0 ? maxResistance / minResistance : NaN,
        diagonalMinS: minDiagonal, diagonalMaxS: maxDiagonal,
        voltageMinV: V.length ? Math.min(...V) : NaN, voltageMaxV: V.length ? Math.max(...V) : NaN,
        sectionCurrentBalance: this.sectionCurrentBalance,
        passiveBalanceBranches: this.bmsBalanceBranches.map(branch => ({ id: branch.id, section: branch.section + 1, attachmentCellId: branch.attachmentCellId, currentA: branch.currentA, powerW: branch.powerW, resistanceOhm: branch.resistanceOhm })),
        topology: this.topologyDiagnostics
      };
      if (pcgResult && converged && !this.pcgRecoveryReported) {
        this.pcgRecoveryReported = true;
        this.logEvent("SOLVER", `Gauss-Seidel nie osiągnął tolerancji po ${gaussSeidelIterations} iteracjach. PCG doprowadził rozwiązanie do błędu ${fmt(finalMaxDiff, 9)} V w ${pcgResult.iterationsUsed} iteracjach.`, { diagnostics: this.lastSolverDiagnostics });
      }
      return converged;
    }

    solveGroundedPcg(V, diag, adjacency, b, ref, iterationsLimit, toleranceV, kclToleranceA) {
      const N = V.length;
      const r = new Float64Array(N), z = new Float64Array(N), p = new Float64Array(N), Ap = new Float64Array(N);
      const multiply = (input, output) => {
        for (let node = 0; node < N; node++) {
          if (node === ref) { output[node] = input[node]; continue; }
          let value = diag[node] * input[node];
          for (const [other, g] of adjacency[node]) value -= g * input[other];
          output[node] = value;
        }
      };
      V[ref] = 0;
      multiply(V, Ap);
      let rhsNorm2 = 0, rz = 0, worstNode = -1, maxCorrection = 0;
      for (let node = 0; node < N; node++) {
        if (node === ref || !(diag[node] > 0)) { r[node] = z[node] = p[node] = 0; continue; }
        r[node] = b[node] - Ap[node];
        z[node] = r[node] / diag[node];
        p[node] = z[node];
        rz += r[node] * z[node];
        rhsNorm2 += b[node] * b[node];
        const correction = Math.abs(z[node]);
        if (correction > maxCorrection) { maxCorrection = correction; worstNode = node; }
      }
      let kcl = this.calculateKclResidual(V, diag, adjacency, b);
      if (maxCorrection <= toleranceV && kcl.maxResidualA <= kclToleranceA) return { converged: true, iterationsUsed: 0, iterationsLimit, maxVoltageCorrectionV: maxCorrection, worstNode, relativeResidual: 0, breakdown: null, maxKclResidualA: kcl.maxResidualA, kclWorstNode: kcl.worstNode, kclSumResidualA: kcl.sumResidualA };
      let iterationsUsed = 0, breakdown = null, relativeResidual = Infinity;
      for (let iteration = 0; iteration < iterationsLimit; iteration++) {
        multiply(p, Ap);
        let pAp = 0;
        for (let node = 0; node < N; node++) if (node !== ref) pAp += p[node] * Ap[node];
        if (!Number.isFinite(pAp) || pAp <= 1e-30 || !Number.isFinite(rz)) { breakdown = `nieprawidłowy iloczyn pAp=${pAp}`; break; }
        const alpha = rz / pAp;
        if (!Number.isFinite(alpha)) { breakdown = `nieprawidłowy krok alpha=${alpha}`; break; }
        let residualNorm2 = 0;
        maxCorrection = 0; worstNode = -1;
        for (let node = 0; node < N; node++) {
          if (node === ref) continue;
          V[node] += alpha * p[node];
          r[node] -= alpha * Ap[node];
          residualNorm2 += r[node] * r[node];
          const correction = Math.abs(r[node] / diag[node]);
          if (correction > maxCorrection) { maxCorrection = correction; worstNode = node; }
        }
        V[ref] = 0;
        iterationsUsed = iteration + 1;
        relativeResidual = Math.sqrt(residualNorm2 / Math.max(1e-30, rhsNorm2));
        kcl = this.calculateKclResidual(V, diag, adjacency, b);
        if (maxCorrection <= toleranceV && kcl.maxResidualA <= kclToleranceA) return { converged: true, iterationsUsed, iterationsLimit, maxVoltageCorrectionV: maxCorrection, worstNode, relativeResidual, breakdown: null, maxKclResidualA: kcl.maxResidualA, kclWorstNode: kcl.worstNode, kclSumResidualA: kcl.sumResidualA };
        let nextRz = 0;
        for (let node = 0; node < N; node++) {
          if (node === ref || !(diag[node] > 0)) { z[node] = 0; continue; }
          z[node] = r[node] / diag[node];
          nextRz += r[node] * z[node];
        }
        if (!Number.isFinite(nextRz) || Math.abs(rz) <= 1e-30) { breakdown = `nieprawidłowy iloczyn rMz=${nextRz}`; break; }
        const beta = nextRz / rz;
        for (let node = 0; node < N; node++) p[node] = node === ref ? 0 : z[node] + beta * p[node];
        rz = nextRz;
      }
      kcl = this.calculateKclResidual(V, diag, adjacency, b);
      return { converged: false, iterationsUsed, iterationsLimit, maxVoltageCorrectionV: maxCorrection, worstNode, relativeResidual, breakdown, maxKclResidualA: kcl.maxResidualA, kclWorstNode: kcl.worstNode, kclSumResidualA: kcl.sumResidualA };
    }

    describeNode(node) {
      if (!(node >= 0)) return "brak";
      const lead = this.externalLeads?.find(item => item.node === node);
      if (node < this.cells.length * 2) {
        const cell = this.cells[Math.floor(node / 2)];
        return `${lead ? `${lead.id} / ` : ""}ogniwo ${cell?.id ?? "?"}, biegun ${node % 2 ? "+" : "−"}, S${(cell?.section ?? 0) + 1}`;
      }
      if (lead) return `zewnętrzny węzeł ${lead.id}`;
      const segment = this.tapeSegments.find(item => item.n1 === node || item.n2 === node);
      return segment ? `węzeł pośredni taśmy ${segment.id}` : `węzeł ${node}`;
    }

    formatSolverDiagnostics(diagnostics) {
      if (!diagnostics) return "Brak danych diagnostycznych solvera.";
      if (diagnostics.phase === "topology") return `${diagnostics.cause}. ${this.formatTopologyDiagnostics(diagnostics.topology)}`;
      return `${diagnostics.cause}. Metoda ${diagnostics.solverMethod}; Gauss-Seidel ${diagnostics.gaussSeidelIterations} iteracji (błąd ${fmt(diagnostics.gaussSeidelFinalDiffV, 9)} V), PCG ${diagnostics.pcgIterations} iteracji${diagnostics.pcgBreakdown ? `, awaria: ${diagnostics.pcgBreakdown}` : ""}. Błąd końcowy ${fmt(diagnostics.finalMaxDiffV, 9)} V (tolerancja ${diagnostics.toleranceV} V), KCL ${fmt(diagnostics.maxKclResidualA, 9)} A (tolerancja ${fmt(diagnostics.kclToleranceA, 9)} A), względne residuum PCG ${fmt(diagnostics.pcgRelativeResidual, 10)}, najgorszy węzeł: ${diagnostics.worstNodeDescription}, R min/max ${fmt(diagnostics.resistanceMinOhm, 10)}/${fmt(diagnostics.resistanceMaxOhm, 6)} Ω (stosunek ${fmt(diagnostics.resistanceRatio, 0)}×), napięcia węzłów ${fmt(diagnostics.voltageMinV, 4)}…${fmt(diagnostics.voltageMaxV, 4)} V, prąd zadany/rozwiązany ${fmt(diagnostics.commandedPackCurrentA, 3)}/${fmt(diagnostics.solvedPackCurrentA, 3)} A.`;
    }

    evaluateElectricalEnergyBalance() {
      const cellR0LossW = this.cells.reduce((sum, cell) => sum + cell.r0LossPowerW, 0);
      const cellR1LossW = this.cells.reduce((sum, cell) => sum + cell.r1LossPowerW, 0);
      const tapeLossW = this.tapeSegments.reduce((sum, segment) => sum + segment.powerW, 0);
      const externalLeadLossW = this.externalLeads.reduce((sum, lead) => sum + (lead.powerW || 0), 0);
      const balancePowerW = this.bmsBalanceBranches.reduce((sum, branch) => sum + branch.powerW, 0);
      const cellSourcePowerW = this.cells.reduce((sum, cell) => sum + cell.ocvV * cell.currentA, 0);
      const cellTerminalPowerW = this.cells.reduce((sum, cell) => sum + cell.localVoltageV * cell.currentA, 0);
      const externalPowerW = this.packVoltage * this.solvedPackCurrentA;
      // I·Vp = Vp²/R1 + d(½C·Vp²)/dt. Ten zapis bilansuje gałąź R1-C1
      // w dokładnie tym samym chwilowym stanie, którego użył solver.
      const polarizationStorageRateW = this.cells.reduce((sum, cell) => sum + cell.polarizationVoltageV * cell.currentA - cell.r1LossPowerW, 0);
      const terminalNetworkResidualW = cellTerminalPowerW - (externalPowerW + tapeLossW + externalLeadLossW + balancePowerW);
      const electricalResidualW = cellSourcePowerW - (externalPowerW + balancePowerW + externalLeadLossW + tapeLossW + cellR0LossW + cellR1LossW + polarizationStorageRateW);
      const terminalScaleW = Math.max(1e-9, Math.abs(cellTerminalPowerW) + Math.abs(externalPowerW) + Math.abs(tapeLossW) + Math.abs(externalLeadLossW) + Math.abs(balancePowerW));
      const electricalScaleW = Math.max(1e-9, Math.abs(cellSourcePowerW) + Math.abs(externalPowerW) + Math.abs(balancePowerW) + Math.abs(externalLeadLossW) + Math.abs(tapeLossW) + Math.abs(cellR0LossW) + Math.abs(cellR1LossW) + Math.abs(polarizationStorageRateW));
      const terminalNetworkErrorPercent = 100 * Math.abs(terminalNetworkResidualW) / terminalScaleW;
      const electricalErrorPercent = 100 * Math.abs(electricalResidualW) / electricalScaleW;
      return {
        commandedPackCurrentA: this.commandedPackCurrentA, solvedPackCurrentA: this.solvedPackCurrentA,
        sourcePowerW: cellSourcePowerW, terminalPowerW: cellTerminalPowerW, externalPowerW,
        cellR0LossW, cellR1LossW, tapeLossW, externalLeadLossW, balancePowerW, polarizationStorageRateW,
        terminalNetworkResidualW, terminalNetworkErrorPercent, electricalResidualW, electricalErrorPercent,
        acceptanceErrorPercent: Math.max(terminalNetworkErrorPercent, electricalErrorPercent)
      };
    }

    updateThermalAndSocLegacy(requestedDt) {
      const settings = this.settings(), model = this.package.cellModel, ambient = settings.ambientC, thermal = settings.thermalModel;
      // Przed uruchomieniem jakiejkolwiek aktualizacji cieplnej, SOC lub RC
      // odrzucamy krok o niespójnym bilansie energii elektrycznej.
      const electrical = this.evaluateElectricalEnergyBalance();
      this.energyBalance = {
        timeS: this.time, dtS: null, ...electrical,
        thermalGeneratedW: null, thermalStoredRateW: null, ambientHeatLossW: null, thermalResidualW: null, thermalErrorPercent: null,
        minThermalTimeConstantS: null
      };
      if (electrical.acceptanceErrorPercent > .1) return { dt: 0, valid: false, reason: `błąd bilansu elektrycznego ${fmt(electrical.acceptanceErrorPercent, 5)}% przekracza 0,10000%` };
      const scratch = this.thermalScratch;
      const cellHeat = scratch.cellHeat, tapeHeat = scratch.tapeHeat, cellConductance = scratch.cellConductance, tapeConductance = scratch.tapeConductance;
      for (let index = 0; index < this.cells.length; index++) {
        cellHeat[index] = settings.thermal ? this.cells[index].powerW : 0;
        cellConductance[index] = 0;
      }
      for (let index = 0; index < this.tapeSegments.length; index++) {
        tapeHeat[index] = settings.thermal ? this.tapeSegments[index].powerW : 0;
        tapeConductance[index] = 0;
      }
      const thermalEnergyBeforeJ = this.cells.reduce((sum, cell) => sum + model.thermal.heat_capacity_J_K * cell.tempC, 0) + this.tapeSegments.reduce((sum, segment) => sum + segment.heatCapacityJK * segment.tempC, 0);
      let ambientHeatLossW = 0;
      const maxNeighbours = this.maxNeighbourCount || 1;

      this.cells.forEach(cell => {
        const thermalState = cell.thermal || {};
        thermalState.generationW = settings.thermal ? cell.powerW : 0;
        thermalState.convectionW = 0; thermalState.neighbourNetW = 0; thermalState.tapeContactNetW = 0; thermalState.conductanceWK = 0;
        cell.thermal = thermalState;
      });
      this.tapeSegments.forEach(segment => {
        const thermalState = segment.thermal || { contacts: [], axialLinks: [], tapeContactLinks: [] };
        thermalState.contacts ||= [];
        thermalState.axialLinks ||= [];
        thermalState.tapeContactLinks ||= [];
        thermalState.generationW = settings.thermal ? segment.powerW : 0;
        thermalState.convectionW = 0; thermalState.contactNetW = 0; thermalState.axialNetW = 0; thermalState.tapeContactNetW = 0; thermalState.conductanceWK = 0;
        thermalState.contacts.length = 0; thermalState.axialLinks.length = 0; thermalState.tapeContactLinks.length = 0;
        segment.thermal = thermalState;
      });

      if (settings.thermal) {
        this.cells.forEach((cell, index) => {
          const exposureFactor = cell.neighbourCount >= maxNeighbours ? thermal.interiorCoolingFactor : cell.neighbourCount >= maxNeighbours - 1 ? thermal.transitionCoolingFactor : thermal.exteriorCoolingFactor;
          const conductance = model.thermal.heat_transfer_W_m2K * model.geometry.surface_area_m2 * cell.coolingFactor * exposureFactor;
          const heatToAmbient = conductance * (cell.tempC - ambient);
          cellHeat[index] -= heatToAmbient;
          cellConductance[index] += conductance;
          cell.thermal.convectionW = heatToAmbient;
          cell.thermal.conductanceWK += conductance;
          ambientHeatLossW += heatToAmbient;
        });
        this.neighbourPairs.forEach(([a, b]) => {
          const q = thermal.cellToCellConductanceWK * (this.cells[a].tempC - this.cells[b].tempC);
          cellHeat[a] -= q; cellHeat[b] += q;
          cellConductance[a] += thermal.cellToCellConductanceWK; cellConductance[b] += thermal.cellToCellConductanceWK;
          this.cells[a].thermal.neighbourNetW -= q; this.cells[b].thermal.neighbourNetW += q;
          this.cells[a].thermal.conductanceWK += thermal.cellToCellConductanceWK; this.cells[b].thermal.conductanceWK += thermal.cellToCellConductanceWK;
        });
        this.tapeSegments.forEach((segment, index) => {
          const surfaceM2 = 2 * (segment.widthMm + segment.thicknessMm) * segment.lengthMm * 1e-6;
          const convectionG = thermal.tapeConvectionCoefficientWm2K * surfaceM2;
          const heatToAmbient = convectionG * (segment.tempC - ambient);
          tapeHeat[index] -= heatToAmbient;
          tapeConductance[index] += convectionG;
          segment.thermal.convectionW = heatToAmbient;
          segment.thermal.conductanceWK += convectionG;
          ambientHeatLossW += heatToAmbient;
          segment.contactCells.forEach(cellIndex => {
            const q = thermal.tapeCellConductanceWK * (segment.tempC - this.cells[cellIndex].tempC);
            tapeHeat[index] -= q; cellHeat[cellIndex] += q;
            tapeConductance[index] += thermal.tapeCellConductanceWK; cellConductance[cellIndex] += thermal.tapeCellConductanceWK;
            segment.thermal.contactNetW -= q;
            segment.thermal.contacts.push({ cellId: String(this.cells[cellIndex].id), conductanceWK: thermal.tapeCellConductanceWK, heatFlowToCellW: q });
            this.cells[cellIndex].thermal.tapeContactNetW += q;
            this.cells[cellIndex].thermal.conductanceWK += thermal.tapeCellConductanceWK;
          });
        });
        this.tapeThermalAxialPairs.forEach(([leftIndex, index]) => {
          const left = this.tapeSegments[leftIndex], right = this.tapeSegments[index];
          const thermalResistance = (left.lengthMm * .0005) / Math.max(1e-12, left.material.thermalConductivity * left.areaM2) + (right.lengthMm * .0005) / Math.max(1e-12, right.material.thermalConductivity * right.areaM2);
          const conductance = 1 / Math.max(1e-12, thermalResistance);
          const q = conductance * (left.tempC - right.tempC);
          tapeHeat[leftIndex] -= q; tapeHeat[index] += q;
          tapeConductance[leftIndex] += conductance; tapeConductance[index] += conductance;
          left.thermal.axialNetW -= q; right.thermal.axialNetW += q;
          left.thermal.axialLinks.push({ segmentId: right.id, conductanceWK: conductance, heatFlowOutW: q });
          right.thermal.axialLinks.push({ segmentId: left.id, conductanceWK: conductance, heatFlowOutW: -q });
          left.thermal.conductanceWK += conductance; right.thermal.conductanceWK += conductance;
        });
        this.tapeThermalContactPairs.forEach(contact => {
          const left = this.tapeSegments[contact.leftIndex], right = this.tapeSegments[contact.rightIndex];
          const conductance = thermal.tapeToTapeContactConductanceWK * contact.coverage;
          if (!(conductance > 0)) return;
          const q = conductance * (left.tempC - right.tempC);
          tapeHeat[contact.leftIndex] -= q; tapeHeat[contact.rightIndex] += q;
          tapeConductance[contact.leftIndex] += conductance; tapeConductance[contact.rightIndex] += conductance;
          left.thermal.tapeContactNetW -= q; right.thermal.tapeContactNetW += q;
          left.thermal.tapeContactLinks.push({ segmentId: right.id, kind: contact.kind, xMm: contact.xMm, yMm: contact.yMm, overlapMm: contact.overlapMm, contactAreaMm2: contact.contactAreaMm2, conductanceWK: conductance, heatFlowOutW: q });
          right.thermal.tapeContactLinks.push({ segmentId: left.id, kind: contact.kind, xMm: contact.xMm, yMm: contact.yMm, overlapMm: contact.overlapMm, contactAreaMm2: contact.contactAreaMm2, conductanceWK: conductance, heatFlowOutW: -q });
          left.thermal.conductanceWK += conductance; right.thermal.conductanceWK += conductance;
        });
      }

      const cellTau = this.cells.map((cell, index) => cellConductance[index] > 0 ? model.thermal.heat_capacity_J_K / cellConductance[index] : Infinity);
      const tapeTau = this.tapeSegments.map((segment, index) => tapeConductance[index] > 0 ? segment.heatCapacityJK / tapeConductance[index] : Infinity);
      const minTauS = Math.min(...cellTau, ...tapeTau);
      const stableDt = Number.isFinite(minTauS) ? Math.max(.0001, .1 * minTauS) : requestedDt;
      const dt = Math.max(.0001, Math.min(requestedDt, stableDt));
      if (dt < requestedDt * .999 && !this.adaptiveStepReported) {
        this.adaptiveStepReported = true;
        this.logEvent("NUMERYKA", `Automatycznie zmniejszono krok z ${fmt(requestedDt, 4)} s do ${fmt(dt, 4)} s; granica stabilności termicznej 0,1τ, τmin=${fmt(minTauS, 5)} s.`);
      }
      this.cells.forEach((cell, index) => {
        const currentDirection = cell.currentA < 0 ? "charge" : "discharge";
        const currentLimits = this.cellCurrentLimits(cell, currentDirection);
        const absoluteCurrentA = Math.abs(cell.currentA);
        const standardRatio = absoluteCurrentA / Math.max(.0001, currentLimits.standardA);
        const maximumRatio = absoluteCurrentA / Math.max(.0001, currentLimits.maximumA);
        cell.currentExposure.throughputAh += absoluteCurrentA * dt / 3600;
        if (standardRatio > 1) cell.currentExposure.secondsAboveStandard += dt;
        if (maximumRatio > 1) cell.currentExposure.secondsAboveMaximum += dt;
        cell.currentExposure.peakStandardRatio = Math.max(cell.currentExposure.peakStandardRatio, standardRatio);
        cell.currentExposure.peakMaximumRatio = Math.max(cell.currentExposure.peakMaximumRatio, maximumRatio);
        const referenceCapacityAh = Math.max(.001, cell.referenceCapacityAh || cell.capacityAh);
        cell.absoluteChargeAh = clamp(cell.absoluteChargeAh - cell.currentA * dt / 3600, 0, referenceCapacityAh);
        const tauS = Math.max(1e-6, cell.r1Ohm * cell.c1F), decay = Math.exp(-dt / tauS);
        cell.polarizationVoltageV = cell.polarizationVoltageV * decay + cell.currentA * cell.r1Ohm * (1 - decay);
        cell.polarizationEnergyJ = .5 * cell.c1F * cell.polarizationVoltageV * cell.polarizationVoltageV;
        cell.tempC += cellHeat[index] / Math.max(1e-6, model.thermal.heat_capacity_J_K) * dt;
        this.updateCellSocViews(cell);
        cell.lossEnergyWh += cell.powerW * dt / 3600;
      });
      this.tapeSegments.forEach((segment, index) => { segment.tempC += tapeHeat[index] / Math.max(1e-6, segment.heatCapacityJK) * dt; segment.lossEnergyWh += segment.powerW * dt / 3600; });

      const thermalEnergyAfterJ = this.cells.reduce((sum, cell) => sum + model.thermal.heat_capacity_J_K * cell.tempC, 0) + this.tapeSegments.reduce((sum, segment) => sum + segment.heatCapacityJK * segment.tempC, 0);
      const thermalStoredRateW = settings.thermal ? (thermalEnergyAfterJ - thermalEnergyBeforeJ) / dt : 0;
      const thermalResidualW = settings.thermal ? electrical.cellR0LossW + electrical.cellR1LossW + electrical.tapeLossW - (thermalStoredRateW + ambientHeatLossW) : null;
      const thermalScaleW = Math.max(1e-9, electrical.cellR0LossW + electrical.cellR1LossW + electrical.tapeLossW + Math.abs(thermalStoredRateW) + Math.abs(ambientHeatLossW));
      Object.assign(this.energyBalance, {
        dtS: dt,
        thermalGeneratedW: settings.thermal ? electrical.cellR0LossW + electrical.cellR1LossW + electrical.tapeLossW : 0,
        thermalStoredRateW,
        ambientHeatLossW,
        thermalResidualW, thermalErrorPercent: settings.thermal ? 100 * Math.abs(thermalResidualW) / thermalScaleW : null,
        minThermalTimeConstantS: minTauS
      });
      return { dt, valid: true };
    }

    updateThermalAndSoc(requestedDt) {
      const settings = this.settings(), model = this.package.cellModel, ambient = settings.ambientC, thermal = settings.thermalModel;
      const twoNode = thermal.fidelity !== "one-node", closedEnvironment = thermal.environment !== "open";
      const electrical = this.evaluateElectricalEnergyBalance();
      this.energyBalance = { timeS: this.time, dtS: null, ...electrical, thermalGeneratedW: null, thermalStoredRateW: null, ambientHeatLossW: null, thermalResidualW: null, thermalErrorPercent: null, minThermalTimeConstantS: null };
      if (electrical.acceptanceErrorPercent > .1) return { dt: 0, valid: false, reason: `błąd bilansu elektrycznego ${fmt(electrical.acceptanceErrorPercent, 5)}% przekracza 0,10000%` };

      const s = this.thermalScratch;
      const coreHeat = s.cellCoreHeat, surfaceHeat = s.cellSurfaceHeat, tapeHeat = s.tapeHeat;
      const coreG = s.cellCoreConductance, surfaceG = s.cellSurfaceConductance, tapeG = s.tapeConductance;
      const airHeat = s.airHeat, airG = s.airConductance, caseHeat = s.caseHeat, caseG = s.caseConductance;
      [coreHeat, surfaceHeat, tapeHeat, coreG, surfaceG, tapeG, airHeat, airG, caseHeat, caseG].forEach(array => array.fill(0));
      const cellCapacityJK = Math.max(1e-6, model.thermal.heat_capacity_J_K);
      const coreCapacityJK = twoNode ? cellCapacityJK * thermal.coreCapacityFraction : cellCapacityJK;
      const surfaceCapacityJK = twoNode ? cellCapacityJK * (1 - thermal.coreCapacityFraction) : 0;
      const systemEnergyJ = () => this.cells.reduce((sum, cell) => sum + (twoNode ? coreCapacityJK * cell.coreTempC + surfaceCapacityJK * cell.surfaceTempC : cellCapacityJK * cell.tempC), 0)
        + this.tapeSegments.reduce((sum, segment) => sum + segment.heatCapacityJK * segment.tempC, 0)
        + (closedEnvironment ? this.airZones.reduce((sum, zone) => sum + zone.heatCapacityJK * zone.tempC, 0) + this.caseNodes.reduce((sum, node) => sum + node.heatCapacityJK * node.tempC, 0) : 0);
      const thermalEnergyBeforeJ = systemEnergyJ();
      let ambientHeatLossW = 0;

      this.cells.forEach((cell, index) => {
        cell.coreTempC = Number.isFinite(cell.coreTempC) ? cell.coreTempC : cell.tempC;
        cell.surfaceTempC = Number.isFinite(cell.surfaceTempC) ? cell.surfaceTempC : cell.tempC;
        const g = cell.thermalGeometry;
        cell.thermal = {
          model: twoNode ? "two-node-core-surface" : "one-node-lumped", generationW: settings.thermal ? cell.powerW : 0,
          coolingClass: g.coolingClass, configuredCoolingFactor: g.configuredCoolingFactor, overrideCoolingFactor: cell.coolingFactor, appliedCoolingFactor: g.appliedCoolingFactor,
          surfaceAreasM2: { total: g.totalAreaM2, side: g.sideAreaM2, ends: g.endAreaM2, exposedSide: g.exposedSideM2, exposedEnds: g.exposedEndsM2, areaToInternalAir: g.areaToInternalAirM2, areaToCase: g.areaToCaseM2, areaToThermalMaterial: g.areaToThermalMaterialM2, areaDirectlyExposed: g.areaDirectlyExposedM2, effectiveCooling: g.effectiveExchangeAreaM2, blockedByCells: g.blockedByCellsM2, blockedByHolder: g.blockedByHolderM2, blockedByTape: g.blockedByTapeM2 },
          coreTemperatureC: cell.coreTempC, surfaceTemperatureC: cell.surfaceTempC, coreToSurfaceW: 0, convectionW: 0, ambientConvectionW: 0, airZoneNetW: 0, caseContactNetW: 0, holderContactNetW: 0,
          neighbourNetW: 0, tapeContactNetW: 0, conductanceWK: 0, airZoneId: this.airZones[g.airZoneIndex]?.id || null, caseNodeId: this.caseNodes[g.caseNodeIndex]?.id || null
        };
        if (settings.thermal) coreHeat[index] += cell.powerW;
        if (settings.thermal && twoNode) {
          const q = thermal.coreToSurfaceConductanceWK * (cell.coreTempC - cell.surfaceTempC);
          coreHeat[index] -= q; surfaceHeat[index] += q; coreG[index] += thermal.coreToSurfaceConductanceWK; surfaceG[index] += thermal.coreToSurfaceConductanceWK;
          cell.thermal.coreToSurfaceW = q;
        }
      });
      this.tapeSegments.forEach((segment, index) => {
        segment.thermal = { generationW: settings.thermal ? segment.powerW : 0, convectionW: 0, ambientConvectionW: 0, airZoneNetW: 0, contactNetW: 0, axialNetW: 0, tapeContactNetW: 0, conductanceWK: 0, contacts: [], axialLinks: [], tapeContactLinks: [], airZoneId: this.airZones[segment.airZoneIndex]?.id || null };
        if (settings.thermal) tapeHeat[index] += segment.powerW;
      });
      this.airZones.forEach(zone => zone.thermal = { cellHeatInW: 0, tapeHeatInW: 0, mixingNetW: 0, caseHeatOutW: 0, conductanceWK: 0 });
      this.caseNodes.forEach(node => node.thermal = { airHeatInW: 0, cellContactHeatInW: 0, lateralNetW: 0, ambientHeatOutW: 0, convectionW: 0, radiationW: 0, conductanceWK: 0 });

      if (settings.thermal) {
        this.cells.forEach((cell, index) => {
          const g = cell.thermalGeometry, nodeTemp = twoNode ? cell.surfaceTempC : cell.tempC;
          const h = thermal.environment === "forced" ? thermal.forcedAirCoefficientWm2K : thermal.environment === "open" ? model.thermal.heat_transfer_W_m2K : thermal.environment === "sealed-no-flow" ? thermal.stillAirCoefficientWm2K : thermal.cellAirCoefficientWm2K;
          const conductance = h * g.exposedAreaM2 * g.appliedCoolingFactor;
          const targetTemp = closedEnvironment ? this.airZones[g.airZoneIndex]?.tempC ?? ambient : ambient;
          const q = conductance * (nodeTemp - targetTemp);
          surfaceHeat[index] -= q; surfaceG[index] += conductance; cell.thermal.appliedConvectionCoefficientWm2K = h; cell.thermal.convectionTarget = closedEnvironment ? "local-air-zone" : "ambient"; cell.thermal.convectionW = q; cell.thermal.conductanceWK += conductance;
          if (closedEnvironment) {
            airHeat[g.airZoneIndex] += q; airG[g.airZoneIndex] += conductance; cell.thermal.airZoneNetW = -q; this.airZones[g.airZoneIndex].thermal.cellHeatInW += q;
          } else { ambientHeatLossW += q; cell.thermal.ambientConvectionW = q; }
          const contactAreaM2 = g.areaToCaseM2, directContactG = thermal.cellToCaseCoefficientWm2K * contactAreaM2;
          const holderContactG = thermal.cellToHolderCoefficientWm2K * g.areaToThermalMaterialM2, contactG = directContactG + holderContactG;
          if (closedEnvironment && contactG > 0) {
            const nodeIndex = g.caseNodeIndex, contactQ = contactG * (nodeTemp - this.caseNodes[nodeIndex].tempC);
            surfaceHeat[index] -= contactQ; caseHeat[nodeIndex] += contactQ; surfaceG[index] += contactG; caseG[nodeIndex] += contactG;
            cell.thermal.caseContactNetW = -contactQ * directContactG / contactG; cell.thermal.holderContactNetW = -contactQ * holderContactG / contactG;
            cell.thermal.conductanceWK += contactG; this.caseNodes[nodeIndex].thermal.cellContactHeatInW += contactQ;
          }
        });
        this.neighbourPairs.forEach(([a, b]) => {
          const leftTemp = twoNode ? this.cells[a].surfaceTempC : this.cells[a].tempC, rightTemp = twoNode ? this.cells[b].surfaceTempC : this.cells[b].tempC;
          const q = thermal.cellToCellConductanceWK * (leftTemp - rightTemp);
          surfaceHeat[a] -= q; surfaceHeat[b] += q; surfaceG[a] += thermal.cellToCellConductanceWK; surfaceG[b] += thermal.cellToCellConductanceWK;
          this.cells[a].thermal.neighbourNetW -= q; this.cells[b].thermal.neighbourNetW += q; this.cells[a].thermal.conductanceWK += thermal.cellToCellConductanceWK; this.cells[b].thermal.conductanceWK += thermal.cellToCellConductanceWK;
        });
        this.tapeSegments.forEach((segment, index) => {
          const areaM2 = 2 * (segment.widthMm + segment.thicknessMm) * segment.lengthMm * 1e-6;
          const h = thermal.environment === "forced" ? Math.max(thermal.tapeConvectionCoefficientWm2K, thermal.forcedAirCoefficientWm2K) : thermal.environment === "sealed-no-flow" ? Math.min(thermal.tapeConvectionCoefficientWm2K, thermal.stillAirCoefficientWm2K) : thermal.tapeConvectionCoefficientWm2K;
          const convectionG = h * areaM2, targetTemp = closedEnvironment ? this.airZones[segment.airZoneIndex]?.tempC ?? ambient : ambient;
          const heatOut = convectionG * (segment.tempC - targetTemp);
          tapeHeat[index] -= heatOut; tapeG[index] += convectionG; segment.thermal.appliedConvectionCoefficientWm2K = h; segment.thermal.convectionTarget = closedEnvironment ? "local-air-zone" : "ambient"; segment.thermal.convectionW = heatOut; segment.thermal.conductanceWK += convectionG;
          if (closedEnvironment) { airHeat[segment.airZoneIndex] += heatOut; airG[segment.airZoneIndex] += convectionG; segment.thermal.airZoneNetW = -heatOut; this.airZones[segment.airZoneIndex].thermal.tapeHeatInW += heatOut; }
          else { ambientHeatLossW += heatOut; segment.thermal.ambientConvectionW = heatOut; }
          segment.contactCells.forEach(cellIndex => {
            const cell = this.cells[cellIndex], cellTemp = twoNode ? cell.surfaceTempC : cell.tempC;
            const referenceAreaMm2 = 64, contactAreaMm2 = Math.min(segment.widthMm ** 2, Math.PI * (cell.thermalGeometry.diameterMm * .5) ** 2);
            const conductance = thermal.tapeCellConductanceWK * clamp(contactAreaMm2 / referenceAreaMm2, .1, 4), q = conductance * (segment.tempC - cellTemp);
            tapeHeat[index] -= q; surfaceHeat[cellIndex] += q; tapeG[index] += conductance; surfaceG[cellIndex] += conductance;
            segment.thermal.contactNetW -= q; segment.thermal.contacts.push({ cellId: String(cell.id), contactAreaMm2, conductanceWK: conductance, heatFlowToCellW: q });
            cell.thermal.tapeContactNetW += q; cell.thermal.conductanceWK += conductance;
          });
        });
        this.tapeThermalAxialPairs.forEach(([leftIndex, rightIndex]) => {
          const left = this.tapeSegments[leftIndex], right = this.tapeSegments[rightIndex];
          const resistance = (left.lengthMm * .0005) / Math.max(1e-12, left.material.thermalConductivity * left.areaM2) + (right.lengthMm * .0005) / Math.max(1e-12, right.material.thermalConductivity * right.areaM2);
          const conductance = 1 / Math.max(1e-12, resistance), q = conductance * (left.tempC - right.tempC);
          tapeHeat[leftIndex] -= q; tapeHeat[rightIndex] += q; tapeG[leftIndex] += conductance; tapeG[rightIndex] += conductance;
          left.thermal.axialNetW -= q; right.thermal.axialNetW += q; left.thermal.axialLinks.push({ segmentId: right.id, conductanceWK: conductance, heatFlowOutW: q }); right.thermal.axialLinks.push({ segmentId: left.id, conductanceWK: conductance, heatFlowOutW: -q });
          left.thermal.conductanceWK += conductance; right.thermal.conductanceWK += conductance;
        });
        this.tapeThermalContactPairs.forEach(contact => {
          const left = this.tapeSegments[contact.leftIndex], right = this.tapeSegments[contact.rightIndex];
          const referenceAreaMm2 = Math.max(1, Math.min(left.widthMm, right.widthMm) ** 2), conductance = thermal.tapeToTapeContactConductanceWK * clamp(contact.contactAreaMm2 / referenceAreaMm2, .05, 8);
          if (!(conductance > 0)) return;
          const q = conductance * (left.tempC - right.tempC), link = { kind: contact.kind, insulated: contact.insulated, electricallyConnected: false, xMm: contact.xMm, yMm: contact.yMm, overlapMm: contact.overlapMm, contactAreaMm2: contact.contactAreaMm2, conductanceWK: conductance };
          tapeHeat[contact.leftIndex] -= q; tapeHeat[contact.rightIndex] += q; tapeG[contact.leftIndex] += conductance; tapeG[contact.rightIndex] += conductance;
          left.thermal.tapeContactNetW -= q; right.thermal.tapeContactNetW += q; left.thermal.tapeContactLinks.push({ segmentId: right.id, ...link, heatFlowOutW: q }); right.thermal.tapeContactLinks.push({ segmentId: left.id, ...link, heatFlowOutW: -q });
          left.thermal.conductanceWK += conductance; right.thermal.conductanceWK += conductance;
        });
        if (closedEnvironment) {
          this.airZonePairs.forEach(([a, b]) => {
            const conductance = thermal.airMixingConductanceWK * (thermal.environment === "sealed-no-flow" ? .25 : thermal.environment === "forced" ? 2 : 1), q = conductance * (this.airZones[a].tempC - this.airZones[b].tempC);
            airHeat[a] -= q; airHeat[b] += q; airG[a] += conductance; airG[b] += conductance; this.airZones[a].thermal.mixingNetW -= q; this.airZones[b].thermal.mixingNetW += q;
            this.airZones[a].thermal.conductanceWK += conductance; this.airZones[b].thermal.conductanceWK += conductance;
          });
          this.airZones.forEach((zone, index) => {
            const conductance = thermal.airToCaseCoefficientWm2K * zone.faceAreaM2, q = conductance * (zone.tempC - this.caseNodes[index].tempC);
            airHeat[index] -= q; caseHeat[index] += q; airG[index] += conductance; caseG[index] += conductance; zone.thermal.caseHeatOutW = q; zone.thermal.conductanceWK += conductance; this.caseNodes[index].thermal.airHeatInW += q;
          });
          this.caseNodePairs.forEach(([a, b]) => {
            const conductance = thermal.caseLateralConductanceWK, q = conductance * (this.caseNodes[a].tempC - this.caseNodes[b].tempC);
            caseHeat[a] -= q; caseHeat[b] += q; caseG[a] += conductance; caseG[b] += conductance; this.caseNodes[a].thermal.lateralNetW -= q; this.caseNodes[b].thermal.lateralNetW += q;
            this.caseNodes[a].thermal.conductanceWK += conductance; this.caseNodes[b].thermal.conductanceWK += conductance;
          });
          this.caseNodes.forEach((node, index) => {
            const convectionG = thermal.caseToAmbientCoefficientWm2K * node.areaM2, meanK = (node.tempC + ambient) * .5 + 273.15;
            const radiationG = 4 * thermal.caseEmissivity * 5.670374419e-8 * Math.max(1, meanK) ** 3 * node.areaM2;
            const convectionW = convectionG * (node.tempC - ambient), radiationW = radiationG * (node.tempC - ambient), q = convectionW + radiationW;
            caseHeat[index] -= q; caseG[index] += convectionG + radiationG; ambientHeatLossW += q; node.thermal.convectionW = convectionW; node.thermal.radiationW = radiationW; node.thermal.ambientHeatOutW = q; node.thermal.conductanceWK += convectionG + radiationG;
          });
        }
      }

      const taus = [];
      this.cells.forEach((cell, index) => {
        if (twoNode) { if (coreG[index] > 0) taus.push(coreCapacityJK / coreG[index]); if (surfaceG[index] > 0) taus.push(surfaceCapacityJK / surfaceG[index]); }
        else if (coreG[index] + surfaceG[index] > 0) taus.push(cellCapacityJK / (coreG[index] + surfaceG[index]));
      });
      this.tapeSegments.forEach((segment, index) => { if (tapeG[index] > 0) taus.push(segment.heatCapacityJK / tapeG[index]); });
      if (closedEnvironment) { this.airZones.forEach((zone, index) => { if (airG[index] > 0) taus.push(zone.heatCapacityJK / airG[index]); }); this.caseNodes.forEach((node, index) => { if (caseG[index] > 0) taus.push(node.heatCapacityJK / caseG[index]); }); }
      const minTauS = taus.length ? Math.min(...taus) : Infinity, stableDt = Number.isFinite(minTauS) ? Math.max(.0001, .1 * minTauS) : requestedDt;
      const dt = Math.max(.0001, Math.min(requestedDt, stableDt));
      if (dt < requestedDt * .999 && !this.adaptiveStepReported) { this.adaptiveStepReported = true; this.logEvent("NUMERYKA", `Automatycznie zmniejszono krok z ${fmt(requestedDt, 4)} s do ${fmt(dt, 4)} s; granica stabilności termicznej 0,1τ, τmin=${fmt(minTauS, 5)} s.`); }
      this.cells.forEach((cell, index) => {
        const limits = this.cellCurrentLimits(cell, cell.currentA < 0 ? "charge" : "discharge"), current = Math.abs(cell.currentA), standardRatio = current / Math.max(.0001, limits.standardA), maximumRatio = current / Math.max(.0001, limits.maximumA);
        cell.currentExposure.throughputAh += current * dt / 3600; if (standardRatio > 1) cell.currentExposure.secondsAboveStandard += dt; if (maximumRatio > 1) cell.currentExposure.secondsAboveMaximum += dt;
        cell.currentExposure.peakStandardRatio = Math.max(cell.currentExposure.peakStandardRatio, standardRatio); cell.currentExposure.peakMaximumRatio = Math.max(cell.currentExposure.peakMaximumRatio, maximumRatio);
        const referenceCapacityAh = Math.max(.001, cell.referenceCapacityAh || cell.capacityAh); cell.absoluteChargeAh = clamp(cell.absoluteChargeAh - cell.currentA * dt / 3600, 0, referenceCapacityAh);
        const tauS = Math.max(1e-6, cell.r1Ohm * cell.c1F), decay = Math.exp(-dt / tauS); cell.polarizationVoltageV = cell.polarizationVoltageV * decay + cell.currentA * cell.r1Ohm * (1 - decay); cell.polarizationEnergyJ = .5 * cell.c1F * cell.polarizationVoltageV ** 2;
        if (twoNode) { cell.coreTempC += coreHeat[index] / coreCapacityJK * dt; cell.surfaceTempC += surfaceHeat[index] / surfaceCapacityJK * dt; cell.tempC = cell.coreTempC; }
        else { cell.tempC += (coreHeat[index] + surfaceHeat[index]) / cellCapacityJK * dt; cell.coreTempC = cell.tempC; cell.surfaceTempC = cell.tempC; }
        cell.thermal.coreTemperatureC = cell.coreTempC; cell.thermal.surfaceTemperatureC = cell.surfaceTempC; this.updateCellSocViews(cell); cell.lossEnergyWh += cell.powerW * dt / 3600;
      });
      this.tapeSegments.forEach((segment, index) => { segment.tempC += tapeHeat[index] / Math.max(1e-6, segment.heatCapacityJK) * dt; segment.lossEnergyWh += segment.powerW * dt / 3600; });
      if (closedEnvironment) { this.airZones.forEach((zone, index) => zone.tempC += airHeat[index] / Math.max(1e-6, zone.heatCapacityJK) * dt); this.caseNodes.forEach((node, index) => node.tempC += caseHeat[index] / Math.max(1e-6, node.heatCapacityJK) * dt); }
      const thermalStoredRateW = settings.thermal ? (systemEnergyJ() - thermalEnergyBeforeJ) / dt : 0, generatedW = settings.thermal ? electrical.cellR0LossW + electrical.cellR1LossW + electrical.tapeLossW : 0;
      const thermalResidualW = settings.thermal ? generatedW - (thermalStoredRateW + ambientHeatLossW) : null, thermalScaleW = Math.max(1e-9, generatedW + Math.abs(thermalStoredRateW) + Math.abs(ambientHeatLossW));
      Object.assign(this.energyBalance, { dtS: dt, thermalGeneratedW: generatedW, thermalStoredRateW, ambientHeatLossW, thermalResidualW, thermalErrorPercent: settings.thermal ? 100 * Math.abs(thermalResidualW) / thermalScaleW : null, minThermalTimeConstantS: minTauS });
      return { dt, valid: true };
    }

    updateBms(dt, packCurrent) {
      const settings = this.settings();
      if (!settings.bmsEnabled || !this.bms.connected) return;
      const mode = settings.mode, maxT = Math.max(...this.cells.map(c => c.tempC)), minT = Math.min(...this.cells.map(c => c.tempC));
      const sectionVoltages = this.sectionBmsVoltages?.length === this.package.series ? this.sectionBmsVoltages : this.groupVoltages;
      const maximumSectionVoltage = Math.max(...sectionVoltages), minimumSectionVoltage = Math.min(...sectionVoltages);
      const checks = [
        { key: "OV", active: mode === "charge" && maximumSectionVoltage > num("stage4BmsVmax", 4.2), value: maximumSectionVoltage, threshold: num("stage4BmsVmax", 4.2), delay: num("stage4BmsVmaxDelay", 1), element: `S${sectionVoltages.indexOf(maximumSectionVoltage) + 1}` },
        { key: "UV", active: mode === "discharge" && minimumSectionVoltage < num("stage4BmsVmin", 2.8), value: minimumSectionVoltage, threshold: num("stage4BmsVmin", 2.8), delay: num("stage4BmsVminDelay", 1), element: `S${sectionVoltages.indexOf(minimumSectionVoltage) + 1}` },
        { key: "OC_DISCHARGE", active: mode === "discharge" && packCurrent > num("stage4BmsDischargeA", 100), value: packCurrent, threshold: num("stage4BmsDischargeA", 100), delay: num("stage4BmsDischargeDelay", 2), element: "pakiet" },
        { key: "OC_CHARGE", active: mode === "charge" && -packCurrent > num("stage4BmsChargeA", 50), value: -packCurrent, threshold: num("stage4BmsChargeA", 50), delay: num("stage4BmsChargeDelay", 2), element: "pakiet" },
        { key: "OT_DISCHARGE", active: settings.temperatureProtection && mode === "discharge" && maxT > num("stage4BmsDischargeTmax", 80), value: maxT, threshold: num("stage4BmsDischargeTmax", 80), delay: num("stage4BmsDischargeTmaxDelay", 2), element: this.hottestCellLabel() },
        { key: "OT_CHARGE", active: settings.temperatureProtection && mode === "charge" && maxT > num("stage4BmsChargeTmax", 45), value: maxT, threshold: num("stage4BmsChargeTmax", 45), delay: num("stage4BmsChargeTmaxDelay", 2), element: this.hottestCellLabel() },
        { key: "UT_CHARGE", active: settings.temperatureProtection && mode === "charge" && minT < num("stage4BmsChargeTmin", 0), value: minT, threshold: num("stage4BmsChargeTmin", 0), delay: num("stage4BmsChargeTminDelay", 1), element: this.coldestCellLabel() },
        { key: "UT_DISCHARGE", active: settings.temperatureProtection && mode === "discharge" && minT < num("stage4BmsDischargeTmin", -20), value: minT, threshold: num("stage4BmsDischargeTmin", -20), delay: num("stage4BmsDischargeTminDelay", 1), element: this.coldestCellLabel() }
      ];
      for (const check of checks) {
        this.bms.timers[check.key] = check.active ? (this.bms.timers[check.key] || 0) + dt : 0;
        if (check.active && this.bms.timers[check.key] >= check.delay) { this.tripBms(check); return; }
      }
      this.bms.state = this.bmsBalanceBranches.length ? "BALANSOWANIE" : mode === "charge" ? "ŁADOWANIE" : "ROZŁADOWANIE";
    }

    tripBms(check) {
      const description = this.describeBmsTrip(check);
      this.bms.connected = false; this.bms.state = "ODŁĄCZENIE";
      const event = this.logEvent("BMS", `${check.key}: ${check.element}, wartość ${fmt(check.value, 3)}, próg ${fmt(check.threshold, 3)}`, {
        protection: check.key,
        threshold: check.threshold,
        value: check.value,
        delayS: check.delay,
        timerS: this.bms.timers[check.key] || 0,
        element: check.element,
        description
      });
      this.bms.lastTrip = { timeS: this.time, type: check.key, threshold: check.threshold, value: check.value, element: check.element, eventId: event.id, reference: event.reference };
      this.stop(`Zadziałał wirtualny BMS: ${check.key} (${check.element}).`, event);
    }

    reconnectBms() {
      this.solveElectrical(0);
      const voltageHysteresis = num("stage4BmsVoltageHysteresis", .1), tempHysteresis = num("stage4BmsTempHysteresis", 5);
      const sectionVoltages = this.sectionBmsVoltages?.length === this.package.series ? this.sectionBmsVoltages : this.groupVoltages;
      const maxGroup = Math.max(...sectionVoltages), minGroup = Math.min(...sectionVoltages), maxTemp = Math.max(...this.cells.map(c => c.tempC)), minTemp = Math.min(...this.cells.map(c => c.tempC));
      const settings = this.settings(), mode = settings.mode;
      const voltageSafe = mode === "charge"
        ? maxGroup <= num("stage4BmsVmax", 4.2) - voltageHysteresis
        : minGroup >= num("stage4BmsVmin", 2.8) + voltageHysteresis;
      const temperatureSafe = !settings.temperatureProtection || (mode === "charge"
        ? maxTemp <= num("stage4BmsChargeTmax", 45) - tempHysteresis && minTemp >= num("stage4BmsChargeTmin", 0) + tempHysteresis
        : maxTemp <= num("stage4BmsDischargeTmax", 80) - tempHysteresis && minTemp >= num("stage4BmsDischargeTmin", -20) + tempHysteresis);
      if (!voltageSafe || !temperatureSafe) {
        this.setState("BMS pozostaje odłączony: wartości nie wróciły do zakresu uwzględniającego histerezę.", "tripped");
        return;
      }
      this.bms.connected = true; this.bms.state = "CZUWANIE"; this.bms.timers = {};
      if (this.status === "finished") this.status = "paused";
      this.logEvent("BMS", "Ręczne ponowne załączenie po sprawdzeniu progów");
      this.setState("BMS ponownie załączony. Uruchom lub kontynuuj symulację."); this.renderAll();
    }

    checkEndConditions(packCurrent) {
      const settings = this.settings(), maxT = Math.max(...this.cells.map(c => c.tempC)), minT = Math.min(...this.cells.map(c => c.tempC)), minSoc = Math.min(...this.cells.map(c => c.soc));
      if (this.time >= settings.durationS) return this.stop("Osiągnięto maksymalny czas symulacji.");
      if (settings.mode === "discharge" && minSoc <= .001) return this.stop("Ogniwo osiągnęło minimalny SOC.");
      if (settings.mode === "charge" && this.chargePhase === "CV" && Math.abs(packCurrent) <= settings.cvEndA) return this.stop("Ładowanie CC/CV zakończone: prąd CV spadł poniżej progu.");
      const lowVoltageCell = settings.mode === "discharge" ? this.cells.find(cell => cell.voltageV <= cell.voltageMinV) : null;
      const highVoltageCell = settings.mode === "charge" ? this.cells.find(cell => cell.voltageV >= cell.voltageMaxV * 1.005) : null;
      if (lowVoltageCell) return this.stop(`Ogniwo ${lowVoltageCell.id} osiągnęło indywidualne napięcie minimalne.`);
      if (highVoltageCell) return this.stop(`Ogniwo ${highVoltageCell.id} przekroczyło indywidualne napięcie maksymalne.`);
      if (settings.temperatureProtection) {
        const safeMax = settings.mode === "charge" ? num("stage4BmsChargeTmax", 45) : num("stage4BmsDischargeTmax", 80);
        const safeMin = settings.mode === "charge" ? num("stage4BmsChargeTmin", 0) : num("stage4BmsDischargeTmin", -20);
        if (maxT > safeMax) return this.stop(`Przekroczono bezpieczną temperaturę ${fmt(maxT, 1)}°C. Thermal runaway nie jest symulowany.`);
        if (minT < safeMin) return this.stop(`Temperatura ${fmt(minT, 1)}°C spadła poniżej dopuszczalnego minimum dla trybu ${settings.mode === "charge" ? "ładowania" : "rozładowania"}.`);
      }
      // Przekroczenie katalogowego prądu jest widoczne w panelu sterowania,
      // ale nie zatrzymuje symulacji. Pozwala to badać zachowanie pakietu poza
      // zakresem katalogowym bez mieszania tego ostrzeżenia z awarią solvera.
    }

    validateFinite() {
      return Number.isFinite(this.packVoltage) && this.packVoltage >= -1
        && this.cells.every(c => [c.soc, c.absoluteChargeAh, c.availableChargeAh, c.temperatureLimitedChargeAh, c.referenceSocPercent, c.availableSocPercent, c.tempC, c.coreTempC, c.surfaceTempC, c.voltageV, c.currentA, c.r0Ohm, c.r1Ohm, c.c1F, c.polarizationVoltageV].every(Number.isFinite) && c.r0Ohm > 0 && c.r1Ohm > 0 && c.c1F > 0)
        && this.tapeSegments.every(t => [t.tempC, t.currentA, t.resistanceOhm, t.powerW].every(Number.isFinite) && t.resistanceOhm > 0)
        && this.airZones.every(zone => Number.isFinite(zone.tempC) && zone.heatCapacityJK > 0)
        && this.caseNodes.every(node => Number.isFinite(node.tempC) && node.heatCapacityJK > 0)
        && this.bmsBalanceBranches.every(branch => [branch.resistanceOhm, branch.currentA, branch.powerW].every(Number.isFinite) && branch.resistanceOhm > 0);
    }

    updateWeakPoints() {
      const candidates = {
        hottest_cell: this.maxItem(this.cells, c => c.tempC), hottest_strip: this.maxItem(this.tapeSegments, s => s.tempC),
        highest_loss: this.maxItem([...this.cells, ...this.tapeSegments], e => e.powerW), highest_cell_current: this.maxItem(this.cells, c => Math.abs(c.currentA)),
        lowest_voltage: this.minItem(this.cells, c => c.voltageV), lowest_soc: this.minItem(this.cells, c => c.soc),
        highest_strip_density: this.maxItem(this.tapeSegments, s => Math.abs(s.currentA) / Math.max(1e-12, s.areaM2))
      };
      Object.entries(candidates).forEach(([key, item]) => {
        if (!item) return; const value = key.startsWith("lowest") ? -item.value : item.value;
        if (!this.weakRecords[key] || value > this.weakRecords[key].comparison) this.weakRecords[key] = { comparison: value, value: item.value, id: item.item.id, timeS: this.time };
      });
    }
    updateThermalMaxima() {
      const register = (key, item, temperatureC, extra = {}) => {
        if (!item || !Number.isFinite(temperatureC)) return;
        const current = this.thermalMaxima[key];
        if (!current || temperatureC > current.temperatureC) this.thermalMaxima[key] = { elementType: key, id: String(item.id), temperatureC, timeS: this.time, ...extra };
      };
      const hottestCore = this.maxItem(this.cells, cell => cell.coreTempC);
      const hottestSurface = this.maxItem(this.cells, cell => cell.surfaceTempC);
      const hottestTape = this.maxItem(this.tapeSegments, segment => segment.tempC);
      const hottestAir = this.maxItem(this.airZones, zone => zone.tempC);
      const hottestCase = this.maxItem(this.caseNodes, node => node.tempC);
      if (hottestCore) register("cellCore", hottestCore.item, hottestCore.value, { section: hottestCore.item.section + 1, positionMm: { x: hottestCore.item.x, y: hottestCore.item.y } });
      if (hottestSurface) register("cellSurface", hottestSurface.item, hottestSurface.value, { section: hottestSurface.item.section + 1, positionMm: { x: hottestSurface.item.x, y: hottestSurface.item.y } });
      if (hottestTape) register("tape", hottestTape.item, hottestTape.value, { side: hottestTape.item.side, tapeId: hottestTape.item.tapeId, positionMm: { x: (hottestTape.item.x1 + hottestTape.item.x2) * .5, y: (hottestTape.item.y1 + hottestTape.item.y2) * .5 } });
      if (hottestAir) register("air", hottestAir.item, hottestAir.value, { zone: { col: hottestAir.item.col, row: hottestAir.item.row }, boundsMm: { x1: hottestAir.item.x1, y1: hottestAir.item.y1, x2: hottestAir.item.x2, y2: hottestAir.item.y2 } });
      if (hottestCase) register("case", hottestCase.item, hottestCase.value, { boundsMm: { x1: hottestCase.item.x1, y1: hottestCase.item.y1, x2: hottestCase.item.x2, y2: hottestCase.item.y2 } });
      if (!this.thermalMaxima.lead) this.thermalMaxima.lead = { elementType: "lead", modeled: false, temperatureC: null, reason: "Idealne wyprowadzenia PACK nie mają geometrii ani pojemności cieplnej." };
    }
    maxItem(items, getter) { if (!items.length) return null; return items.reduce((best, item) => getter(item) > best.value ? { item, value: getter(item) } : best, { item: items[0], value: getter(items[0]) }); }
    minItem(items, getter) { if (!items.length) return null; return items.reduce((best, item) => getter(item) < best.value ? { item, value: getter(item) } : best, { item: items[0], value: getter(items[0]) }); }
    hottestCellLabel() { return String(this.maxItem(this.cells, c => c.tempC)?.item.id || "ogniwo"); }
    coldestCellLabel() { return String(this.minItem(this.cells, c => c.tempC)?.item.id || "ogniwo"); }

    recordHistory(force = false) {
      const settings = this.settings();
      const earlyWindowS = Math.min(30, settings.durationS * .02);
      const interval = this.time <= earlyWindowS ? Math.max(.05, Math.min(.5, settings.dt)) : Math.max(1, settings.durationS / 1500);
      if (!force && this.history.length && this.time - this.history[this.history.length - 1].timeS < interval) return;
      this.history.push({
        timeS: this.time, voltageV: this.packVoltage,
        commandedPackCurrentA: this.commandedPackCurrentA, solvedPackCurrentA: this.solvedPackCurrentA,
        currentA: this.solvedPackCurrentA, powerW: this.packVoltage * this.solvedPackCurrentA,
        energyWh: this.energyWh, lossWh: this.lossEnergyWh, balanceEnergyWh: this.bmsBalanceEnergyWh,
        maxTempC: Math.max(...this.cells.map(c => c.coreTempC), ...this.cells.map(c => c.surfaceTempC), ...this.tapeSegments.map(t => t.tempC), ...this.airZones.map(z => z.tempC), ...this.caseNodes.map(n => n.tempC)),
        maxCellCoreTempC: Math.max(...this.cells.map(c => c.coreTempC)), maxCellSurfaceTempC: Math.max(...this.cells.map(c => c.surfaceTempC)),
        maxTapeTempC: this.tapeSegments.length ? Math.max(...this.tapeSegments.map(t => t.tempC)) : null,
        maxAirTempC: this.airZones.length ? Math.max(...this.airZones.map(z => z.tempC)) : null, maxCaseTempC: this.caseNodes.length ? Math.max(...this.caseNodes.map(n => n.tempC)) : null,
        minSoc: Math.min(...this.cells.map(c => c.soc)), maxSoc: Math.max(...this.cells.map(c => c.soc)), groupVoltages: [...this.groupVoltages], sectionBmsVoltages: [...(this.sectionBmsVoltages || [])],
        cells: this.cells.map(c => [c.id, c.voltageV, c.currentA, c.soc, c.coreTempC, c.surfaceTempC, c.localVoltageV, c.ocvV, c.r0Ohm, c.r1Ohm, c.c1F, c.polarizationVoltageV, c.polarizationEnergyJ, c.absoluteChargeAh, c.availableChargeAh, c.temperatureLimitedChargeAh, c.availableSocPercent, c.r0LossPowerW, c.r1LossPowerW, c.powerW, c.lossEnergyWh, c.currentExposure.secondsAboveStandard, c.currentExposure.secondsAboveMaximum, c.currentExposure.peakStandardRatio, c.currentExposure.peakMaximumRatio]),
        strips: this.tapeSegments.map(t => [t.id, t.currentA, t.tempC, t.voltageV, t.resistanceOhm, t.powerW, t.lossEnergyWh]),
        airZones: this.airZones.map(zone => [zone.id, zone.tempC]), caseNodes: this.caseNodes.map(node => [node.id, node.tempC]),
        load: { ...this.loadCommandDescriptor(this.commandedPackCurrentA), commandedPackCurrentA: this.commandedPackCurrentA, solvedPackCurrentA: this.solvedPackCurrentA, solvedPowerW: this.packVoltage * this.solvedPackCurrentA, mode: settings.mode, loadMode: settings.loadMode, chargePhase: this.chargePhase },
        externalLeads: this.externalLeads.map(lead => [lead.id, lead.currentA, lead.voltageV, true, lead.powerW]),
        balanceBranches: this.bmsBalanceBranches.map(branch => [branch.id, branch.section + 1, branch.attachmentCellId, branch.currentA, branch.voltageV, branch.resistanceOhm, branch.powerW, branch.energyWh]),
        sectionCurrentBalance: this.sectionCurrentBalance?.map(item => ({ ...item })) || [],
        electricalValidation: this.lastElectricalValidation ? { ...this.lastElectricalValidation } : null,
        energyBalance: this.energyBalance ? { ...this.energyBalance } : null,
        nodeVoltagesV: Array.from(this.nodeVoltages || []),
        bms: { connected: this.bms.connected, state: this.bms.state, timers: { ...this.bms.timers }, lastTrip: this.bms.lastTrip ? { ...this.bms.lastTrip } : null },
        solver: this.lastSolverDiagnostics ? {
          converged: this.lastSolverDiagnostics.converged,
          solverMethod: this.lastSolverDiagnostics.solverMethod,
          iterationsUsed: this.lastSolverDiagnostics.iterationsUsed,
          finalMaxDiffV: this.lastSolverDiagnostics.finalMaxDiffV,
          pcgRelativeResidual: this.lastSolverDiagnostics.pcgRelativeResidual,
          kclToleranceA: this.lastSolverDiagnostics.kclToleranceA,
          currentInjectionSumA: this.lastSolverDiagnostics.currentInjectionSumA,
          maxKclResidualA: this.lastSolverDiagnostics.maxKclResidualA,
          commandedPackCurrentA: this.lastSolverDiagnostics.commandedPackCurrentA,
          solvedPackCurrentA: this.lastSolverDiagnostics.solvedPackCurrentA,
          resistanceMinOhm: this.lastSolverDiagnostics.resistanceMinOhm,
          resistanceMaxOhm: this.lastSolverDiagnostics.resistanceMaxOhm
        } : null
      });
    }

    eventSnapshot() {
      const cells = this.cells || [];
      const sectionVoltages = this.sectionBmsVoltages?.length === this.package?.series ? this.sectionBmsVoltages : this.groupVoltages || [];
      const values = (items, selector) => items.map(selector).filter(Number.isFinite);
      const cellVoltages = values(cells, cell => cell.voltageV);
      const temperatures = values(cells, cell => cell.tempC);
      const socValues = values(cells, cell => cell.soc);
      return {
        configuration: this.package ? `${this.package.series}S${this.package.parallel}P` : "brak modelu",
        mode: this.settingsCache?.mode || $("stage4Mode")?.value || "discharge",
        status: this.status,
        bmsState: this.bms?.state || "brak",
        bmsConnected: Boolean(this.bms?.connected),
        packVoltageV: this.packVoltage,
        commandedCurrentA: this.commandedPackCurrentA,
        solvedCurrentA: this.solvedPackCurrentA,
        packPowerW: Number.isFinite(this.packVoltage) && Number.isFinite(this.solvedPackCurrentA) ? this.packVoltage * this.solvedPackCurrentA : null,
        minSectionVoltageV: sectionVoltages.length ? Math.min(...sectionVoltages) : null,
        maxSectionVoltageV: sectionVoltages.length ? Math.max(...sectionVoltages) : null,
        minCellVoltageV: cellVoltages.length ? Math.min(...cellVoltages) : null,
        maxCellVoltageV: cellVoltages.length ? Math.max(...cellVoltages) : null,
        minTemperatureC: temperatures.length ? Math.min(...temperatures) : null,
        maxTemperatureC: temperatures.length ? Math.max(...temperatures) : null,
        minSocPercent: socValues.length ? Math.min(...socValues) : null,
        maxSocPercent: socValues.length ? Math.max(...socValues) : null
      };
    }

    describeStatusEvent(message, type = "STATUS") {
      const snapshot = this.eventSnapshot();
      const mode = snapshot.mode === "charge" ? "ładowanie CC/CV" : "rozładowanie";
      return [
        `${type}: ${message}`,
        `Czas symulacji: ${fmt(this.time, 3)} s. Stan solvera: ${snapshot.status}. Tryb: ${mode}.`,
        `Pakiet: ${snapshot.configuration}; napięcie ${fmt(snapshot.packVoltageV, 3)} V; prąd zadany ${fmt(snapshot.commandedCurrentA, 3)} A; prąd rozwiązany ${fmt(snapshot.solvedCurrentA, 3)} A; moc ${fmt(snapshot.packPowerW, 2)} W.`,
        `Sekcje: minimum ${fmt(snapshot.minSectionVoltageV, 4)} V, maksimum ${fmt(snapshot.maxSectionVoltageV, 4)} V. Ogniwa: minimum ${fmt(snapshot.minCellVoltageV, 4)} V, maksimum ${fmt(snapshot.maxCellVoltageV, 4)} V.`,
        `Temperatura ogniw: ${fmt(snapshot.minTemperatureC, 2)}–${fmt(snapshot.maxTemperatureC, 2)}°C. SOC: ${fmt(snapshot.minSocPercent, 2)}–${fmt(snapshot.maxSocPercent, 2)}%.`,
        `BMS: ${snapshot.bmsConnected ? "połączony" : "odłączony"}, stan ${snapshot.bmsState}.`
      ].join("\n");
    }

    describeBmsTrip(check) {
      const names = {
        OV: "przekroczenie maksymalnego napięcia sekcji",
        UV: "spadek napięcia sekcji poniżej minimum",
        OC_DISCHARGE: "przekroczenie maksymalnego prądu rozładowania pakietu",
        OC_CHARGE: "przekroczenie maksymalnego prądu ładowania pakietu",
        OT_DISCHARGE: "przekroczenie maksymalnej temperatury podczas rozładowania",
        OT_CHARGE: "przekroczenie maksymalnej temperatury podczas ładowania",
        UT_CHARGE: "spadek temperatury poniżej minimum ładowania",
        UT_DISCHARGE: "spadek temperatury poniżej minimum rozładowania"
      };
      const units = check.key === "OV" || check.key === "UV" ? "V" : check.key.startsWith("OC_") ? "A" : "°C";
      const lowerLimit = check.key === "UV" || check.key.startsWith("UT_");
      const operator = lowerLimit ? "<" : ">";
      const difference = lowerLimit ? check.threshold - check.value : check.value - check.threshold;
      const differencePercent = Math.abs(check.threshold) > 1e-9 ? difference / Math.abs(check.threshold) * 100 : null;
      const snapshot = this.eventSnapshot();
      const mode = snapshot.mode === "charge" ? "ładowanie CC/CV" : "rozładowanie";
      return [
        `Zabezpieczenie ${check.key}: ${names[check.key] || "przekroczenie skonfigurowanego limitu"}.`,
        `Warunek wyzwolenia: ${fmt(check.value, 4)} ${units} ${operator} ${fmt(check.threshold, 4)} ${units}. Granica została przekroczona o ${fmt(difference, 4)} ${units}${Number.isFinite(differencePercent) ? ` (${fmt(differencePercent, 2)}%)` : ""}.`,
        `Warunek utrzymywał się przez ${fmt(this.bms.timers[check.key] || 0, 3)} s przy wymaganym opóźnieniu ${fmt(check.delay, 3)} s. Element wskazany przez pomiar: ${check.element}.`,
        `Chwila zadziałania: ${fmt(this.time, 3)} s. Tryb pracy: ${mode}. Konfiguracja: ${snapshot.configuration}.`,
        `Pakiet: napięcie ${fmt(snapshot.packVoltageV, 3)} V; prąd zadany ${fmt(snapshot.commandedCurrentA, 3)} A; prąd rozwiązany ${fmt(snapshot.solvedCurrentA, 3)} A; moc ${fmt(snapshot.packPowerW, 2)} W.`,
        `Napięcia sekcji: minimum ${fmt(snapshot.minSectionVoltageV, 4)} V, maksimum ${fmt(snapshot.maxSectionVoltageV, 4)} V. Napięcia ogniw: minimum ${fmt(snapshot.minCellVoltageV, 4)} V, maksimum ${fmt(snapshot.maxCellVoltageV, 4)} V.`,
        `Temperatury ogniw: minimum ${fmt(snapshot.minTemperatureC, 2)}°C, maksimum ${fmt(snapshot.maxTemperatureC, 2)}°C. SOC: minimum ${fmt(snapshot.minSocPercent, 2)}%, maksimum ${fmt(snapshot.maxSocPercent, 2)}%.`,
        "Skutek: wirtualny BMS otworzył tor prądowy, ustawił stan ODŁĄCZENIE i zatrzymał dalszy bieg symulacji. Stan elektryczny i cieplny z chwili zadziałania został zachowany do analizy."
      ].join("\n");
    }

    eventPrefix(type) {
      if (type === "STATUS" || type === "KONIEC") return "SIM";
      if (type === "BMS") return "BMS";
      if (type === "TOPOLOGIA" || type === "BŁĄD TOPOLOGII") return "TOP";
      if (type === "SOLVER" || type === "NUMERYKA") return "SOL";
      if (type === "WALIDACJA ELEKTRYCZNA" || type === "BILANS ENERGII") return "VAL";
      if (type === "DANE") return "DAT";
      if (type === "ŁADOWARKA") return "CHG";
      if (type === "EDYCJA") return "EDT";
      if (type === "TEST KONTROLNY") return "TST";
      return "EVT";
    }

    logEvent(type, message, details = {}) {
      const sequence = ++this.eventSequence;
      const category = this.eventPrefix(type);
      const categorySequence = (this.eventCategoryCounters[category] || 0) + 1;
      this.eventCategoryCounters[category] = categorySequence;
      const reference = `${category}-${String(categorySequence).padStart(3, "0")}`;
      const event = { ...details, id: `stage4-event-${sequence}`, category, categorySequence, reference, timeS: this.time, type, message };
      if (!event.description) event.description = this.describeStatusEvent(message, type);
      this.events.push(event);
      if (["TOPOLOGIA", "BŁĄD TOPOLOGII", "SOLVER", "NUMERYKA", "BMS"].includes(type)) {
        console.groupCollapsed(`[Etap 4 · ${fmt(this.time, 3)} s] ${type}: ${message}`);
        if (details.diagnostics) console.log("Diagnostyka:", details.diagnostics);
        else if (Object.keys(details).length) console.log("Szczegóły:", details);
        console.groupEnd();
      }
      return event;
    }

    openEventReference(eventId) {
      if (!eventId || !this.events.some(event => event.id === eventId)) return;
      this.activeTab = "events";
      this.activateTab("events");
      document.querySelector(".stage4-stage")?.classList.remove("stage4-results-collapsed");
      const toggle = $("stage4ResultsToggle");
      if (toggle) { toggle.setAttribute("aria-expanded", "true"); toggle.textContent = "Zwiń"; toggle.title = "Zwiń panel wyników"; }
      this.renderResults();
      requestAnimationFrame(() => document.getElementById(eventId)?.scrollIntoView({ block: "center", behavior: "smooth" }));
    }

    setState(text, kind = "", linkedEvent = null) {
      const element = $("stage4State");
      if (!element) return;
      const event = linkedEvent || this.logEvent("STATUS", text);
      element.className = `stage4-state ${kind}`;
      element.innerHTML = `<span class="stage4-state-text">${esc(text)}</span><a class="stage4-event-ref" href="#${event.id}" data-stage4-event-link="${event.id}" title="${esc(event.description)}">${event.reference}</a>`;
      element.title = event.description;
      element.dataset.eventId = event.id;
      element.setAttribute("aria-label", `${text} ${event.reference}. ${event.description.replace(/\n/g, " ")}`);
    }

    renderSimulationProgress() {
      const host = $("stage4SimulationProgress"), bar = $("stage4SimulationProgressBar"), label = $("stage4SimulationProgressLabel");
      if (!host || !bar || !label) return;
      const visible = this.cells.length > 0 && (this.status !== "idle" || this.time > 0);
      host.hidden = !visible;
      if (!visible) return;
      const duration = Math.max(1, num("stage4DurationS", 7200));
      const progress = clamp(this.time / duration * 100, 0, 100);
      bar.style.width = `${progress.toFixed(2)}%`;
      label.textContent = `${progress.toFixed(1)}% · ${fmt(this.time, 1)} / ${fmt(duration, 1)} s`;
    }

    renderSimulationFrame(updateResults = false) {
      this.renderMetrics();
      this.renderLivePanel();
      this.renderVisual();
      this.renderBms();
      if (updateResults || this.status !== "running") this.renderResults();
    }

    renderAll() { this.renderSimulationFrame(true); this.renderSimulationProgress(); }
    renderEmpty() {
      $("stage4Metrics").innerHTML = "";
      $("stage4LiveStatus").textContent = "BRAK MODELU";
      $("stage4LivePackData").innerHTML = '<div class="stage4-live-stat">Pakiet<strong>Przejdź przez etapy 1–3</strong></div>';
      $("stage4BmsStatus").textContent = "Brak modelu.";
      $("stage4ResultBody").innerHTML = '<div class="stage4-summary-item">Przejdź przez etapy 1–3, aby utworzyć model.</div>';
      this.renderSimulationProgress();
    }

    renderMetrics() {
      if (!this.cells.length) return;
      const maxTemp = Math.max(...this.cells.map(c => c.coreTempC), ...this.cells.map(c => c.surfaceTempC), ...this.tapeSegments.map(t => t.tempC), ...this.airZones.map(z => z.tempC), ...this.caseNodes.map(n => n.tempC)), minSoc = Math.min(...this.cells.map(c => c.soc));
      const efficiency = this.energyWh > 0 ? Math.max(0, 100 * (1 - this.lossEnergyWh / this.energyWh)) : 100;
      $("stage4Metrics").innerHTML = [
        ["Czas", `${fmt(this.time, 1)} s`], ["Napięcie pakietu", `${fmt(this.packVoltage, 2)} V`], ["Prąd zadany / rozwiązany", `${fmt(this.commandedPackCurrentA, 2)} / ${fmt(this.solvedPackCurrentA, 2)} A`],
        ["Moc", `${fmt(this.packVoltage * this.packCurrent, 1)} W`], ["Min. SOC", `${fmt(minSoc, 2)}%`], ["Maks. temperatura", `${fmt(maxTemp, 1)}°C`], ["Sprawność", `${fmt(efficiency, 2)}%`]
      ].map(([label, value]) => `<div class="stage4-metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
    }

    renderLivePanel() {
      const host = $("stage4LivePackData"), status = $("stage4LiveStatus");
      if (!host || !status) return;
      if (!this.cells.length || !this.package) {
        status.textContent = "BRAK MODELU";
        host.innerHTML = '<div class="stage4-live-stat">Pakiet<strong>Oczekiwanie na dane</strong></div>';
        return;
      }
      const minSoc = Math.min(...this.cells.map(cell => cell.soc));
      const maxTemp = Math.max(...this.cells.map(cell => cell.coreTempC), ...this.cells.map(cell => cell.surfaceTempC), ...this.tapeSegments.map(segment => segment.tempC), ...this.airZones.map(zone => zone.tempC), ...this.caseNodes.map(node => node.tempC));
      const stateLabel = { idle: "GOTOWY", running: "W TOKU", paused: "PAUZA", finished: "ZATRZYMANY" }[this.status] || String(this.status || "GOTOWY").toUpperCase();
      status.textContent = stateLabel;
      const values = [
        ["Konfiguracja", `${this.package.series}S${this.package.parallel}P`],
        ["Napięcie", `${fmt(this.packVoltage, 2)} V`],
        ["Prąd rozwiązany", `${fmt(this.solvedPackCurrentA, 2)} A`],
        ["Moc", `${fmt(this.packVoltage * this.solvedPackCurrentA, 0)} W`],
        ["Min. SOC", `${fmt(minSoc, 1)}%`],
        ["Maks. T", `${fmt(maxTemp, 1)}°C`],
        ["Wątki", this.workerPool?.size ? `${this.workerPool.size + 1}` : "1 · zgodność"]
      ];
      host.innerHTML = values.map(([label, value]) => `<div class="stage4-live-stat">${label}<strong>${value}</strong></div>`).join("");
      this.syncLiveControls();
    }

    tempColor(temp, min, max) {
      const t = clamp((temp - min) / Math.max(1e-6, max - min), 0, 1), stops = THERMAL_COLOR_STOPS;
      const p = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
      const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f)); return `rgb(${c.join(",")})`;
    }

    renderVisual() {
      const svg = $("stage4Drawing"); if (!svg || !this.cells.length) return;
      const layer = $("stage4VisualLayer")?.value || "cell-core", scaleMode = $("stage4ScaleMode")?.value || "safety", ambient = this.settings().ambientC;
      const averagePackageTempC = this.cells.reduce((sum, cell) => sum + cell.coreTempC, 0) / Math.max(1, this.cells.length);
      const cellValue = cell => ({ "cell-core": cell.coreTempC, "cell-surface": cell.surfaceTempC, "cell-loss": cell.powerW, "cooling-class": { interior: 0, transition: .5, exterior: 1 }[cell.thermalGeometry?.coolingClass] ?? 0, "cooling-area": (cell.thermalGeometry?.effectiveExchangeAreaM2 || 0) * 1e4, "delta-ambient": cell.coreTempC - averagePackageTempC, combined: cell.coreTempC })[layer];
      const tapeValue = segment => ({ tape: segment.tempC, "tape-loss": segment.powerW, "delta-ambient": segment.tempC - averagePackageTempC, combined: segment.tempC })[layer];
      const airValue = zone => layer === "air" ? zone.tempC : layer === "delta-ambient" ? zone.tempC - averagePackageTempC : undefined;
      const caseValue = node => layer === "case" ? node.tempC : layer === "delta-ambient" ? node.tempC - averagePackageTempC : undefined;
      const values = [...this.cells.map(cellValue), ...this.tapeSegments.map(tapeValue), ...this.airZones.map(airValue), ...this.caseNodes.map(caseValue)].filter(Number.isFinite);
      const unit = ["cell-loss", "tape-loss"].includes(layer) ? "W" : layer === "cooling-area" ? "cm²" : layer === "cooling-class" ? "" : "°C";
      const temperatureLayer = ["cell-core", "cell-surface", "tape", "air", "case", "combined"].includes(layer);
      let scaleMin = num("stage4ScaleMin", 20), scaleMax = num("stage4ScaleMax", 80);
      if (scaleMode === "safety" && !["cell-loss", "tape-loss", "cooling-class", "cooling-area", "delta-ambient"].includes(layer)) { scaleMin = 20; scaleMax = 80; }
      else if (scaleMode === "diagnostic" && temperatureLayer) { const span = Math.max(1, ...values.map(value => Math.abs(value - averagePackageTempC))); scaleMin = averagePackageTempC - span; scaleMax = averagePackageTempC + span; }
      else if (layer === "delta-ambient") { const span = Math.max(1, ...values.map(value => Math.abs(value))); scaleMin = -span; scaleMax = span; }
      else if (scaleMode === "auto" || ["cell-loss", "tape-loss", "cooling-class", "cooling-area"].includes(layer)) { scaleMin = values.length ? Math.min(...values) : 0; scaleMax = values.length ? Math.max(...values) : 1; if (scaleMax - scaleMin < 1e-9) scaleMax = scaleMin + 1; }
      const layerColor = value => Number.isFinite(value) ? this.tempColor(value, scaleMin, scaleMax) : "rgb(30,41,59)";
      $("stage4ScaleMinLabel").textContent = `${fmt(scaleMin, 0)}°C`; $("stage4ScaleMaxLabel").textContent = `${fmt(scaleMax, 0)}°C`;
      if ($("stage4ScaleUnit")) $("stage4ScaleUnit").textContent = unit;
      $("stage4ScaleMinLabel").textContent = `${fmt(scaleMin, layer === "cooling-area" ? 1 : 0)}${unit}`; $("stage4ScaleMaxLabel").textContent = `${fmt(scaleMax, layer === "cooling-area" ? 1 : 0)}${unit}`;
      const scaleGradient = $("stage4ScaleGradient");
      if (scaleGradient) {
        scaleGradient.style.background = `linear-gradient(90deg, ${THERMAL_COLOR_STOPS.map((color, index) => `rgb(${color.join(",")}) ${index / (THERMAL_COLOR_STOPS.length - 1) * 100}%`).join(", ")})`;
      }
      const layout = this.visualLayout || (this.buildVisualLayoutCache(), this.visualLayout);
      const { minX, maxX, minY, maxY, viewWidth, viewHeight, viewGap, backOffsetX, project, radius, boundaryMarkup, stripEntries } = layout;
      this.visualBaseViewBox = layout.baseViewBox;
      if (!this.visualViewBox || this.visualViewNeedsFit) {
        this.visualViewBox = { ...this.visualBaseViewBox };
        this.visualViewNeedsFit = false;
      }
      svg.setAttribute("viewBox", `${this.visualViewBox.x} ${this.visualViewBox.y} ${this.visualViewBox.width} ${this.visualViewBox.height}`);
      const defs = `<defs><marker id="stage4-current-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#e0f2fe"/></marker><filter id="stage4-strip-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
      const gradientDefs = `<defs>${stripEntries.map((segments, groupIndex) => {
        const side = segments[0].side, start = project(side, segments[0].x1, segments[0].y1), endSegment = segments[segments.length - 1], end = project(side, endSegment.x2, endSegment.y2);
        const totalLength = segments.reduce((sum, segment) => sum + segment.lengthMm, 0) || 1;
        let traversed = 0;
        const stops = [`<stop offset="0%" stop-color="${layerColor(tapeValue(segments[0]))}"/>`];
        segments.forEach(segment => {
          traversed += segment.lengthMm;
          stops.push(`<stop offset="${clamp(traversed / totalLength * 100, 0, 100)}%" stop-color="${layerColor(tapeValue(segment))}"/>`);
        });
        return `<linearGradient id="stage4-tape-gradient-${groupIndex}" gradientUnits="userSpaceOnUse" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}">${stops.join("")}</linearGradient>`;
      }).join("")}</defs>`;
      const currentIndicators = [];
      const strips = stripEntries.map((segments, groupIndex) => {
        const side = segments[0].side;
        const first = segments[0], last = segments[segments.length - 1], start = project(side, first.x1, first.y1), end = project(side, last.x2, last.y2);
        const tapeWidth = Math.max(...segments.map(segment => segment.widthMm));
        // Szerokość fizyczna pozostaje w segmentach: to wyłącznie kompaktowy
        // rysunek SVG, aby nakładające się taśmy nie zasłaniały wizualizacji.
        const visualTapeWidth = Math.max(.8, tapeWidth * .5);
        const hitSegments = segments.map(segment => {
          const a = project(side, segment.x1, segment.y1), b = project(side, segment.x2, segment.y2);
          return `<line class="stage4-strip-hit" data-strip-id="${esc(segment.id)}" data-current-group="${groupIndex}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="${visualTapeWidth + 1.5}" stroke-linecap="round" pointer-events="stroke" style="cursor:pointer"/>`;
        }).join("");
        const middle = segments.reduce((best, segment) => Math.abs(segment.currentA) > Math.abs(best.currentA) ? segment : best, segments[0]), a = project(side, middle.x1, middle.y1), b = project(side, middle.x2, middle.y2);
        const current = middle.currentA, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, arrowLength = Math.min(10, length * .55), sign = current >= 0 ? 1 : -1;
        const ax1 = cx - ux * arrowLength * .5 * sign, ay1 = cy - uy * arrowLength * .5 * sign, ax2 = cx + ux * arrowLength * .5 * sign, ay2 = cy + uy * arrowLength * .5 * sign;
        const flow = Math.abs(current) > .02 ? `<g class="stage4-current-indicator" data-current-group="${groupIndex}" pointer-events="none"><line x1="${ax1}" y1="${ay1}" x2="${ax2}" y2="${ay2}" stroke="#e0f2fe" stroke-width=".9" opacity=".9" marker-end="url(#stage4-current-arrow)"/><text class="stage4-current-label" x="${cx - uy * (visualTapeWidth * .72 + 2)}" y="${cy + ux * (visualTapeWidth * .72 + 2)}" text-anchor="middle" dominant-baseline="middle" fill="#f8fafc" stroke="#020617" stroke-width="2" stroke-linejoin="round" paint-order="stroke fill" font-size="3.8" font-weight="900">${fmt(Math.abs(current), 1)} A</text></g>` : "";
        currentIndicators.push(flow);
        return `<g class="stage4-tape-visual"><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#07111f" stroke-width="${visualTapeWidth + 1.5}" stroke-linecap="round"/><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="rgba(186,230,253,.42)" stroke-width="${visualTapeWidth + .55}" stroke-linecap="round" filter="url(#stage4-strip-glow)"/><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="url(#stage4-tape-gradient-${groupIndex})" stroke-width="${visualTapeWidth}" stroke-linecap="round" opacity=".92"/><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="rgba(255,255,255,.22)" stroke-width=".5" stroke-linecap="round" pointer-events="none"/>${hitSegments}</g>`;
      }).join("");
      const currentIndicatorsMarkup = `<g class="stage4-current-indicators" pointer-events="none">${currentIndicators.join("")}</g>`;
      const environmentOverlay = ["air", "case", "delta-ambient"].includes(layer) ? ["front", "back"].map(side => {
        const nodes = layer === "case" ? this.caseNodes : this.airZones;
        return nodes.map(node => {
          const a = project(side, node.x1, node.y1), b = project(side, node.x2, node.y2), value = layer === "case" ? caseValue(node) : airValue(node);
          return `<rect x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}" fill="${layerColor(value)}" opacity=".22" stroke="rgba(226,232,240,.18)" stroke-width=".45"><title>${esc(node.id)} · ${fmt(value, 2)}${unit}</title></rect>`;
        }).join("");
      }).join("") : "";
      const hottestCell = this.maxItem(this.cells, cell => Math.max(cell.coreTempC, cell.surfaceTempC))?.item;
      const cellLabels = [];
      const cells = ["front", "back"].map(side => this.cells.map(cell => {
        const p = project(side, cell.x, cell.y), frontStartsPositive = !this.package.polarityReversed;
        const sideStartsPositive = side === "front" ? frontStartsPositive : !frontStartsPositive;
        const positive = sideStartsPositive ? cell.section % 2 === 0 : cell.section % 2 !== 0;
        const terminal = positive
          ? `<circle cx="${p.x}" cy="${p.y}" r="${radius * .43}" fill="rgba(226,232,240,.72)" stroke="rgba(255,255,255,.8)" stroke-width=".65"/><circle cx="${p.x}" cy="${p.y}" r="${radius * .18}" fill="rgba(15,23,42,.7)"/>`
          : `<circle cx="${p.x}" cy="${p.y}" r="${radius * .63}" fill="rgba(2,6,23,.3)" stroke="rgba(226,232,240,.56)" stroke-width=".75"/>`;
        cellLabels.push(`<g class="stage4-cell-label" pointer-events="none"><text x="${p.x}" y="${p.y - radius * .08}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(3.6, radius * .38)}" fill="#f8fafc" stroke="#020617" stroke-width="1.8" stroke-linejoin="round" paint-order="stroke fill" font-weight="900">${esc(cell.id)}</text><text x="${p.x}" y="${p.y + radius * .43}" text-anchor="middle" font-size="${Math.max(2.8, radius * .27)}" fill="#bae6fd" stroke="#020617" stroke-width="1.35" stroke-linejoin="round" paint-order="stroke fill">S${cell.section + 1}</text></g>`);
        return `<g class="stage4-cell-hit" data-cell-id="${esc(cell.id)}" data-side="${side}" style="cursor:pointer"><circle cx="${p.x}" cy="${p.y}" r="${radius + 1.2}" fill="rgba(2,6,23,.82)" stroke="${cell === hottestCell ? "#fb3f67" : "rgba(147,197,253,.58)"}" stroke-width="${cell === hottestCell ? 2.4 : 1.1}"/><circle cx="${p.x}" cy="${p.y}" r="${radius}" fill="${layerColor(cellValue(cell))}" stroke="rgba(219,234,254,.72)" stroke-width=".65"/>${terminal}</g>`;
      }).join("")).join("");
      const cellLabelsMarkup = `<g class="stage4-cell-labels" pointer-events="none">${cellLabels.join("")}</g>`;
      const labels = `<g pointer-events="none"><text x="${minX + 8}" y="${minY + 13}" fill="#bae6fd" font-size="7" font-weight="900">PRZÓD PAKIETU · STRONA A</text><text x="${minX + backOffsetX + 8}" y="${minY + 13}" fill="#bae6fd" font-size="7" font-weight="900">TYŁ PAKIETU · STRONA B · ODBICIE POZIOME</text><line x1="${minX + viewWidth + viewGap / 2}" y1="${minY + 5}" x2="${minX + viewWidth + viewGap / 2}" y2="${maxY - 5}" stroke="rgba(148,203,255,.18)" stroke-dasharray="4 5"/></g>`;
      svg.innerHTML = defs + gradientDefs + boundaryMarkup + environmentOverlay + cells + strips + cellLabelsMarkup + labels + currentIndicatorsMarkup;
    }

    showCellTooltipLegacy(id) {
      const c = this.cells.find(cell => String(cell.id) === String(id)); if (!c) return;
      const metric = (label, value, tone = "") => `<div class="stage4-tooltip-metric ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
      $("stage4Tooltip").innerHTML = `<div class="stage4-tooltip-title"><span>Ogniwo <strong>${esc(c.id)}</strong></span><b>S${c.section + 1}</b></div><div class="stage4-tooltip-grid">${metric("SOC referencyjny", `${fmt(c.referenceSocPercent, 2)}%`)}${metric("SOC dostępny", `${fmt(c.availableSocPercent, 2)}%`)}${metric("OCV", `${fmt(c.ocvV, 3)} V`)}${metric("Napięcie zacisku", `${fmt(c.voltageV, 3)} V`)}</div><div class="stage4-tooltip-section">Prąd i temperatura</div><div class="stage4-tooltip-grid">${metric("Prąd ogniwa", `${fmt(c.currentA, 3)} A`, "accent")}${metric("Temperatura", `${fmt(c.tempC, 1)}°C`, c.tempC >= 60 ? "hot" : "")}${metric("R0 / R1", `${fmt(c.r0Ohm * 1000, 2)} / ${fmt(c.r1Ohm * 1000, 2)} mΩ`)}${metric("Polaryzacja Vp", `${fmt(c.polarizationVoltageV, 3)} V`)}</div><div class="stage4-tooltip-footer"><span>Limity rozładowania <strong>${fmt(c.standardCurrentA, 2)} / ${fmt(c.maxCurrentA, 2)} A</strong></span><span>Limity ładowania <strong>${fmt(c.standardChargeCurrentA, 2)} / ${fmt(c.maxChargeCurrentA, 2)} A</strong></span><span>Czas ponad standard / maksimum <strong>${fmt(c.currentExposure.secondsAboveStandard, 1)} / ${fmt(c.currentExposure.secondsAboveMaximum, 1)} s</strong></span><span>Ładunek <strong>${fmt(c.absoluteChargeAh, 3)} / ${fmt(c.referenceCapacityAh, 3)} Ah</strong></span><span>Straty R0 / R1 <strong>${fmt(c.r0LossPowerW, 3)} / ${fmt(c.r1LossPowerW, 3)} W</strong></span><span>Energia strat <strong>${fmt(c.lossEnergyWh, 4)} Wh</strong></span></div>`;
    }
    showCellTooltip(id) {
      const c = this.cells.find(cell => String(cell.id) === String(id)); if (!c) return;
      const metric = (label, value, tone = "") => `<div class="stage4-tooltip-metric ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
      const g = c.thermalGeometry || {}, t = c.thermal || {};
      $("stage4Tooltip").innerHTML = `<div class="stage4-tooltip-title"><span>Ogniwo <strong>${esc(c.id)}</strong></span><b>S${c.section + 1}</b></div>
        <div class="stage4-tooltip-grid">${metric("SOC referencyjny", `${fmt(c.referenceSocPercent, 2)}%`)}${metric("SOC dostępny", `${fmt(c.availableSocPercent, 2)}%`)}${metric("OCV", `${fmt(c.ocvV, 3)} V`)}${metric("Napięcie zacisku", `${fmt(c.voltageV, 3)} V`)}</div>
        <div class="stage4-tooltip-section">Prąd i termika</div><div class="stage4-tooltip-grid">${metric("Prąd ogniwa", `${fmt(c.currentA, 3)} A`, "accent")}${metric("Rdzeń", `${fmt(c.coreTempC, 1)}°C`, c.coreTempC >= 60 ? "hot" : "")}${metric("Powierzchnia", `${fmt(c.surfaceTempC, 1)}°C`, c.surfaceTempC >= 60 ? "hot" : "")}${metric("Rdzeń − powierzchnia", `${fmt(c.coreTempC - c.surfaceTempC, 2)} K`)}</div>
        <div class="stage4-tooltip-footer"><span>Klasa chłodzenia <strong>${esc(g.coolingClass || "—")}</strong></span><span>Współczynnik ustawiony / zastosowany <strong>${fmt(g.configuredCoolingFactor, 3)} / ${fmt(g.appliedCoolingFactor, 3)}×</strong></span><span>Efektywna powierzchnia wymiany <strong>${fmt((g.effectiveExchangeAreaM2 || 0) * 1e4, 2)} cm²</strong></span><span>Powietrze / obudowa / materiał / bezpośrednio <strong>${fmt((g.areaToInternalAirM2 || 0) * 1e4, 2)} / ${fmt((g.areaToCaseM2 || 0) * 1e4, 2)} / ${fmt((g.areaToThermalMaterialM2 || 0) * 1e4, 2)} / ${fmt((g.areaDirectlyExposedM2 || 0) * 1e4, 2)} cm²</strong></span><span>Zasłonięte: ogniwa / holder / taśmy <strong>${fmt((g.blockedByCellsM2 || 0) * 1e4, 2)} / ${fmt((g.blockedByHolderM2 || 0) * 1e4, 2)} / ${fmt((g.blockedByTapeM2 || 0) * 1e4, 2)} cm²</strong></span><span>Strefa powietrza <strong>${esc(t.airZoneId || "brak")}</strong></span><span>Straty R0 / R1 <strong>${fmt(c.r0LossPowerW, 3)} / ${fmt(c.r1LossPowerW, 3)} W</strong></span><span>Ciepło rdzeń → powierzchnia <strong>${fmt(t.coreToSurfaceW, 4)} W</strong></span><span>Oddawanie konwekcyjne <strong>${fmt(t.convectionW, 4)} W</strong></span></div>`;
    }
    showStripTooltip(id) {
      const s = this.tapeSegments.find(item => item.id === id); if (!s) return;
      const metric = (label, value, tone = "") => `<div class="stage4-tooltip-metric ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
      $("stage4Tooltip").innerHTML = `<div class="stage4-tooltip-title"><span>Segment taśmy</span><b>${esc(s.id)}</b></div><div class="stage4-tooltip-material">${esc(s.materialName)} · ${fmt(s.lengthMm, 1)} × ${fmt(s.widthMm, 2)} × ${fmt(s.thicknessMm, 2)} mm</div><div class="stage4-tooltip-grid">${metric("Przekrój", `${fmt(s.widthMm * s.thicknessMm, 3)} mm²`)}${metric("Prąd", `${fmt(s.currentA, 3)} A`, "accent")}${metric("Rezystancja", `${fmt(s.resistanceOhm * 1000, 4)} mΩ`)}${metric("Temperatura", `${fmt(s.tempC, 1)}°C`, s.tempC >= 60 ? "hot" : "")}</div><div class="stage4-tooltip-footer"><span>Moc strat <strong>${fmt(s.powerW, 4)} W</strong></span><span>Energia strat <strong>${fmt(s.lossEnergyWh, 5)} Wh</strong></span></div>`;
    }

    activateTab(name) {
      document.querySelectorAll("[data-stage4-tab]").forEach(button => button.classList.toggle("active", button.dataset.stage4Tab === name));
      document.querySelector(".stage4-stage")?.classList.toggle("summary-compact", name === "summary");
    }

    renderBms() {
      if (!this.cells.length) return;
      const minT = Math.min(...this.cells.map(c => c.tempC)), maxT = Math.max(...this.cells.map(c => c.tempC)), minSoc = Math.min(...this.cells.map(c => c.soc)), maxSoc = Math.max(...this.cells.map(c => c.soc));
      const sectionVoltages = this.sectionBmsVoltages?.length === this.package.series ? this.sectionBmsVoltages : this.groupVoltages;
      const warnings = Object.entries(this.bms.timers).filter(([, seconds]) => seconds > 0).map(([key, seconds]) => `${key} (${fmt(seconds, 2)} s)`).join(", ");
      $("stage4BmsBadge").textContent = this.bms.state;
      $("stage4BmsStatus").innerHTML = `<strong>${this.bms.connected ? "ZAŁĄCZONY" : "ODŁĄCZONY"}</strong><br>Prąd ${fmt(this.packCurrent, 2)} A · temperatury ${fmt(minT, 1)}–${fmt(maxT, 1)}°C<br>SOC ${fmt(minSoc, 2)}–${fmt(maxSoc, 2)}% · ΔU punktów BMS ${fmt(Math.max(...sectionVoltages) - Math.min(...sectionVoltages), 3)} V${this.bmsBalanceBranches.length ? `<br>Rezystory balansujące: ${this.bmsBalanceBranches.map(branch => `S${branch.section + 1} ${fmt(branch.currentA, 3)} A`).join(", ")}` : ""}${warnings ? `<br><span style="color:#fbbf24">Aktywne ostrzeżenia: ${warnings}</span>` : ""}`;
      const lo = this.package.cellModel.voltage_min_V, hi = this.package.cellModel.voltage_max_V;
      $("stage4GroupList").innerHTML = sectionVoltages.map((v, i) => `<div class="stage4-group-row"><b>S${i + 1}</b><i style="width:${clamp((v - lo) / Math.max(.01, hi - lo) * 100, 0, 100)}%"></i><span>${fmt(v, 3)} V</span></div>`).join("");
      const trip = this.bms.lastTrip;
      $("stage4LastBmsEvent").innerHTML = trip ? `<a class="stage4-event-ref" href="#${esc(trip.eventId)}" data-stage4-event-link="${esc(trip.eventId)}">${esc(trip.reference)}</a><span>${fmt(trip.timeS, 2)} s · ${esc(trip.type)} · ${esc(trip.element)} · ${fmt(trip.value, 3)} (próg ${fmt(trip.threshold, 3)})</span>` : "Brak zdarzeń odłączenia.";
    }

    renderResults() {
      const body = $("stage4ResultBody"); if (!body || !this.cells.length) return;
      if (this.activeTab === "charts") return this.renderCharts(body);
      if (this.activeTab === "cells") return this.renderCellTable(body);
      if (this.activeTab === "strips") return this.renderStripTable(body);
      if (this.activeTab === "events") { body.innerHTML = `<div class="stage4-event-log">${this.events.length ? this.events.slice().reverse().map(e => `<div class="stage4-event-row" id="${esc(e.id)}" title="${esc(e.description)}"><a class="stage4-event-ref" href="#${esc(e.id)}" data-stage4-event-link="${esc(e.id)}" aria-label="Odnośnik do zdarzenia ${esc(e.reference)}">${esc(e.reference)}</a><span>${fmt(e.timeS, 2)} s</span><strong>${esc(e.type)}</strong><span>${esc(e.message)}</span></div>`).join("") : '<div class="stage4-summary-item">Brak zdarzeń.</div>'}</div>`; return; }
      const weakest = this.minItem(this.cells, c => c.voltageV), hottest = this.maxItem([...this.cells, ...this.tapeSegments, ...this.airZones, ...this.caseNodes], e => e.tempC), loss = this.cells.reduce((s, c) => s + c.powerW, 0) + this.tapeSegments.reduce((s, t) => s + t.powerW, 0);
      const efficiency = this.energyWh > 0 ? Math.max(0, 100 * (1 - this.lossEnergyWh / this.energyWh)) : 100;
      const balance = this.energyBalance;
      const maximumStandardExposureS = Math.max(...this.cells.map(cell => cell.currentExposure.secondsAboveStandard));
      const maximumLimitExposureS = Math.max(...this.cells.map(cell => cell.currentExposure.secondsAboveMaximum));
      const weakLabels = { hottest_cell: "Najcieplejsze ogniwo", hottest_strip: "Najcieplejsza taśma", highest_loss: "Największe straty", highest_cell_current: "Największy prąd ogniwa", lowest_voltage: "Najniższe napięcie", lowest_soc: "Najniższy SOC", highest_strip_density: "Największa gęstość prądu" };
      const weakTable = Object.entries(this.weakRecords).map(([key, record]) => `<tr><td>${weakLabels[key] || key}</td><td>${esc(record.id)}</td><td>${fmt(record.value, 4)}</td><td>${fmt(record.timeS, 2)} s</td></tr>`).join("");
      body.innerHTML = `<div class="stage4-summary-grid">${[
        ["Stan", this.status], ["Faza", this.settings().mode === "charge" ? this.chargePhase : "rozładowanie"], ["Energia", `${fmt(this.energyWh, 3)} Wh`], ["Straty pakietu", `${fmt(this.lossEnergyWh, 4)} Wh`], ["Straty BMS", `${fmt(this.bmsBalanceEnergyWh, 4)} Wh`], ["Sprawność", `${fmt(efficiency, 2)}%`],
        ["Najsłabsze ogniwo", `${esc(weakest?.item.id)} · ${fmt(weakest?.value, 3)} V`], ["Najcieplejszy element", `${esc(hottest?.item.id)} · ${fmt(hottest?.value, 1)}°C`], ["Straty chwilowe", `${fmt(loss, 3)} W`], ["Czas ponad standard", `${fmt(maximumStandardExposureS, 1)} s`], ["Czas ponad maksimum", `${fmt(maximumLimitExposureS, 1)} s`], ["Błąd bilansu el.", balance ? `${fmt(balance.electricalErrorPercent, 4)}%` : "—"], ["Błąd bilansu T", balance?.thermalErrorPercent === null || !balance ? "—" : `${fmt(balance.thermalErrorPercent, 4)}%`], ["Segmenty taśm", this.tapeSegments.length], ["Przyczyna końca", this.finishReason || "—"]
      ].map(([l, v]) => `<div class="stage4-summary-item">${l}<strong>${v}</strong></div>`).join("")}</div>${weakTable ? `<table class="stage4-table" style="margin-top:7px"><thead><tr><th>Słaby punkt / rekord</th><th>Element</th><th>Wartość</th><th>Czas</th></tr></thead><tbody>${weakTable}</tbody></table>` : ""}`;
    }

    renderChartsLegacy(body) {
      const series = [
        ["Napięcie pakietu [V]", h => h.voltageV, "#38bdf8"], ["Prąd pakietu [A]", h => h.currentA, "#f59e0b"],
        ["Maks. temperatura [°C]", h => h.maxTempC, "#ef4444"], ["Minimalny SOC [%]", h => h.minSoc, "#22c55e"]
      ];
      body.innerHTML = `<div class="stage4-chart-grid">${series.map(([title, getter, color]) => `<div class="stage4-chart"><strong>${title}</strong>${this.chartSvg(getter, color)}</div>`).join("")}</div>`;
    }
    renderCharts(body) {
      const interiorIds = new Set(this.cells.filter(cell => cell.thermalGeometry?.coolingClass === "interior").map(cell => String(cell.id)));
      const exteriorIds = new Set(this.cells.filter(cell => cell.thermalGeometry?.coolingClass === "exterior").map(cell => String(cell.id)));
      const averageCells = (snapshot, ids, column) => { const values = snapshot.cells.filter(item => ids.has(String(item[0]))).map(item => item[column]).filter(Number.isFinite); return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN; };
      const series = [
        ["Napięcie pakietu [V]", h => h.voltageV, "#38bdf8"], ["Prąd pakietu [A]", h => h.currentA, "#f59e0b"],
        ["Maks. temperatura rdzenia [°C]", h => h.maxCellCoreTempC, "#ef4444"], ["Maks. temperatura powierzchni [°C]", h => h.maxCellSurfaceTempC, "#fb7185"],
        ["Średnia rdzenia · wnętrze [°C]", h => averageCells(h, interiorIds, 4), "#f97316"], ["Średnia rdzenia · krawędź [°C]", h => averageCells(h, exteriorIds, 4), "#22d3ee"],
        ["Wnętrze − krawędź [K]", h => averageCells(h, interiorIds, 4) - averageCells(h, exteriorIds, 4), "#f43f5e"],
        ["Maksymalne ΔT ogniw [K]", h => { const values = h.cells.map(item => item[4]).filter(Number.isFinite); return values.length ? Math.max(...values) - Math.min(...values) : NaN; }, "#e879f9"],
        ["Maks. rdzeń − powierzchnia [K]", h => Math.max(...h.cells.map(item => item[4] - item[5])), "#a78bfa"],
        ["Maks. temperatura powietrza [°C]", h => h.maxAirTempC, "#34d399"], ["Maks. temperatura obudowy [°C]", h => h.maxCaseTempC, "#94a3b8"],
        ["Ciepło wygenerowane [W]", h => h.energyBalance?.thermalGeneratedW, "#facc15"], ["Ciepło magazynowane [W]", h => h.energyBalance?.thermalStoredRateW, "#60a5fa"], ["Ciepło oddane [W]", h => h.energyBalance?.ambientHeatLossW, "#2dd4bf"],
        ["Minimalny SOC [%]", h => h.minSoc, "#22c55e"]
      ];
      body.innerHTML = `<div class="stage4-chart-grid">${series.map(([title, getter, color]) => `<div class="stage4-chart"><strong>${title}</strong>${this.chartSvg(getter, color)}</div>`).join("")}</div>`;
    }
    chartSvg(getter, color) {
      if (this.history.length < 2) return '<svg viewBox="0 0 300 100"><text x="150" y="52" text-anchor="middle" fill="#64748b" font-size="10">Oczekiwanie na dane</text></svg>';
      const values = this.history.map(getter).filter(Number.isFinite);
      if (values.length < 2) return '<svg viewBox="0 0 300 100"><text x="150" y="52" text-anchor="middle" fill="#64748b" font-size="10">Oczekiwanie na dane</text></svg>';
      const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
      const points = values.map((v, i) => `${i / (values.length - 1) * 300},${94 - (v - min) / span * 86}`).join(" ");
      return `<svg viewBox="0 0 300 100" preserveAspectRatio="none"><path d="M0 94H300 M0 8V94" stroke="#334155" fill="none"/><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/><text x="3" y="10" fill="#94a3b8" font-size="7">${fmt(max, 2)}</text><text x="3" y="92" fill="#94a3b8" font-size="7">${fmt(min, 2)}</text></svg>`;
    }

    renderCellTable(body) {
      const selected = this.cells.find(c => String(c.id) === String(this.selectedCell));
      const editor = selected ? `<div class="stage4-cell-editor"><label>Pojemność [Ah]<input id="stage4EditCapacity" value="${selected.capacityAh}"></label><label>DCIR [mΩ]<input id="stage4EditDcir" value="${selected.baseDcirMohm}"></label><label>SOC [%]<input id="stage4EditSoc" value="${selected.soc}"></label><label>Temperatura [°C]<input id="stage4EditTemp" value="${selected.tempC}"></label><label>Chłodzenie [×]<input id="stage4EditCooling" value="${selected.coolingFactor}"></label><label>Standardowy prąd rozł. [A]<input id="stage4EditStandardCurrent" value="${selected.standardCurrentA}"></label><label>Maks. ciągły prąd rozł. [A]<input id="stage4EditCurrent" value="${selected.maxCurrentA}"></label><label>Standardowy prąd ład. [A]<input id="stage4EditStandardChargeCurrent" value="${selected.standardChargeCurrentA}"></label><label>Maks. prąd ład. [A]<input id="stage4EditChargeCurrent" value="${selected.maxChargeCurrentA}"></label><label>V min [V]<input id="stage4EditVmin" value="${selected.voltageMinV}"></label><label>V max [V]<input id="stage4EditVmax" value="${selected.voltageMaxV}"></label><button id="stage4ApplyCellEdit">Zastosuj do ${esc(selected.id)}</button></div>` : "";
      const selectedHistory = selected ? `<div class="stage4-chart-grid">${[
        ["Napięcie ogniwa [V]", 1, "#38bdf8"], ["Prąd ogniwa [A]", 2, "#f59e0b"], ["SOC ogniwa [%]", 3, "#22c55e"], ["Temperatura ogniwa [°C]", 4, "#ef4444"]
      ].map(([title, index, color]) => `<div class="stage4-chart"><strong>${title}</strong>${this.chartSvg(h => h.cells.find(item => String(item[0]) === String(selected.id))?.[index], color)}</div>`).join("")}</div>` : "";
      body.innerHTML = editor + selectedHistory + `<table class="stage4-table"><thead><tr><th>Ogniwo</th><th>Grupa</th><th>SOC ref. [%]</th><th>OCV [V]</th><th>U zacisku [V]</th><th>I [A]</th><th>R0/R1 [mΩ]</th><th>Vp [V]</th><th>T [°C]</th><th>Q [Ah]</th><th>P [W]</th><th>E strat [Wh]</th></tr></thead><tbody>${this.cells.map(c => `<tr data-stage4-cell-row="${esc(c.id)}" class="${String(c.id) === String(this.selectedCell) ? "selected" : ""}"><td>${esc(c.id)}</td><td>S${c.section + 1}</td><td>${fmt(c.referenceSocPercent, 3)}</td><td>${fmt(c.ocvV, 3)}</td><td>${fmt(c.voltageV, 3)}</td><td>${fmt(c.currentA, 3)}</td><td>${fmt(c.r0Ohm * 1000, 2)} / ${fmt(c.r1Ohm * 1000, 2)}</td><td>${fmt(c.polarizationVoltageV, 3)}</td><td>${fmt(c.tempC, 2)}</td><td>${fmt(c.absoluteChargeAh, 4)}</td><td>${fmt(c.powerW, 4)}</td><td>${fmt(c.lossEnergyWh, 5)}</td></tr>`).join("")}</tbody></table>`;
      body.querySelectorAll("[data-stage4-cell-row]").forEach(row => row.onclick = () => { this.selectedCell = row.dataset.stage4CellRow; this.renderResults(); });
      $("stage4ApplyCellEdit")?.addEventListener("click", () => this.applyCellEdit(selected));
    }

    applyCellEdit(cell) {
      const maxCurrentA = Math.max(.01, num("stage4EditCurrent", cell.maxCurrentA));
      const maxChargeCurrentA = Math.max(.01, num("stage4EditChargeCurrent", cell.maxChargeCurrentA));
      const override = { capacityAh: num("stage4EditCapacity", cell.capacityAh), dcirMohm: num("stage4EditDcir", cell.baseDcirMohm), soc: clamp(num("stage4EditSoc", cell.soc), 0, 100), tempC: num("stage4EditTemp", cell.tempC), coolingFactor: Math.max(.01, num("stage4EditCooling", cell.coolingFactor)), standardCurrentA: Math.min(maxCurrentA, Math.max(.01, num("stage4EditStandardCurrent", cell.standardCurrentA))), maxCurrentA, standardChargeCurrentA: Math.min(maxChargeCurrentA, Math.max(.01, num("stage4EditStandardChargeCurrent", cell.standardChargeCurrentA))), maxChargeCurrentA, voltageMinV: num("stage4EditVmin", cell.voltageMinV), voltageMaxV: num("stage4EditVmax", cell.voltageMaxV) };
      this.overrides.set(String(cell.id), override); Object.assign(cell, {
        capacityAh: override.capacityAh, referenceCapacityAh: override.capacityAh, absoluteChargeAh: override.capacityAh * override.soc / 100,
        soc: override.soc, referenceSocPercent: override.soc, baseDcirMohm: override.dcirMohm,
        r1ToR0Ratio: this.package.cellModel.dynamic_model?.r1_fraction_of_dcir ?? cell.r1ToR0Ratio,
        tempC: override.tempC, coreTempC: override.tempC, surfaceTempC: override.tempC, coolingFactor: override.coolingFactor, standardCurrentA: override.standardCurrentA, maxCurrentA: override.maxCurrentA, standardChargeCurrentA: override.standardChargeCurrentA, maxChargeCurrentA: override.maxChargeCurrentA,
        voltageMinV: override.voltageMinV, voltageMaxV: override.voltageMaxV
      });
      this.buildCellThermalGeometry();
      this.logEvent("EDYCJA", `Ręcznie zmieniono parametry ogniwa ${cell.id}`); this.renderAll();
    }

    renderStripTable(body) {
      const selected = this.tapeSegments.find(segment => segment.id === this.selectedStrip);
      const selectedHistory = selected ? `<div class="stage4-chart-grid"><div class="stage4-chart"><strong>Prąd segmentu [A]</strong>${this.chartSvg(h => h.strips.find(item => item[0] === selected.id)?.[1], "#f59e0b")}</div><div class="stage4-chart"><strong>Temperatura segmentu [°C]</strong>${this.chartSvg(h => h.strips.find(item => item[0] === selected.id)?.[2], "#ef4444")}</div></div>` : "";
      body.innerHTML = selectedHistory + `<table class="stage4-table"><thead><tr><th>Segment</th><th>Materiał</th><th>L [mm]</th><th>w×t [mm]</th><th>A [mm²]</th><th>I [A]</th><th>R [mΩ]</th><th>T [°C]</th><th>P [W]</th><th>E strat [Wh]</th></tr></thead><tbody>${this.tapeSegments.map(s => `<tr data-stage4-strip-row="${esc(s.id)}" class="${s.id === this.selectedStrip ? "selected" : ""}"><td>${esc(s.id)}</td><td>${esc(s.materialName)}</td><td>${fmt(s.lengthMm, 2)}</td><td>${fmt(s.widthMm, 2)}×${fmt(s.thicknessMm, 2)}</td><td>${fmt(s.widthMm * s.thicknessMm, 3)}</td><td>${fmt(s.currentA, 3)}</td><td>${fmt(s.resistanceOhm * 1000, 5)}</td><td>${fmt(s.tempC, 2)}</td><td>${fmt(s.powerW, 5)}</td><td>${fmt(s.lossEnergyWh, 6)}</td></tr>`).join("")}</tbody></table>`;
      body.querySelectorAll("[data-stage4-strip-row]").forEach(row => row.onclick = () => { this.selectedStrip = row.dataset.stage4StripRow; this.renderResults(); });
    }

    run10S10P50AControlTest() {
      const expectedSeries = 10, expectedParallel = 10, expectedPackCurrentA = 50;
      const currentToleranceA = .1, kclToleranceA = 1e-3, energyTolerancePercent = .1;
      const cellsPerSection = Array.from({ length: expectedSeries }, (_, section) => this.sectionCells(section).length);
      const configurationMatches = this.package?.series === expectedSeries
        && this.cells.length === expectedSeries * expectedParallel
        && cellsPerSection.every(count => count === expectedParallel);
      const plus = this.externalLeads?.find(lead => lead.id === "PACK+");
      const minus = this.externalLeads?.find(lead => lead.id === "PACK−");
      const sectionCurrentsA = (this.sectionCurrentBalance || []).map(item => item.cellCurrentA);
      const averageCellCurrentA = this.cells.length ? this.cells.reduce((sum, cell) => sum + Math.abs(cell.currentA), 0) / this.cells.length : NaN;
      const maxSectionCurrentErrorA = sectionCurrentsA.length ? Math.max(...sectionCurrentsA.map(value => Math.abs(Math.abs(value) - expectedPackCurrentA))) : Infinity;
      const kclErrorA = this.lastSolverDiagnostics?.maxKclResidualA ?? Infinity;
      const energyErrorPercent = this.energyBalance?.electricalErrorPercent ?? Infinity;
      const sourcePowerW = this.energyBalance?.sourcePowerW ?? NaN;
      const accountedPowerW = this.energyBalance
        ? this.energyBalance.externalPowerW + this.energyBalance.balancePowerW + this.energyBalance.externalLeadLossW + this.energyBalance.tapeLossW + this.energyBalance.cellR0LossW + this.energyBalance.cellR1LossW + this.energyBalance.polarizationStorageRateW
        : NaN;
      const checks = [
        { id: "configuration", label: "konfiguracja 10S10P", passed: configurationMatches, observed: `${this.package?.series || 0}S / ${this.cells.length} ogniw` },
        { id: "commanded_current", label: "prąd zadany 50 A", passed: Math.abs(Math.abs(this.commandedPackCurrentA) - expectedPackCurrentA) <= currentToleranceA, observed: this.commandedPackCurrentA },
        { id: "pack_plus", label: "PACK+ ≈ 50 A", passed: Math.abs(Math.abs(plus?.currentA ?? NaN) - expectedPackCurrentA) <= currentToleranceA, observed: plus?.currentA ?? NaN },
        { id: "pack_minus", label: "PACK− ≈ 50 A", passed: Math.abs(Math.abs(minus?.currentA ?? NaN) - expectedPackCurrentA) <= currentToleranceA, observed: minus?.currentA ?? NaN },
        { id: "sections", label: "każda sekcja ≈ 50 A", passed: maxSectionCurrentErrorA <= currentToleranceA, observed: maxSectionCurrentErrorA },
        { id: "cell_average", label: "średni prąd ogniwa ≈ 5 A", passed: Math.abs(averageCellCurrentA - expectedPackCurrentA / expectedParallel) <= currentToleranceA, observed: averageCellCurrentA },
        { id: "kcl", label: "residual KCL < 1 mA", passed: kclErrorA < kclToleranceA, observed: kclErrorA },
        { id: "energy", label: "błąd bilansu energii ≤ 0,1%", passed: energyErrorPercent <= energyTolerancePercent, observed: energyErrorPercent },
        { id: "power", label: "moc źródeł = obciążenie + straty", passed: Number.isFinite(sourcePowerW) && Number.isFinite(accountedPowerW) && Math.abs(sourcePowerW - accountedPowerW) <= Math.max(.001, Math.abs(sourcePowerW) * .001), observed: Number.isFinite(sourcePowerW) && Number.isFinite(accountedPowerW) ? sourcePowerW - accountedPowerW : NaN }
      ];
      const hasCompletedStep = this.time > 0;
      const passed = hasCompletedStep && checks.every(check => check.passed);
      this.lastControlTest = {
        id: "10S10P_50A_after_first_valid_step", executedAtSimulationTimeS: this.time, expected: { series: expectedSeries, parallel: expectedParallel, packCurrentA: expectedPackCurrentA, averageCellCurrentA: 5, kclToleranceA, energyTolerancePercent },
        applicable: configurationMatches, hasCompletedStep, passed, checks,
        readings: { commandedPackCurrentA: this.commandedPackCurrentA, solvedPackCurrentA: this.solvedPackCurrentA, plusCurrentA: plus?.currentA ?? NaN, minusCurrentA: minus?.currentA ?? NaN, sectionCurrentsA, averageCellCurrentA, kclErrorA, energyErrorPercent, sourcePowerW, accountedPowerW }
      };
      const reason = !hasCompletedStep ? "test wymaga co najmniej jednego zatwierdzonego kroku symulacji" : !configurationMatches ? "test wymaga dokładnie konfiguracji 10S10P" : passed ? "test 10S10P / 50 A zaliczony" : `test 10S10P / 50 A niezaliczony: ${checks.filter(check => !check.passed).map(check => check.label).join(", ")}`;
      this.logEvent("TEST KONTROLNY", reason, { controlTest: this.lastControlTest });
      this.setState(reason, passed ? "ok" : "tripped");
      this.renderAll();
      return this.lastControlTest;
    }

    thermalCalibrationBounds() {
      return {
        cellToCellConductanceWK: { min: .001, max: .5, suggested: [.01, .03, .06, .12], unit: "W/K" },
        interiorCoolingFactor: { min: .05, max: 1, suggested: [.1, .25, .4, .55], unit: "×" },
        coreToSurfaceConductanceWK: { min: .05, max: 10, suggested: [.4, .8, 1.6, 3.2], unit: "W/K" },
        cellAirCoefficientWm2K: { min: .2, max: 80, suggested: [2, 6, 12, 28], unit: "W/(m²·K)" },
        tapeCellConductanceWK: { min: .005, max: 2, suggested: [.03, .08, .18, .4], unit: "W/K przy 64 mm²" },
        tapeToTapeContactConductanceWK: { min: .001, max: 1, suggested: [.01, .03, .06, .15], unit: "W/K przy polu referencyjnym" },
        cellToHolderCoefficientWm2K: { min: .1, max: 100, suggested: [2, 6, 12, 30], unit: "W/(m²·K)" },
        airMixingConductanceWK: { min: .001, max: 1, suggested: [.02, .05, .08, .2], unit: "W/K" },
        airToCaseCoefficientWm2K: { min: .2, max: 30, suggested: [1, 3, 5, 10], unit: "W/(m²·K)" },
        caseToAmbientCoefficientWm2K: { min: .2, max: 60, suggested: [2, 5, 8, 20], unit: "W/(m²·K)" }
      };
    }

    exportThermalCalibrationTemplate() {
      const template = {
        schema: "ebike-battery-thermal-calibration-v1",
        description: "Profil obciążenia i temperatury zmierzone na fizycznym pakiecie. Każdy czujnik musi mieć znane położenie lub identyfikator elementu.",
        environment: { ambientTemperatureC: this.settings().ambientC, enclosure: { mode: this.settings().thermalModel.environment, description: "uzupełnij materiał, grubość, kanały i sposób chłodzenia" } },
        loadProfile: [{ timeS: 0, commandedCurrentA: 0, measuredPackCurrentA: 0, measuredPackVoltageV: this.packVoltage || null, source: "measurement" }],
        sensors: [{ sensorId: "T1", type: "cellSurface", elementId: String(this.cells[0]?.id || "cell-id"), positionMm: this.cells[0] ? { x: this.cells[0].x, y: this.cells[0].y } : { x: 0, y: 0 } }],
        measurements: [{ timeS: 0, sensorId: "T1", temperatureC: this.settings().ambientC }],
        fitParameters: ["coreToSurfaceConductanceWK", "cellAirCoefficientWm2K"],
        parameterBounds: this.thermalCalibrationBounds(),
        validationProfile: { required: true, note: "Waliduj na innym profilu obciążenia niż użyty do dopasowania." }
      };
      this.download("szablon-kalibracji-termicznej.json", JSON.stringify(template, null, 2), "application/json");
    }

    exportThermalSensitivityPlan() {
      const bounds = this.thermalCalibrationBounds();
      const selected = [...($("stage4SensitivityScope")?.selectedOptions || [])].map(option => option.value).filter(key => bounds[key]);
      const baseline = this.settings().thermalModel;
      const scenarios = [{ id: "baseline", changedParameter: null, thermalModel: { ...baseline } }];
      selected.forEach(key => bounds[key].suggested.forEach(value => scenarios.push({ id: `${key}-${value}`, changedParameter: key, value, unit: bounds[key].unit, thermalModel: { ...baseline, [key]: value } })));
      const plan = {
        schema: "ebike-battery-thermal-sensitivity-plan-v1", deterministic: true,
        fixedConditions: { seed: this.settings().spread.seed, durationS: this.settings().durationS, timeStepS: this.settings().dt, mode: this.settings().mode, loadMode: this.settings().loadMode, currentA: this.settings().currentA, powerW: this.settings().powerW, initialPackVoltageV: this.settings().initialPackVoltageV },
        rule: "Zmieniaj jeden parametr naraz. Pozostałe ustawienia, geometria, seed, krok i historia obciążenia muszą pozostać identyczne.",
        parameterBounds: bounds, scenarios
      };
      this.download("plan-analizy-wrazliwosci-termicznej.json", JSON.stringify(plan, null, 2), "application/json");
    }

    async importThermalCalibrationData(file) {
      if (!file) return;
      const status = $("stage4CalibrationStatus");
      try {
        const data = JSON.parse(await file.text());
        if (data.schema !== "ebike-battery-thermal-calibration-v1" || !Array.isArray(data.sensors) || !Array.isArray(data.measurements)) throw new Error("Nieprawidłowy schemat lub brak list sensors/measurements.");
        const sensorIds = new Set(data.sensors.map(sensor => String(sensor.sensorId)));
        if (data.measurements.some(item => !sensorIds.has(String(item.sensorId)) || !Number.isFinite(Number(item.timeS)) || !Number.isFinite(Number(item.temperatureC)))) throw new Error("Pomiar odwołuje się do nieznanego czujnika albo ma nieprawidłowy czas/temperaturę.");
        const fitCount = Array.isArray(data.fitParameters) ? data.fitParameters.length : 0;
        if (fitCount > Math.max(1, sensorIds.size * 2)) throw new Error(`Wybrano ${fitCount} parametrów dla ${sensorIds.size} czujników. Ogranicz liczbę dopasowywanych parametrów.`);
        this.calibrationDataset = data;
        this.evaluateCalibrationDataset(true);
      } catch (error) {
        this.calibrationDataset = null; this.calibrationEvaluation = null;
        if (status) status.textContent = `Błąd danych kalibracyjnych: ${error.message}`;
      }
    }

    evaluateCalibrationDataset(updateUi = false) {
      if (!this.calibrationDataset || !this.history.length) return null;
      const sensors = new Map(this.calibrationDataset.sensors.map(sensor => [String(sensor.sensorId), sensor]));
      const prediction = (snapshot, sensor) => {
        if (sensor.type === "cellCore" || sensor.type === "cellSurface") { const cell = snapshot.cells.find(item => String(item[0]) === String(sensor.elementId)); return cell?.[sensor.type === "cellCore" ? 4 : 5]; }
        if (sensor.type === "tape") return snapshot.strips.find(item => String(item[0]) === String(sensor.elementId))?.[2];
        if (sensor.type === "air") return snapshot.airZones?.find(item => String(item[0]) === String(sensor.elementId))?.[1];
        if (sensor.type === "case") return snapshot.caseNodes?.find(item => String(item[0]) === String(sensor.elementId))?.[1];
        return NaN;
      };
      const residuals = this.calibrationDataset.measurements.map(measurement => {
        const sensor = sensors.get(String(measurement.sensorId));
        const snapshot = this.history.reduce((best, item) => Math.abs(item.timeS - measurement.timeS) < Math.abs(best.timeS - measurement.timeS) ? item : best, this.history[0]);
        const simulatedC = prediction(snapshot, sensor || {}), measuredC = Number(measurement.temperatureC);
        return { sensorId: measurement.sensorId, requestedTimeS: Number(measurement.timeS), matchedTimeS: snapshot.timeS, measuredC, simulatedC, errorK: simulatedC - measuredC };
      }).filter(item => Number.isFinite(item.simulatedC));
      const rmseK = residuals.length ? Math.sqrt(residuals.reduce((sum, item) => sum + item.errorK ** 2, 0) / residuals.length) : null;
      this.calibrationEvaluation = { evaluatedAtSimulationTimeS: this.time, matchedMeasurements: residuals.length, totalMeasurements: this.calibrationDataset.measurements.length, rmseK, residuals };
      if (updateUi && $("stage4CalibrationStatus")) $("stage4CalibrationStatus").textContent = residuals.length ? `Wczytano dane. Bieżący zestaw parametrów: RMSE ${fmt(rmseK, 3)} K dla ${residuals.length}/${this.calibrationDataset.measurements.length} pomiarów.` : "Wczytano dane, ale historia symulacji nie zawiera jeszcze pasujących elementów i czasów.";
      return this.calibrationEvaluation;
    }

    exportJson() {
      this.download("symulacja-pakietu.json", JSON.stringify({
        metadata: { approximate: true, welds_ignored: true, model: "lokalne_węzły_R0_R1_C1_z_pasywnym_BMS" },
        settings: this.settings(), cellModel: this.package.cellModel, stripSelection: this.package.stripSelection,
        runtime: { timeS: this.time, packVoltageV: this.packVoltage, commandedPackCurrentA: this.commandedPackCurrentA, solvedPackCurrentA: this.solvedPackCurrentA, energyWh: this.energyWh, packLossEnergyWh: this.lossEnergyWh, balanceEnergyWh: this.bmsBalanceEnergyWh, electricalValidation: this.lastElectricalValidation, energyBalance: this.energyBalance, controlTest: this.lastControlTest },
        externalLeads: this.externalLeads, passiveBalanceBranches: this.bmsBalanceBranches, sectionCurrentBalance: this.sectionCurrentBalance,
        thermalEnvironment: { airZones: this.airZones, caseNodes: this.caseNodes, maxima: this.thermalMaxima }, loadHistory: this.loadHistory, loadControlHistory: this.loadControlHistory,
        history: this.history, events: this.events, weakPoints: this.weakRecords
      }, null, 2), "application/json");
    }

    exportDiagnosticLog() {
      if (!this.package || !this.cells.length) return;
      const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
      const simulationSettings = this.settings(), thermalSettings = simulationSettings.thermalModel;
      const calibrationEvaluation = this.evaluateCalibrationDataset(false);
      const cellId = index => String(this.cells[index]?.id ?? `indeks-${index}`);
      const nodeDescriptors = Array.from({ length: this.nodeCount }, (_, node) => {
        const leadsAtNode = (this.externalLeads || []).filter(lead => lead.node === node).map(lead => lead.id);
        if (node < this.cells.length * 2) {
          const cell = this.cells[Math.floor(node / 2)];
          return { node, type: "zacisk_ogniwa", cellId: String(cell.id), biegunModelu: node % 2 ? "+" : "−", externalTerminals: leadsAtNode };
        }
        const lead = this.externalLeads?.find(item => item.node === node);
        if (lead) return { node, type: "węzeł_zewnętrzny", id: lead.id, attachmentNode: lead.attachmentNode, idealMerged: true };
        const connectedSegments = this.tapeSegments.filter(segment => segment.n1 === node || segment.n2 === node).map(segment => segment.id);
        return { node, type: "węzeł_pośredni_taśmy", segmenty: connectedSegments };
      });
      const cells = this.cells.map(cell => ({
        id: String(cell.id), index: cell.index, section: cell.section + 1, positionMm: { x: cell.x, y: cell.y }, nodes: { negativeNode: cell.index * 2, positiveNode: cell.index * 2 + 1 }, neighbourCount: cell.neighbourCount,
        capacityAh: cell.capacityAh, referenceCapacityAh: cell.referenceCapacityAh, absoluteChargeAh: cell.absoluteChargeAh, nominalCapacityAh: cell.nominalCapacityAh, baseDcirMohm: cell.baseDcirMohm,
        referenceSocPercent: cell.referenceSocPercent, availableSocPercent: cell.availableSocPercent, availableCapacityAh: cell.availableCapacityAh, availableChargeAh: cell.availableChargeAh, temperatureLimitedChargeAh: cell.temperatureLimitedChargeAh,
        temperatureC: cell.tempC, coreTemperatureC: cell.coreTempC, surfaceTemperatureC: cell.surfaceTempC,
        coolingFactor: cell.coolingFactor, coolingClass: cell.thermalGeometry?.coolingClass, configuredCoolingFactor: cell.thermalGeometry?.configuredCoolingFactor, appliedCoolingFactor: cell.thermalGeometry?.appliedCoolingFactor,
        thermalGeometry: clone(cell.thermalGeometry),
        currentLimitA: { discharge: { standard: cell.standardCurrentA, maximumContinuous: cell.maxCurrentA }, charge: { standard: cell.standardChargeCurrentA, maximum: cell.maxChargeCurrentA } }, currentExposure: clone(cell.currentExposure), voltageLimitV: { min: cell.voltageMinV, max: cell.voltageMaxV },
        electrical: { ocvV: cell.ocvV, terminalVoltageV: cell.voltageV, r0Ohm: cell.r0Ohm, r1Ohm: cell.r1Ohm, c1F: cell.c1F, polarizationVoltageV: cell.polarizationVoltageV, polarizationEnergyJ: cell.polarizationEnergyJ, cellCurrentA: cell.currentA, r0LossPowerW: cell.r0LossPowerW, r1LossPowerW: cell.r1LossPowerW, reversiblePowerW: cell.reversiblePowerW, lossPowerW: cell.powerW, lossEnergyWh: cell.lossEnergyWh },
        thermal: clone(cell.thermal)
      }));
      const tapeSegments = this.tapeSegments.map(segment => ({
        id: segment.id, tapeId: segment.tapeId, side: segment.side, nodes: [segment.n1, segment.n2],
        endpointsMm: { x1: segment.x1, y1: segment.y1, x2: segment.x2, y2: segment.y2 },
        geometry: { lengthMm: segment.lengthMm, widthMm: segment.widthMm, thicknessMm: segment.thicknessMm, areaM2: segment.areaM2, massKg: segment.massKg, heatCapacityJK: segment.heatCapacityJK },
        contactCellIds: segment.contactCells.map(index => cellId(index)), material: clone(segment.material),
        electrical: { voltageV: segment.voltageV, currentA: segment.currentA, resistanceOhm: segment.resistanceOhm, lossPowerW: segment.powerW, lossEnergyWh: segment.lossEnergyWh }, temperatureC: segment.tempC, thermal: clone(segment.thermal)
      }));
      const externalLeads = this.externalLeads.map(lead => ({ id: lead.id, node: lead.node, attachmentNode: lead.attachmentNode, idealMerged: true, voltageV: lead.voltageV, currentA: lead.currentA, lossPowerW: lead.powerW }));
      const passiveBalanceBranches = this.bmsBalanceBranches.map(branch => ({ id: branch.id, section: branch.section + 1, attachmentCellId: branch.attachmentCellId, nodes: [branch.n, branch.p], resistanceOhm: branch.resistanceOhm, voltageV: branch.voltageV, currentA: branch.currentA, lossPowerW: branch.powerW, lossEnergyWh: branch.energyWh, targetCurrentA: branch.targetCurrentA, activationVoltageV: branch.activationVoltageV }));
      const cellThermalLinks = this.neighbourPairs.map(([a, b]) => ({ fromCellId: cellId(a), toCellId: cellId(b), conductanceWK: thermalSettings.cellToCellConductanceWK }));
      const tapeThermalLinks = this.tapeSegments.flatMap(segment => (segment.thermal?.contacts || []).map(contact => ({ tapeSegmentId: segment.id, cellId: contact.cellId, contactAreaMm2: contact.contactAreaMm2, conductanceWK: contact.conductanceWK, heatFlowToCellW: contact.heatFlowToCellW })));
      const tapeAxialLinks = this.tapeSegments.flatMap(segment => (segment.thermal?.axialLinks || []).map(link => ({ fromSegmentId: segment.id, toSegmentId: link.segmentId, conductanceWK: link.conductanceWK, heatFlowOutW: link.heatFlowOutW })));
      const tapeContactLinks = this.tapeThermalContactPairs.map(contact => {
        const left = this.tapeSegments[contact.leftIndex], right = this.tapeSegments[contact.rightIndex];
        const live = left.thermal?.tapeContactLinks?.find(link => link.segmentId === right.id && Math.abs(link.xMm - contact.xMm) < .11 && Math.abs(link.yMm - contact.yMm) < .11);
        return { fromSegmentId: left.id, toSegmentId: right.id, kind: contact.kind, insulated: contact.insulated, electricallyConnected: false, xMm: contact.xMm, yMm: contact.yMm, overlapMm: contact.overlapMm, contactAreaMm2: contact.contactAreaMm2, conductanceWK: live?.conductanceWK ?? 0, heatFlowFromLeftToRightW: live?.heatFlowOutW ?? 0 };
      });
      const airZones = this.airZones.map(zone => ({ id: zone.id, index: zone.index, grid: { col: zone.col, row: zone.row }, boundsMm: { x1: zone.x1, y1: zone.y1, x2: zone.x2, y2: zone.y2 }, temperatureC: zone.tempC, volumeM3: zone.volumeM3, faceAreaM2: zone.faceAreaM2, heatCapacityJK: zone.heatCapacityJK, cellIds: zone.cellIndices.map(cellId), tapeSegmentIds: zone.tapeIndices.map(index => this.tapeSegments[index]?.id), thermal: clone(zone.thermal) }));
      const caseNodes = this.caseNodes.map(node => ({ id: node.id, index: node.index, airZoneId: this.airZones[node.airZoneIndex]?.id, boundsMm: { x1: node.x1, y1: node.y1, x2: node.x2, y2: node.y2 }, temperatureC: node.tempC, areaM2: node.areaM2, heatCapacityJK: node.heatCapacityJK, thermal: clone(node.thermal) }));
      const appliedAirMixingG = thermalSettings.airMixingConductanceWK * (thermalSettings.environment === "sealed-no-flow" ? .25 : thermalSettings.environment === "forced" ? 2 : 1);
      const airZoneThermalLinks = this.airZonePairs.map(([a, b]) => ({ fromAirZoneId: this.airZones[a].id, toAirZoneId: this.airZones[b].id, configuredConductanceWK: thermalSettings.airMixingConductanceWK, appliedConductanceWK: appliedAirMixingG, heatFlowFromAToBW: appliedAirMixingG * (this.airZones[a].tempC - this.airZones[b].tempC) }));
      const caseThermalLinks = this.caseNodePairs.map(([a, b]) => ({ fromCaseNodeId: this.caseNodes[a].id, toCaseNodeId: this.caseNodes[b].id, conductanceWK: thermalSettings.caseLateralConductanceWK, heatFlowFromAToBW: thermalSettings.caseLateralConductanceWK * (this.caseNodes[a].tempC - this.caseNodes[b].tempC) }));
      const airToCaseLinks = this.airZones.map((zone, index) => ({ fromAirZoneId: zone.id, toCaseNodeId: this.caseNodes[index].id, conductanceWK: thermalSettings.airToCaseCoefficientWm2K * zone.faceAreaM2, heatFlowToCaseW: zone.thermal?.caseHeatOutW ?? 0 }));
      const caseToAmbientLinks = this.caseNodes.map(node => ({ fromCaseNodeId: node.id, to: "ambient", convectionW: node.thermal?.convectionW ?? 0, radiationW: node.thermal?.radiationW ?? 0, totalHeatFlowW: node.thermal?.ambientHeatOutW ?? 0 }));
      const sampleInterval = Math.max(1, simulationSettings.durationS / 1500);
      const log = {
        schema: "ebike-battery-simulation-diagnostic-v4",
        exportedAtIso: new Date().toISOString(),
        purpose: "Pełny zapis danych potrzebnych do analizy elektrycznej, termicznej i topologicznej symulacji.",
        units: { geometry: "mm", voltage: "V", current: "A", resistance: "ohm", temperature: "°C", power: "W", energy: "Wh", charge: "Ah", thermalEnergy: "J", currentDensity: "A/mm²", thermalConductance: "W/K", heatCapacity: "J/K" },
        modelAssumptions: [
          "Termika ogniwa działa w wybranym trybie: jednowęzłowym lub dwuwęzłowym rdzeń–powierzchnia. W trybie dwuwęzłowym straty elektryczne trafiają do rdzenia, a wymiana z taśmami, sąsiadami, powietrzem i obudową zachodzi przez powierzchnię.",
          "W zamkniętej obudowie ogniwa i taśmy nie chłodzą się bezpośrednio do temperatury otoczenia. Ciepło przechodzi przez lokalne strefy powietrza i węzły obudowy, a dopiero następnie do otoczenia przez konwekcję i promieniowanie.",
          "Efektywna powierzchnia chłodzenia wynika z wymiarów ogniwa oraz zasłonięcia przez sąsiadów, holder i taśmy. Ustawiony, nadpisany i faktycznie zastosowany współczynnik chłodzenia są raportowane osobno.",
          "Ogniwo: źródło OCV, rezystancja R0 oraz dynamiczna polaryzacja R1-C1; stan Vp jest osobny dla każdego ogniwa.",
          "Każde ogniwo ma dokładnie jeden prąd: I=(OCV−Vp−Vzacisku)/R0. Ten sam prąd aktualizuje ładunek, SOC, straty, temperaturę i historię.",
          "Prąd standardowy jest zalecanym punktem pracy, a nie sztucznym ogranicznikiem równań. Przekroczenie zwiększa rzeczywiste straty I²R i jest rejestrowane jako ekspozycja ponadstandardowa.",
          "Prąd maksymalny jest granicą ciągłą ogniwa: ustala domyślne progi BMS, ogranicza prąd ładowarki z uwzględnieniem temperatury i jest raportowany osobno dla każdego ogniwa.",
          "Nie ma idealnego wspólnego napięcia sekcji równoległej ani sztucznego parallelBalanceCurrent. Prądy wyrównawcze wynikają wyłącznie z lokalnych węzłów i rezystancji taśm.",
          "PACK+ i PACK− są idealnie scalone z wybranymi węzłami magistrali; nie występują sztuczne rezystory 1 nΩ. Obciążenie jest źródłem prądowym między PACK+ i PACK−, z wymuszeniami o przeciwnych znakach.",
          "Krok jest zatwierdzany wyłącznie, gdy jednocześnie spełnione są: tolerancja napięciowa solvera, residual KCL ≤ 1 mA, bilans prądów sekcji, zgodność |PACK+| z |PACK−| oraz błąd bilansu elektrycznego ≤ 0,1%. W przeciwnym razie SOC, RC i termika nie są aktualizowane.",
          "Taśma: rezystancja zależna od temperatury; prąd, spadek napięcia i strata są liczone osobno dla każdego segmentu między punktami kontaktu.",
          "BMS: pasywne rezystory balansujące są zewnętrznymi gałęziami rezystancyjnymi. Ich ciepło nie jest doliczane do termiki pakietu, ale jest raportowane w bilansie.",
          "Składnik odwracalny I·T·dOCV/dT jest ustawiony jawnie na 0 W, bo katalog nie dostarcza dOCV/dT. Model nadal pomija rezystancję i geometrię zgrzewów; współczynniki termiczne kontaktów są parametrami kalibracyjnymi, a nie wynikiem pomiaru."
        ],
        runtime: { status: this.status, finishReason: this.finishReason || null, timeS: this.time, packVoltageV: this.packVoltage, commandedPackCurrentA: this.commandedPackCurrentA, solvedPackCurrentA: this.solvedPackCurrentA, deliveredEnergyWh: this.energyWh, packLossEnergyWh: this.lossEnergyWh, bmsBalanceEnergyWh: this.bmsBalanceEnergyWh, groupAverageVoltagesV: [...this.groupVoltages], sectionBmsVoltagesV: [...(this.sectionBmsVoltages || [])], nodeVoltagesV: Array.from(this.nodeVoltages || []), electricalValidation: clone(this.lastElectricalValidation), energyBalance: clone(this.energyBalance), controlTest: clone(this.lastControlTest) },
        replay: { deterministicSeed: simulationSettings.spread.seed, settingsSnapshot: clone(simulationSettings), sourceCellIds: this.cells.map(cell => String(cell.id)), note: "Powtórzenie wymaga tej samej geometrii etapu 3, profilu ogniwa, seed, kroku, czasu i historii sterowania." },
        settings: simulationSettings,
        bms: clone(this.bms),
        package: {
          series: this.package.series, parallel: this.package.parallel, polarityReversed: Boolean(this.package.polarityReversed), boundary: clone(this.package.boundary || []),
          cellModel: clone(this.package.cellModel), stripSelection: clone(this.package.stripSelection), stripMaterial: clone(this.package.stripMaterial),
          leadMinus: cellId(this.leadMinusIndex), leadPlus: cellId(this.leadPlusIndex), sourceCells: clone(this.package.cells), sourceTapes: clone(this.package.tapes)
        },
        topology: { diagnostics: clone(this.topologyDiagnostics), nodes: nodeDescriptors, cells, tapeSegments, tapeSummaries: this.summarizeTapes(), externalLeads, passiveBalanceBranches, sectionCurrentBalance: clone(this.sectionCurrentBalance) },
        thermalNetwork: {
          ambientC: simulationSettings.ambientC,
          cellConvectionApplied: { openPackCoefficientWm2K: this.package.cellModel.thermal.heat_transfer_W_m2K, cellAirCoefficientWm2K: thermalSettings.cellAirCoefficientWm2K, forcedAirCoefficientWm2K: thermalSettings.forcedAirCoefficientWm2K, areaSource: "cell.thermalGeometry.exposedAreaM2", coolingFactorSource: "configuredCoolingFactor × overrideCoolingFactor" },
          fidelity: thermalSettings.fidelity,
          environment: thermalSettings.environment,
          geometryClassification: "Na podstawie geometrycznie odsłoniętej powierzchni bocznej i denek; pełne dane są zapisane osobno dla każdego ogniwa.",
          coreToSurfaceConductanceWK: thermalSettings.coreToSurfaceConductanceWK,
          cellAirCoefficientWm2K: thermalSettings.cellAirCoefficientWm2K,
          forcedAirCoefficientWm2K: thermalSettings.forcedAirCoefficientWm2K,
          cellConvection: { coefficientWm2K: this.package.cellModel.thermal.heat_transfer_W_m2K, surfaceAreaM2: this.package.cellModel.geometry.surface_area_m2, classes: { exteriorFactor: thermalSettings.exteriorCoolingFactor, transitionFactor: thermalSettings.transitionCoolingFactor, interiorFactor: thermalSettings.interiorCoolingFactor }, classification: "zewnętrzne: mniej niż max−1 sąsiadów; pośrednie: max−1; wewnętrzne: max sąsiadów" },
          tapeConvectionCoefficientWm2K: thermalSettings.tapeConvectionCoefficientWm2K, tapeToTapeContactConductanceWK: thermalSettings.tapeToTapeContactConductanceWK, cellToCellLinks: cellThermalLinks, tapeToCellLinks: tapeThermalLinks, tapeAxialLinks, tapeContactLinks
        },
        thermalEnvironment: { airZones, caseNodes, airZoneLinks: airZoneThermalLinks, airToCaseLinks, caseNodeLinks: caseThermalLinks, caseToAmbientLinks, maxima: clone(this.thermalMaxima) },
        loadHistory: clone(this.loadHistory), loadControlHistory: clone(this.loadControlHistory),
        thermalCalibration: { status: this.calibrationDataset ? "wczytano pomiary; oceniono bieżący zestaw parametrów" : "brak pomiarów; dostępny deterministyczny plan analizy wrażliwości", dataset: clone(this.calibrationDataset), evaluation: clone(calibrationEvaluation), parameterBounds: this.thermalCalibrationBounds(), suggestedTargets: ["temperatura powierzchni pojedynczego ogniwa", "temperatura rdzenia estymowana", "temperatura taśmy", "temperatura powietrza i obudowy"], sensitivityParameters: ["coreToSurfaceConductanceWK", "cellAirCoefficientWm2K", "cellToCellConductanceWK", "cellToHolderCoefficientWm2K", "tapeCellConductanceWK", "tapeToTapeContactConductanceWK", "airMixingConductanceWK", "airToCaseCoefficientWm2K", "caseToAmbientCoefficientWm2K", "caseContactFraction"] },
        solver: clone(this.lastSolverDiagnostics), controlTest: clone(this.lastControlTest), weakRecords: clone(this.weakRecords), events: clone(this.events),
        historyFormat: {
          sampling: { strategy: "stan początkowy, próbki co 0,05–0,5 s w pierwszych 2% lub 30 s, następnie do 1500 próbek równomiernych", targetIntervalAfterWarmupS: sampleInterval, samples: this.history.length },
          cellColumns: ["id", "terminalVoltageV", "cellCurrentA", "referenceSocPercent", "coreTemperatureC", "surfaceTemperatureC", "localTerminalVoltageV", "ocvV", "r0Ohm", "r1Ohm", "c1F", "polarizationVoltageV", "polarizationEnergyJ", "absoluteChargeAh", "availableChargeAh", "temperatureLimitedChargeAh", "availableSocPercent", "r0LossPowerW", "r1LossPowerW", "lossPowerW", "lossEnergyWh", "secondsAboveStandard", "secondsAboveMaximum", "peakStandardRatio", "peakMaximumRatio"],
          stripColumns: ["id", "currentA", "temperatureC", "voltageV", "resistanceOhm", "lossPowerW", "lossEnergyWh"],
          airZoneColumns: ["id", "temperatureC"], caseNodeColumns: ["id", "temperatureC"],
          externalLeadColumns: ["id", "currentA", "voltageV", "idealMerged", "lossPowerW"],
          balanceBranchColumns: ["id", "section", "attachmentCellId", "currentA", "voltageV", "resistanceOhm", "lossPowerW", "lossEnergyWh"],
          snapshotColumns: ["timeS", "voltageV", "commandedPackCurrentA", "solvedPackCurrentA", "currentA", "powerW", "energyWh", "lossWh", "balanceEnergyWh", "maxTempC", "maxCellCoreTempC", "maxCellSurfaceTempC", "maxTapeTempC", "maxAirTempC", "maxCaseTempC", "minSoc", "maxSoc", "groupVoltages", "sectionBmsVoltages", "cells", "strips", "airZones", "caseNodes", "load", "externalLeads", "balanceBranches", "sectionCurrentBalance", "electricalValidation", "energyBalance", "nodeVoltagesV", "bms", "solver"],
          snapshots: this.history
        }
      };
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.download(`log-diagnostyczny-symulacji-${stamp}.json`, JSON.stringify(log, null, 2), "application/json");
    }
    exportCsv() {
      const rows = [["time_s","pack_voltage_V","commanded_pack_current_A","solved_pack_current_A","pack_current_A","pack_power_W","energy_Wh","loss_Wh","max_temp_C","max_cell_core_temp_C","max_cell_surface_temp_C","max_tape_temp_C","max_air_temp_C","max_case_temp_C","min_soc_percent","max_soc_percent","max_kcl_residual_A","electrical_energy_error_percent","thermal_energy_error_percent"], ...this.history.map(h => [h.timeS,h.voltageV,h.commandedPackCurrentA,h.solvedPackCurrentA,h.currentA,h.powerW,h.energyWh,h.lossWh,h.maxTempC,h.maxCellCoreTempC,h.maxCellSurfaceTempC,h.maxTapeTempC,h.maxAirTempC,h.maxCaseTempC,h.minSoc,h.maxSoc,h.solver?.maxKclResidualA,h.energyBalance?.electricalErrorPercent,h.energyBalance?.thermalErrorPercent])];
      this.download("symulacja-pakietu.csv", rows.map(row => row.join(",")).join("\n"), "text/csv");
    }
    download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  global.Stage4Simulation = Stage4Simulation;
})(window);
