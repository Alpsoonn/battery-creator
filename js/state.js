// State Engine / Manager - Global Script

class StateManager {
  constructor() {
    this.state = {
      currentStage: 0, // 0: Geometria, 1: Sekcje S/P, 2: Połączenia, 3: 3D i FEM
      isManualMode: false,
      geometry: {
        cells: [],
        triInfo: null,
        controller: null,
        layoutMode: "both",
        cellType: 18,
        cellGap: 1.5,
        frameMargin: 8,
        angleStep: 3,
        offsetDensity: 4,
        controllerOn: true,
        controllerRotate: true,
        series: 10,
        cellAh: 5,
        cellCurrent: 10,
        cellVoltage: 3.6,
        variants: [],
        activeIndex: 0
      },
      manual: {
        cells: [],
        layout: "honeycomb",
        cellType: 21,
        cellGap: 1.5,
        controller: null,
        controllerOn: false
      },
      sections: {
        series: 10,
        parallel: 16,
        sectioning: [],
        cellOverrides: {},
        activeDrawSec: 0
      },
      connections: {
        nickelStrips: [],
        validation: { warnings: [], isValid: true },
        parameters: {
          cellAh: 5,
          cellCurrent: 10,
          cellVoltage: 3.6
        }
      },
      simulation: {
        results: null,
        isRunning: false
      },
      fem: {
        running: false,
        results: null
      }
    };
    
    this.history = [];
    this.redoHistory = [];
    this.listeners = new Set();
  }

  getState() {
    return this.state;
  }

  setState(updates) {
    this.state = this.deepMerge(this.state, updates);
    this.notify();
  }

  deepMerge(target, source) {
    const output = { ...target };
    if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach(key => {
        if (isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this.deepMerge(target[key], source[key]);
          }
        } else if (Array.isArray(source[key])) {
          output[key] = JSON.parse(JSON.stringify(source[key]));
        } else {
          output[key] = source[key];
        }
      });
    }
    return output;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    this.listeners.forEach(listener => listener(this.state));
  }

  saveCheckpoint(description = "") {
    this.history.push({
      state: JSON.parse(JSON.stringify(this.state)),
      description,
      timestamp: Date.now()
    });
    this.redoHistory = [];
    console.log(`💾 Checkpoint saved: ${description}`);
  }

  canUndo() {
    return this.history.length > 0;
  }

  undo() {
    if (!this.canUndo()) return false;
    const checkpoint = this.history.pop();
    this.redoHistory.push({
      state: JSON.parse(JSON.stringify(this.state)),
      description: checkpoint.description
    });
    this.state = checkpoint.state;
    this.notify();
    return true;
  }

  canRedo() {
    return this.redoHistory.length > 0;
  }

  redo() {
    if (!this.canRedo()) return false;
    const checkpoint = this.redoHistory.pop();
    this.history.push({
      state: JSON.parse(JSON.stringify(this.state)),
      description: checkpoint.description
    });
    this.state = checkpoint.state;
    this.notify();
    return true;
  }

  reset() {
    this.history = [];
    this.redoHistory = [];
    this.state.isManualMode = false;
    this.state.geometry.cells = [];
    this.state.geometry.triInfo = null;
    this.state.geometry.controller = null;
    this.state.geometry.variants = [];
    this.state.geometry.activeIndex = 0;
    this.state.manual.cells = [];
    this.state.manual.controller = null;
    this.state.manual.controllerOn = false;
    this.state.sections.sectioning = [];
    this.state.sections.cellOverrides = {};
    this.state.sections.activeDrawSec = 0;
    this.state.connections.nickelStrips = [];
    this.state.connections.validation = { warnings: [], isValid: true };
    this.state.simulation.results = null;
    this.state.fem.running = false;
    this.state.fem.results = null;
    this.notify();
  }

  mirrorX() {
    this.saveCheckpoint("Mirror X Geometry");
    
    const isManual = this.state.isManualMode;
    const cells = isManual ? this.state.manual.cells : this.state.geometry.cells;
    const tri = isManual ? null : this.state.geometry.triInfo;
    const controller = isManual ? this.state.manual.controller : this.state.geometry.controller;
    const series = isManual ? this.state.sections.series : this.state.geometry.series;
    
    if (cells.length === 0) return;
    
    let pivotX = 0;
    if (!isManual && tri && tri.points) {
      const xs = tri.points.map(p => p.x);
      pivotX = (Math.min(...xs) + Math.max(...xs)) / 2;
    } else {
      const xs = cells.map(c => c.x);
      pivotX = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    
    cells.forEach(c => {
      c.x = pivotX - (c.x - pivotX);
      if (c.col !== undefined) c.col = -c.col;
      
      if (c.section !== undefined && c.section !== null) {
        c.section = (series - 1) - c.section;
      }
    });

    const newOverrides = {};
    Object.keys(this.state.sections.cellOverrides).forEach(cid => {
      const sec = this.state.sections.cellOverrides[cid];
      if (sec !== null) {
        newOverrides[cid] = (series - 1) - sec;
      } else {
        newOverrides[cid] = null;
      }
    });
    this.state.sections.cellOverrides = newOverrides;
    
    if (controller) {
      controller.cx = pivotX - (controller.cx - pivotX);
      controller.angle = -controller.angle;
    }
    
    if (!isManual && tri && tri.points) {
      tri.points.forEach(p => {
        p.x = pivotX - (p.x - pivotX);
      });
      tri.points.reverse();
    }
    
    console.log("⚡ Safety Rule: mirrored X. Series sections inverted.");
    this.notify();
  }
}

function isObject(item) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

// Global instance
window.stateEngine = new StateManager();
