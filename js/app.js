// Application Coordinator - Main Entry Point
// Wires up global StageManager navigation, Pub/Sub updates, and undo/redo buttons

import { stateEngine } from './state.js';
import { simulationEngine } from './simulation.js';
import { computeEngine } from './compute.js';
import { Graphics2D } from './graphics2d.js';
import { graphics3D } from './graphics3d.js';
import { Stage1Controller } from './stage1.js';
import { Stage2Controller } from './stage2.js';
import { Stage3Controller } from './stage3.js';
import { assignSections } from './auto-pack.js';

class AppManager {
  constructor() {
    this.g2d = null;
    this.stage1 = null;
    this.stage2 = null;
    this.stage3 = null;
    
    this.init();
  }

  init() {
    const $ = (id) => document.getElementById(id);
    
    // 1. Initialize 2D Graphics Engine (SVG)
    this.g2d = new Graphics2D();
    window.g2d = this.g2d; // expose

    // 2. Initialize Stage Controllers
    this.stage1 = new Stage1Controller(this.g2d);
    this.stage2 = new Stage2Controller(this.g2d);
    this.stage3 = new Stage3Controller(this.g2d);

    // 3. Initialize Stage Navigation
    this.setupNavigation();
    
    // 4. Initialize Global Undo/Redo listeners
    this.setupKeyboardShortcuts();
    
    // 5. Initialize Stage 4 (3D stress test controls)
    this.setupStage4Events();

    // Subscribe to state updates to coordinate canvases and menus
    stateEngine.subscribe((state) => this.renderGlobalUI(state));

    // Force default state loading
    stateEngine.notify();
  }

  setupNavigation() {
    const $ = (id) => document.getElementById(id);

    // Click tabs directly
    for (let i = 0; i < 4; i++) {
      const tab = $(`nav-stage-${i}`);
      if (tab) {
        tab.addEventListener('click', () => this.goToStage(i));
      }
    }

    // Wstecz / Dalej buttons
    const backBtn = $('nav-back');
    const nextBtn = $('nav-next');
    
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const state = stateEngine.getState();
        if (state.currentStage > 0) {
          this.goToStage(state.currentStage - 1);
        }
      });
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const state = stateEngine.getState();
        if (state.currentStage < 3) {
          this.goToStage(state.currentStage + 1);
        }
      });
    }

    // Export button
    const exportBtn = $('exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => this.exportCurrentStage());
    }

    // Undo / Redo buttons
    const undoBtn = $('undoBtn');
    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        if (stateEngine.canUndo()) {
          stateEngine.undo();
        }
      });
    }
    
    const redoBtn = $('redoBtn');
    if (redoBtn) {
      redoBtn.addEventListener('click', () => {
        if (stateEngine.canRedo()) {
          stateEngine.redo();
        }
      });
    }

    // Auto vs Manual Mode Switcher (Stage 1 Tab buttons)
    const btnAuto = $('btn-mode-auto');
    const btnManual = $('btn-mode-manual');

    if (btnAuto && btnManual) {
      btnAuto.addEventListener('click', () => {
        stateEngine.saveCheckpoint("Przełącz na Tryb Automatyczny");
        stateEngine.setState({ isManualMode: false });
        this.g2d.requestRedraw();
      });

      btnManual.addEventListener('click', () => {
        stateEngine.saveCheckpoint("Przełącz na Ręczne Malowanie");
        
        // Initialize manual parameters if empty
        const state = stateEngine.getState();
        if (state.manual.cells.length === 0) {
          state.manual.cells = [];
          state.manual.controller = { cx: 0, cy: 0, w: 90, h: 45, angle: 0 };
          state.manual.controllerOn = false;
        }
        
        stateEngine.setState({ isManualMode: true });
        this.g2d.requestRedraw();
      });
    }
  }

  setupKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ctrl + Z: Undo
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        if (stateEngine.canUndo()) stateEngine.undo();
      }
      // Ctrl + Y: Redo
      if (e.ctrlKey && e.key === 'y') {
        e.preventDefault();
        if (stateEngine.canRedo()) stateEngine.redo();
      }
    });
  }

  setupStage4Events() {
    const $ = (id) => document.getElementById(id);
    
    const startStressBtn = $('stage4-start-stress');
    if (startStressBtn) {
      startStressBtn.addEventListener('click', () => {
        const duration = parseFloat($('stage4-duration').value) || 60;
        
        const progressBar = $('stage4-stress-progress');
        const progressVal = $('stage4-progress-val');
        
        if (progressBar) progressBar.style.width = '0%';
        
        computeEngine.startStressTest(duration, (elapsed, temps) => {
          const pct = Math.min(100, (elapsed / duration) * 100);
          if (progressBar) progressBar.style.width = `${pct}%`;
          if (progressVal) progressVal.textContent = `Symulacja: ${elapsed.toFixed(1)}s / ${duration}s`;
          
          // Update 3D colors
          graphics3D.updatePack(stateEngine.getState());
        });
      });
    }

    const stopStressBtn = $('stage4-stop-stress');
    if (stopStressBtn) {
      stopStressBtn.addEventListener('click', () => {
        computeEngine.stopStressTest();
        const progressVal = $('stage4-progress-val');
        if (progressVal) progressVal.textContent = "Zatrzymano symulację.";
      });
    }
  }

  goToStage(stageIndex) {
    const state = stateEngine.getState();
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    
    // Check validation rules
    if (stageIndex > 0 && cells.length === 0) {
      alert("⚠️ Aby przejść do kolejnego etapu, musisz najpierw wygenerować lub namalować ogniwa!");
      return;
    }
    
    if (stageIndex > 1) {
      // Check if S/P sectioning is initialized
      const hasSections = cells.some(c => c.section !== null && c.section !== undefined && c.section >= 0);
      if (!hasSections) {
        alert("⚠️ Skonfiguruj lub przelicz sekcje S/P w Etapie 2 przed przejściem dalej!");
        return;
      }
    }

    stateEngine.saveCheckpoint(`Przejdź do Etapu ${stageIndex + 1}`);
    stateEngine.setState({ currentStage: stageIndex });
    
    // Trigger specific stage initializations
    if (stageIndex === 2) {
      // Stage 3 (Connections): Trigger load current simulation automatically
      simulationEngine.requestSimulation(50);
    } else if (stageIndex === 3) {
      // Stage 4 (3D view): Initialize Three.js canvas in container
      const container = document.getElementById('drawing-3d-container');
      if (container) {
        // Run after DOM displays
        setTimeout(() => {
          graphics3D.init(container);
          graphics3D.updatePack(stateEngine.getState());
        }, 80);
      }
    }
  }

  renderGlobalUI(state) {
    const $ = (id) => document.getElementById(id);
    const stage = state.currentStage;
    
    const stageNames = ["Geometria", "Sekcje S/P", "Połączenia", "Analiza 3D/FEM"];
    for (let i = 0; i < 4; i++) {
      const container = document.querySelector(`.stage-container.stage-${i + 1}`);
      if (container) {
        container.style.display = (i === stage) ? 'grid' : 'none';
      }
      
      const navTab = $(`nav-stage-${i}`);
      if (navTab) {
        navTab.classList.toggle('active', i === stage);
      }
    }

    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    const hasCells = cells.length > 0;
    
    const statusTextEl = $('stage-status-text');
    if (statusTextEl) {
      let isValid = false;
      if (stage === 0) isValid = hasCells;
      else if (stage === 1) isValid = hasCells && cells.some(c => c.section !== null && c.section !== undefined && c.section >= 0);
      else if (stage === 2) isValid = hasCells && state.simulation.results !== null;
      else if (stage === 3) isValid = true;
      
      statusTextEl.textContent = `${stageNames[stage]} ${isValid ? "✓" : "⚠"}`;
      statusTextEl.classList.toggle('ready', isValid);
    }

    // 2. Wrappers are controlled by stage containers automatically

    // 3. Update Undo/Redo button states
    const undoBtn = $('undoBtn');
    if (undoBtn) {
      undoBtn.disabled = !stateEngine.canUndo();
      undoBtn.style.opacity = stateEngine.canUndo() ? '1' : '0.5';
    }
    
    const redoBtn = $('redoBtn');
    if (redoBtn) {
      redoBtn.disabled = !stateEngine.canRedo();
      redoBtn.style.opacity = stateEngine.canRedo() ? '1' : '0.5';
    }

    // 4. Update Auto/Manual mode buttons class (Stage 1 Mode picker)
    const btnAuto = $('btn-mode-auto');
    const btnManual = $('btn-mode-manual');
    if (btnAuto && btnManual) {
      btnAuto.classList.toggle('active', !state.isManualMode);
      btnManual.classList.toggle('active', state.isManualMode);
    }

    // 5. Update back/next controls
    const backBtn = $('nav-back');
    if (backBtn) {
      backBtn.disabled = (stage === 0);
      backBtn.style.opacity = (stage === 0) ? '0.4' : '1';
    }
    
    const nextBtn = $('nav-next');
    if (nextBtn) {
      const isManual = state.isManualMode;
      const cells = isManual ? state.manual.cells : state.geometry.cells;
      const hasCells = cells.length > 0;
      
      nextBtn.disabled = (stage === 3 || !hasCells);
      nextBtn.style.opacity = (stage === 3 || !hasCells) ? '0.4' : '1';
    }

    // 6. Draw 2D SVG if active
    if (stage < 3 && this.g2d) {
      this.g2d.requestRedraw();
    }
  }

  exportCurrentStage() {
    const state = stateEngine.getState();
    const stage = state.currentStage;
    
    if (stage < 3) {
      // Export 2D layout as SVG vector
      this.export2DToSVG();
    } else {
      // Export 3D screenshot as PNG image
      this.export3DScreenshot();
    }
  }

  export2DToSVG() {
    const state = stateEngine.getState();
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    
    if (cells.length === 0) {
      alert("Brak ogniw do wyeksportowania.");
      return;
    }

    const r = (isManual ? state.manual.cellType : state.geometry.cellType) / 2;
    
    // Find bounds
    const xs = cells.map(c => c.x);
    const ys = cells.map(c => c.y);
    const minX = Math.min(...xs) - r - 20;
    const maxX = Math.max(...xs) + r + 20;
    const minY = Math.min(...ys) - r - 20;
    const maxY = Math.max(...ys) + r + 20;
    
    const width = maxX - minX;
    const height = maxY - minY;
    
    // Generate inline SVG text representing the pack
    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">`;
    svgContent += `<rect width="100%" height="100%" fill="#090d16" />`;
    
    // 1. Draw frame if auto mode
    if (!isManual && state.geometry.triInfo && state.geometry.triInfo.points) {
      const poly = state.geometry.triInfo.points.map(p => `${p.x},${p.y}`).join(" ");
      svgContent += `<polygon points="${poly}" fill="none" stroke="#e2e8f0" stroke-width="2.5" />`;
    }
    
    // 2. Draw controller
    const ctrl = isManual ? state.manual.controller : state.geometry.controller;
    const ctrlOn = isManual ? state.manual.controllerOn : state.geometry.controllerOn;
    if (ctrl && ctrlOn) {
      const corners = rotatedRectCorners(ctrl);
      const poly = corners.map(p => `${p.x},${p.y}`).join(" ");
      svgContent += `<polygon points="${poly}" fill="none" stroke="#7c3aed" stroke-width="2" stroke-dasharray="5,4" />`;
      svgContent += `<text x="${ctrl.cx}" y="${ctrl.cy}" fill="#c084fc" font-family="sans-serif" font-weight="bold" font-size="9" text-anchor="middle">STEROWNIK</text>`;
    }
    
    // 3. Draw cells
    const colors = [
      "#2b6cb0", "#c05621", "#2f855a", "#805ad5", "#b83280",
      "#0f766e", "#b7791f", "#4a5568", "#dd6b20", "#3182ce"
    ];

    cells.forEach(cell => {
      let fill = '#334155';
      if (cell.section !== null && cell.section !== undefined && cell.section >= 0) {
        fill = colors[cell.section % colors.length];
      }
      
      svgContent += `<circle cx="${cell.x.toFixed(2)}" cy="${cell.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}" stroke="#020617" stroke-width="0.9" />`;
      
      if (cell.section !== null && cell.section !== undefined && cell.section >= 0) {
        const textCol = '#ffffff';
        svgContent += `<text x="${cell.x.toFixed(2)}" y="${(cell.y + r*0.4).toFixed(2)}" font-family="sans-serif" font-weight="bold" font-size="${r * 0.45}" fill="${textCol}" text-anchor="middle">S${cell.section + 1}</text>`;
        if (cell.parallelIndex) {
          svgContent += `<text x="${cell.x.toFixed(2)}" y="${(cell.y - r*0.1).toFixed(2)}" font-family="sans-serif" font-weight="bold" font-size="${r * 0.55}" fill="${textCol}" text-anchor="middle">${cell.parallelIndex}</text>`;
        }
      }
    });

    svgContent += `</svg>`;
    
    // Download Blob
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pakiet-baterii-etap-${stage + 1}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  export3DScreenshot() {
    if (!graphics3D.renderer) return;
    
    // Render scene immediately to capture it
    graphics3D.renderer.render(graphics3D.scene, graphics3D.camera);
    
    const dataUrl = graphics3D.renderer.domElement.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "ebike-battery-pack-3d.png";
    a.click();
  }
}

// Instantiate app coordinator when document ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new AppManager();
});
