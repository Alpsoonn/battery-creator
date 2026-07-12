// Manual Packing Helpers - Global Script

function initializeManualPack(state) {
  state.manual.cells = [];
  state.manual.controller = {
    cx: 0,
    cy: 0,
    w: 90,
    h: 45,
    angle: 0
  };
  state.manual.controllerOn = false;
  
  state.sections.sectioning = [];
  state.sections.cellOverrides = {};
}

function scaleManualCells(cells, cellTypeBefore, cellTypeAfter) {
  if (cells.length === 0) return;
  const ratio = cellTypeAfter / cellTypeBefore;
  
  cells.forEach(c => {
    c.x *= ratio;
    c.y *= ratio;
  });
}

function getManualStats(cells, series) {
  const total = cells.length;
  const P = series > 0 ? Math.floor(total / series) : 0;
  const rem = series > 0 ? total % series : total;
  
  return {
    total,
    series,
    parallel: P,
    remainder: rem
  };
}

// Expose globally
window.initializeManualPack = initializeManualPack;
window.scaleManualCells = scaleManualCells;
window.getManualStats = getManualStats;
