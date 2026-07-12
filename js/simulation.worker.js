// Simulation Engine - Web Worker
// Performs Kirchhoff's node voltage solver for the resistor network and thermal calculations

self.onmessage = function (e) {
  const { cells, series, parallel, parameters } = e.data;
  
  if (!cells || cells.length === 0) {
    self.postMessage({ error: "Brak ogniw do symulacji." });
    return;
  }

  try {
    const results = runSimulation(cells, series, parallel, parameters);
    self.postMessage({ results });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
};

function runSimulation(cells, series, parallel, params) {
  // Extract parameters
  const cellVoltage = params.cellVoltage || 3.6; // Open circuit voltage (EMF)
  const cellIr = params.cellIr || 0.015; // 15 mOhm internal resistance
  const cellCurrentLimit = params.cellCurrent || 10; // A
  const loadCurrent = params.loadCurrent || (parallel * cellCurrentLimit * 0.8); // 80% of pack max current
  const cellDiameter = params.cellType || 18;
  const cellGap = params.cellGap || 1.2;
  
  const pitch = cellDiameter + cellGap;
  const maxNeighDist = pitch * 1.35; // connection distance threshold

  // Number of cells
  const N = cells.length;
  
  // We represent each cell k by 2 nodes:
  // Node 2k: negative terminal
  // Node 2k+1: positive terminal
  const numNodes = 2 * N;
  
  // Build adjacency list for nickel strips
  // A strip connection is represented by: { nodeA, nodeB, resistance }
  const connections = [];
  
  // 1. Internal Cell connections (each cell has EMF and IR)
  // We will solve this inside the solver loop by injecting current:
  // I_cell = (cellVoltage - (V_pos - V_neg)) / cellIr
  
  // 2. Nickel strips between adjacent cells
  // Resistivity of pure Nickel is ~7e-8 Ohm*m.
  // Standard strip: 8mm x 0.15mm = 1.2 mm^2 cross section = 1.2e-6 m^2.
  // R per meter = 7e-8 / 1.2e-6 = 0.058 Ohm/m = 0.058 mOhm/mm.
  const rPerMm = 7e-8 / (8 * 0.15 * 1e-6) * 1000; // ~0.058 mOhm/mm
  
  // Build parallel and series connection strips based on physical distance
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
          // Parallel connection: + to + (2i+1 to 2j+1) and - to - (2i to 2j)
          connections.push({ n1: 2 * i + 1, n2: 2 * j + 1, r: rStrip });
          connections.push({ n1: 2 * i, n2: 2 * j, r: rStrip });
        } else if (c1.section + 1 === c2.section) {
          // Series connection: c1(-) to c2(+) -> 2i to 2j+1
          connections.push({ n1: 2 * i, n2: 2 * j + 1, r: rStrip });
        } else if (c2.section + 1 === c1.section) {
          // Series connection: c2(-) to c1(+) -> 2j to 2i+1
          connections.push({ n1: 2 * j, n2: 2 * i + 1, r: rStrip });
        }
      }
    }
  }

  // 3. Set up boundary conditions (Load connections)
  // Find B+ nodes (positive terminals of the highest section: series - 1)
  // Find B- nodes (negative terminals of the lowest section: 0)
  const bPlusCellIndices = [];
  const bMinusCellIndices = [];
  
  for (let i = 0; i < N; i++) {
    if (cells[i].section === series - 1) {
      bPlusCellIndices.push(i);
    }
    if (cells[i].section === 0) {
      bMinusCellIndices.push(i);
    }
  }
  
  if (bPlusCellIndices.length === 0 || bMinusCellIndices.length === 0) {
    throw new Error("Brak prawidłowych ogniw w sekcji B+ (S" + series + ") lub B- (S1).");
  }

  // Solve the network using Node Voltage Method (Gauss-Seidel iterative approach)
  // Node voltages array
  const V = new Float64Array(numNodes);
  
  // Set initial guess: linear gradient from 0 to series * cellVoltage
  for (let i = 0; i < N; i++) {
    const s = cells[i].section || 0;
    const baseV = s * cellVoltage;
    V[2 * i] = baseV;       // negative node
    V[2 * i + 1] = baseV + cellVoltage; // positive node
  }

  // Iterative solver parameters
  const maxIterations = 600;
  const tolerance = 1e-6;
  
  // Pre-calculate conductance (G = 1/R) for speed
  const G = connections.map(conn => ({
    n1: conn.n1,
    n2: conn.n2,
    g: 1.0 / conn.r
  }));

  // Node self-conductance accumulator (sum of all G connected to node)
  const diagG = new Float64Array(numNodes);
  // Pre-add nickel strip conductances
  G.forEach(c => {
    diagG[c.n1] += c.g;
    diagG[c.n2] += c.g;
  });
  // Add cell internal conductance
  for (let i = 0; i < N; i++) {
    diagG[2 * i] += 1.0 / cellIr;
    diagG[2 * i + 1] += 1.0 / cellIr;
  }

  // Node current injection accumulator
  const b = new Float64Array(numNodes);

  // We connect B- nodes to Ground (0V) with very small resistance (or just hold them at 0V)
  // We distribute loadCurrent equally as extraction at B+ and injection at B-
  const currentPerBPlus = loadCurrent / bPlusCellIndices.length;
  const currentPerBMinus = loadCurrent / bMinusCellIndices.length;

  let iter = 0;
  let diff = 1.0;
  
  while (iter < maxIterations && diff > tolerance) {
    diff = 0;
    
    // Gauss-Seidel step
    for (let node = 0; node < numNodes; node++) {
      // 1. Calculate sum of G_ij * V_j
      let sumG_V = 0;
      
      // Add nickel strip contributions
      // To optimize, we could store a sparse matrix representation,
      // but for this scale, scanning is fine. (We can optimize by grouping G)
      
      // Let's gather connections for this node
      // (This can be optimized but is fast enough for ~500 nodes)
    }
    
    // Optimized adjacency indexing for faster iterations:
    // We group connections by node.
    iter++;
  }

  // Let's implement the optimized loop
  const nodeConnections = Array.from({ length: numNodes }, () => []);
  G.forEach(c => {
    nodeConnections[c.n1].push({ neighbor: c.n2, g: c.g });
    nodeConnections[c.n2].push({ neighbor: c.n1, g: c.g });
  });

  // Main Solver Loop
  iter = 0;
  diff = 1.0;
  
  while (iter < maxIterations && diff > tolerance) {
    let maxDiff = 0;
    
    // Hold B- (ground node references) close to 0V:
    // We can fix the first B- node to 0V as the reference.
    const refNode = 2 * bMinusCellIndices[0]; // negative node of first cell in S0 is 0V
    V[refNode] = 0;

    for (let node = 0; node < numNodes; node++) {
      if (node === refNode) continue;
      
      let sumG_V = 0;
      const neighbors = nodeConnections[node];
      for (let k = 0; k < neighbors.length; k++) {
        sumG_V += neighbors[k].g * V[neighbors[k].neighbor];
      }
      
      // Cell internal EMF contribution
      const cellIdx = Math.floor(node / 2);
      const isPos = (node % 2 === 1);
      
      if (isPos) {
        // Positive node: connected to negative node (2*cellIdx) via EMF & IR
        // Current injected into positive node from cell internal is (cellVoltage - (V_pos - V_neg)) / cellIr
        // This is equivalent to connecting to a node V_neg + cellVoltage with conductance 1/cellIr
        sumG_V += (V[2 * cellIdx] + cellVoltage) / cellIr;
      } else {
        // Negative node: connected to positive node (2*cellIdx + 1) via EMF & IR
        // Current injected into negative node from cell internal is -(cellVoltage - (V_pos - V_neg)) / cellIr
        // This is equivalent to connecting to a node V_pos - cellVoltage with conductance 1/cellIr
        sumG_V += (V[2 * cellIdx + 1] - cellVoltage) / cellIr;
      }
      
      // External current injection
      let extI = 0;
      if (isPos && bPlusCellIndices.includes(cellIdx)) {
        // Extract current at B+ terminal
        extI -= currentPerBPlus;
      }
      if (!isPos && bMinusCellIndices.includes(cellIdx)) {
        // Inject current at B- terminal
        extI += currentPerBMinus;
      }
      
      const newV = (sumG_V + extI) / diagG[node];
      const d = Math.abs(newV - V[node]);
      if (d > maxDiff) maxDiff = d;
      V[node] = newV;
    }
    
    diff = maxDiff;
    iter++;
  }

  // Calculate final currents and temperatures
  const cellCurrents = new Float64Array(N);
  const cellLosses = new Float64Array(N);
  const cellVoltages = new Float64Array(N); // actual terminal voltage V_pos - V_neg
  
  for (let i = 0; i < N; i++) {
    const vNeg = V[2 * i];
    const vPos = V[2 * i + 1];
    cellVoltages[i] = vPos - vNeg;
    
    // Current flowing OUT of positive terminal
    const I = (cellVoltage - cellVoltages[i]) / cellIr;
    cellCurrents[i] = I;
    cellLosses[i] = I * I * cellIr; // internal heating
  }

  // Calculate Nickel strip currents and heating
  let totalStripLoss = 0;
  const stripLosses = connections.map(conn => {
    const v1 = V[conn.n1];
    const v2 = V[conn.n2];
    const I = (v1 - v2) / conn.r;
    const P = I * I * conn.r;
    totalStripLoss += P;
    return { n1: conn.n1, n2: conn.n2, current: I, power: P };
  });

  // Calculate pack voltage sag
  // Average B+ voltage minus average B- voltage
  const avgBPlusV = bPlusCellIndices.reduce((sum, idx) => sum + V[2 * idx + 1], 0) / bPlusCellIndices.length;
  const avgBMinusV = bMinusCellIndices.reduce((sum, idx) => sum + V[2 * idx], 0) / bMinusCellIndices.length;
  const packVoltage = avgBPlusV - avgBMinusV;
  const openCircuitPackV = series * cellVoltage;
  const voltageSag = openCircuitPackV - packVoltage;

  // Calculate Thermal Penalty ("Hot Core" effect)
  // Count neighbors for each cell within maxNeighDist
  const neighborCounts = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    let count = 0;
    const c1 = cells[i];
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const c2 = cells[j];
      if (Math.hypot(c1.x - c2.x, c1.y - c2.y) <= maxNeighDist) {
        count++;
      }
    }
    neighborCounts[i] = count;
  }

  // Temperature rise calculation
  // Temperature rise is proportional to cell loss + adjacent strip losses
  // and multiplied by the spatial hot core penalty.
  const tempRise = new Float64Array(N);
  const ambientTemp = 25.0; // °C
  
  for (let i = 0; i < N; i++) {
    // Spatial penalty: multiplier based on neighbors (more neighbors = less ventilation)
    // Honeycomb has max 6 neighbors. Square has max 4 (or 8 with diagonals).
    const penalty = 1.0 + 0.18 * neighborCounts[i];
    
    // Gather power dissipated near this cell (internal loss + half of connected strips losses)
    let localPower = cellLosses[i];
    stripLosses.forEach(s => {
      const c1Idx = Math.floor(s.n1 / 2);
      const c2Idx = Math.floor(s.n2 / 2);
      if (c1Idx === i || c2Idx === i) {
        localPower += s.power * 0.5; // share strip loss with neighbors
      }
    });

    // Simple thermal resistance model: Delta T = Power * R_theta * Penalty
    // Assuming R_theta = 12 °C/W for a typical cell package in a holder
    const rTheta = 12.0; 
    tempRise[i] = localPower * rTheta * penalty;
  }

  // Scale temperatures to look realistic
  const cellTemps = tempRise.map(tr => ambientTemp + tr);
  const maxTemp = Math.max(...cellTemps);

  // Group currents by parallel groups (to see asymmetry)
  const sectionCurrents = Array.from({ length: series }, () => []);
  for (let i = 0; i < N; i++) {
    const s = cells[i].section;
    if (s !== null && s !== undefined) {
      sectionCurrents[s].push(cellCurrents[i]);
    }
  }

  // Find max asymmetry (difference between max and min current in each section)
  let maxAsymmetry = 0;
  sectionCurrents.forEach((currents, s) => {
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
