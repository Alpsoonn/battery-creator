// Stage 3 Controller - Simulation & Connections
// Connects UI inputs to the Simulation Worker, runs load analysis, and renders performance summaries

import { stateEngine } from './state.js';
import { simulationEngine } from './simulation.js';

export class Stage3Controller {
  constructor(graphics2d) {
    this.g2d = graphics2d;
    this.initEvents();
    
    // Subscribe to state updates
    stateEngine.subscribe((state) => this.onStateChange(state));
  }

  initEvents() {
    const $ = (id) => document.getElementById(id);
    
    // Watch parameters changes and trigger simulation
    ['stage3-ah', 'stage3-current', 'stage3-voltage', 'stage3-load-current'].forEach(id => {
      const el = $(id);
      if (el) {
        el.addEventListener('input', () => this.triggerSimulation());
      }
    });

    // Run Simulation button
    const runSimBtn = $('stage3-run-sim');
    if (runSimBtn) {
      runSimBtn.addEventListener('click', () => {
        const statusEl = $('stage3-status');
        if (statusEl) statusEl.textContent = "Uruchamianie obliczeń Kirchhoffa/Ohma...";
        simulationEngine.requestSimulation(50); // immediate run
      });
    }

    // Toggle view mode (Electrical vs Thermal Heatmap)
    const modeSelect = $('stage3-view-mode');
    if (modeSelect) {
      modeSelect.addEventListener('change', () => {
        const mode = modeSelect.value; // 'electrical' or 'thermal'
        this.g2d.setMode(mode);
      });
    }

    // Mirror X safety button
    const mirrorBtn = $('stage3-mirror-x');
    if (mirrorBtn) {
      mirrorBtn.addEventListener('click', () => {
        stateEngine.mirrorX();
        // Immediately run simulation again since geometries changed
        this.triggerSimulation();
      });
    }
  }

  triggerSimulation() {
    const $ = (id) => document.getElementById(id);
    const state = stateEngine.getState();
    
    const cellAh = parseFloat($('stage3-ah').value) || 5;
    const cellCurrent = parseFloat($('stage3-current').value) || 10;
    const cellVoltage = parseFloat($('stage3-voltage').value) || 3.6;
    const loadCurrent = parseFloat($('stage3-load-current').value) || 20;

    // Save parameters to state
    stateEngine.setState({
      connections: {
        parameters: { cellAh, cellCurrent, cellVoltage, loadCurrent }
      }
    });

    // Debounced simulation trigger
    simulationEngine.requestSimulation(300);
  }

  onStateChange(state) {
    if (state.currentStage !== 2) return;
    
    const $ = (id) => document.getElementById(id);
    
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    const series = isManual ? state.sections.series : state.geometry.series;
    const parallel = isManual ? Math.max(1, Math.floor(cells.length / series)) : state.sections.parallel;
    
    // Sync inputs from state
    const params = state.connections.parameters;
    
    const ahInput = $('stage3-ah');
    if (ahInput && ahInput.value === '') ahInput.value = params.cellAh;
    
    const curInput = $('stage3-current');
    if (curInput && curInput.value === '') curInput.value = params.cellCurrent;
    
    const voltInput = $('stage3-voltage');
    if (voltInput && voltInput.value === '') voltInput.value = params.cellVoltage;
    
    const loadInput = $('stage3-load-current');
    if (loadInput && (loadInput.value === '' || parseFloat(loadInput.value) === 0)) {
      loadInput.value = params.loadCurrent || (parallel * params.cellCurrent * 0.8);
    }

    // Render simulation results
    this.renderSimulationResults(state);
    this.renderSummary(cells, series, parallel, state);
  }

  renderSimulationResults(state) {
    const $ = (id) => document.getElementById(id);
    const results = state.simulation.results;
    const statusEl = $('stage3-status');
    const statsDiv = $('stage3-stats');
    
    if (state.simulation.isRunning) {
      if (statusEl) statusEl.textContent = "Symulowanie sieci oporników w osobnym wątku...";
      return;
    }

    if (!results) {
      if (statusEl) statusEl.textContent = "Naciśnij 'Uruchom Analizę Obciążeniową' aby rozpocząć.";
      if (statsDiv) statsDiv.innerHTML = '<p class="help">Wprowadź parametry obciążenia i ogniw, aby przeanalizować spadki napięcia i wydzielanie ciepła Joule\'a.</p>';
      return;
    }

    if (statusEl) statusEl.textContent = `✓ Symulacja ukończona (Gauss-Seidel: ${results.solverIterations} iteracji)`;
    
    if (statsDiv) {
      const normalAsym = results.maxAsymmetry < (state.connections.parameters.cellCurrent * 0.15) ? 'color:#22c55e' : 'color:#f59e0b';
      const normalSag = results.voltageSag < 1.0 ? 'color:#22c55e' : 'color:#f87171';
      const normalTemp = results.maxTemp < 60 ? 'color:#22c55e' : 'color:#f87171';

      statsDiv.innerHTML = `
        <div class="active-config-grid">
          <div class="active-config-row">
            <span class="active-config-label">Napięcie pod obciążeniem:</span>
            <span class="active-config-value" style="${normalSag}">${results.packVoltage} V</span>
          </div>
          <div class="active-config-row">
            <span class="active-config-label">Spadek napięcia (Sag):</span>
            <span class="active-config-value" style="${normalSag}">-${results.voltageSag} V</span>
          </div>
          <div class="active-config-row">
            <span class="active-config-label">Straty ciepła (Joule):</span>
            <span class="active-config-value">${results.totalStripLoss} W</span>
          </div>
          <div class="active-config-row">
            <span class="active-config-label">Maks. Temperatura (Hot Core):</span>
            <span class="active-config-value" style="${normalTemp}">${results.maxTemp} °C</span>
          </div>
          <div class="active-config-row">
            <span class="active-config-label">Asymetria prądu w sekcjach P:</span>
            <span class="active-config-value" style="${normalAsym}">${results.maxAsymmetry} A</span>
          </div>
        </div>
      `;
    }

    // Force canvas update to draw thermal colors if mode is 'thermal'
    if ($('stage3-view-mode').value === 'thermal') {
      this.g2d.setMode('thermal');
    }
  }

  renderSummary(cells, series, parallel, state) {
    const summaryEl = document.getElementById('stage3-summary');
    if (!summaryEl) return;

    if (cells.length === 0) {
      summaryEl.innerHTML = '<span class="pill">Brak ogniw</span>';
      return;
    }

    const spare = cells.length - (series * parallel);
    const params = state.connections.parameters;
    const voltage = series * params.cellVoltage;
    const capacity = parallel * params.cellAh;
    const energy = voltage * capacity;

    const results = state.simulation.results;
    const loadLabel = results ? `${results.loadCurrent} A obciążenia` : `Brak symulacji`;

    summaryEl.innerHTML = `
      <span class="pill" style="background:#163b38;color:var(--accent)">${loadLabel}</span>
      <span class="pill">${series}S${parallel}P ${spare ? `(+${spare} zapas)` : ''}</span>
      <span class="pill">${voltage.toFixed(1)} V</span>
      <span class="pill">${capacity.toFixed(1)} Ah</span>
      <span class="pill">${energy.toFixed(0)} Wh</span>
    `;
  }
}
