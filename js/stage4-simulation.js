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

  class Stage4Simulation {
    constructor(dataProvider) {
      this.dataProvider = dataProvider;
      this.package = null;
      this.cells = [];
      this.tapeSegments = [];
      this.nodes = [];
      this.groupVoltages = [];
      this.history = [];
      this.events = [];
      this.weakRecords = {};
      this.adaptiveStepReported = false;
      this.overrides = new Map();
      this.selectedCell = null;
      this.selectedStrip = null;
      this.status = "idle";
      this.time = 0;
      this.energyWh = 0;
      this.lossEnergyWh = 0;
      this.lastFrame = 0;
      this.visualAccumulator = 0;
      this.activeTab = "summary";
      this.bms = { connected: true, state: "CZUWANIE", timers: {}, lastTrip: null };
      this.boundLoop = timestamp => this.loop(timestamp);
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
        if (values) { $("stage4SegmentLengthMm").value = values[0]; $("stage4TimeStepS").value = values[1]; }
      });
      $("stage4Mode")?.addEventListener("change", () => this.updateModeUi());
      document.querySelectorAll("[data-stage4-tab]").forEach(button => button.addEventListener("click", () => {
        this.activeTab = button.dataset.stage4Tab;
        this.activateTab(this.activeTab);
        this.renderResults();
      }));
      $("stage4ExportCsv")?.addEventListener("click", () => this.exportCsv());
      $("stage4ExportJson")?.addEventListener("click", () => this.exportJson());
      ["stage4ScaleMin", "stage4ScaleMax", "stage4AutoScale"].forEach(id => $(id)?.addEventListener("input", () => this.renderVisual()));
      this.bindVisualNavigation();
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
        const rect = svg.getBoundingClientRect();
        const dx = event.clientX - this.visualPan.x, dy = event.clientY - this.visualPan.y;
        this.visualViewBox.x -= dx / Math.max(1, rect.width) * this.visualViewBox.width;
        this.visualViewBox.y -= dy / Math.max(1, rect.height) * this.visualViewBox.height;
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
      svg.addEventListener("wheel", event => {
        if (!this.visualViewBox || !this.visualBaseViewBox) return;
        event.preventDefault();
        const rect = svg.getBoundingClientRect();
        const px = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        const py = clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
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
      const incoming = this.dataProvider?.();
      if (!incoming?.cells?.length) {
        this.setState("Brak przypisanych ogniw. Uzupełnij etapy 1–3.", "tripped");
        return;
      }
      if (!incoming.cellModel) {
        this.setState("Brak modelu ogniwa z etapu 3. Uzupełnij parametry ogniwa przed uruchomieniem symulacji.", "tripped");
        return;
      }
      const signature = JSON.stringify({ cells: incoming.cells.map(c => [c.id, c.x, c.y, c.section]), tapes: incoming.tapes, strip: incoming.stripSelection, model: incoming.cellModel });
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
      if (firstGroup.length) $("stage4LeadMinus").value = String(firstGroup.slice().sort((a, b) => a.x - b.x)[0].id);
      if (lastGroup.length) $("stage4LeadPlus").value = String(lastGroup.slice().sort((a, b) => b.x - a.x)[0].id);
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
        $("stage4CurrentA").value = Math.max(0.1, this.package.parallel * model.max_continuous_discharge_A * 0.5);
      }
    }

    applyBmsDefaults() {
      const model = this.package?.cellModel;
      if (!model) return;
      $("stage4BmsVmax").value = model.voltage_max_V;
      $("stage4BmsVmin").value = model.voltage_min_V;
      $("stage4BmsDischargeA").value = model.max_continuous_discharge_A * this.package.parallel;
      $("stage4BmsChargeA").value = model.max_charge_A * this.package.parallel;
      $("stage4BalanceStartV").value = Math.max(model.voltage_min_V, model.voltage_max_V - 0.15).toFixed(2);
    }

    updateModeUi() {
      const charge = $("stage4Mode").value === "charge";
      $("stage4LoadMode").disabled = charge;
      this.renderAll();
    }

    settings() {
      return {
        mode: $("stage4Mode").value,
        loadMode: $("stage4LoadMode").value,
        currentA: Math.max(0, num("stage4CurrentA", 20)),
        powerW: Math.max(0, num("stage4PowerW", 500)),
        cvEndA: Math.max(0, num("stage4CvEndCurrentA", 1)),
        ambientC: num("stage4AmbientC", 25),
        durationS: Math.max(1, num("stage4DurationS", 7200)),
        dt: Math.max(0.01, num("stage4TimeStepS", 1)),
        speed: Math.max(1, num("stage4Speed", 60)),
        thermal: $("stage4ThermalEnabled").checked,
        quality: $("stage4Quality").value,
        maxSegmentMm: Math.max(1, num("stage4SegmentLengthMm", 20)),
        spread: {
          enabled: $("stage4SpreadEnabled").checked,
          seed: Math.trunc(num("stage4Seed", 12345)),
          capacity: Math.max(0, num("stage4SpreadCapacity", 2)),
          dcir: Math.max(0, num("stage4SpreadDcir", 5)),
          soc: Math.max(0, num("stage4SpreadSoc", 0.5))
        },
        bmsEnabled: $("stage4BmsEnabled").checked,
        balanceEnabled: $("stage4BalanceEnabled").checked
      };
    }

    reset(regenerated = false) {
      if (!this.package) return;
      cancelAnimationFrame(this.raf);
      this.status = "idle";
      this.time = 0;
      this.energyWh = 0;
      this.lossEnergyWh = 0;
      this.finishReason = "";
      this.history = [];
      this.events = [];
      this.weakRecords = {};
      this.adaptiveStepReported = false;
      this.pcgRecoveryReported = false;
      this.bms = { connected: true, state: "CZUWANIE", timers: {}, lastTrip: null };
      this.chargePhase = "CC";
      this.package.cellModel = JSON.parse(JSON.stringify(this.baseCellModel));
      this.applyCustomCharacteristics();
      this.generateCells();
      this.buildTopology();
      this.solveElectrical(0);
      this.recordHistory(true);
      this.setState(regenerated ? `Wygenerowano nowy zestaw ogniw. Seed: ${this.settings().spread.seed}.` : "Model gotowy. Parametry zgrzewów i fizycznego BMS są pominięte.");
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
      const spread = this.settings().spread;
      const random = this.seededRandom(spread.seed);
      this.cells = this.package.cells.map((source, index) => {
        const capacityFactor = spread.enabled ? 1 + this.boundedNormal(random, spread.capacity) / 100 : 1;
        const dcirFactor = spread.enabled ? 1 + this.boundedNormal(random, spread.dcir) / 100 : 1;
        const socOffset = spread.enabled ? this.boundedNormal(random, spread.soc) : 0;
        const override = this.overrides.get(String(source.id)) || {};
        return {
          ...source,
          index,
          capacityAh: override.capacityAh ?? model.capacity_nominal_Ah * capacityFactor,
          nominalCapacityAh: model.capacity_nominal_Ah,
          baseDcirMohm: override.dcirMohm ?? model.dcir_at_current_soh_mohm * dcirFactor,
          soc: clamp(override.soc ?? model.initial_soc_percent + socOffset, 0, 100),
          tempC: override.tempC ?? model.initial_temperature_C,
          coolingFactor: override.coolingFactor ?? 1,
          maxCurrentA: override.maxCurrentA ?? model.max_continuous_discharge_A,
          maxChargeCurrentA: override.maxChargeCurrentA ?? model.max_charge_A,
          voltageMinV: override.voltageMinV ?? model.voltage_min_V,
          voltageMaxV: override.voltageMaxV ?? model.voltage_max_V,
          chargeTempMinC: num("stage4BmsChargeTmin", 0), chargeTempMaxC: num("stage4BmsChargeTmax", 45),
          dischargeTempMinC: num("stage4BmsDischargeTmin", -20), dischargeTempMaxC: num("stage4BmsDischargeTmax", 60),
          currentA: 0, voltageV: 0, ocvV: 0, resistanceOhm: 0, powerW: 0, lossEnergyWh: 0
        };
      });
      this.buildCellNeighbours();
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
            this.tapeSegments.push({
              id: `${side}-${tapeIndex}-${pair - 1}-${part}`, tapeId: tape.id, side, n1: previousNode, n2: nextNode,
              x1: a.x + (b.x - a.x) * t0, y1: a.y + (b.y - a.y) * t0, x2: a.x + (b.x - a.x) * t1, y2: a.y + (b.y - a.y) * t1,
              lengthMm, widthMm, thicknessMm, areaM2: widthMm * thicknessMm * 1e-6,
              massKg: volumeM3 * material.density, heatCapacityJK: Math.max(1e-6, volumeM3 * material.density * material.specificHeat),
              material, materialName: this.package.stripMaterial?.name_pl || this.package.stripSelection.materialId,
              tempC: this.package.cellModel.initial_temperature_C, currentA: 0, voltageV: 0, resistanceOhm: 0, powerW: 0, lossEnergyWh: 0,
              endpointCells: [a.index, b.index]
            });
            previousNode = nextNode;
          }
        }
      }));
      this.nodeVoltages = new Float64Array(this.nodeCount);
      this.cells.forEach(cell => { const base = cell.section * this.package.cellModel.voltage_nominal_V; this.nodeVoltages[cell.index * 2] = base; this.nodeVoltages[cell.index * 2 + 1] = base + this.package.cellModel.voltage_nominal_V; });
      this.leadMinusIndex = this.cells.find(c => String(c.id) === String($("stage4LeadMinus").value))?.index ?? 0;
      this.leadPlusIndex = this.cells.find(c => String(c.id) === String($("stage4LeadPlus").value))?.index ?? this.cells.length - 1;
      this.leadMinusNode = this.leadMinusIndex * 2;
      this.leadPlusNode = this.leadPlusIndex * 2 + 1;
      this.topologyDiagnostics = this.analyzeTopology();
      const topologyMessage = this.formatTopologyDiagnostics(this.topologyDiagnostics);
      this.logEvent(this.topologyDiagnostics.valid ? "TOPOLOGIA" : "BŁĄD TOPOLOGII", topologyMessage, { diagnostics: this.topologyDiagnostics });
    }

    analyzeTopology() {
      const graph = Array.from({ length: this.nodeCount }, () => []);
      const connect = (a, b) => { graph[a].push(b); graph[b].push(a); };
      this.cells.forEach(cell => connect(cell.index * 2, cell.index * 2 + 1));
      this.tapeSegments.forEach(segment => connect(segment.n1, segment.n2));
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
      this.bms.state = this.settings().mode === "charge" ? "ŁADOWANIE" : "ROZŁADOWANIE";
      this.lastFrame = performance.now();
      this.setState("Symulacja działa.", "running");
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.boundLoop);
    }

    pause() { if (this.status === "running") { this.status = "paused"; cancelAnimationFrame(this.raf); this.setState("Pauza — stan fizyczny został zachowany."); this.renderAll(); } }
    resume() { if (this.status === "paused") { this.status = "running"; this.lastFrame = performance.now(); this.setState("Kontynuacja symulacji.", "running"); this.raf = requestAnimationFrame(this.boundLoop); } }
    stop(reason = "Zatrzymano") { cancelAnimationFrame(this.raf); this.status = "finished"; this.finishReason = reason; this.logEvent("KONIEC", reason); this.setState(reason, reason.includes("BMS") || reason.includes("temperatur") ? "tripped" : ""); this.renderAll(); }

    loop(timestamp) {
      if (this.status !== "running") return;
      const realDelta = Math.min(.1, Math.max(.001, (timestamp - this.lastFrame) / 1000));
      this.lastFrame = timestamp;
      let budget = realDelta * this.settings().speed;
      let guard = 0;
      while (budget > 0 && this.status === "running" && guard++ < 500) {
        const requested = Math.min(this.settings().dt, budget);
        const used = this.step(requested);
        if (!(used > 0)) break;
        budget -= used;
      }
      this.visualAccumulator += realDelta;
      if (this.visualAccumulator >= .12) { this.visualAccumulator = 0; this.renderAll(); }
      if (this.status === "running") this.raf = requestAnimationFrame(this.boundLoop);
    }

    requestedPackCurrent() {
      const settings = this.settings();
      const direction = settings.mode === "charge" ? -1 : 1;
      if (settings.mode === "charge") {
        const coldest = this.cells.length ? Math.min(...this.cells.map(cell => cell.tempC)) : this.package.cellModel.initial_temperature_C;
        const temperatureLimit = this.package.cellModel.max_charge_A * this.package.parallel * clamp(interp(this.package.cellModel.charge_current_temperature_factor, coldest), 0, 1);
        if (this.chargePhase === "CV") {
          const target = this.package.series * this.package.cellModel.voltage_max_V;
          const voltageError = Math.max(0, target - (this.packVoltage || 0));
          const estimatedR = this.cells.reduce((sum, cell) => sum + cell.resistanceOhm, 0) / Math.max(1, this.package.parallel * this.package.parallel);
          return -Math.min(settings.currentA, temperatureLimit, estimatedR > 0 ? voltageError / estimatedR : settings.currentA);
        }
        return -Math.min(settings.currentA, temperatureLimit);
      }
      if (settings.loadMode === "power") return settings.powerW / Math.max(.1, Math.abs(this.packVoltage || this.package.series * this.package.cellModel.voltage_nominal_V));
      return direction * settings.currentA;
    }

    step(requestedDt) {
      let packCurrent = this.bms.connected ? this.requestedPackCurrent() : 0;
      if (!this.solveElectrical(packCurrent)) {
        const details = this.formatSolverDiagnostics(this.lastSolverDiagnostics);
        this.logEvent("SOLVER", details, { diagnostics: this.lastSolverDiagnostics });
        this.stop(`Solver nie osiągnął zbieżności. Przyczyna: ${this.lastSolverDiagnostics?.cause || "nieznana"}. Szczegóły zapisano w dzienniku.`);
        return 0;
      }
      if (!this.validateFinite()) { this.stop("Utrata stabilności numerycznej: wykryto NaN, Infinity lub ujemną rezystancję."); return 0; }
      const dt = this.updateThermalAndSoc(requestedDt);
      if (dt <= .0001001 && requestedDt > .01) { this.stop("Granica stabilności modelu: wymagany krok czasowy jest zbyt mały."); return 0; }
      this.time += dt;
      this.energyWh += Math.abs(this.packVoltage * packCurrent) * dt / 3600;
      this.lossEnergyWh += (this.cells.reduce((s, c) => s + c.powerW, 0) + this.tapeSegments.reduce((s, t) => s + t.powerW, 0)) * dt / 3600;
      this.applyBalancing(dt);
      this.updateBms(dt, packCurrent);
      this.updateWeakPoints();
      this.recordHistory();
      this.checkEndConditions(packCurrent);
      return dt;
    }

    solveElectrical(packCurrent) {
      if (Math.abs(packCurrent) > 1e-12 && this.topologyDiagnostics && !this.topologyDiagnostics.valid) {
        this.lastSolverDiagnostics = { phase: "topology", converged: false, packCurrent, topology: this.topologyDiagnostics, cause: this.topologyDiagnostics.reasons.join("; ") };
        return false;
      }
      const N = this.nodeCount, adjacency = Array.from({ length: N }, () => []), diag = new Float64Array(N), b = new Float64Array(N);
      const addBranch = (n1, n2, resistance) => {
        const r = Math.max(1e-9, resistance), g = 1 / r;
        adjacency[n1].push([n2, g]); adjacency[n2].push([n1, g]); diag[n1] += g; diag[n2] += g;
      };
      const model = this.package.cellModel;
      this.cells.forEach(cell => {
        cell.ocvV = interp(model.ocv_soc, cell.soc);
        const kT = interp(model.resistance_temperature_factor, cell.tempC), kSoc = interp(model.resistance_soc_factor, cell.soc);
        cell.resistanceOhm = Math.max(1e-6, cell.baseDcirMohm * 1e-3 * kT * kSoc);
        const n = cell.index * 2, p = n + 1, g = 1 / cell.resistanceOhm;
        addBranch(n, p, cell.resistanceOhm); b[p] += cell.ocvV * g; b[n] -= cell.ocvV * g;
      });
      this.tapeSegments.forEach(segment => {
        const rhoT = segment.material.resistivity * (1 + segment.material.tcr * (segment.tempC - 20));
        segment.resistanceOhm = Math.max(1e-9, rhoT * segment.lengthMm * 1e-3 / segment.areaM2);
        addBranch(segment.n1, segment.n2, segment.resistanceOhm);
      });
      b[this.leadPlusNode] -= packCurrent; b[this.leadMinusNode] += packCurrent;
      const ref = this.leadMinusNode, V = this.nodeVoltages, iterations = { low: 60, medium: 100, high: 180 }[this.settings().quality] || 100;
      let converged = false, iterationsUsed = 0, finalMaxDiff = Infinity, worstNode = -1, initialMaxDiff = null, pcgResult = null, solverMethod = "Gauss-Seidel";
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
        if (maxDiff < 1e-7) { converged = true; break; }
      }
      const gaussSeidelIterations = iterationsUsed;
      const gaussSeidelFinalDiff = finalMaxDiff;
      if (!converged) {
        const pcgLimit = Math.max(100, Math.min(2500, N * ({ low: 2, medium: 4, high: 8 }[this.settings().quality] || 4)));
        pcgResult = this.solveGroundedPcg(V, diag, adjacency, b, ref, pcgLimit, 1e-7);
        solverMethod = "Gauss-Seidel + PCG";
        iterationsUsed += pcgResult.iterationsUsed;
        finalMaxDiff = pcgResult.maxVoltageCorrectionV;
        worstNode = pcgResult.worstNode;
        converged = pcgResult.converged;
      }
      this.packCurrent = packCurrent;
      this.packVoltage = V[this.leadPlusNode] - V[this.leadMinusNode];
      this.cells.forEach(cell => {
        const n = cell.index * 2, p = n + 1;
        cell.voltageV = V[p] - V[n];
        cell.currentA = (cell.ocvV - cell.voltageV) / cell.resistanceOhm;
        cell.powerW = cell.currentA * cell.currentA * cell.resistanceOhm;
      });
      this.tapeSegments.forEach(segment => {
        segment.voltageV = V[segment.n1] - V[segment.n2];
        segment.currentA = segment.voltageV / segment.resistanceOhm;
        segment.powerW = segment.currentA * segment.currentA * segment.resistanceOhm;
      });
      this.groupVoltages = Array.from({ length: this.package.series }, (_, section) => {
        const group = this.cells.filter(cell => cell.section === section);
        return group.length ? group.reduce((sum, cell) => sum + cell.voltageV, 0) / group.length : 0;
      });
      if (this.settings().mode === "charge" && this.chargePhase === "CC" && Math.max(...this.groupVoltages) >= this.package.cellModel.voltage_max_V * .995) {
        this.chargePhase = "CV"; this.logEvent("ŁADOWARKA", "Przejście z CC do CV");
      }
      const positiveDiagonal = Array.from(diag).filter(value => value > 0);
      const cellResistances = this.cells.map(cell => cell.resistanceOhm);
      const stripResistances = this.tapeSegments.map(segment => segment.resistanceOhm);
      const allResistances = [...cellResistances, ...stripResistances].filter(value => value > 0);
      const minResistance = allResistances.length ? Math.min(...allResistances) : NaN;
      const maxResistance = allResistances.length ? Math.max(...allResistances) : NaN;
      const minDiagonal = positiveDiagonal.length ? Math.min(...positiveDiagonal) : NaN;
      const maxDiagonal = positiveDiagonal.length ? Math.max(...positiveDiagonal) : NaN;
      const convergenceRatio = initialMaxDiff > 0 ? finalMaxDiff / initialMaxDiff : 0;
      let cause = "zbieżność osiągnięta";
      if (!converged) {
        if (this.topologyDiagnostics && !this.topologyDiagnostics.valid) cause = this.topologyDiagnostics.reasons.join("; ");
        else if (pcgResult?.breakdown) cause = `solver PCG został przerwany: ${pcgResult.breakdown}`;
        else if (Number.isFinite(minResistance) && Number.isFinite(maxResistance) && maxResistance / minResistance > 1e7) cause = "sieć jest źle uwarunkowana: bardzo duża różnica między rezystancją ogniw i taśm";
        else if (convergenceRatio > .9) cause = "iteracje praktycznie nie zmniejszają błędu; możliwy wiszący komponent lub osobliwość macierzy";
        else cause = "osiągnięto limit iteracji przed uzyskaniem wymaganej dokładności";
      }
      this.lastSolverDiagnostics = {
        phase: "solver", converged, cause, solverMethod, packCurrent, packVoltage: this.packVoltage,
        nodeCount: N, branchCount: this.cells.length + this.tapeSegments.length,
        iterationsLimit: iterations + (pcgResult?.iterationsLimit || 0), iterationsUsed, gaussSeidelIterations, gaussSeidelFinalDiffV: gaussSeidelFinalDiff,
        pcgIterations: pcgResult?.iterationsUsed || 0, pcgRelativeResidual: pcgResult?.relativeResidual ?? null, pcgBreakdown: pcgResult?.breakdown || null,
        toleranceV: 1e-7, initialMaxDiffV: initialMaxDiff, finalMaxDiffV: finalMaxDiff,
        convergenceRatio, worstNode, worstNodeDescription: this.describeNode(worstNode),
        resistanceMinOhm: minResistance, resistanceMaxOhm: maxResistance,
        resistanceRatio: Number.isFinite(minResistance) && minResistance > 0 ? maxResistance / minResistance : NaN,
        diagonalMinS: minDiagonal, diagonalMaxS: maxDiagonal,
        voltageMinV: V.length ? Math.min(...V) : NaN, voltageMaxV: V.length ? Math.max(...V) : NaN,
        topology: this.topologyDiagnostics
      };
      if (pcgResult && converged && !this.pcgRecoveryReported) {
        this.pcgRecoveryReported = true;
        this.logEvent("SOLVER", `Gauss-Seidel nie osiągnął tolerancji po ${gaussSeidelIterations} iteracjach. PCG doprowadził rozwiązanie do błędu ${fmt(finalMaxDiff, 9)} V w ${pcgResult.iterationsUsed} iteracjach.`, { diagnostics: this.lastSolverDiagnostics });
      }
      return converged || Math.abs(packCurrent) < 1e-12;
    }

    solveGroundedPcg(V, diag, adjacency, b, ref, iterationsLimit, toleranceV) {
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
      if (maxCorrection <= toleranceV) return { converged: true, iterationsUsed: 0, iterationsLimit, maxVoltageCorrectionV: maxCorrection, worstNode, relativeResidual: 0, breakdown: null };
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
        if (maxCorrection <= toleranceV) return { converged: true, iterationsUsed, iterationsLimit, maxVoltageCorrectionV: maxCorrection, worstNode, relativeResidual, breakdown: null };
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
      return { converged: false, iterationsUsed, iterationsLimit, maxVoltageCorrectionV: maxCorrection, worstNode, relativeResidual, breakdown };
    }

    describeNode(node) {
      if (!(node >= 0)) return "brak";
      if (node < this.cells.length * 2) {
        const cell = this.cells[Math.floor(node / 2)];
        return `ogniwo ${cell?.id ?? "?"}, biegun ${node % 2 ? "+" : "−"}, S${(cell?.section ?? 0) + 1}`;
      }
      const segment = this.tapeSegments.find(item => item.n1 === node || item.n2 === node);
      return segment ? `węzeł pośredni taśmy ${segment.id}` : `węzeł ${node}`;
    }

    formatSolverDiagnostics(diagnostics) {
      if (!diagnostics) return "Brak danych diagnostycznych solvera.";
      if (diagnostics.phase === "topology") return `${diagnostics.cause}. ${this.formatTopologyDiagnostics(diagnostics.topology)}`;
      return `${diagnostics.cause}. Metoda ${diagnostics.solverMethod}; Gauss-Seidel ${diagnostics.gaussSeidelIterations} iteracji (błąd ${fmt(diagnostics.gaussSeidelFinalDiffV, 9)} V), PCG ${diagnostics.pcgIterations} iteracji${diagnostics.pcgBreakdown ? `, awaria: ${diagnostics.pcgBreakdown}` : ""}. Błąd końcowy ${fmt(diagnostics.finalMaxDiffV, 9)} V (tolerancja ${diagnostics.toleranceV} V), względne residuum PCG ${fmt(diagnostics.pcgRelativeResidual, 10)}, najgorszy węzeł: ${diagnostics.worstNodeDescription}, R min/max ${fmt(diagnostics.resistanceMinOhm, 10)}/${fmt(diagnostics.resistanceMaxOhm, 6)} Ω (stosunek ${fmt(diagnostics.resistanceRatio, 0)}×), napięcia węzłów ${fmt(diagnostics.voltageMinV, 4)}…${fmt(diagnostics.voltageMaxV, 4)} V, prąd pakietu ${fmt(diagnostics.packCurrent, 3)} A.`;
    }

    updateThermalAndSoc(requestedDt) {
      const model = this.package.cellModel, ambient = this.settings().ambientC;
      const cellHeat = this.cells.map(cell => cell.powerW), tapeHeat = this.tapeSegments.map(segment => segment.powerW);
      if (this.settings().thermal) {
        this.cells.forEach((cell, i) => {
          const exposure = cell.coolingFactor / (1 + .12 * cell.neighbourCount);
          cellHeat[i] -= model.thermal.heat_transfer_W_m2K * model.geometry.surface_area_m2 * exposure * (cell.tempC - ambient);
        });
        this.neighbourPairs.forEach(([a, b]) => { const q = .12 * (this.cells[a].tempC - this.cells[b].tempC); cellHeat[a] -= q; cellHeat[b] += q; });
        this.tapeSegments.forEach((segment, i) => {
          const surface = 2 * (segment.widthMm + segment.thicknessMm) * segment.lengthMm * 1e-6;
          tapeHeat[i] -= 10 * surface * (segment.tempC - ambient);
          segment.endpointCells.forEach(cellIndex => { const q = .18 * (segment.tempC - this.cells[cellIndex].tempC); tapeHeat[i] -= q; cellHeat[cellIndex] += q; });
        });
        const byTape = new Map();
        this.tapeSegments.forEach((s, i) => { if (!byTape.has(s.tapeId)) byTape.set(s.tapeId, []); byTape.get(s.tapeId).push(i); });
        byTape.forEach(indices => indices.slice(1).forEach((index, p) => {
          const a = this.tapeSegments[indices[p]], b = this.tapeSegments[index];
          const lengthM = Math.max(1e-4, (a.lengthMm + b.lengthMm) * .0005), k = a.material.thermalConductivity * a.areaM2 / lengthM;
          const q = k * (a.tempC - b.tempC); tapeHeat[indices[p]] -= q; tapeHeat[index] += q;
        }));
      }
      let maxRate = 0;
      this.cells.forEach((cell, i) => { maxRate = Math.max(maxRate, Math.abs(cellHeat[i] / Math.max(1e-6, model.thermal.heat_capacity_J_K))); });
      this.tapeSegments.forEach((segment, i) => { maxRate = Math.max(maxRate, Math.abs(tapeHeat[i] / segment.heatCapacityJK)); });
      const dt = maxRate > 0 ? Math.min(requestedDt, 2 / maxRate) : requestedDt;
      if (dt < requestedDt * .999 && !this.adaptiveStepReported) {
        this.adaptiveStepReported = true;
        this.logEvent("NUMERYKA", `Automatycznie zmniejszono krok z ${fmt(requestedDt, 4)} s do ${fmt(dt, 4)} s z powodu szybkiej zmiany temperatury.`);
      }
      this.cells.forEach((cell, i) => {
        const qFactor = Math.max(.05, interp(model.capacity_temperature_factor, cell.tempC));
        const availableAh = Math.max(.001, cell.capacityAh * qFactor);
        cell.soc = clamp(cell.soc - cell.currentA * dt / (3600 * availableAh) * 100, 0, 100);
        cell.tempC += cellHeat[i] / Math.max(1e-6, model.thermal.heat_capacity_J_K) * dt;
        cell.lossEnergyWh += cell.powerW * dt / 3600;
      });
      this.tapeSegments.forEach((segment, i) => { segment.tempC += tapeHeat[i] / segment.heatCapacityJK * dt; segment.lossEnergyWh += segment.powerW * dt / 3600; });
      return Math.max(.0001, dt);
    }

    applyBalancing(dt) {
      if (!this.settings().balanceEnabled || !this.groupVoltages.length || this.settings().mode !== "charge") return;
      const start = num("stage4BalanceStartV", 4), delta = num("stage4BalanceDeltaV", .02), min = Math.min(...this.groupVoltages);
      const active = this.groupVoltages.map((v, i) => ({ v, i })).filter(g => g.v >= start && g.v - min >= delta).sort((a, b) => b.v - a.v).slice(0, Math.max(1, num("stage4BalanceMaxGroups", 2)));
      const current = Math.max(0, num("stage4BalanceCurrentA", .1));
      active.forEach(group => {
        const cells = this.cells.filter(cell => cell.section === group.i);
        cells.forEach(cell => cell.soc = clamp(cell.soc - current / Math.max(1, cells.length) * dt / (3600 * cell.capacityAh) * 100, 0, 100));
      });
      if (active.length) this.bms.state = "BALANSOWANIE";
      else if (this.bms.connected) this.bms.state = this.status === "running" ? (this.settings().mode === "charge" ? "ŁADOWANIE" : "ROZŁADOWANIE") : "CZUWANIE";
    }

    updateBms(dt, packCurrent) {
      if (!this.settings().bmsEnabled || !this.bms.connected) return;
      const mode = this.settings().mode, maxT = Math.max(...this.cells.map(c => c.tempC)), minT = Math.min(...this.cells.map(c => c.tempC));
      const checks = [
        { key: "OV", active: Math.max(...this.groupVoltages) > num("stage4BmsVmax", 4.2), value: Math.max(...this.groupVoltages), threshold: num("stage4BmsVmax", 4.2), delay: num("stage4BmsVmaxDelay", 1), element: `S${this.groupVoltages.indexOf(Math.max(...this.groupVoltages)) + 1}` },
        { key: "UV", active: Math.min(...this.groupVoltages) < num("stage4BmsVmin", 2.8), value: Math.min(...this.groupVoltages), threshold: num("stage4BmsVmin", 2.8), delay: num("stage4BmsVminDelay", 1), element: `S${this.groupVoltages.indexOf(Math.min(...this.groupVoltages)) + 1}` },
        { key: "OC_DISCHARGE", active: packCurrent > num("stage4BmsDischargeA", 100), value: packCurrent, threshold: num("stage4BmsDischargeA", 100), delay: num("stage4BmsDischargeDelay", 2), element: "pakiet" },
        { key: "OC_CHARGE", active: -packCurrent > num("stage4BmsChargeA", 50), value: -packCurrent, threshold: num("stage4BmsChargeA", 50), delay: num("stage4BmsChargeDelay", 2), element: "pakiet" },
        { key: "OT_DISCHARGE", active: mode === "discharge" && maxT > num("stage4BmsDischargeTmax", 60), value: maxT, threshold: num("stage4BmsDischargeTmax", 60), delay: num("stage4BmsDischargeTmaxDelay", 2), element: this.hottestCellLabel() },
        { key: "OT_CHARGE", active: mode === "charge" && maxT > num("stage4BmsChargeTmax", 45), value: maxT, threshold: num("stage4BmsChargeTmax", 45), delay: num("stage4BmsChargeTmaxDelay", 2), element: this.hottestCellLabel() },
        { key: "UT_CHARGE", active: mode === "charge" && minT < num("stage4BmsChargeTmin", 0), value: minT, threshold: num("stage4BmsChargeTmin", 0), delay: num("stage4BmsChargeTminDelay", 1), element: this.coldestCellLabel() },
        { key: "UT_DISCHARGE", active: mode === "discharge" && minT < num("stage4BmsDischargeTmin", -20), value: minT, threshold: num("stage4BmsDischargeTmin", -20), delay: num("stage4BmsDischargeTminDelay", 1), element: this.coldestCellLabel() }
      ];
      for (const check of checks) {
        this.bms.timers[check.key] = check.active ? (this.bms.timers[check.key] || 0) + dt : 0;
        if (check.active && this.bms.timers[check.key] >= check.delay) { this.tripBms(check); return; }
      }
    }

    tripBms(check) {
      this.bms.connected = false; this.bms.state = "ODŁĄCZENIE";
      this.bms.lastTrip = { timeS: this.time, type: check.key, threshold: check.threshold, value: check.value, element: check.element };
      this.logEvent("BMS", `${check.key}: ${check.element}, wartość ${fmt(check.value, 3)}, próg ${fmt(check.threshold, 3)}`, { protection: check.key, threshold: check.threshold, value: check.value, element: check.element });
      this.stop(`Zadziałał wirtualny BMS: ${check.key} (${check.element}).`);
    }

    reconnectBms() {
      this.solveElectrical(0);
      const voltageHysteresis = num("stage4BmsVoltageHysteresis", .1), tempHysteresis = num("stage4BmsTempHysteresis", 5);
      const maxGroup = Math.max(...this.groupVoltages), minGroup = Math.min(...this.groupVoltages), maxTemp = Math.max(...this.cells.map(c => c.tempC)), minTemp = Math.min(...this.cells.map(c => c.tempC));
      const mode = this.settings().mode;
      const voltageSafe = maxGroup <= num("stage4BmsVmax", 4.2) - voltageHysteresis && minGroup >= num("stage4BmsVmin", 2.8) + voltageHysteresis;
      const temperatureSafe = mode === "charge"
        ? maxTemp <= num("stage4BmsChargeTmax", 45) - tempHysteresis && minTemp >= num("stage4BmsChargeTmin", 0) + tempHysteresis
        : maxTemp <= num("stage4BmsDischargeTmax", 60) - tempHysteresis && minTemp >= num("stage4BmsDischargeTmin", -20) + tempHysteresis;
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
      const settings = this.settings(), maxT = Math.max(...this.cells.map(c => c.tempC)), minT = Math.min(...this.cells.map(c => c.tempC)), minSoc = Math.min(...this.cells.map(c => c.soc)), maxSoc = Math.max(...this.cells.map(c => c.soc));
      if (this.time >= settings.durationS) return this.stop("Osiągnięto maksymalny czas symulacji.");
      if (settings.mode === "discharge" && minSoc <= .001) return this.stop("Ogniwo osiągnęło minimalny SOC.");
      if (settings.mode === "charge" && maxSoc >= 99.999) return this.stop("Ogniwo osiągnęło 100% SOC.");
      if (settings.mode === "charge" && this.chargePhase === "CV" && Math.abs(packCurrent) <= settings.cvEndA) return this.stop("Ładowanie CC/CV zakończone: prąd CV spadł poniżej progu.");
      if (settings.mode === "discharge" && Math.min(...this.groupVoltages) <= this.package.cellModel.voltage_min_V) return this.stop("Grupa szeregowa osiągnęła minimalne napięcie.");
      if (settings.mode === "charge" && Math.max(...this.groupVoltages) > this.package.cellModel.voltage_max_V * 1.01) return this.stop("Grupa szeregowa przekroczyła maksymalne napięcie.");
      const lowVoltageCell = settings.mode === "discharge" ? this.cells.find(cell => cell.voltageV <= cell.voltageMinV) : null;
      const highVoltageCell = settings.mode === "charge" ? this.cells.find(cell => cell.voltageV >= cell.voltageMaxV * 1.005) : null;
      if (lowVoltageCell) return this.stop(`Ogniwo ${lowVoltageCell.id} osiągnęło indywidualne napięcie minimalne.`);
      if (highVoltageCell) return this.stop(`Ogniwo ${highVoltageCell.id} przekroczyło indywidualne napięcie maksymalne.`);
      const safeMax = settings.mode === "charge" ? num("stage4BmsChargeTmax", 45) : num("stage4BmsDischargeTmax", 60);
      const safeMin = settings.mode === "charge" ? num("stage4BmsChargeTmin", 0) : num("stage4BmsDischargeTmin", -20);
      if (maxT > safeMax) return this.stop(`Przekroczono bezpieczną temperaturę ${fmt(maxT, 1)}°C. Thermal runaway nie jest symulowany.`);
      if (minT < safeMin) return this.stop(`Temperatura ${fmt(minT, 1)}°C spadła poniżej dopuszczalnego minimum dla trybu ${settings.mode === "charge" ? "ładowania" : "rozładowania"}.`);
      const overCurrent = this.cells.find(c => c.currentA > c.maxCurrentA * 1.5 || -c.currentA > c.maxChargeCurrentA * 1.05);
      if (overCurrent) {
        const charging = overCurrent.currentA < 0;
        const threshold = charging ? overCurrent.maxChargeCurrentA * 1.05 : overCurrent.maxCurrentA * 1.5;
        return this.stop(`Ogniwo ${overCurrent.id} przekroczyło próg awaryjny prądu ${charging ? "ładowania" : "rozładowania"}: ${fmt(Math.abs(overCurrent.currentA), 2)} A > ${fmt(threshold, 2)} A${charging ? "" : " (150% wartości zapisanej)"}.`);
      }
    }

    validateFinite() {
      return Number.isFinite(this.packVoltage) && this.packVoltage >= -1 && this.cells.every(c => [c.soc, c.tempC, c.voltageV, c.currentA, c.resistanceOhm].every(Number.isFinite) && c.resistanceOhm > 0) && this.tapeSegments.every(t => [t.tempC, t.currentA, t.resistanceOhm].every(Number.isFinite) && t.resistanceOhm > 0);
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
    maxItem(items, getter) { if (!items.length) return null; return items.reduce((best, item) => getter(item) > best.value ? { item, value: getter(item) } : best, { item: items[0], value: getter(items[0]) }); }
    minItem(items, getter) { if (!items.length) return null; return items.reduce((best, item) => getter(item) < best.value ? { item, value: getter(item) } : best, { item: items[0], value: getter(items[0]) }); }
    hottestCellLabel() { return String(this.maxItem(this.cells, c => c.tempC)?.item.id || "ogniwo"); }
    coldestCellLabel() { return String(this.minItem(this.cells, c => c.tempC)?.item.id || "ogniwo"); }

    recordHistory(force = false) {
      const interval = Math.max(1, this.settings().durationS / 1500);
      if (!force && this.history.length && this.time - this.history[this.history.length - 1].timeS < interval) return;
      this.history.push({
        timeS: this.time, voltageV: this.packVoltage, currentA: this.packCurrent, powerW: this.packVoltage * this.packCurrent,
        energyWh: this.energyWh, lossWh: this.lossEnergyWh, maxTempC: Math.max(...this.cells.map(c => c.tempC), ...this.tapeSegments.map(t => t.tempC)),
        minSoc: Math.min(...this.cells.map(c => c.soc)), maxSoc: Math.max(...this.cells.map(c => c.soc)), groupVoltages: [...this.groupVoltages],
        cells: this.cells.map(c => [c.id, c.voltageV, c.currentA, c.soc, c.tempC]), strips: this.tapeSegments.map(t => [t.id, t.currentA, t.tempC])
      });
    }

    logEvent(type, message, details = {}) {
      const event = { timeS: this.time, type, message, ...details };
      this.events.push(event);
      if (["TOPOLOGIA", "BŁĄD TOPOLOGII", "SOLVER", "NUMERYKA", "BMS"].includes(type)) {
        console.groupCollapsed(`[Etap 4 · ${fmt(this.time, 3)} s] ${type}: ${message}`);
        if (details.diagnostics) console.log("Diagnostyka:", details.diagnostics);
        else if (Object.keys(details).length) console.log("Szczegóły:", details);
        console.groupEnd();
      }
    }
    setState(text, kind = "") { const element = $("stage4State"); if (element) { element.className = `stage4-state ${kind}`; element.textContent = text; } }

    renderAll() { this.renderMetrics(); this.renderVisual(); this.renderBms(); this.renderResults(); }
    renderEmpty() { $("stage4Metrics").innerHTML = ""; $("stage4BmsStatus").textContent = "Brak modelu."; $("stage4ResultBody").innerHTML = '<div class="stage4-summary-item">Przejdź przez etapy 1–3, aby utworzyć model.</div>'; }

    renderMetrics() {
      if (!this.cells.length) return;
      const maxTemp = Math.max(...this.cells.map(c => c.tempC), ...this.tapeSegments.map(t => t.tempC)), minSoc = Math.min(...this.cells.map(c => c.soc));
      const efficiency = this.energyWh > 0 ? Math.max(0, 100 * (1 - this.lossEnergyWh / this.energyWh)) : 100;
      $("stage4Metrics").innerHTML = [
        ["Czas", `${fmt(this.time, 1)} s`], ["Napięcie pakietu", `${fmt(this.packVoltage, 2)} V`], ["Prąd", `${fmt(this.packCurrent, 2)} A`],
        ["Moc", `${fmt(this.packVoltage * this.packCurrent, 1)} W`], ["Min. SOC", `${fmt(minSoc, 2)}%`], ["Maks. temperatura", `${fmt(maxTemp, 1)}°C`], ["Sprawność", `${fmt(efficiency, 2)}%`]
      ].map(([label, value]) => `<div class="stage4-metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
    }

    tempColor(temp, min, max) {
      const t = clamp((temp - min) / Math.max(1e-6, max - min), 0, 1), stops = [[23,37,84],[14,165,233],[34,197,94],[250,204,21],[239,68,68],[255,255,255]];
      const p = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
      const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f)); return `rgb(${c.join(",")})`;
    }

    renderVisual() {
      const svg = $("stage4Drawing"); if (!svg || !this.cells.length) return;
      const temps = [...this.cells.map(c => c.tempC), ...this.tapeSegments.map(t => t.tempC)];
      const auto = $("stage4AutoScale").checked, scaleMin = auto ? Math.floor(Math.min(...temps) / 5) * 5 : num("stage4ScaleMin", 20), scaleMax = auto ? Math.ceil(Math.max(...temps) / 5) * 5 + 5 : num("stage4ScaleMax", 80);
      $("stage4ScaleMinLabel").textContent = `${fmt(scaleMin, 0)}°C`; $("stage4ScaleMaxLabel").textContent = `${fmt(scaleMax, 0)}°C`;
      const geometryPoints = [...this.cells, ...(this.package.boundary || [])];
      const xs = geometryPoints.map(c => c.x), ys = geometryPoints.map(c => c.y), pad = 35;
      const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad, minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
      const viewHeight = maxY - minY, viewGap = Math.max(28, viewHeight * .1), backOffsetY = viewHeight + viewGap;
      this.visualBaseViewBox = { x: minX, y: minY, width: maxX - minX, height: viewHeight * 2 + viewGap };
      if (!this.visualViewBox || this.visualViewNeedsFit) {
        this.visualViewBox = { ...this.visualBaseViewBox };
        this.visualViewNeedsFit = false;
      }
      svg.setAttribute("viewBox", `${this.visualViewBox.x} ${this.visualViewBox.y} ${this.visualViewBox.width} ${this.visualViewBox.height}`);
      const radius = Math.max(5, this.package.cellModel.geometry.diameter_mm / 2);
      const project = (side, x, y) => side === "back"
        ? { x: minX + maxX - x, y: y + backOffsetY }
        : { x, y };
      const defs = `<defs><marker id="stage4-current-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="2.6" markerHeight="2.6" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#e0f2fe"/></marker><filter id="stage4-strip-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.2" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
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
      const stripEntries = [...stripGroups.values()];
      const gradientDefs = `<defs>${stripEntries.map((segments, groupIndex) => {
        const side = segments[0].side, start = project(side, segments[0].x1, segments[0].y1), endSegment = segments[segments.length - 1], end = project(side, endSegment.x2, endSegment.y2);
        const totalLength = segments.reduce((sum, segment) => sum + segment.lengthMm, 0) || 1;
        let traversed = 0;
        const stops = [`<stop offset="0%" stop-color="${this.tempColor(segments[0].tempC, scaleMin, scaleMax)}"/>`];
        segments.forEach(segment => {
          traversed += segment.lengthMm;
          stops.push(`<stop offset="${clamp(traversed / totalLength * 100, 0, 100)}%" stop-color="${this.tempColor(segment.tempC, scaleMin, scaleMax)}"/>`);
        });
        return `<linearGradient id="stage4-tape-gradient-${groupIndex}" gradientUnits="userSpaceOnUse" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}">${stops.join("")}</linearGradient>`;
      }).join("")}</defs>`;
      const strips = stripEntries.map((segments, groupIndex) => {
        const side = segments[0].side;
        const first = segments[0], last = segments[segments.length - 1], start = project(side, first.x1, first.y1), end = project(side, last.x2, last.y2);
        const tapeWidth = Math.max(...segments.map(segment => segment.widthMm));
        const hitSegments = segments.map(segment => {
          const a = project(side, segment.x1, segment.y1), b = project(side, segment.x2, segment.y2);
          return `<line class="stage4-strip-hit" data-strip-id="${esc(segment.id)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="transparent" stroke-width="${segment.widthMm + 7}" stroke-linecap="round" pointer-events="stroke" style="cursor:pointer"/>`;
        }).join("");
        const middle = segments.reduce((best, segment) => Math.abs(segment.currentA) > Math.abs(best.currentA) ? segment : best, segments[0]), a = project(side, middle.x1, middle.y1), b = project(side, middle.x2, middle.y2);
        const current = middle.currentA, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1, ux = dx / length, uy = dy / length;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, arrowLength = Math.min(10, length * .55), sign = current >= 0 ? 1 : -1;
        const ax1 = cx - ux * arrowLength * .5 * sign, ay1 = cy - uy * arrowLength * .5 * sign, ax2 = cx + ux * arrowLength * .5 * sign, ay2 = cy + uy * arrowLength * .5 * sign;
        const flow = Math.abs(current) > .02 ? `<g pointer-events="none"><line x1="${ax1}" y1="${ay1}" x2="${ax2}" y2="${ay2}" stroke="#e0f2fe" stroke-width=".75" opacity=".72" marker-end="url(#stage4-current-arrow)"/><text class="stage4-current-label" x="${cx - uy * (middle.widthMm * .72 + 2)}" y="${cy + ux * (middle.widthMm * .72 + 2)}" text-anchor="middle" dominant-baseline="middle" fill="#e0f2fe" stroke="#020617" stroke-width="1.4" paint-order="stroke" font-size="3.4" font-weight="800">${fmt(Math.abs(current), 1)} A</text></g>` : "";
        return `<g class="stage4-tape-visual"><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="#07111f" stroke-width="${tapeWidth + 3}" stroke-linecap="round"/><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="rgba(186,230,253,.42)" stroke-width="${tapeWidth + 1.1}" stroke-linecap="round" filter="url(#stage4-strip-glow)"/><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="url(#stage4-tape-gradient-${groupIndex})" stroke-width="${tapeWidth}" stroke-linecap="round" opacity=".92"/><line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="rgba(255,255,255,.22)" stroke-width=".5" stroke-linecap="round" pointer-events="none"/>${hitSegments}${flow}</g>`;
      }).join("");
      const weakest = this.minItem(this.cells, c => c.voltageV)?.item;
      const cells = ["front", "back"].map(side => this.cells.map(cell => {
        const p = project(side, cell.x, cell.y), frontStartsPositive = !this.package.polarityReversed;
        const sideStartsPositive = side === "front" ? frontStartsPositive : !frontStartsPositive;
        const positive = sideStartsPositive ? cell.section % 2 === 0 : cell.section % 2 !== 0;
        const terminal = positive
          ? `<circle cx="${p.x}" cy="${p.y}" r="${radius * .43}" fill="rgba(226,232,240,.72)" stroke="rgba(255,255,255,.8)" stroke-width=".65"/><circle cx="${p.x}" cy="${p.y}" r="${radius * .18}" fill="rgba(15,23,42,.7)"/>`
          : `<circle cx="${p.x}" cy="${p.y}" r="${radius * .63}" fill="rgba(2,6,23,.3)" stroke="rgba(226,232,240,.56)" stroke-width=".75"/>`;
        return `<g class="stage4-cell-hit" data-cell-id="${esc(cell.id)}" data-side="${side}" style="cursor:pointer"><circle cx="${p.x}" cy="${p.y}" r="${radius + 1.2}" fill="rgba(2,6,23,.82)" stroke="${cell === weakest ? "#fb3f67" : "rgba(147,197,253,.58)"}" stroke-width="${cell === weakest ? 2.4 : 1.1}"/><circle cx="${p.x}" cy="${p.y}" r="${radius}" fill="${this.tempColor(cell.tempC, scaleMin, scaleMax)}" stroke="rgba(219,234,254,.72)" stroke-width=".65"/>${terminal}<text x="${p.x}" y="${p.y - radius * .08}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(3.6, radius * .38)}" fill="#f8fafc" stroke="#020617" stroke-width="1.1" paint-order="stroke" font-weight="900">${esc(cell.id)}</text><text x="${p.x}" y="${p.y + radius * .43}" text-anchor="middle" font-size="${Math.max(2.8, radius * .27)}" fill="#bae6fd" stroke="#020617" stroke-width=".8" paint-order="stroke">S${cell.section + 1}</text></g>`;
      }).join("")).join("");
      const labels = `<g pointer-events="none"><text x="${minX + 8}" y="${minY + 13}" fill="#bae6fd" font-size="7" font-weight="900">PRZÓD PAKIETU · STRONA A</text><text x="${minX + 8}" y="${minY + backOffsetY + 13}" fill="#bae6fd" font-size="7" font-weight="900">TYŁ PAKIETU · STRONA B · ODBICIE POZIOME</text><line x1="${minX + 5}" y1="${minY + viewHeight + viewGap / 2}" x2="${maxX - 5}" y2="${minY + viewHeight + viewGap / 2}" stroke="rgba(148,203,255,.18)" stroke-dasharray="4 5"/></g>`;
      svg.innerHTML = defs + gradientDefs + boundaryMarkup + cells + strips + labels;
      svg.querySelectorAll(".stage4-cell-hit").forEach(element => { element.onmouseenter = () => this.showCellTooltip(element.dataset.cellId); element.onclick = () => { this.selectedCell = element.dataset.cellId; this.activeTab = "cells"; this.activateTab("cells"); this.renderResults(); }; });
      svg.querySelectorAll(".stage4-strip-hit").forEach(element => { element.onmouseenter = () => this.showStripTooltip(element.dataset.stripId); element.onclick = () => { this.selectedStrip = element.dataset.stripId; this.activeTab = "strips"; this.activateTab("strips"); this.renderResults(); }; });
      svg.onmouseleave = () => $("stage4Tooltip").innerHTML = "";
    }

    showCellTooltip(id) {
      const c = this.cells.find(cell => String(cell.id) === String(id)); if (!c) return;
      $("stage4Tooltip").innerHTML = `<strong>Ogniwo ${esc(c.id)} · S${c.section + 1}</strong><br>SOC ${fmt(c.soc, 2)}% · OCV ${fmt(c.ocvV, 3)} V · pod obciążeniem ${fmt(c.voltageV, 3)} V<br>Prąd ${fmt(c.currentA, 3)} A · DCIR ${fmt(c.resistanceOhm * 1000, 2)} mΩ · ${fmt(c.tempC, 1)}°C<br>Pojemność ${fmt(c.capacityAh, 3)} / ${fmt(c.nominalCapacityAh, 3)} Ah · straty ${fmt(c.powerW, 3)} W / ${fmt(c.lossEnergyWh, 4)} Wh`;
    }
    showStripTooltip(id) {
      const s = this.tapeSegments.find(item => item.id === id); if (!s) return;
      $("stage4Tooltip").innerHTML = `<strong>Segment ${esc(s.id)}</strong><br>${esc(s.materialName)} · ${fmt(s.lengthMm, 1)} × ${fmt(s.widthMm, 2)} × ${fmt(s.thicknessMm, 2)} mm<br>Przekrój ${fmt(s.widthMm * s.thicknessMm, 3)} mm² · prąd ${fmt(s.currentA, 3)} A<br>R ${fmt(s.resistanceOhm * 1000, 4)} mΩ · ${fmt(s.tempC, 1)}°C · ${fmt(s.powerW, 4)} W / ${fmt(s.lossEnergyWh, 5)} Wh`;
    }

    activateTab(name) {
      document.querySelectorAll("[data-stage4-tab]").forEach(button => button.classList.toggle("active", button.dataset.stage4Tab === name));
      document.querySelector(".stage4-stage")?.classList.toggle("summary-compact", name === "summary");
    }

    renderBms() {
      if (!this.cells.length) return;
      const minT = Math.min(...this.cells.map(c => c.tempC)), maxT = Math.max(...this.cells.map(c => c.tempC)), minSoc = Math.min(...this.cells.map(c => c.soc)), maxSoc = Math.max(...this.cells.map(c => c.soc));
      const warnings = Object.entries(this.bms.timers).filter(([, seconds]) => seconds > 0).map(([key, seconds]) => `${key} (${fmt(seconds, 2)} s)`).join(", ");
      $("stage4BmsBadge").textContent = this.bms.state;
      $("stage4BmsStatus").innerHTML = `<strong>${this.bms.connected ? "ZAŁĄCZONY" : "ODŁĄCZONY"}</strong><br>Prąd ${fmt(this.packCurrent, 2)} A · temperatury ${fmt(minT, 1)}–${fmt(maxT, 1)}°C<br>SOC ${fmt(minSoc, 2)}–${fmt(maxSoc, 2)}% · ΔU grup ${fmt(Math.max(...this.groupVoltages) - Math.min(...this.groupVoltages), 3)} V${warnings ? `<br><span style="color:#fbbf24">Aktywne ostrzeżenia: ${warnings}</span>` : ""}`;
      const lo = this.package.cellModel.voltage_min_V, hi = this.package.cellModel.voltage_max_V;
      $("stage4GroupList").innerHTML = this.groupVoltages.map((v, i) => `<div class="stage4-group-row"><b>S${i + 1}</b><i style="width:${clamp((v - lo) / Math.max(.01, hi - lo) * 100, 0, 100)}%"></i><span>${fmt(v, 3)} V</span></div>`).join("");
      const trip = this.bms.lastTrip;
      $("stage4LastBmsEvent").textContent = trip ? `${fmt(trip.timeS, 2)} s · ${trip.type} · ${trip.element} · ${fmt(trip.value, 3)} (próg ${fmt(trip.threshold, 3)})` : "Brak zdarzeń odłączenia.";
    }

    renderResults() {
      const body = $("stage4ResultBody"); if (!body || !this.cells.length) return;
      if (this.activeTab === "charts") return this.renderCharts(body);
      if (this.activeTab === "cells") return this.renderCellTable(body);
      if (this.activeTab === "strips") return this.renderStripTable(body);
      if (this.activeTab === "events") { body.innerHTML = `<div class="stage4-event-log">${this.events.length ? this.events.slice().reverse().map(e => `<div class="stage4-event-row"><span>${fmt(e.timeS, 2)} s</span><strong>${esc(e.type)}</strong><span>${esc(e.message)}</span></div>`).join("") : '<div class="stage4-summary-item">Brak zdarzeń.</div>'}</div>`; return; }
      const weakest = this.minItem(this.cells, c => c.voltageV), hottest = this.maxItem([...this.cells, ...this.tapeSegments], e => e.tempC), loss = this.cells.reduce((s, c) => s + c.powerW, 0) + this.tapeSegments.reduce((s, t) => s + t.powerW, 0);
      const efficiency = this.energyWh > 0 ? Math.max(0, 100 * (1 - this.lossEnergyWh / this.energyWh)) : 100;
      const weakLabels = { hottest_cell: "Najcieplejsze ogniwo", hottest_strip: "Najcieplejsza taśma", highest_loss: "Największe straty", highest_cell_current: "Największy prąd ogniwa", lowest_voltage: "Najniższe napięcie", lowest_soc: "Najniższy SOC", highest_strip_density: "Największa gęstość prądu" };
      const weakTable = Object.entries(this.weakRecords).map(([key, record]) => `<tr><td>${weakLabels[key] || key}</td><td>${esc(record.id)}</td><td>${fmt(record.value, 4)}</td><td>${fmt(record.timeS, 2)} s</td></tr>`).join("");
      body.innerHTML = `<div class="stage4-summary-grid">${[
        ["Stan", this.status], ["Faza", this.settings().mode === "charge" ? this.chargePhase : "rozładowanie"], ["Energia", `${fmt(this.energyWh, 3)} Wh`], ["Straty", `${fmt(this.lossEnergyWh, 4)} Wh`], ["Sprawność", `${fmt(efficiency, 2)}%`],
        ["Najsłabsze ogniwo", `${esc(weakest?.item.id)} · ${fmt(weakest?.value, 3)} V`], ["Najcieplejszy element", `${esc(hottest?.item.id)} · ${fmt(hottest?.value, 1)}°C`], ["Straty chwilowe", `${fmt(loss, 3)} W`], ["Segmenty taśm", this.tapeSegments.length], ["Przyczyna końca", this.finishReason || "—"]
      ].map(([l, v]) => `<div class="stage4-summary-item">${l}<strong>${v}</strong></div>`).join("")}</div>${weakTable ? `<table class="stage4-table" style="margin-top:7px"><thead><tr><th>Słaby punkt / rekord</th><th>Element</th><th>Wartość</th><th>Czas</th></tr></thead><tbody>${weakTable}</tbody></table>` : ""}`;
    }

    renderCharts(body) {
      const series = [
        ["Napięcie pakietu [V]", h => h.voltageV, "#38bdf8"], ["Prąd pakietu [A]", h => h.currentA, "#f59e0b"],
        ["Maks. temperatura [°C]", h => h.maxTempC, "#ef4444"], ["Minimalny SOC [%]", h => h.minSoc, "#22c55e"]
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
      const editor = selected ? `<div class="stage4-cell-editor"><label>Pojemność [Ah]<input id="stage4EditCapacity" value="${selected.capacityAh}"></label><label>DCIR [mΩ]<input id="stage4EditDcir" value="${selected.baseDcirMohm}"></label><label>SOC [%]<input id="stage4EditSoc" value="${selected.soc}"></label><label>Temperatura [°C]<input id="stage4EditTemp" value="${selected.tempC}"></label><label>Chłodzenie [×]<input id="stage4EditCooling" value="${selected.coolingFactor}"></label><label>Maks. prąd rozł. [A]<input id="stage4EditCurrent" value="${selected.maxCurrentA}"></label><label>Maks. prąd ład. [A]<input id="stage4EditChargeCurrent" value="${selected.maxChargeCurrentA}"></label><label>V min [V]<input id="stage4EditVmin" value="${selected.voltageMinV}"></label><label>V max [V]<input id="stage4EditVmax" value="${selected.voltageMaxV}"></label><button id="stage4ApplyCellEdit">Zastosuj do ${esc(selected.id)}</button></div>` : "";
      const selectedHistory = selected ? `<div class="stage4-chart-grid">${[
        ["Napięcie ogniwa [V]", 1, "#38bdf8"], ["Prąd ogniwa [A]", 2, "#f59e0b"], ["SOC ogniwa [%]", 3, "#22c55e"], ["Temperatura ogniwa [°C]", 4, "#ef4444"]
      ].map(([title, index, color]) => `<div class="stage4-chart"><strong>${title}</strong>${this.chartSvg(h => h.cells.find(item => String(item[0]) === String(selected.id))?.[index], color)}</div>`).join("")}</div>` : "";
      body.innerHTML = editor + selectedHistory + `<table class="stage4-table"><thead><tr><th>Ogniwo</th><th>Grupa</th><th>SOC [%]</th><th>OCV [V]</th><th>U [V]</th><th>I [A]</th><th>DCIR [mΩ]</th><th>T [°C]</th><th>Q los. [Ah]</th><th>P [W]</th><th>E strat [Wh]</th></tr></thead><tbody>${this.cells.map(c => `<tr data-stage4-cell-row="${esc(c.id)}" class="${String(c.id) === String(this.selectedCell) ? "selected" : ""}"><td>${esc(c.id)}</td><td>S${c.section + 1}</td><td>${fmt(c.soc, 3)}</td><td>${fmt(c.ocvV, 3)}</td><td>${fmt(c.voltageV, 3)}</td><td>${fmt(c.currentA, 3)}</td><td>${fmt(c.resistanceOhm * 1000, 2)}</td><td>${fmt(c.tempC, 2)}</td><td>${fmt(c.capacityAh, 4)}</td><td>${fmt(c.powerW, 4)}</td><td>${fmt(c.lossEnergyWh, 5)}</td></tr>`).join("")}</tbody></table>`;
      body.querySelectorAll("[data-stage4-cell-row]").forEach(row => row.onclick = () => { this.selectedCell = row.dataset.stage4CellRow; this.renderResults(); });
      $("stage4ApplyCellEdit")?.addEventListener("click", () => this.applyCellEdit(selected));
    }

    applyCellEdit(cell) {
      const override = { capacityAh: num("stage4EditCapacity", cell.capacityAh), dcirMohm: num("stage4EditDcir", cell.baseDcirMohm), soc: clamp(num("stage4EditSoc", cell.soc), 0, 100), tempC: num("stage4EditTemp", cell.tempC), coolingFactor: Math.max(.01, num("stage4EditCooling", cell.coolingFactor)), maxCurrentA: Math.max(.01, num("stage4EditCurrent", cell.maxCurrentA)), maxChargeCurrentA: Math.max(.01, num("stage4EditChargeCurrent", cell.maxChargeCurrentA)), voltageMinV: num("stage4EditVmin", cell.voltageMinV), voltageMaxV: num("stage4EditVmax", cell.voltageMaxV) };
      this.overrides.set(String(cell.id), override); Object.assign(cell, { capacityAh: override.capacityAh, baseDcirMohm: override.dcirMohm, soc: override.soc, tempC: override.tempC, coolingFactor: override.coolingFactor, maxCurrentA: override.maxCurrentA, maxChargeCurrentA: override.maxChargeCurrentA, voltageMinV: override.voltageMinV, voltageMaxV: override.voltageMaxV });
      this.logEvent("EDYCJA", `Ręcznie zmieniono parametry ogniwa ${cell.id}`); this.renderAll();
    }

    renderStripTable(body) {
      const selected = this.tapeSegments.find(segment => segment.id === this.selectedStrip);
      const selectedHistory = selected ? `<div class="stage4-chart-grid"><div class="stage4-chart"><strong>Prąd segmentu [A]</strong>${this.chartSvg(h => h.strips.find(item => item[0] === selected.id)?.[1], "#f59e0b")}</div><div class="stage4-chart"><strong>Temperatura segmentu [°C]</strong>${this.chartSvg(h => h.strips.find(item => item[0] === selected.id)?.[2], "#ef4444")}</div></div>` : "";
      body.innerHTML = selectedHistory + `<table class="stage4-table"><thead><tr><th>Segment</th><th>Materiał</th><th>L [mm]</th><th>w×t [mm]</th><th>A [mm²]</th><th>I [A]</th><th>R [mΩ]</th><th>T [°C]</th><th>P [W]</th><th>E strat [Wh]</th></tr></thead><tbody>${this.tapeSegments.map(s => `<tr data-stage4-strip-row="${esc(s.id)}" class="${s.id === this.selectedStrip ? "selected" : ""}"><td>${esc(s.id)}</td><td>${esc(s.materialName)}</td><td>${fmt(s.lengthMm, 2)}</td><td>${fmt(s.widthMm, 2)}×${fmt(s.thicknessMm, 2)}</td><td>${fmt(s.widthMm * s.thicknessMm, 3)}</td><td>${fmt(s.currentA, 3)}</td><td>${fmt(s.resistanceOhm * 1000, 5)}</td><td>${fmt(s.tempC, 2)}</td><td>${fmt(s.powerW, 5)}</td><td>${fmt(s.lossEnergyWh, 6)}</td></tr>`).join("")}</tbody></table>`;
      body.querySelectorAll("[data-stage4-strip-row]").forEach(row => row.onclick = () => { this.selectedStrip = row.dataset.stage4StripRow; this.renderResults(); });
    }

    exportJson() { this.download("symulacja-pakietu.json", JSON.stringify({ metadata: { approximate: true, welds_ignored: true, physical_bms_ignored: true }, settings: this.settings(), cellModel: this.package.cellModel, stripSelection: this.package.stripSelection, history: this.history, events: this.events, weakPoints: this.weakRecords }, null, 2), "application/json"); }
    exportCsv() {
      const rows = [["time_s","pack_voltage_V","pack_current_A","pack_power_W","energy_Wh","loss_Wh","max_temp_C","min_soc_percent","max_soc_percent"], ...this.history.map(h => [h.timeS,h.voltageV,h.currentA,h.powerW,h.energyWh,h.lossWh,h.maxTempC,h.minSoc,h.maxSoc])];
      this.download("symulacja-pakietu.csv", rows.map(row => row.join(",")).join("\n"), "text/csv");
    }
    download(name, content, type) { const url = URL.createObjectURL(new Blob([content], { type })), a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  global.Stage4Simulation = Stage4Simulation;
})(window);
