// Stage 1 Controller - Geometry Configuration
// Orchestrates inputs, automatic solving, manual layout adjustments, and UI bindings for Stage 1

import { stateEngine } from './state.js';
import { solve, assignSections, possibleConfigs } from './auto-pack.js';
import { scaleManualCells, getManualStats, initializeManualPack } from './manual-pack.js';

export class Stage1Controller {
  constructor(graphics2d) {
    this.g2d = graphics2d;
    this.initEvents();
    
    // Subscribe to state updates
    stateEngine.subscribe((state) => this.onStateChange(state));
  }

  initEvents() {
    const $ = (id) => document.getElementById(id);
    
    // Solve button
    const solveBtn = $('solveBtn');
    if (solveBtn) {
      solveBtn.addEventListener('click', () => this.runAutoSolve());
    }

    // Demo button
    const demoBtn = $('demoBtn');
    if (demoBtn) {
      demoBtn.addEventListener('click', () => this.loadDemoConfig());
    }
    
    // Clear manual layout
    const manualClearBtn = $('manual-clear');
    if (manualClearBtn) {
      manualClearBtn.addEventListener('click', () => {
        stateEngine.saveCheckpoint("Wyczyść planszę");
        initializeManualPack(stateEngine.getState());
        this.g2d.requestRedraw();
      });
    }

    // Bind series selectors
    const seriesSelect = $('seriesSelect');
    if (seriesSelect) {
      seriesSelect.addEventListener('change', () => {
        const val = seriesSelect.value;
        const customSLabel = $('customSLabel');
        if (customSLabel) {
          customSLabel.style.display = val === 'custom' ? 'grid' : 'none';
        }
        this.updateElectricalParams();
      });
    }
    const customS = $('customS');
    if (customS) {
      customS.addEventListener('input', () => this.updateElectricalParams());
    }

    // Manual mode series inputs
    const manualSeriesSelect = $('manualSeriesSelect');
    if (manualSeriesSelect) {
      manualSeriesSelect.addEventListener('change', () => {
        const val = manualSeriesSelect.value;
        const manualCustomSLabel = $('manualCustomSLabel');
        if (manualCustomSLabel) {
          manualCustomSLabel.style.display = val === 'custom' ? 'grid' : 'none';
        }
        this.updateManualElectricalParams();
      });
    }
    const manualCustomS = $('manualCustomS');
    if (manualCustomS) {
      manualCustomS.addEventListener('input', () => this.updateManualElectricalParams());
    }

    // Watchers for manual sizing adjustments
    ['manualCellType', 'manualCellGap', 'manualLayout'].forEach(id => {
      const el = $(id);
      if (el) {
        el.addEventListener('change', () => this.handleManualSizingChange());
        el.addEventListener('input', () => this.handleManualSizingChange());
      }
    });

    // Watchers for manual controller adjustments
    ['manualControllerOn', 'manualControllerW', 'manualControllerH', 'manualControllerAngle'].forEach(id => {
      const el = $(id);
      if (el) {
        el.addEventListener('change', () => this.handleManualControllerChange());
        el.addEventListener('input', () => this.handleManualControllerChange());
      }
    });

    // Watchers for electrical characteristics inputs
    ['cellAh', 'cellCurrent', 'cellVoltage'].forEach(id => {
      const el = $(id);
      if (el) {
        el.addEventListener('input', () => this.updateElectricalParams());
      }
    });
    
    ['manualCellAh', 'manualCellCurrent', 'manualCellVoltage'].forEach(id => {
      const el = $(id);
      if (el) {
        el.addEventListener('input', () => this.updateManualElectricalParams());
      }
    });
  }

  // Update parameters from inputs for Auto
  updateElectricalParams() {
    const $ = (id) => document.getElementById(id);
    const series = this.getSelectedSeries('seriesSelect', 'customS');
    
    stateEngine.setState({
      geometry: {
        series: series,
        cellAh: parseFloat($('cellAh').value) || 5,
        cellCurrent: parseFloat($('cellCurrent').value) || 10,
        cellVoltage: parseFloat($('cellVoltage').value) || 3.6
      }
    });
    this.g2d.requestRedraw();
  }

  // Update parameters from inputs for Manual
  updateManualElectricalParams() {
    const $ = (id) => document.getElementById(id);
    const series = this.getSelectedSeries('manualSeriesSelect', 'manualCustomS');
    
    stateEngine.setState({
      sections: {
        series: series
      },
      connections: {
        parameters: {
          cellAh: parseFloat($('manualCellAh').value) || 5,
          cellCurrent: parseFloat($('manualCellCurrent').value) || 10,
          cellVoltage: parseFloat($('manualCellVoltage').value) || 3.6
        }
      }
    });
    this.g2d.requestRedraw();
  }

  getSelectedSeries(selectId, inputId) {
    const $ = (id) => document.getElementById(id);
    const sel = $(selectId).value;
    if (sel === 'custom') {
      return parseInt($(inputId).value) || 10;
    }
    return parseInt(sel) || 10;
  }

  handleManualSizingChange() {
    const $ = (id) => document.getElementById(id);
    const state = stateEngine.getState();
    
    const cellType = parseInt($('manualCellType').value) || 21;
    const cellGap = parseFloat($('manualCellGap').value) || 1.5;
    const layout = $('manualLayout').value;
    
    stateEngine.saveCheckpoint("Zmień rozmiar ogniw (Ręczny)");
    
    // Rescale coordinates of already placed cells so structure is preserved
    scaleManualCells(state.manual.cells, cellType, cellGap, layout);
    
    stateEngine.setState({
      manual: {
        cellType,
        cellGap,
        layout,
        cells: state.manual.cells
      }
    });
    this.g2d.requestRedraw();
  }

  handleManualControllerChange() {
    const $ = (id) => document.getElementById(id);
    const state = stateEngine.getState();
    
    const controllerOn = $('manualControllerOn').checked;
    const w = parseFloat($('manualControllerW').value) || 90;
    const h = parseFloat($('manualControllerH').value) || 45;
    const angle = parseFloat($('manualControllerAngle').value) || 0;
    
    let ctrl = state.manual.controller;
    if (!ctrl) {
      ctrl = { cx: 0, cy: 0, w: w, h: h, angle: angle };
    } else {
      ctrl.w = w;
      ctrl.h = h;
      ctrl.angle = angle;
    }
    
    stateEngine.setState({
      manual: {
        controllerOn,
        controller: ctrl
      }
    });
    this.g2d.requestRedraw();
  }

  async runAutoSolve() {
    const $ = (id) => document.getElementById(id);
    
    const inputs = {
      sideA: parseFloat($('sideA').value) || 500,
      sideB: parseFloat($('sideB').value) || 600,
      sideC: parseFloat($('sideC').value) || 250,
      cellDiameter: parseInt($('cellType').value) || 18,
      cellGap: parseFloat($('cellGap').value) || 1.2,
      frameMargin: parseFloat($('frameMargin').value) || 8,
      layoutMode: $('layoutMode').value || 'both',
      angleStep: parseInt($('angleStep').value) || 3,
      offsetDensity: parseInt($('offsetDensity').value) || 4,
      controllerOn: $('controllerOn').checked,
      controllerW: parseFloat($('controllerW').value) || 90,
      controllerH: parseFloat($('controllerH').value) || 45,
      controllerRotate: $('controllerRotate').checked,
      series: this.getSelectedSeries('seriesSelect', 'customS')
    };

    const statusEl = $('status');
    const progressBar = $('progressBar');
    
    if (statusEl) statusEl.textContent = "Obliczanie wariantów...";
    if (progressBar) {
      progressBar.style.width = '5%';
      progressBar.parentElement.setAttribute('aria-hidden', 'false');
    }

    try {
      stateEngine.saveCheckpoint("Automatyczne generowanie pakietu");
      
      const bestVariants = await solve(inputs, (pct, text) => {
        if (progressBar) progressBar.style.width = `${pct}%`;
        if (statusEl) statusEl.textContent = text;
      });

      if (bestVariants.length === 0) {
        if (statusEl) statusEl.textContent = "Brak pasujących wariantów. Spróbuj zmniejszyć margines lub rozmiar ogniw.";
        stateEngine.setState({
          geometry: {
            variants: [],
            cells: [],
            triInfo: null,
            controller: null
          }
        });
        this.g2d.requestRedraw();
        return;
      }

      const activeIdx = 0;
      const variant = bestVariants[activeIdx];
      const series = inputs.series;
      const parallel = Math.floor(variant.cells.length / series);

      // Save geometry solvers to state
      stateEngine.setState({
        geometry: {
          variants: bestVariants,
          activeIndex: activeIdx,
          cells: variant.cells,
          triInfo: variant.triInfo,
          controller: variant.controller,
          series: series
        },
        sections: {
          series: series,
          parallel: parallel,
          sectioning: assignSections(variant.cells, series)
        }
      });

      if (statusEl) statusEl.textContent = `Gotowe! Wygenerowano warianty (${bestVariants.length}).`;
      if (progressBar) progressBar.style.width = '100%';
      
      this.g2d.requestRedraw();
      
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = "Błąd: " + err.message;
    }
  }

  loadDemoConfig() {
    const $ = (id) => document.getElementById(id);
    
    stateEngine.saveCheckpoint("Wczytaj Przykład (Demo)");
    
    $('sideA').value = 525;
    $('sideB').value = 455;
    $('sideC').value = 620;
    $('cellType').value = "21";
    $('frameMargin').value = 9;
    $('cellGap').value = 1.5;
    $('controllerOn').checked = true;
    $('controllerW').value = 92;
    $('controllerH').value = 42;
    $('cellAh').value = 5;
    $('cellCurrent').value = 10;
    $('cellVoltage').value = 3.6;
    $('seriesSelect').value = "13";
    $('layoutMode').value = "both";
    
    this.updateElectricalParams();
    this.runAutoSolve();
  }

  onStateChange(state) {
    if (state.currentStage !== 0) return;
    
    const isManual = state.isManualMode;
    
    // Toggle side panel sections depending on Auto vs Manual mode
    const autoSection = document.getElementById('stage1-auto-panel');
    const manualSection = document.getElementById('stage1-manual-panel');
    
    if (autoSection && manualSection) {
      autoSection.style.display = isManual ? 'none' : 'block';
      manualSection.style.display = isManual ? 'block' : 'none';
    }

    if (isManual) {
      this.renderManualSummary(state);
    } else {
      this.renderAutoSummary(state);
      this.renderVariantsSelector(state);
      this.renderConfigsList(state);
    }
  }

  renderAutoSummary(state) {
    const $ = (id) => document.getElementById(id);
    const summaryEl = $('summary');
    if (!summaryEl) return;

    const cells = state.geometry.cells;
    if (cells.length === 0) {
      summaryEl.innerHTML = '<span class="pill">Brak pakietu</span>';
      return;
    }

    const series = state.geometry.series;
    const parallel = state.sections.parallel;
    const spare = cells.length - (series * parallel);
    
    const voltage = series * state.geometry.cellVoltage;
    const capacity = parallel * state.geometry.cellAh;
    const maxCurrent = parallel * state.geometry.cellCurrent;
    const energy = voltage * capacity;

    summaryEl.innerHTML = `
      <span class="pill" title="Liczba ogniw">${cells.length} ogniw</span>
      <span class="pill" title="Konfiguracja szeregowo-równoległa">${series}S${parallel}P ${spare ? `(+${spare} zapas)` : ''}</span>
      <span class="pill" title="Napięcie nominalne">${voltage.toFixed(1)} V</span>
      <span class="pill" title="Pojemność pakietu">${capacity.toFixed(1)} Ah</span>
      <span class="pill" title="Prąd maksymalny ciągły">${maxCurrent.toFixed(0)} A</span>
      <span class="pill" title="Energia całkowita">${energy.toFixed(0)} Wh</span>
    `;
  }

  renderManualSummary(state) {
    const $ = (id) => document.getElementById(id);
    const summaryEl = $('summary');
    const statsEl = $('manual-stats');
    if (!summaryEl) return;

    const stats = getManualStats(
      state.manual.cells,
      state.manual.cellType,
      state.manual.cellGap,
      state.sections.series
    );

    if (stats.totalCells === 0) {
      summaryEl.innerHTML = '<span class="pill">Pusta plansza</span>';
      if (statsEl) statsEl.innerHTML = '<p class="help">Klikaj na tarcze pośrodku ekranu aby dodać pierwsze ogniwo akumulatora.</p>';
      return;
    }

    const voltage = stats.series * state.connections.parameters.cellVoltage;
    const capacity = stats.parallel * state.connections.parameters.cellAh;
    const maxCurrent = stats.parallel * state.connections.parameters.cellCurrent;
    const energy = voltage * capacity;

    summaryEl.innerHTML = `
      <span class="pill" title="Liczba ogniw">${stats.totalCells} ogniw</span>
      <span class="pill" title="Konfiguracja szeregowo-równoległa">${stats.series}S${stats.parallel}P ${stats.spare ? `(+${stats.spare} zapas)` : ''}</span>
      <span class="pill" title="Napięcie nominalne">${voltage.toFixed(1)} V</span>
      <span class="pill" title="Pojemność pakietu">${capacity.toFixed(1)} Ah</span>
      <span class="pill" title="Prąd maksymalny ciągły">${maxCurrent.toFixed(0)} A</span>
      <span class="pill" title="Energia całkowita">${energy.toFixed(0)} Wh</span>
    `;

    if (statsEl) {
      statsEl.innerHTML = `
        <div class="active-config-grid">
          <div class="active-config-row"><span class="active-config-label">Liczba ogniw:</span><span class="active-config-value">${stats.totalCells}</span></div>
          <div class="active-config-row"><span class="active-config-label">Konfiguracja:</span><span class="active-config-value">${stats.series}S ${stats.parallel}P</span></div>
          <div class="active-config-row"><span class="active-config-label">Szerokość pakietu:</span><span class="active-config-value">${stats.width} mm</span></div>
          <div class="active-config-row"><span class="active-config-label">Wysokość pakietu:</span><span class="active-config-value">${stats.height} mm</span></div>
          <div class="active-config-row"><span class="active-config-label">Ogniwa zapasowe:</span><span class="active-config-value">${stats.spare} szt.</span></div>
        </div>
      `;
    }
  }

  renderVariantsSelector(state) {
    const $ = (id) => document.getElementById(id);
    const variantsDiv = $('variants');
    if (!variantsDiv) return;

    const variants = state.geometry.variants;
    if (variants.length === 0) {
      variantsDiv.innerHTML = '';
      return;
    }

    variantsDiv.innerHTML = variants.map((v, idx) => {
      const isActive = (idx === state.geometry.activeIndex);
      const isHoneycomb = (v.layout === 'honeycomb');
      const layoutName = isHoneycomb ? 'Honeycomb' : 'Kwadrat';
      return `
        <button class="variant ${isActive ? 'active' : ''}" data-vidx="${idx}">
          <strong>Wariant ${idx + 1}</strong>
          <span>Układ: ${layoutName}</span>
          <span>Ogniw: ${v.totalCells} (${v.usedP}P)</span>
          <span>Kąt: ${v.angle}°</span>
        </button>
      `;
    }).join('');

    // Bind clicks to variants
    variantsDiv.querySelectorAll('.variant').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const vidx = parseInt(e.currentTarget.dataset.vidx);
        stateEngine.saveCheckpoint("Zmień wariant geometrii");
        
        const variant = variants[vidx];
        const series = state.geometry.series;
        const parallel = Math.floor(variant.cells.length / series);
        
        stateEngine.setState({
          geometry: {
            activeIndex: vidx,
            cells: variant.cells,
            triInfo: variant.triInfo,
            controller: variant.controller
          },
          sections: {
            parallel: parallel,
            sectioning: assignSections(variant.cells, series)
          }
        });
        this.g2d.requestRedraw();
      });
    });
  }

  renderConfigsList(state) {
    const $ = (id) => document.getElementById(id);
    const configsDiv = $('configs');
    if (!configsDiv) return;

    const cells = state.geometry.cells;
    if (cells.length === 0) {
      configsDiv.innerHTML = '';
      return;
    }

    const configs = possibleConfigs(cells.length);
    configsDiv.innerHTML = configs.slice(0, 6).map(c => {
      const isActive = (c.s === state.geometry.series);
      return `
        <button class="config ${isActive ? 'active' : ''}" data-s="${c.s}">
          <strong>${c.s}S ${c.p}P</strong>
          <span style="font-size:10px;opacity:0.7">${c.used} ogniw, ${c.spare} zapas</span>
        </button>
      `;
    }).join('');

    // Bind clicks to configs
    configsDiv.querySelectorAll('.config').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const s = parseInt(e.currentTarget.dataset.s);
        stateEngine.saveCheckpoint("Zmień konfigurację S/P");
        
        // Sync selectors
        const seriesSelect = $('seriesSelect');
        if (seriesSelect) {
          const opt = Array.from(seriesSelect.options).find(o => o.value === String(s));
          if (opt) {
            seriesSelect.value = String(s);
            $('customSLabel').style.display = 'none';
          } else {
            seriesSelect.value = 'custom';
            $('customSLabel').style.display = 'grid';
            $('customS').value = s;
          }
        }

        const parallel = Math.floor(cells.length / s);
        stateEngine.setState({
          geometry: { series: s },
          sections: {
            series: s,
            parallel: parallel,
            sectioning: assignSections(cells, s)
          }
        });
        this.g2d.requestRedraw();
      });
    });
  }
}
