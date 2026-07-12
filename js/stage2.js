// Stage 2 Controller - Electrical S/P Configuration
// Manages series sectioning, auto distribution, and manual painting in S/P groups

import { stateEngine } from './state.js';
import { assignSections } from './auto-pack.js';

export class Stage2Controller {
  constructor(graphics2d) {
    this.g2d = graphics2d;
    this.initEvents();
    
    // Subscribe to state updates
    stateEngine.subscribe((state) => this.onStateChange(state));
  }

  initEvents() {
    const $ = (id) => document.getElementById(id);
    
    // Series input change
    const seriesInput = $('stage2-series');
    if (seriesInput) {
      seriesInput.addEventListener('change', () => this.runAutoSectioning());
    }

    // Auto sectioning button
    const autoBtn = $('stage2-auto');
    if (autoBtn) {
      autoBtn.addEventListener('click', () => this.runAutoSectioning());
    }
    
    // Manual paint toggles
    const manualBtn = $('stage2-manual');
    if (manualBtn) {
      manualBtn.addEventListener('click', () => {
        // Toggle manual S/P painting mode
        // For Stage 2 manual painting, we keep the cell geometries but let users assign sections.
        const state = stateEngine.getState();
        stateEngine.saveCheckpoint("Przełącz na ręczne malowanie sekcji S/P");
        
        // Reset overrides or copy current sectioning
        const isManual = state.isManualMode;
        const cells = isManual ? state.manual.cells : state.geometry.cells;
        
        // Ensure they have sections initialized
        cells.forEach(c => {
          if (c.section === undefined) c.section = null;
        });
        
        stateEngine.setState({
          sections: {
            activeDrawSec: 0
          }
        });
        
        alert("Tryb Ręcznego Przypisywania: Klikaj na ogniwa lewym przyciskiem myszy, aby przypisać je do aktywnej sekcji S. Klikaj prawym przyciskiem, aby wyczyścić przypisanie. Wybierz aktywną sekcję z legendy na dole.");
        
        this.g2d.requestRedraw();
      });
    }

    // Bind legend clicks to set active S section
    const legendEl = $('legend');
    if (legendEl) {
      legendEl.addEventListener('click', (e) => {
        const item = e.target.closest('.legend-item');
        if (!item) return;
        
        const sidx = parseInt(item.dataset.sidx);
        stateEngine.setState({
          sections: {
            activeDrawSec: sidx
          }
        });
        this.g2d.requestRedraw();
      });
    }
  }

  runAutoSectioning() {
    const $ = (id) => document.getElementById(id);
    const state = stateEngine.getState();
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    
    if (cells.length === 0) {
      const statusEl = $('stage2-status');
      if (statusEl) statusEl.textContent = "⚠ Brak ogniw! Skonfiguruj geometrię w Etapie 1.";
      return;
    }

    const series = parseInt($('stage2-series').value) || 10;
    const parallel = Math.floor(cells.length / series);
    
    const parallelInput = $('stage2-parallel');
    if (parallelInput) parallelInput.value = parallel;

    stateEngine.saveCheckpoint("Automatyczny podział sekcji S/P");

    const assigned = assignSections(cells, series);
    
    // Write back to correct cell array (manual or geometry)
    if (isManual) {
      stateEngine.setState({
        manual: { cells: assigned },
        sections: { series, parallel }
      });
    } else {
      stateEngine.setState({
        geometry: { cells: assigned, series },
        sections: { series, parallel }
      });
    }
    
    this.g2d.requestRedraw();
    this.checkBottlenecksAndWarnings(assigned, series, parallel);
  }

  checkBottlenecksAndWarnings(cells, series, parallel) {
    const $ = (id) => document.getElementById(id);
    const state = stateEngine.getState();
    
    const cellType = state.isManualMode ? state.manual.cellType : state.geometry.cellType;
    const cellGap = state.isManualMode ? state.manual.cellGap : state.geometry.cellGap;
    const pitch = cellType + cellGap;
    
    const warnings = [];
    
    // Group cells
    const secs = Array.from({ length: series }, () => []);
    cells.forEach(c => {
      if (c.section !== null && c.section !== undefined && c.section >= 0) {
        secs[c.section].push(c);
      }
    });

    // Check boundary connections
    for (let s = 0; s < series - 1; s++) {
      let edgeCount = 0;
      for (const c1 of secs[s]) {
        for (const c2 of secs[s + 1]) {
          if (Math.hypot(c1.x - c2.x, c1.y - c2.y) <= pitch * 1.35) {
            edgeCount++;
          }
        }
      }
      
      if (edgeCount === 0) {
        warnings.push({
          type: "critical",
          message: `Brak połączeń prądowych między sekcją S${s + 1} i S${s + 2}!`
        });
      } else if (edgeCount === 1) {
        warnings.push({
          type: "warning",
          message: `Pojedyncze (wąskie) gardło połączenia między sekcją S${s + 1} i S${s + 2}.`
        });
      }
    }

    // Check for split/fragmented sections (islands)
    for (let s = 0; s < series; s++) {
      const components = this.countConnectedComponents(secs[s], pitch);
      if (components > 1) {
        warnings.push({
          type: "warning",
          message: `Sekcja S${s + 1} jest rozdzielona na ${components} osobne wyspy!`
        });
      }
    }

    // Save warnings to state
    stateEngine.setState({
      connections: {
        validation: {
          warnings: warnings,
          isValid: warnings.every(w => w.type !== "critical")
        }
      }
    });

    // Render alerts
    const warningsEl = $('stage2-warnings');
    const statusEl = $('stage2-status');
    
    if (warnings.length > 0) {
      if (warningsEl) {
        warningsEl.style.display = 'block';
        warningsEl.innerHTML = `
          <div style="background:#1e0a0a;border:1px solid #ef4444;border-radius:8px;padding:10px;margin-top:12px;color:#f87171;font-size:13px;">
            <strong>Ostrzeżenia układu elektrycznego:</strong><br>
            ${warnings.map(w => `<span style="display:block;margin:4px 0;padding:6px;background:#172033;border-left:3px solid ${w.type === "critical" ? "#ef4444" : "#f59e0b"};border-radius:4px;">${w.message}</span>`).join("")}
          </div>
        `;
      }
      if (statusEl) {
        const critCount = warnings.filter(w => w.type === 'critical').length;
        statusEl.textContent = critCount > 0 ? `⚠ ${critCount} krytycznych problemów!` : "✓ Podział zakończony z ostrzeżeniami.";
      }
    } else {
      if (warningsEl) warningsEl.style.display = 'none';
      if (statusEl) statusEl.textContent = "✓ Przypisanie sekcji jest poprawne elektrycznie.";
    }
  }

  countConnectedComponents(sectionCells, pitch) {
    if (sectionCells.length <= 1) return sectionCells.length;
    const unseen = new Set(sectionCells.map(c => c.id));
    let components = 0;
    
    while (unseen.size > 0) {
      components++;
      const firstId = unseen.values().next().value;
      const queue = [sectionCells.find(c => c.id === firstId)];
      unseen.delete(firstId);
      
      while (queue.length > 0) {
        const current = queue.shift();
        for (const other of sectionCells) {
          if (unseen.has(other.id) && Math.hypot(current.x - other.x, current.y - other.y) <= pitch * 1.35) {
            unseen.delete(other.id);
            queue.push(other);
          }
        }
      }
    }
    return components;
  }

  onStateChange(state) {
    if (state.currentStage !== 1) return;
    
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    const series = isManual ? state.sections.series : state.geometry.series;
    
    // Sync series input value
    const seriesInput = document.getElementById('stage2-series');
    if (seriesInput) seriesInput.value = series;

    const parallel = Math.floor(cells.length / series);
    const parallelInput = document.getElementById('stage2-parallel');
    if (parallelInput) parallelInput.value = parallel;

    // Render legend selector
    this.renderLegend(series, state.sections.activeDrawSec);
    this.renderSummary(cells, series, parallel, state);
  }

  renderLegend(series, activeSec) {
    const legendEl = document.getElementById('legend');
    if (!legendEl) return;
    
    const colors = [
      "#2b6cb0", "#c05621", "#2f855a", "#805ad5", "#b83280",
      "#0f766e", "#b7791f", "#4a5568", "#dd6b20", "#3182ce",
      "#38a169", "#9f7aea", "#d53f8c", "#319795", "#718096",
      "#e53e3e", "#667eea", "#975a16", "#2c7a7b", "#6b46c1"
    ];

    let content = '<div class="legend-title" style="margin-bottom:6px;font-size:11px;text-transform:uppercase;color:var(--muted)">Wybierz aktywną sekcję do rysowania:</div>';
    content += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
    
    for (let s = 0; s < series; s++) {
      const color = colors[s % colors.length];
      const isActive = (s === activeSec);
      content += `
        <button class="legend-item ${isActive ? 'active' : ''}" data-sidx="${s}" 
                style="display:flex;align-items:center;gap:6px;background:#1e2533;border:1px solid ${isActive ? 'var(--accent)' : 'var(--line)'};padding:4px 8px;border-radius:6px;cursor:pointer;outline:none;">
          <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color}"></span>
          <span style="font-size:12px;font-weight:600;color:#e2e8f0">S${s + 1}</span>
        </button>
      `;
    }
    content += '</div>';
    legendEl.innerHTML = content;
  }

  renderSummary(cells, series, parallel, state) {
    const summaryEl = document.getElementById('stage2-summary');
    if (!summaryEl) return;

    if (cells.length === 0) {
      summaryEl.innerHTML = '<span class="pill">Brak ogniw</span>';
      return;
    }

    const spare = cells.length - (series * parallel);
    const cellVoltage = state.isManualMode ? state.connections.parameters.cellVoltage : state.geometry.cellVoltage;
    const cellAh = state.isManualMode ? state.connections.parameters.cellAh : state.geometry.cellAh;
    const cellCurrent = state.isManualMode ? state.connections.parameters.cellCurrent : state.geometry.cellCurrent;
    
    const voltage = series * cellVoltage;
    const capacity = parallel * cellAh;
    const maxCurrent = parallel * cellCurrent;
    const energy = voltage * capacity;

    summaryEl.innerHTML = `
      <span class="pill">${cells.length} ogniw</span>
      <span class="pill">${series}S${parallel}P ${spare ? `(+${spare} zapas)` : ''}</span>
      <span class="pill">${voltage.toFixed(1)} V</span>
      <span class="pill">${capacity.toFixed(1)} Ah</span>
      <span class="pill">${maxCurrent.toFixed(0)} A</span>
      <span class="pill">${energy.toFixed(0)} Wh</span>
    `;
  }
}
