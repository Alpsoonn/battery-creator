// 2D Graphics Engine - SVG Renderer - Global Script
// Renders vector graphics inside the original <svg> elements and manages mouse interactions

class Graphics2D {
  constructor() {
    this.svgStage1 = document.getElementById('drawing');
    this.svgStage2 = document.getElementById('stage2-drawing');
    this.svgStage3 = document.getElementById('stage3-drawing');
    
    // Hover/Selection state
    this.hoveredCellId = null;
    this.selectedCellId = null;
    this.viewMode = 'electrical'; // electrical or thermal
    
    // Dragging state for manual controller
    this.isDraggingCtrl = false;
    this.dragStartMouseX = 0;
    this.dragStartMouseY = 0;
    this.dragStartCtrlX = 0;
    this.dragStartCtrlY = 0;
    
    this.initEvents();
  }

  setMode(mode) {
    this.viewMode = mode;
    this.requestRedraw();
  }

  initEvents() {
    // 1. Stage 1 SVG Interactions
    if (this.svgStage1) {
      this.svgStage1.addEventListener('mousedown', (e) => this.handleMouseDown(e));
      this.svgStage1.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      window.addEventListener('mouseup', () => this.handleMouseUp());
    }
    
    // 2. Stage 2 SVG Event Delegation (Cell click to assign section)
    if (this.svgStage2) {
      this.svgStage2.addEventListener('click', (e) => this.handleStage2Click(e));
      this.svgStage2.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.handleStage2RightClick(e);
      });
    }
  }

  requestRedraw() {
    const state = stateEngine.getState();
    const stage = state.currentStage;
    
    if (stage === 0) {
      this.drawStage1(state);
    } else if (stage === 1) {
      this.drawStage2(state);
    } else if (stage === 2) {
      this.drawStage3(state);
    }
  }

  // Convert mouse client coordinates to SVG local space
  getSVGMouseCoordinates(e, svg) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPoint = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: svgPoint.x, y: svgPoint.y };
  }

  handleMouseDown(e) {
    const state = stateEngine.getState();
    if (state.currentStage !== 0) return;
    
    const isManual = state.isManualMode;
    const mouse = this.getSVGMouseCoordinates(e, this.svgStage1);
    
    // 1. Check drag controller in manual mode
    const ctrl = isManual ? state.manual.controller : state.geometry.controller;
    const ctrlOn = isManual ? state.manual.controllerOn : state.geometry.controllerOn;
    
    if (isManual && ctrl && ctrlOn) {
      // Check if click was inside controller rect
      const corners = rotatedRectCorners(ctrl);
      if (pointInPolygon(mouse, corners)) {
        this.isDraggingCtrl = true;
        this.dragStartMouseX = mouse.x;
        this.dragStartMouseY = mouse.y;
        this.dragStartCtrlX = ctrl.cx;
        this.dragStartCtrlY = ctrl.cy;
        stateEngine.saveCheckpoint("Przeciągnij sterownik");
        return;
      }
    }

    // 2. Handle manual cell painting clicks in Stage 1
    if (isManual) {
      const pitch = state.manual.cellType + state.manual.cellGap;
      const layout = state.manual.layout;
      
      const clickedSlot = this.findNearestGridSlot(mouse.x, mouse.y, pitch, layout);
      if (clickedSlot) {
        const cellIdx = state.manual.cells.findIndex(c => c.row === clickedSlot.row && c.col === clickedSlot.col);
        
        stateEngine.saveCheckpoint(cellIdx >= 0 ? "Usuń ogniwo" : "Dodaj ogniwo");
        
        if (cellIdx >= 0) {
          state.manual.cells.splice(cellIdx, 1);
        } else {
          state.manual.cells.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            row: clickedSlot.row,
            col: clickedSlot.col,
            x: clickedSlot.x,
            y: clickedSlot.y,
            section: null,
            parallelIndex: null
          });
        }
        
        stateEngine.setState({ manual: { cells: state.manual.cells } });
        return;
      }
    }
  }

  handleMouseMove(e) {
    const state = stateEngine.getState();
    if (state.currentStage !== 0 || !this.isDraggingCtrl) return;
    
    const mouse = this.getSVGMouseCoordinates(e, this.svgStage1);
    const dx = mouse.x - this.dragStartMouseX;
    const dy = mouse.y - this.dragStartMouseY;
    
    stateEngine.setState({
      manual: {
        controller: {
          ...state.manual.controller,
          cx: this.dragStartCtrlX + dx,
          cy: this.dragStartCtrlY + dy
        }
      }
    });
  }

  handleMouseUp() {
    this.isDraggingCtrl = false;
  }

  handleStage2Click(e) {
    const g = e.target.closest('.cell-g');
    if (!g) return;
    
    const cid = parseInt(g.dataset.cid);
    const state = stateEngine.getState();
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    const activeSec = state.sections.activeDrawSec;
    const maxP = state.sections.parallel;
    
    const cell = cells.find(c => c.id === cid);
    if (!cell) return;
    
    stateEngine.saveCheckpoint("Zmień sekcję ogniwa");
    
    if (cell.section === activeSec) {
      cell.section = null;
      cell.parallelIndex = null;
    } else {
      const currentCount = cells.filter(c => c.section === activeSec).length;
      if (currentCount < maxP) {
        cell.section = activeSec;
      } else {
        alert(`Sekcja S${activeSec + 1} jest już pełna (${maxP} ogniw)!`);
      }
    }
    
    this.recalculateParallelIndices(cells);
    stateEngine.setState({
      [isManual ? 'manual' : 'geometry']: { cells }
    });
  }

  handleStage2RightClick(e) {
    const g = e.target.closest('.cell-g');
    if (!g) return;
    
    const cid = parseInt(g.dataset.cid);
    const state = stateEngine.getState();
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    
    const cell = cells.find(c => c.id === cid);
    if (cell) {
      stateEngine.saveCheckpoint("Wyczyść sekcję ogniwa");
      cell.section = null;
      cell.parallelIndex = null;
      
      this.recalculateParallelIndices(cells);
      stateEngine.setState({
        [isManual ? 'manual' : 'geometry']: { cells }
      });
    }
  }

  recalculateParallelIndices(cells) {
    const secGroups = {};
    cells.forEach(c => {
      if (c.section !== null && c.section !== undefined && c.section >= 0) {
        if (!secGroups[c.section]) secGroups[c.section] = [];
        secGroups[c.section].push(c);
      }
    });
    
    Object.keys(secGroups).forEach(s => {
      secGroups[s].sort((a, b) => a.x - b.x || a.y - b.y);
      secGroups[s].forEach((c, idx) => {
        c.parallelIndex = idx + 1;
      });
    });
  }

  findNearestGridSlot(x, y, pitch, layout) {
    const colEst = Math.round(x / pitch);
    const rowEst = Math.round(y / (layout === 'honeycomb' ? pitch * Math.sqrt(3) / 2 : pitch));
    
    let bestSlot = null;
    let minDist = pitch * 0.7; // Snapping radius
    
    const searchRadius = 3;
    for (let r = rowEst - searchRadius; r <= rowEst + searchRadius; r++) {
      for (let c = colEst - searchRadius; c <= colEst + searchRadius; c++) {
        let gx, gy;
        if (layout === 'honeycomb') {
          const stagger = (r % 2 !== 0) ? pitch / 2 : 0;
          gx = c * pitch + stagger;
          gy = r * (pitch * Math.sqrt(3) / 2);
        } else {
          gx = c * pitch;
          gy = r * pitch;
        }
        
        const dist = Math.hypot(x - gx, y - gy);
        if (dist < minDist) {
          minDist = dist;
          bestSlot = { row: r, col: c, x: gx, y: gy };
        }
      }
    }
    return bestSlot;
  }

  // ================= RENDER STAGE 1 (GEOMETRY) =================
  drawStage1(state) {
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    const tri = isManual ? null : state.geometry.triInfo;
    const controller = isManual ? state.manual.controller : state.geometry.controller;
    const controllerOn = isManual ? state.manual.controllerOn : state.geometry.controllerOn;
    const r = (isManual ? state.manual.cellType : state.geometry.cellType) / 2;
    
    if (!this.svgStage1) return;
    
    // 1. Calculate ViewBox
    let minX = -150, maxX = 150, minY = -150, maxY = 150;
    if (cells.length > 0) {
      const xs = cells.map(c => c.x);
      const ys = cells.map(c => c.y);
      minX = Math.min(...xs) - r - 30;
      maxX = Math.max(...xs) + r + 30;
      minY = Math.min(...ys) - r - 30;
      maxY = Math.max(...ys) + r + 30;
    } else if (!isManual && tri && tri.points) {
      const xs = tri.points.map(p => p.x);
      const ys = tri.points.map(p => p.y);
      minX = Math.min(...xs) - 40;
      maxX = Math.max(...xs) + 40;
      minY = Math.min(...ys) - 40;
      maxY = Math.max(...ys) + 40;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    
    this.svgStage1.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    
    // 2. Build SVG String
    let content = `
      <defs>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#111827" flood-opacity=".18"/>
        </filter>
      </defs>
    `;
    
    // Draw triangle frame (Auto mode only)
    if (!isManual && tri && tri.points) {
      const poly = tri.points.map(p => `${p.x},${p.y}`).join(" ");
      content += `<polygon points="${poly}" fill="transparent" stroke="var(--frame)" stroke-width="2.5" filter="url(#softShadow)"></polygon>`;
      content += this.drawSideLabels(tri);
    }
    
    // Draw progressive grid slots (Manual mode only)
    if (isManual) {
      content += this.buildProgressiveGridSvg(state, r);
    }
    
    // Draw controller
    if (controller && ctrlOn) {
      const corners = rotatedRectCorners(controller);
      const poly = corners.map(p => `${p.x},${p.y}`).join(" ");
      
      let isColliding = false;
      if (isManual) {
        isColliding = cells.some(cell => circleRectOverlap(cell, r, controller));
      }
      
      const strokeColor = isColliding ? 'var(--danger)' : (isManual ? 'var(--accent-2)' : 'rgba(255,255,255,0.4)');
      const dash = isManual ? 'stroke-dasharray="5,4"' : '';
      const fill = isColliding ? 'rgba(248,113,113,0.1)' : 'rgba(255,255,255,0.02)';
      
      content += `
        <polygon points="${poly}" fill="${fill}" stroke="${strokeColor}" stroke-width="1.8" ${dash} style="${isManual ? 'cursor:move;' : ''}"></polygon>
        <text x="${controller.cx}" y="${controller.cy}" text-anchor="middle" font-size="9" fill="${strokeColor}" font-weight="800" style="pointer-events:none">STEROWNIK</text>
        <text x="${controller.cx}" y="${controller.cy + 10}" text-anchor="middle" font-size="7" fill="${strokeColor}" style="pointer-events:none">${controller.w} x ${controller.h} mm</text>
      `;
    }
    
    // Draw cells
    content += this.buildCellsSvg(cells, r);
    
    this.svgStage1.innerHTML = content;
  }

  buildProgressiveGridSvg(state, r) {
    const cells = state.manual.cells;
    const pitch = state.manual.cellType + state.manual.cellGap;
    const layout = state.manual.layout;
    
    if (cells.length === 0) {
      // Draw single central snap point
      return `
        <circle cx="0" cy="0" r="${r}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="4,4" style="cursor:pointer"></circle>
        <line x1="-5" y1="0" x2="5" y2="0" stroke="var(--accent)" stroke-width="1.5"></line>
        <line x1="0" y1="-5" x2="0" y2="5" stroke="var(--accent)" stroke-width="1.5"></line>
        <text x="0" y="${r + 20}" text-anchor="middle" font-size="10" fill="var(--muted)" font-weight="600">Kliknij aby dodać pierwsze ogniwo</text>
      `;
    }
    
    // Find placed cell bounding box
    const rows = cells.map(c => c.row);
    const cols = cells.map(c => c.col);
    const minRow = Math.min(...rows) - 2;
    const maxRow = Math.max(...rows) + 2;
    const minCol = Math.min(...cols) - 2;
    const maxCol = Math.max(...cols) + 2;
    
    let gridContent = "";
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        // Skip if cell exists
        const exists = cells.some(c => c.row === row && c.col === col);
        if (exists) continue;
        
        let gx, gy;
        if (layout === 'honeycomb') {
          const stagger = (row % 2 !== 0) ? pitch / 2 : 0;
          gx = col * pitch + stagger;
          gy = row * (pitch * Math.sqrt(3) / 2);
        } else {
          gx = col * pitch;
          gy = row * pitch;
        }
        
        gridContent += `<circle cx="${gx.toFixed(1)}" cy="${gy.toFixed(1)}" r="${(r * 0.95).toFixed(1)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1" stroke-dasharray="2,2" style="cursor:pointer"></circle>`;
      }
    }
    return gridContent;
  }

  buildCellsSvg(cells, r) {
    const colors = [
      "#2b6cb0", "#c05621", "#2f855a", "#805ad5", "#b83280",
      "#0f766e", "#b7791f", "#4a5568", "#dd6b20", "#3182ce",
      "#38a169", "#9f7aea", "#d53f8c", "#319795", "#718096",
      "#e53e3e", "#667eea", "#975a16", "#2c7a7b", "#6b46c1"
    ];

    return cells.map(c => {
      const fill = (c.section !== null && c.section !== undefined && c.section >= 0) ? colors[c.section % colors.length] : "#d8dee8";
      const pIdx = (c.parallelIndex !== null && c.parallelIndex !== undefined) ? c.parallelIndex : "";
      const textCol = readableTextColor(fill);
      
      let labelNode = "";
      if (c.section !== null && c.section !== undefined && c.section >= 0) {
        labelNode = `
          <text x="${c.x.toFixed(2)}" y="${(c.y - r * 0.08).toFixed(2)}" text-anchor="middle" font-size="${Math.max(4.5, r * .55).toFixed(1)}" font-weight="750" fill="${textCol}" style="pointer-events:none">${pIdx}</text>
          <text x="${c.x.toFixed(2)}" y="${(c.y + r * 0.48).toFixed(2)}" text-anchor="middle" font-size="${Math.max(3.5, r * .38).toFixed(1)}" font-weight="750" fill="${textCol}" opacity="0.8" style="pointer-events:none">S${c.section + 1}</text>
        `;
      }

      return `
        <g class="cell-g" data-cid="${c.id}" style="cursor:pointer;">
          <circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}" stroke="var(--cell-stroke)" stroke-width="0.9"></circle>
          ${labelNode}
        </g>
      `;
    }).join("");
  }

  drawSideLabels(tri) {
    const [p0, p1, p2] = tri.points;
    const mA = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 - 10 };
    const mB = { x: (p1.x + p2.x) / 2 + 12, y: (p1.y + p2.y) / 2 };
    const mC = { x: (p2.x + p0.x) / 2 - 12, y: (p2.y + p0.y) / 2 };
    
    return `
      <text x="${mA.x}" y="${mA.y}" fill="var(--muted)" font-size="10" text-anchor="middle">${Math.round(tri.top)} mm</text>
      <text x="${mB.x}" y="${mB.y}" fill="var(--muted)" font-size="10" text-anchor="start">${Math.round(tri.shortest)} mm</text>
      <text x="${mC.x}" y="${mC.y}" fill="var(--muted)" font-size="10" text-anchor="end">${Math.round(tri.longest)} mm</text>
    `;
  }

  // ================= RENDER STAGE 2 (S/P GROUPING) =================
  drawStage2(state) {
    if (!this.svgStage2) return;
    
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    const tri = isManual ? null : state.geometry.triInfo;
    const r = (isManual ? state.manual.cellType : state.geometry.cellType) / 2;
    const pitch = (isManual ? state.manual.cellType : state.geometry.cellType) + (isManual ? state.manual.cellGap : state.geometry.cellGap);
    const series = isManual ? state.sections.series : state.geometry.series;
    
    let minX = -150, maxX = 150, minY = -150, maxY = 150;
    if (cells.length > 0) {
      const xs = cells.map(c => c.x);
      const ys = cells.map(c => c.y);
      minX = Math.min(...xs) - r - 30;
      maxX = Math.max(...xs) + r + 30;
      minY = Math.min(...ys) - r - 30;
      maxY = Math.max(...ys) + r + 30;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    
    this.svgStage2.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    
    // Group cells for bottleneck checks
    const secs = Array.from({ length: series }, () => []);
    cells.forEach(c => {
      if (c.section !== null && c.section !== undefined && c.section >= 0) {
        secs[c.section].push(c);
      }
    });

    let content = "";
    
    // Draw triangle
    if (!isManual && tri && tri.points) {
      const poly = tri.points.map(p => `${p.x},${p.y}`).join(" ");
      content += `<polygon points="${poly}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.2"></polygon>`;
    }
    
    // Draw cells
    content += this.buildCellsSvg(cells, r);
    
    // Draw bottleneck warning dots
    const warnings = state.connections.validation.warnings || [];
    for (let s = 0; s < series - 1; s++) {
      const c1s = secs[s];
      const c2s = secs[s + 1];
      
      let edgeCount = 0;
      const connectedEdges = [];
      for (const c1 of c1s) {
        for (const c2 of c2s) {
          if (Math.hypot(c1.x - c2.x, c1.y - c2.y) <= pitch * 1.35) {
            edgeCount++;
            connectedEdges.push({ c1, c2 });
          }
        }
      }
      
      if (edgeCount === 0 || edgeCount === 1) {
        const markerColor = edgeCount === 0 ? "var(--danger)" : "var(--accent-2)";
        connectedEdges.forEach(edge => {
          const cx = (edge.c1.x + edge.c2.x) / 2;
          const cy = (edge.c1.y + edge.c2.y) / 2;
          content += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="2" fill="${markerColor}" opacity="0.7"></circle>`;
        });
      }
    }
    
    this.svgStage2.innerHTML = content;
  }

  // ================= RENDER STAGE 3 (RESISTOR NETWORK SIMULATION) =================
  drawStage3(state) {
    if (!this.svgStage3) return;
    
    const isManual = state.isManualMode;
    const cells = isManual ? state.manual.cells : state.geometry.cells;
    const tri = isManual ? null : state.geometry.triInfo;
    const r = (isManual ? state.manual.cellType : state.geometry.cellType) / 2;
    const pitch = (isManual ? state.manual.cellType : state.geometry.cellType) + (isManual ? state.manual.cellGap : state.geometry.cellGap);
    const series = isManual ? state.sections.series : state.geometry.series;
    
    let minX = -150, maxX = 150, minY = -150, maxY = 150;
    if (cells.length > 0) {
      const xs = cells.map(c => c.x);
      const ys = cells.map(c => c.y);
      minX = Math.min(...xs) - r - 30;
      maxX = Math.max(...xs) + r + 30;
      minY = Math.min(...ys) - r - 30;
      maxY = Math.max(...ys) + r + 30;
    }
    const width = maxX - minX;
    const height = maxY - minY;
    
    this.svgStage3.setAttribute('viewBox', `${minX} ${minY} ${width} ${height}`);
    
    // Group cells
    const secs = Array.from({ length: series }, () => []);
    cells.forEach(c => {
      if (c.section !== null && c.section !== undefined && c.section >= 0) {
        secs[c.section].push(c);
      }
    });

    let content = `
      <defs>
        <marker id="arrow-front-3" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#dc2626" />
        </marker>
        <marker id="arrow-back-3" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563eb" />
        </marker>
      </defs>
    `;
    
    // Draw triangle frame
    if (!isManual && tri && tri.points) {
      const poly = tri.points.map(p => `${p.x},${p.y}`).join(" ");
      content += `<polygon points="${poly}" fill="transparent" stroke="var(--frame)" stroke-width="2.5"></polygon>`;
    }
    
    // Draw cells
    const colors = [
      "#2b6cb0", "#c05621", "#2f855a", "#805ad5", "#b83280",
      "#0f766e", "#b7791f", "#4a5568", "#dd6b20", "#3182ce",
      "#38a169", "#9f7aea", "#d53f8c", "#319795", "#718096",
      "#e53e3e", "#667eea", "#975a16", "#2c7a7b", "#6b46c1"
    ];

    const simResults = state.simulation.results;
    
    content += cells.map((cell, idx) => {
      let fill = '#334155';
      let textColor = '#ffffff';
      
      if (this.viewMode === 'thermal' && simResults && simResults.cellTemps) {
        // Thermal Heatmap coloring
        const temp = simResults.cellTemps[idx] || 25.0;
        const ratio = Math.max(0, Math.min(1, (temp - 25.0) / 50.0));
        const hue = (1.0 - ratio) * 120;
        fill = `hsl(${hue}, 85%, 45%)`;
        textColor = '#0f172a';
      } else if (cell.section !== null && cell.section !== undefined && cell.section >= 0) {
        fill = colors[cell.section % colors.length];
      }
      
      const pIdx = cell.parallelIndex || "";
      let labels = "";
      if (this.viewMode === 'thermal' && simResults && simResults.cellTemps) {
        const temp = simResults.cellTemps[idx] || 25.0;
        labels = `<text x="${cell.x.toFixed(2)}" y="${cell.y.toFixed(2)}" text-anchor="middle" font-size="${(r * 0.55).toFixed(1)}" font-weight="750" fill="${textColor}" style="pointer-events:none">${temp.toFixed(1)}°</text>`;
      } else if (cell.section !== null && cell.section !== undefined && cell.section >= 0) {
        labels = `
          <text x="${cell.x.toFixed(2)}" y="${(cell.y - r * 0.08).toFixed(2)}" text-anchor="middle" font-size="${Math.max(4.5, r * .55).toFixed(1)}" font-weight="750" fill="${textColor}" style="pointer-events:none">${pIdx}</text>
          <text x="${cell.x.toFixed(2)}" y="${(cell.y + r * 0.48).toFixed(2)}" text-anchor="middle" font-size="${Math.max(3.5, r * .38).toFixed(1)}" font-weight="750" fill="${textColor}" opacity="0.8" style="pointer-events:none">S${cell.section + 1}</text>
        `;
      }

      return `
        <g class="cell-g">
          <circle cx="${cell.x.toFixed(2)}" cy="${cell.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}" stroke="var(--cell-stroke)" stroke-width="0.9"></circle>
          ${labels}
        </g>
      `;
    }).join("");

    // Draw connection arrows
    for (let s = 0; s < series - 1; s++) {
      const isFront = (s % 2 === 0);
      const stroke = isFront ? "#dc2626" : "#2563eb";
      const marker = isFront ? "url(#arrow-front-3)" : "url(#arrow-back-3)";
      const dash = isFront ? "" : 'stroke-dasharray="3,3"';
      
      for (const c1 of secs[s]) {
        for (const c2 of secs[s + 1]) {
          if (Math.hypot(c1.x - c2.x, c1.y - c2.y) <= pitch * 1.35) {
            const d = Math.hypot(c1.x - c2.x, c1.y - c2.y);
            const ux = (c2.x - c1.x) / d;
            const uy = (c2.y - c1.y) / d;
            
            const x1 = c1.x + ux * (r * 1.05);
            const y1 = c1.y + uy * (r * 1.05);
            const x2 = c2.x - ux * (r * 1.3);
            const y2 = c2.y - uy * (r * 1.3);
            
            content += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="1.8" ${dash} opacity="0.85" marker-end="${marker}"></line>`;
          }
        }
      }
    }
    
    this.svgStage3.innerHTML = content;
  }
}

function readableTextColor(hex) {
  const color = (hex.startsWith('#')) ? hex.substring(1) : hex;
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 128) ? '#0f172a' : '#ffffff';
}

function pointInPolygon(p, corners) {
  let isInside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const xi = corners[i].x, yi = corners[i].y;
    const xj = corners[j].x, yj = corners[j].y;
    
    const intersect = ((yi > p.y) !== (yj > p.y))
        && (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
    if (intersect) isInside = !isInside;
  }
  return isInside;
}

window.Graphics2D = Graphics2D;
