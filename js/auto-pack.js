// Automatic Packing Solver Engine - Global Script

function possibleConfigs(totalCells) {
  const list = [];
  for (let s = 7; s <= 24; s++) {
    const p = Math.floor(totalCells / s);
    if (p > 0) {
      const used = s * p;
      const spare = totalCells - used;
      list.push({ s, p, used, spare });
    }
  }
  return list.sort((a, b) => b.used - a.used || b.s - a.s);
}

function compactnessScore(cells) {
  if (cells.length <= 1) return 0;
  let cx = 0, cy = 0;
  cells.forEach(c => { cx += c.x; cy += c.y; });
  cx /= cells.length;
  cy /= cells.length;
  
  let sumDist = 0;
  cells.forEach(c => {
    sumDist += Math.hypot(c.x - cx, c.y - cy);
  });
  return sumDist / cells.length;
}

function generateGrid(tri, opts, layout, angleDeg, ox, oy) {
  const radius = opts.cellDiameter / 2;
  const pitch = opts.cellDiameter + opts.cellGap;
  const angle = angleDeg * Math.PI / 180;
  const bounds = polygonBounds(tri);
  
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + pitch * 8;
  const cells = [];
  const rowStep = layout === "honeycomb" ? pitch * Math.sqrt(3) / 2 : pitch;
  const colStep = pitch;
  let id = 0;

  for (let row = -Math.ceil(span / rowStep); row <= Math.ceil(span / rowStep); row++) {
    for (let col = -Math.ceil(span / colStep); col <= Math.ceil(span / colStep); col++) {
      const stagger = layout === "honeycomb" && row % 2 !== 0 ? colStep / 2 : 0;
      const local = {
        x: col * colStep + stagger + ox,
        y: row * rowStep + oy
      };
      
      const rp = rotatePoint(local, angle);
      const p = {
        x: rp.x + (bounds.minX + bounds.maxX) / 2,
        y: rp.y + (bounds.minY + bounds.maxY) / 2
      };
      
      if (p.x < bounds.minX - pitch || p.x > bounds.maxX + pitch || p.y < bounds.minY - pitch || p.y > bounds.maxY + pitch) {
        continue;
      }
      
      if (pointInTriangle(p, tri, opts.frameMargin + radius)) {
        cells.push({ x: p.x, y: p.y, id: id++, row, col });
      }
    }
  }
  return cells;
}

function findController(tri, cells, opts) {
  const radius = opts.cellDiameter / 2;
  const clearance = radius + opts.cellGap;
  const triMargin = opts.frameMargin;
  
  let best = null;
  const bounds = polygonBounds(tri);
  const step = 8;
  const angles = opts.controllerRotate ? [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165] : [0];

  function tryRect(rect) {
    if (!rectInsideTriangle(rect, tri, triMargin)) return;
    
    let conflicts = 0;
    for (const c of cells) {
      if (circleRectOverlap(c, radius, rect, clearance)) {
        conflicts++;
      }
    }
    
    const fit = controllerCornerFit(rect, tri);
    
    if (best === null || 
        conflicts < best.conflicts || 
        (conflicts === best.conflicts && fit.distance < best.fitDistance)) {
      best = {
        cx: rect.cx,
        cy: rect.cy,
        w: rect.w,
        h: rect.h,
        angle: rect.angle,
        conflicts,
        fitDistance: fit.distance,
        vertexIndex: fit.vertexIndex
      };
    }
  }

  for (let x = bounds.minX; x <= bounds.maxX; x += step) {
    for (let y = bounds.minY; y <= bounds.maxY; y += step) {
      if (!pointInTriangle({ x, y }, tri, triMargin)) continue;
      
      for (const angle of angles) {
        tryRect({ cx: x, cy: y, w: opts.controllerW, h: opts.controllerH, angle });
      }
    }
  }

  return best;
}

function weldingOrder(cells) {
  const sorted = [...cells].sort((a, b) => a.x - b.x || a.y - b.y);
  return sorted;
}

function verticalSnakePath(cells) {
  if (cells.length === 0) return [];
  const cols = {};
  cells.forEach(c => {
    const key = Math.round(c.x * 10);
    if (!cols[key]) cols[key] = [];
    cols[key].push(c);
  });
  
  const sortedColKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);
  const path = [];
  
  sortedColKeys.forEach((colKey, index) => {
    const colCells = cols[colKey].sort((a, b) => a.y - b.y);
    if (index % 2 === 1) {
      colCells.reverse();
    }
    path.push(...colCells);
  });
  
  return path;
}

function assignSections(cells, series) {
  if (cells.length === 0) return [];
  
  const path = verticalSnakePath(cells);
  const P = Math.floor(cells.length / series);
  const totalTarget = series * P;
  
  const assigned = path.map(c => ({
    ...c,
    section: null,
    parallelIndex: null
  }));

  let currentSec = 0;
  let countInSec = 0;
  
  for (let i = 0; i < totalTarget; i++) {
    assigned[i].section = currentSec;
    assigned[i].parallelIndex = countInSec + 1;
    
    countInSec++;
    if (countInSec === P) {
      currentSec++;
      countInSec = 0;
    }
  }
  
  return assigned;
}

async function solve(inputs, progressCallback = () => {}) {
  const {
    sideA, sideB, sideC,
    cellDiameter, cellGap, frameMargin,
    angleStep, offsetDensity,
    controllerOn, controllerW, controllerH, controllerRotate,
    series
  } = inputs;

  const triInfo = triangleFromSides([sideA, sideB, sideC]);
  const tri = triInfo.points;
  
  const pitch = cellDiameter + cellGap;
  const layouts = inputs.layoutMode === "both" ? ["honeycomb", "square"] : [inputs.layoutMode];
  const stepSize = Math.max(1, 5 - offsetDensity);
  
  let bestVariants = [];
  const maxVariantsToKeep = 4;

  const totalSteps = layouts.length * 360 / angleStep;
  let currentStep = 0;

  for (const layout of layouts) {
    for (let angle = 0; angle < 360; angle += angleStep) {
      currentStep++;
      if (currentStep % 5 === 0) {
        progressCallback(Math.min(95, Math.round((currentStep / totalSteps) * 100)), `Przeliczanie: ${layout} (${angle}°)`);
        await new Promise(r => setTimeout(r, 0));
      }

      const offsets = [];
      const rowStep = layout === "honeycomb" ? pitch * Math.sqrt(3) / 2 : pitch;
      
      for (let ox = 0; ox < pitch; ox += stepSize * 2) {
        for (let oy = 0; oy < rowStep; oy += stepSize * 2) {
          offsets.push({ ox, oy });
        }
      }

      for (const offset of offsets) {
        let gridCells = generateGrid(tri, { cellDiameter, cellGap, frameMargin }, layout, angle, offset.ox, offset.oy);
        
        let controller = null;
        let finalCells = gridCells;

        if (controllerOn) {
          controller = findController(tri, gridCells, {
            cellDiameter, cellGap, frameMargin,
            controllerW, controllerH, controllerRotate
          });
          
          if (controller) {
            const radius = cellDiameter / 2;
            const clearance = radius + cellGap;
            finalCells = gridCells.filter(c => !circleRectOverlap(c, radius, controller, clearance));
          } else {
            continue;
          }
        }

        const totalCells = finalCells.length;
        if (totalCells < series) continue;

        const usedP = Math.floor(totalCells / series);
        const score = compactnessScore(finalCells);
        
        const variant = {
          layout,
          angle,
          ox: offset.ox,
          oy: offset.oy,
          cells: finalCells,
          triInfo,
          controller,
          totalCells,
          usedP,
          score
        };

        bestVariants.push(variant);
        bestVariants.sort((a, b) => b.totalCells - a.totalCells || a.score - b.score);
        
        if (bestVariants.length > maxVariantsToKeep) {
          bestVariants.pop();
        }
      }
    }
  }

  progressCallback(100, "Gotowe!");
  return bestVariants;
}

// Expose globally
window.possibleConfigs = possibleConfigs;
window.compactnessScore = compactnessScore;
window.generateGrid = generateGrid;
window.findController = findController;
window.weldingOrder = weldingOrder;
window.verticalSnakePath = verticalSnakePath;
window.assignSections = assignSections;
window.solve = solve;
