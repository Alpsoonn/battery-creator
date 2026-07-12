// Simulation Engine - Main Thread Interface - Global Script
// Contains worker manager and a main-thread fallback solver in case CORS blocks the Web Worker.

class SimulationInterface {
  constructor() {
    this.worker = null;
    this.debounceTimer = null;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.workerFailed = false;
    
    this.initWorker();
  }

  initWorker() {
    try {
      this.worker = new Worker('./js/simulation.worker.js');
      
      this.worker.onmessage = (e) => {
        const { results, error } = e.data;
        stateEngine.setState({ simulation: { isRunning: false } });
        
        if (error) {
          console.error("❌ Simulation Error:", error);
          if (this.pendingReject) {
            this.pendingReject(new Error(error));
            this.pendingResolve = null;
            this.pendingReject = null;
          }
        } else if (results) {
          stateEngine.setState({ simulation: { results: results } });
          if (this.pendingResolve) {
            this.pendingResolve(results);
            this.pendingResolve = null;
            this.pendingReject = null;
          }
        }
      };

      this.worker.onerror = (err) => {
        console.warn("⚠️ Worker error, switching to main-thread fallback:", err);
        this.workerFailed = true;
        this.runFallbackSimulation();
      };
    } catch (e) {
      console.warn("⚠️ Failed to initialize Web Worker (CORS/file:// protocol). Using main-thread fallback.");
      this.workerFailed = true;
    }
  }

  requestSimulation(delayMs = 250) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;

      this.debounceTimer = setTimeout(() => {
        if (this.workerFailed) {
          this.runFallbackSimulation();
        } else {
          this.runImmediateSimulation();
        }
      }, delayMs);
    });
  }

  runImmediateSimulation() {
    if (!this.worker) {
      this.initWorker();
    }
    
    if (this.workerFailed) {
      this.runFallbackSimulation();
      return;
    }

    const state = stateEngine.getState();
    const payload = this.preparePayload(state);
    if (!payload) return;

    stateEngine.setState({ simulation: { isRunning: true } });
    
    try {
      this.worker.postMessage(payload);
    } catch (e) {
      console.warn("⚠️ worker.postMessage failed, switching to main-thread fallback:", e);
      this.workerFailed = true;
      this.runFallbackSimulation();
    }
  }

  preparePayload(state) {
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    const series = isManual ? state.sections.series : state.geometry.series;
    const parallel = isManual ? Math.max(1, Math.floor(cells.length / series)) : state.sections.parallel;
    
    if (!cells || cells.length === 0) {
      stateEngine.setState({ simulation: { results: null, isRunning: false } });
      if (this.pendingResolve) this.pendingResolve(null);
      return null;
    }

    const parameters = {
      cellVoltage: isManual ? state.connections.parameters.cellVoltage : state.geometry.cellVoltage,
      cellAh: isManual ? state.connections.parameters.cellAh : state.geometry.cellAh,
      cellCurrent: isManual ? state.connections.parameters.cellCurrent : state.geometry.cellCurrent,
      cellGap: isManual ? state.manual.cellGap : state.geometry.cellGap,
      cellType: isManual ? state.manual.cellType : state.geometry.cellType,
      loadCurrent: isManual ? 
        (state.connections.parameters.loadCurrent || (parallel * state.connections.parameters.cellCurrent * 0.8)) :
        (state.geometry.loadCurrent || (parallel * state.geometry.cellCurrent * 0.8)),
      cellIr: 0.015
    };

    return {
      cells: cells.map(c => ({ id: c.id, x: c.x, y: c.y, section: c.section })),
      series,
      parallel,
      parameters
    };
  }

  runFallbackSimulation() {
    const state = stateEngine.getState();
    const payload = this.preparePayload(state);
    if (!payload) return;

    stateEngine.setState({ simulation: { isRunning: true } });

    setTimeout(() => {
      try {
        const results = runLocalKirchhoffSolver(payload.cells, payload.series, payload.parallel, payload.parameters);
        stateEngine.setState({
          simulation: {
            results: results,
            isRunning: false
          }
        });
        if (this.pendingResolve) {
          this.pendingResolve(results);
          this.pendingResolve = null;
          this.pendingReject = null;
        }
      } catch (err) {
        console.error("❌ Fallback Simulation Error:", err);
        stateEngine.setState({ simulation: { isRunning: false } });
        if (this.pendingReject) {
          this.pendingReject(err);
          this.pendingResolve = null;
          this.pendingReject = null;
        }
      }
    }, 0);
  }
}

// MAIN THREAD KIRCHHOFF SOLVER FALLBACK
function runLocalKirchhoffSolver(cells, series, parallel, params) {
  const cellVoltage = params.cellVoltage || 3.6;
  const cellIr = params.cellIr || 0.015;
  const cellCurrentLimit = params.cellCurrent || 10;
  const loadCurrent = params.loadCurrent || (parallel * cellCurrentLimit * 0.8);
  const cellDiameter = params.cellType || 21;
  const cellGap = params.cellGap || 1.5;
  
  const pitch = cellDiameter + cellGap;
  const maxNeighDist = pitch * 1.35;
  const N = cells.length;
  const numNodes = 2 * N;
  
  const connections = [];
  const rPerMm = 7e-8 / (8 * 0.15 * 1e-6) * 1000; // ~0.058 mOhm/mm
  
  for (let i = 0; i < N; i++) {
    const c1 = cells[i];
    if (c1.section === null || c1.section === undefined) continue;
    
    for (let j = i + 1; j < N; j++) {
      const c2 = cells[j];
      if (c2.section === null || c2.section === undefined) continue;
      
      const dist = Math.hypot(c1.x - c2.x, c1.y - c2.y);
      if (dist <= maxNeighDist) {
        const rStrip = dist * rPerMm * 0.001; // Ohms
        
        if (c1.section === c2.section) {
          connections.push({ n1: 2 * i + 1, n2: 2 * j + 1, r: rStrip });
          connections.push({ n1: 2 * i, n2: 2 * j, r: rStrip });
        } else if (c1.section + 1 === c2.section) {
          connections.push({ n1: 2 * i, n2: 2 * j + 1, r: rStrip });
        } else if (c2.section + 1 === c1.section) {
          connections.push({ n1: 2 * j, n2: 2 * i + 1, r: rStrip });
        }
      }
    }
  }

  const bPlusCellIndices = [];
  const bMinusCellIndices = [];
  
  for (let i = 0; i < N; i++) {
    if (cells[i].section === series - 1) bPlusCellIndices.push(i);
    if (cells[i].section === 0) bMinusCellIndices.push(i);
  }
  
  if (bPlusCellIndices.length === 0 || bMinusCellIndices.length === 0) {
    throw new Error("Brak prawidłowych ogniw w sekcji B+ lub B-.");
  }

  const V = new Float64Array(numNodes);
  for (let i = 0; i < N; i++) {
    const s = cells[i].section || 0;
    const baseV = s * cellVoltage;
    V[2 * i] = baseV;
    V[2 * i + 1] = baseV + cellVoltage;
  }

  const maxIterations = 400;
  const tolerance = 1e-5;
  const G = connections.map(conn => ({ n1: conn.n1, n2: conn.n2, g: 1.0 / conn.r }));

  const diagG = new Float64Array(numNodes);
  G.forEach(c => {
    diagG[c.n1] += c.g;
    diagG[c.n2] += c.g;
  });
  for (let i = 0; i < N; i++) {
    diagG[2 * i] += 1.0 / cellIr;
    diagG[2 * i + 1] += 1.0 / cellIr;
  }

  const currentPerBPlus = loadCurrent / bPlusCellIndices.length;
  const currentPerBMinus = loadCurrent / bMinusCellIndices.length;

  const nodeConnections = Array.from({ length: numNodes }, () => []);
  G.forEach(c => {
    nodeConnections[c.n1].push({ neighbor: c.n2, g: c.g });
    nodeConnections[c.n2].push({ neighbor: c.n1, g: c.g });
  });

  let iter = 0;
  let diff = 1.0;
  
  while (iter < maxIterations && diff > tolerance) {
    let maxDiff = 0;
    const refNode = 2 * bMinusCellIndices[0];
    V[refNode] = 0;

    for (let node = 0; node < numNodes; node++) {
      if (node === refNode) continue;
      
      let sumG_V = 0;
      const neighbors = nodeConnections[node];
      for (let k = 0; k < neighbors.length; k++) {
        sumG_V += neighbors[k].g * V[neighbors[k].neighbor];
      }
      
      const cellIdx = Math.floor(node / 2);
      const isPos = (node % 2 === 1);
      
      if (isPos) {
        sumG_V += (V[2 * cellIdx] + cellVoltage) / cellIr;
      } else {
        sumG_V += (V[2 * cellIdx + 1] - cellVoltage) / cellIr;
      }
      
      let extI = 0;
      if (isPos && bPlusCellIndices.includes(cellIdx)) extI -= currentPerBPlus;
      if (!isPos && bMinusCellIndices.includes(cellIdx)) extI += currentPerBMinus;
      
      const newV = (sumG_V + extI) / diagG[node];
      const d = Math.abs(newV - V[node]);
      if (d > maxDiff) maxDiff = d;
      V[node] = newV;
    }
    
    diff = maxDiff;
    iter++;
  }

  const cellCurrents = new Float64Array(N);
  const cellLosses = new Float64Array(N);
  const cellVoltages = new Float64Array(N);
  
  for (let i = 0; i < N; i++) {
    const vNeg = V[2 * i];
    const vPos = V[2 * i + 1];
    cellVoltages[i] = vPos - vNeg;
    const I = (cellVoltage - cellVoltages[i]) / cellIr;
    cellCurrents[i] = I;
    cellLosses[i] = I * I * cellIr;
  }

  let totalStripLoss = 0;
  const stripLosses = connections.map(conn => {
    const v1 = V[conn.n1];
    const v2 = V[conn.n2];
    const I = (v1 - v2) / conn.r;
    const P = I * I * conn.r;
    totalStripLoss += P;
    return { power: P };
  });

  const avgBPlusV = bPlusCellIndices.reduce((sum, idx) => sum + V[2 * idx + 1], 0) / bPlusCellIndices.length;
  const avgBMinusV = bMinusCellIndices.reduce((sum, idx) => sum + V[2 * idx], 0) / bMinusCellIndices.length;
  const packVoltage = avgBPlusV - avgBMinusV;
  const openCircuitPackV = series * cellVoltage;
  const voltageSag = openCircuitPackV - packVoltage;

  const neighborCounts = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    let count = 0;
    const c1 = cells[i];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const c2 = cells[j];
      if (Math.hypot(c1.x - c2.x, c1.y - c2.y) <= maxNeighDist) count++;
    }
    neighborCounts[i] = count;
  }

  const tempRise = new Float64Array(N);
  const ambientTemp = 25.0;
  
  for (let i = 0; i < N; i++) {
    const penalty = 1.0 + 0.18 * neighborCounts[i];
    let localPower = cellLosses[i];
    const rTheta = 12.0; 
    tempRise[i] = localPower * rTheta * penalty;
  }

  const cellTemps = tempRise.map(tr => ambientTemp + tr);
  const maxTemp = Math.max(...cellTemps);

  const sectionCurrents = Array.from({ length: series }, () => []);
  for (let i = 0; i < N; i++) {
    const s = cells[i].section;
    if (s !== null && s !== undefined) sectionCurrents[s].push(cellCurrents[i]);
  }

  let maxAsymmetry = 0;
  sectionCurrents.forEach((currents) => {
    if (currents.length > 1) {
      const maxI = Math.max(...currents);
      const minI = Math.min(...currents);
      const diffI = maxI - minI;
      if (diffI > maxAsymmetry) maxAsymmetry = diffI;
    }
  });

  return {
    packVoltage: Number(packVoltage.toFixed(2)),
    voltageSag: Number(voltageSag.toFixed(2)),
    cellCurrents: Array.from(cellCurrents).map(v => Number(v.toFixed(2))),
    cellLosses: Array.from(cellLosses).map(v => Number(v.toFixed(3))),
    cellVoltages: Array.from(cellVoltages).map(v => Number(v.toFixed(2))),
    cellTemps: Array.from(cellTemps).map(v => Number(v.toFixed(1))),
    maxTemp: Number(maxTemp.toFixed(1)),
    maxAsymmetry: Number(maxAsymmetry.toFixed(2)),
    totalStripLoss: Number(totalStripLoss.toFixed(2)),
    loadCurrent: loadCurrent,
    solverIterations: iter
  };
}

window.simulationEngine = new SimulationInterface();
