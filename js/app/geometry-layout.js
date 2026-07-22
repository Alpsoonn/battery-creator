  // ===== Mode switcher =====
  function placeStage1CellDefinitionControls(inManualPanel) {
    const controls = $("stage1CellDefinitionControls");
    const mount = $(inManualPanel ? "manualCellDefinitionMount" : "autoCellDefinitionMount");
    if (controls && mount && controls.parentElement !== mount) mount.appendChild(controls);
    if ($("automaticLayoutModeField")) $("automaticLayoutModeField").hidden = inManualPanel;
  }

  function setAutoMode() {
    if (boundaryType === "none") {
      setManualModeBtn();
      return;
    }
    manualMode = false;
    placeStage1CellDefinitionControls(false);
    $('btn-auto-mode').classList.add('active');
    $('btn-manual-mode').classList.remove('active');
    $('btn-manual-mode').textContent = "Pozycjonowanie ręczne";
    $("stage1-positioning-mode-tabs").style.display = stage1Substep === 2 ? "" : "none";
    $('autoPanel').style.display = '';
    $('manualModePanel').style.display = 'none';
    $("placementControls").style.display = stage1Substep === 2 ? "" : "none";
    updateBoundaryTypeUI();
    $('manualTransformTools').hidden = true;
    render();
  }

  function setManualModeBtn() {
    placeStage1CellDefinitionControls(true);
    $('btn-auto-mode').classList.remove('active');
    $('btn-manual-mode').classList.add('active');
    $('btn-manual-mode').textContent = "Pozycjonowanie ręczne";
    $("stage1-positioning-mode-tabs").style.display = stage1Substep === 2 ? "" : "none";
    $('autoPanel').style.display = stage1Substep === 1 ? '' : 'none';
    $('manualModePanel').style.display = stage1Substep === 2 ? 'grid' : 'none';

    startManualMode();
  }

  function updateStage1BoundaryDynamically() {
    updateBoundaryTypeUI();
    if (stage1Substep === 1) {
      renderBoundaryStage();
      return;
    }
    try {
      commitBoundaryForPlacement();
      renderPlacementBoundary($("drawing"), placementBoundary);
      $("summary").innerHTML = `<span class="pill">Aktualizacja rozmieszczenia ogniw…</span>`;
    } catch (error) {
      $("status").className = "status error";
      $("status").textContent = error.message;
      return;
    }
    if (stage1DynamicSolveTimer) clearTimeout(stage1DynamicSolveTimer);
    stage1DynamicSolveTimer = setTimeout(() => {
      stage1DynamicSolveTimer = null;
      if (currentStage === 1 && stage1Substep === 2 && !manualMode) runSolve();
    }, 100);
  }

  function setStage1Substep(step) {
    if (step === 2) {
      try {
        commitBoundaryForPlacement();
      } catch (error) {
        const status = $("boundaryEditorStatus");
        if (status) status.textContent = error.message;
        return;
      }
    }
    if (step === 2 && boundaryType === "none") manualMode = true;
    stage1Substep = step;
    $("btn-manual-mode").textContent = "Pozycjonowanie ręczne";
    $("stage1-boundary-step").classList.toggle("active", step === 1);
    $("stage1-placement-step").classList.toggle("active", step === 2);
    $("stage1-positioning-mode-tabs").style.display = step === 2 ? "" : "none";
    $("autoPanel").style.display = (!manualMode || step === 1) ? "" : "none";
    $("manualModePanel").style.display = manualMode && step === 2 ? "grid" : "none";
    $("placementControls").style.display = step === 2 && !manualMode ? "" : "none";
    placeStage1CellDefinitionControls(manualMode && step === 2);
    $("btn-auto-mode").classList.toggle("active", !manualMode);
    $("btn-manual-mode").classList.toggle("active", manualMode);
    updateBoundaryTypeUI();
    if (step === 2 && boundaryType === "none") {
      startManualMode();
      return;
    }
    render();
    if (step === 2 && !manualMode) runSolve();
  }

  function updateBoundaryTypeUI() {
    boundaryType = $("boundaryType").value;
    $("autoBoundaryControls").style.display = stage1Substep === 1 ? "" : "none";
    $("triangleBoundaryControls").style.display = boundaryType === "triangle" ? "" : "none";
    $("rectangleBoundaryControls").style.display = boundaryType === "rectangle" ? "" : "none";
    $("manualBoundaryPanel").style.display = boundaryType === "manual" && stage1Substep === 1 ? "" : "none";
    if ($("noBoundaryNotice")) $("noBoundaryNotice").style.display = boundaryType === "none" ? "block" : "none";
    $("btn-auto-mode").disabled = boundaryType === "none";
  }

  function rectangleFromSize() {
    const width = Math.max(1, readNumber("boundaryWidth"));
    const height = Math.max(1, readNumber("boundaryHeight"));
    return { type: "rectangle", points: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }], width, height };
  }

  function quadraticPoint(a, control, b, t) {
    const mt = 1 - t;
    return { x: mt * mt * a.x + 2 * mt * t * control.x + t * t * b.x, y: mt * mt * a.y + 2 * mt * t * control.y + t * t * b.y };
  }

  function edgeControls(edge) {
    if (!Array.isArray(edge.controls)) edge.controls = edge.curve && edge.control ? [{ ...edge.control }] : [];
    edge.curve = edge.controls.length > 0;
    return edge.controls;
  }

  function sampleManualEdge(edge, steps = 16) {
    const a = manualBoundaryPoints[edge.a], b = manualBoundaryPoints[edge.b];
    if (!a || !b) return [];
    const controls = edgeControls(edge);
    if (!controls.length) return [{ ...a }, { ...b }];
    const samples = [];
    let start = a;
    controls.forEach((control, index) => {
      const end = index === controls.length - 1 ? b : { x: (control.x + controls[index + 1].x) / 2, y: (control.y + controls[index + 1].y) / 2 };
      for (let step = 0; step <= steps; step++) {
        if (samples.length && step === 0) continue;
        samples.push(quadraticPoint(start, control, end, step / steps));
      }
      start = end;
    });
    return samples;
  }

  function manualEdgePath(edge) {
    const a = manualBoundaryPoints[edge.a], b = manualBoundaryPoints[edge.b];
    const controls = edgeControls(edge);
    if (!controls.length) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    let path = `M ${a.x} ${a.y}`;
    controls.forEach((control, index) => {
      const end = index === controls.length - 1 ? b : { x: (control.x + controls[index + 1].x) / 2, y: (control.y + controls[index + 1].y) / 2 };
      path += ` Q ${control.x} ${control.y} ${end.x} ${end.y}`;
    });
    return path;
  }

  function traceManualBoundary() {
    if (!manualBoundaryEdges.length || !manualBoundaryPoints.length) return { steps: [], complete: false, closed: false };
    const adjacency = new Map();
    manualBoundaryPoints.forEach((_, index) => adjacency.set(index, []));
    manualBoundaryEdges.forEach((edge, edgeIndex) => {
      adjacency.get(edge.a)?.push({ edgeIndex, next: edge.b, reverse: false });
      adjacency.get(edge.b)?.push({ edgeIndex, next: edge.a, reverse: true });
    });
    const endpoints = manualBoundaryOpenEndpoints();
    const start = manualBoundaryClosed
      ? (adjacency.get(0)?.length ? 0 : manualBoundaryEdges[0].a)
      : (endpoints[0] ?? manualBoundaryEdges[0].a);
    const visitedEdges = new Set();
    const visitedPoints = new Set([start]);
    const steps = [];
    let current = start;
    while (steps.length < manualBoundaryEdges.length) {
      const candidate = (adjacency.get(current) || []).find(item => !visitedEdges.has(item.edgeIndex));
      if (!candidate) break;
      visitedEdges.add(candidate.edgeIndex);
      visitedPoints.add(candidate.next);
      steps.push(candidate);
      current = candidate.next;
    }
    return {
      steps,
      complete: visitedEdges.size === manualBoundaryEdges.length && visitedPoints.size === manualBoundaryPoints.length,
      closed: current === start
    };
  }

  function sampleManualBoundary() {
    if (manualBoundaryPoints.length < 3) return [];
    const trace = traceManualBoundary();
    if (!trace.complete || (manualBoundaryClosed && !trace.closed)) return [];
    const result = [];
    trace.steps.forEach((step, stepIndex) => {
      const edge = manualBoundaryEdges[step.edgeIndex];
      const samples = sampleManualEdge(edge);
      if (step.reverse) samples.reverse();
      result.push(...(stepIndex === 0 ? samples : samples.slice(1)));
    });
    if (trace.closed && result.length > 1 && Math.hypot(result[0].x - result[result.length - 1].x, result[0].y - result[result.length - 1].y) < 1e-6) result.pop();
    return result;
  }

  function polygonArea(points) {
    if (points.length < 3) return 0;
    let doubledArea = 0;
    points.forEach((point, index) => {
      const next = points[(index + 1) % points.length];
      doubledArea += point.x * next.y - next.x * point.y;
    });
    return Math.abs(doubledArea) / 2;
  }

  function activeBoundary() {
    if (boundaryType === "none") return { type: "none", points: [] };
    if (boundaryType === "rectangle") return rectangleFromSize();
    if (boundaryType === "manual") return { type: "manual", points: [...manualBoundaryPoints], edges: [...manualBoundaryEdges], samples: sampleManualBoundary() };
    return triangleFromSides([readNumber("sideA"), readNumber("sideB"), readNumber("sideC")]);
  }

  function cloneBoundary(boundary) {
    return boundary ? JSON.parse(JSON.stringify(boundary)) : null;
  }

  function commitBoundaryForPlacement() {
    const boundary = activeBoundary();
    if (boundary.type === "none") {
      placementBoundary = { type: "none", points: [], areaMm2: null };
      variants = [];
      activeIndex = 0;
      manualVariant = null;
      return placementBoundary;
    }
    if (boundary.type === "manual" && (!manualBoundaryClosed || manualBoundaryPoints.length < 3)) {
      throw new Error("Najpierw zamknij wielobok wyznaczający granicę.");
    }
    if (boundary.type === "manual" && (!boundary.samples || boundary.samples.length < 3)) {
      throw new Error("Krawędzie granicy nie tworzą jednego poprawnie połączonego, zamkniętego obwodu.");
    }
    if (boundary.type === "manual" && boundaryHasSelfIntersection()) {
      throw new Error("Krawędzie granicy przecinają się. Popraw obwód przed rozmieszczaniem ogniw.");
    }
    const points = boundaryPoints(boundary);
    if (points.length < 3) throw new Error("Granica musi mieć co najmniej trzy punkty.");
    boundary.areaMm2 = polygonArea(points);
    if (!Number.isFinite(boundary.areaMm2) || boundary.areaMm2 < 0.01) throw new Error("Pole utworzonej granicy jest nieprawidłowe lub równe zeru.");
    placementBoundary = cloneBoundary(boundary);
    variants = [];
    activeIndex = 0;
    if (manualVariant) manualVariant.triInfo = cloneBoundary(placementBoundary);
    return placementBoundary;
  }

  function boundaryPoints(boundary) {
    return boundary?.samples?.length ? boundary.samples : (boundary?.points || []);
  }

  function pointInBoundary(p, boundary, margin = 0) {
    const points = boundaryPoints(boundary);
    if (points.length < 3) return false;
    if (margin > 0 && points.some((point, i) => edgeDistance(p, point, points[(i + 1) % points.length]) < margin)) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i], b = points[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / ((b.y - a.y) || 1e-9) + a.x) inside = !inside;
    }
    return inside;
  }

  function boundarySegments() {
    return manualBoundaryEdges.flatMap(edge => {
      const points = sampleManualEdge(edge);
      return points.slice(1).map((point, i) => ({ a: points[i], b: point }));
    });
  }

  function boundaryHasSelfIntersection() {
    for (let i = 0; i < manualBoundaryEdges.length; i++) {
      const edgeA = manualBoundaryEdges[i];
      const segmentsA = sampleManualEdge(edgeA);
      for (let j = i + 1; j < manualBoundaryEdges.length; j++) {
        const edgeB = manualBoundaryEdges[j];
        if ([edgeA.a, edgeA.b].some(point => point === edgeB.a || point === edgeB.b)) continue;
        const segmentsB = sampleManualEdge(edgeB);
        for (let ai = 1; ai < segmentsA.length; ai++) {
          for (let bi = 1; bi < segmentsB.length; bi++) {
            if (segmentIntersect(segmentsA[ai - 1], segmentsA[ai], segmentsB[bi - 1], segmentsB[bi])) return true;
          }
        }
      }
    }
    return false;
  }

  function segmentIntersect(a, b, c, d) {
    const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    return o1 * o2 < -1e-7 && o3 * o4 < -1e-7;
  }

  function manualEdgeIntersects(a, b, ignoredEdge = -1) {
    return boundarySegments().some((segment, index) => index !== ignoredEdge && segmentIntersect(a, b, segment.a, segment.b));
  }

  function manualEdgeLength(edge) {
    const points = sampleManualEdge(edge, 24);
    return points.slice(1).reduce((length, point, index) => length + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);
  }

  function manualEdgeMiddle(edge) {
    const points = sampleManualEdge(edge, 32);
    if (points.length < 2) return null;
    const length = manualEdgeLength(edge);
    let travelled = 0;
    for (let index = 1; index < points.length; index++) {
      const a = points[index - 1], b = points[index];
      const segmentLength = Math.hypot(b.x - a.x, b.y - a.y);
      if (travelled + segmentLength >= length / 2 || index === points.length - 1) {
        const ratio = segmentLength ? Math.max(0, Math.min(1, (length / 2 - travelled) / segmentLength)) : 0;
        return {
          x: a.x + (b.x - a.x) * ratio,
          y: a.y + (b.y - a.y) * ratio,
          dx: b.x - a.x,
          dy: b.y - a.y
        };
      }
      travelled += segmentLength;
    }
    return null;
  }

  function manualBoundaryOpenEndpoints() {
    if (manualBoundaryClosed) return [];
    const degree = Array(manualBoundaryPoints.length).fill(0);
    manualBoundaryEdges.forEach(edge => {
      degree[edge.a] = (degree[edge.a] || 0) + 1;
      degree[edge.b] = (degree[edge.b] || 0) + 1;
    });
    if (manualBoundaryPoints.length === 1) return [0];
    return degree.map((count, index) => count <= 1 ? index : null).filter(index => index !== null);
  }

  function manualBoundaryIsSingleOpenChain() {
    if (manualBoundaryClosed || manualBoundaryPoints.length < 2) return false;
    const endpoints = manualBoundaryOpenEndpoints();
    if (endpoints.length !== 2 || manualBoundaryEdges.length !== manualBoundaryPoints.length - 1) return false;
    const visited = new Set([endpoints[0]]);
    const queue = [endpoints[0]];
    while (queue.length) {
      const current = queue.shift();
      manualBoundaryEdges.forEach(edge => {
        const neighbour = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
        if (neighbour !== null && !visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      });
    }
    return visited.size === manualBoundaryPoints.length;
  }

  function manualBoundaryCanCloseAt(index) {
    return index === 0 && manualBoundaryPoints.length >= 3 && manualBoundaryOpenEndpoints().includes(index) && manualBoundaryIsSingleOpenChain();
  }

  function boundaryRulers(points) {
    if (!points.length) return "";
    const bounds = polygonBounds(points);
    const top = bounds.minY - 28, left = bounds.minX - 28;
    const step = 50;
    let xTicks = "", yTicks = "";
    const exactWidth = bounds.maxX - bounds.minX;
    for (let val = 0; val <= exactWidth; val += step) {
      if (exactWidth - val < 15) continue;
      let x = bounds.minX + val;
      xTicks += `<line x1="${x}" y1="${top - 5}" x2="${x}" y2="${top + 5}" stroke="rgba(148,163,184,.55)" stroke-width=".8"/><text x="${x}" y="${top - 9}" text-anchor="middle" font-size="7" fill="rgba(203,213,225,.75)">${val.toFixed(0)}</text>`;
    }
    xTicks += `<line x1="${bounds.maxX}" y1="${top - 5}" x2="${bounds.maxX}" y2="${top + 5}" stroke="#f87171" stroke-width="1"/><text x="${bounds.maxX}" y="${top - 18}" text-anchor="middle" font-size="7" fill="#f87171" font-weight="bold">${exactWidth.toFixed(2)} mm</text>`;

    const exactHeight = bounds.maxY - bounds.minY;
    for (let val = 0; val <= exactHeight; val += step) {
      if (exactHeight - val < 15) continue;
      let y = bounds.minY + val;
      yTicks += `<line x1="${left - 5}" y1="${y}" x2="${left + 5}" y2="${y}" stroke="rgba(148,163,184,.55)" stroke-width=".8"/><text x="${left - 9}" y="${y + 2.5}" text-anchor="end" font-size="7" fill="rgba(203,213,225,.75)">${val.toFixed(0)}</text>`;
    }
    yTicks += `<line x1="${left - 5}" y1="${bounds.maxY}" x2="${left + 5}" y2="${bounds.maxY}" stroke="#60a5fa" stroke-width="1"/><text x="${left - 18}" y="${bounds.maxY + 2.5}" text-anchor="end" font-size="7" fill="#60a5fa" font-weight="bold">${exactHeight.toFixed(2)} mm</text>`;

    return `<g class="boundary-rulers" opacity=".9"><line x1="${bounds.minX}" y1="${top}" x2="${bounds.maxX}" y2="${top}" stroke="rgba(148,163,184,.7)" stroke-width="1"/><line x1="${left}" y1="${bounds.minY}" x2="${left}" y2="${bounds.maxY}" stroke="rgba(148,163,184,.7)" stroke-width="1"/>${xTicks}${yTicks}<text x="${bounds.maxX + 12}" y="${top + 3}" font-size="8" fill="#f87171">X</text><text x="${left + 3}" y="${bounds.minY - 12}" font-size="8" fill="#60a5fa">Y</text></g>`;
  }

  function boundaryEdgeLabels() {
    return manualBoundaryEdges.map(edge => {
      const middle = manualEdgeMiddle(edge);
      if (!middle) return "";
      const length = Math.hypot(middle.dx, middle.dy) || 1;
      const offset = 10;
      const x = middle.x - middle.dy / length * offset, y = middle.y + middle.dx / length * offset;
      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" text-anchor="middle" font-size="8" fill="rgba(226,232,240,.78)" style="paint-order:stroke;stroke:#0f172a;stroke-width:3px;stroke-opacity:.8;pointer-events:none">${manualEdgeLength(edge).toFixed(2)} mm</text>`;
    }).join("");
  }

  function boundarySnapshot() {
    return JSON.stringify({ points: manualBoundaryPoints, edges: manualBoundaryEdges, closed: manualBoundaryClosed, image: boundaryImageSnapshot() });
  }

  function ensureBoundaryHistory() {
    if (boundaryHistory.length) return;
    boundaryHistory = [boundarySnapshot()];
    boundaryHistoryIndex = 0;
  }

  function commitBoundaryHistory(before) {
    if (!boundaryHistory.length) {
      boundaryHistory = [before];
      boundaryHistoryIndex = 0;
    }
    const after = boundarySnapshot();
    if (before === after) return;
    boundaryHistory = boundaryHistory.slice(0, boundaryHistoryIndex + 1);
    boundaryHistory.push(after);
    boundaryHistoryIndex++;
  }

  function restoreBoundaryHistory(snapshot) {
    const state = JSON.parse(snapshot);
    manualBoundaryPoints = state.points;
    manualBoundaryEdges = state.edges;
    manualBoundaryClosed = state.closed;
    boundaryReferenceImage = normalizeBoundaryImageObject(state.image || null);
    boundaryImageSelected = false;
    boundaryImageCalibration = { active: false, points: [] };
    boundaryImageFieldBefore = null;
    manualBoundaryActiveEndpoint = null;
    boundaryClickSuppressed = true;
    renderBoundaryStage();
  }

  function undoBoundaryChange() {
    finishBoundaryImagePropertyEdit();
    if (boundaryHistoryIndex <= 0) return;
    boundaryHistoryIndex--;
    restoreBoundaryHistory(boundaryHistory[boundaryHistoryIndex]);
  }

  function redoBoundaryChange() {
    finishBoundaryImagePropertyEdit();
    if (boundaryHistoryIndex >= boundaryHistory.length - 1) return;
    boundaryHistoryIndex++;
    restoreBoundaryHistory(boundaryHistory[boundaryHistoryIndex]);
  }

  function closeManualBoundary() {
    if (manualBoundaryPoints.length < 3 || manualBoundaryClosed) return false;
    const endpoints = manualBoundaryOpenEndpoints();
    if (endpoints.length !== 2) return false;
    const before = boundarySnapshot();
    manualBoundaryEdges.push({ a: endpoints[0], b: endpoints[1], curve: false, controls: [] });
    manualBoundaryClosed = true;
    manualBoundaryActiveEndpoint = null;
    commitBoundaryHistory(before);
    return true;
  }

  function removeClosedBoundaryPoint(index) {
    if (!manualBoundaryClosed || index < 0 || index >= manualBoundaryPoints.length) return;
    const before = boundarySnapshot();
    const indexMap = new Map();
    const points = [];
    manualBoundaryPoints.forEach((point, oldIndex) => {
      if (oldIndex === index) return;
      indexMap.set(oldIndex, points.length);
      points.push(point);
    });
    const incidentEdges = manualBoundaryEdges.filter(edge => edge.a === index || edge.b === index);
    const neighbours = [...new Set(incidentEdges.map(edge => edge.a === index ? edge.b : edge.a))];
    const replacementPosition = manualBoundaryEdges.findIndex(edge => edge.a === index || edge.b === index);
    const edges = [];
    manualBoundaryEdges.forEach((edge, edgeIndex) => {
      if (edgeIndex === replacementPosition && points.length >= 3 && neighbours.length === 2) {
        edges.push({ a: indexMap.get(neighbours[0]), b: indexMap.get(neighbours[1]), curve: false, controls: [] });
      }
      if (edge.a === index || edge.b === index) return;
      edges.push({ ...edge, a: indexMap.get(edge.a), b: indexMap.get(edge.b), controls: edgeControls(edge).map(control => ({ ...control })) });
    });
    manualBoundaryPoints = points;
    manualBoundaryEdges = edges;
    manualBoundaryClosed = points.length >= 3 && edges.length === points.length;
    manualBoundaryActiveEndpoint = manualBoundaryClosed ? null : manualBoundaryOpenEndpoints().at(-1) ?? null;
    commitBoundaryHistory(before);
    renderBoundaryStage();
  }

  function splitBoundaryEdge(edgeIndex, point) {
    const edge = manualBoundaryEdges[edgeIndex];
    if (!edge) return;
    const before = boundarySnapshot();
    const oldEnd = edge.b;
    const newIndex = manualBoundaryPoints.push({ x: point.x, y: point.y }) - 1;
    const retainedControls = edgeControls(edge).map(control => ({ ...control }));
    edge.b = newIndex;
    edge.controls = retainedControls;
    edge.curve = retainedControls.length > 0;
    manualBoundaryEdges.splice(edgeIndex + 1, 0, { a: newIndex, b: oldEnd, curve: false, controls: [] });
    commitBoundaryHistory(before);
    renderBoundaryStage();
  }

  function addBezierPoint(edgeIndex, point) {
    const edge = manualBoundaryEdges[edgeIndex];
    if (!edge) return;
    const before = boundarySnapshot();
    edgeControls(edge).push({ x: point.x, y: point.y });
    edge.curve = true;
    commitBoundaryHistory(before);
    renderBoundaryStage();
  }

  function queueBoundaryEdgeSplit(edgeIndex, point) {
    if (boundaryEdgeClickTimer) clearTimeout(boundaryEdgeClickTimer);
    boundaryEdgeClickTimer = setTimeout(() => {
      boundaryEdgeClickTimer = null;
      splitBoundaryEdge(edgeIndex, point);
    }, 360);
  }

  function renderBoundaryStage() {
    const svg = $("drawing");
    $("manualTransformTools").hidden = true;
    svg.onwheel = e => zoomWorkspace(e, svg);
    if (boundaryType === "none") {
      setWorkspaceViewBox(svg);
      svg.innerHTML = `<g pointer-events="none"><text x="0" y="-8" text-anchor="middle" fill="#cbd5e1" font-size="18" font-weight="800">Bez obudowy</text><text x="0" y="18" text-anchor="middle" fill="#64748b" font-size="11">Przejdź do umiejscawiania ogniw — uruchomiony zostanie tryb ręczny.</text></g>`;
      svg.onclick = null;
      svg.ondblclick = null;
      svg.oncontextmenu = null;
      svg.onmousemove = null;
      svg.onpointerdown = e => { beginWorkspacePan(e, svg); };
    } else if (boundaryType === "manual") {
      const points = manualBoundaryPoints.length ? manualBoundaryPoints : [{ x: -220, y: -150 }, { x: 220, y: -150 }, { x: 0, y: 200 }];
      const bounds = polygonBounds(points), pad = 70;
      setWorkspaceViewBox(svg);
      const paths = manualBoundaryEdges.map((edge, index) => {
        const path = manualEdgePath(edge);
        return `<path class="boundary-edge" data-edge="${index}" d="${path}" fill="none" stroke="var(--accent)" stroke-width="12" stroke-opacity=".01"/><path d="${path}" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.8" pointer-events="none"/>`;
      }).join("");
      const handles = manualBoundaryEdges.flatMap((edge, edgeIndex) => edgeControls(edge).map((control, controlIndex) => `<circle cx="${control.x}" cy="${control.y}" r="2" fill="#f59e0b" opacity="0.5" pointer-events="none"/><circle class="boundary-control" data-edge="${edgeIndex}" data-control="${controlIndex}" cx="${control.x}" cy="${control.y}" r="10" fill="transparent"/>`)).join("");
      const nodes = manualBoundaryPoints.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#e2e8f0" stroke="${manualBoundaryActiveEndpoint === i ? "#f59e0b" : "var(--accent)"}" stroke-width="${manualBoundaryActiveEndpoint === i ? "1.5" : "1"}" opacity="0.5" pointer-events="none"/><circle class="boundary-node" data-point="${i}" cx="${p.x}" cy="${p.y}" r="12" fill="transparent"/>`).join("");
      svg.innerHTML = `${boundaryImageMarkup()}${boundaryRulers(manualBoundaryPoints)}${paths}${boundaryEdgeLabels()}${handles}${nodes}`;
      updateBoundaryImageTools();
      const openEndpoints = manualBoundaryOpenEndpoints();
      const activeEndpointText = !manualBoundaryClosed && Number.isInteger(manualBoundaryActiveEndpoint) ? ` · rysowanie od punktu ${manualBoundaryActiveEndpoint + 1}` : " · kliknij otwarty koniec, aby kontynuować";
      const closeText = manualBoundaryIsSingleOpenChain() && manualBoundaryPoints.length >= 3 ? " · kliknij pierwszy punkt, aby zamknąć" : "";
      const sampledBoundary = manualBoundaryClosed ? sampleManualBoundary() : [];
      const areaText = sampledBoundary.length >= 3 ? ` · pole ${(polygonArea(sampledBoundary) / 100).toFixed(2)} cm²` : "";
      $("boundaryEditorStatus").textContent = manualBoundaryClosed ? `Wielobok zamknięty · ${manualBoundaryPoints.length} wierzchołków${areaText}` : `${manualBoundaryPoints.length} wierzchołków · ${openEndpoints.length} otwarte końce${activeEndpointText}${closeText}`;
      svg.onclick = e => {
        if (workspacePan?.moved || workspacePanJustMoved) { workspacePan = null; workspacePanJustMoved = false; return; }
        if (boundaryClickSuppressed) { boundaryClickSuppressed = false; return; }
        if (boundaryImageCalibration.active) {
          addBoundaryImageCalibrationPoint(svgPoint(e, svg));
          return;
        }
        const imageTarget = e.target.closest("[data-boundary-image]");
        if (imageTarget) {
          if (!boundaryImageSelected) {
            boundaryImageSelected = true;
            renderBoundaryStage();
          }
          return;
        } else if (boundaryImageSelected) {
          boundaryImageSelected = false;
          renderBoundaryStage();
          return;
        }
        if (boundaryReferenceImage && !boundaryReferenceImage.locked) return;
        const edgeElement = e.target.closest(".boundary-edge");
        if (edgeElement) {
          const point = svgPoint(e, svg);
          queueBoundaryEdgeSplit(Number(edgeElement.dataset.edge), point);
          return;
        }
        const node = e.target.closest(".boundary-node");
        if (node && !manualBoundaryClosed) {
          const nodeIndex = Number(node.dataset.point);
          const endpoints = manualBoundaryOpenEndpoints();
          if (manualBoundaryCanCloseAt(nodeIndex)) {
            closeManualBoundary();
            renderBoundaryStage();
            return;
          }
          if (endpoints.includes(nodeIndex)) {
            manualBoundaryActiveEndpoint = nodeIndex;
            renderBoundaryStage();
            return;
          }
        }
        if (node || e.target.closest(".boundary-control")) return;
        if (manualBoundaryClosed) return;
        const point = svgPoint(e, svg);
        const endpoints = manualBoundaryOpenEndpoints();
        const startIndex = Number.isInteger(manualBoundaryActiveEndpoint) && endpoints.includes(manualBoundaryActiveEndpoint)
          ? manualBoundaryActiveEndpoint
          : endpoints.includes(manualBoundaryPoints.length - 1) ? manualBoundaryPoints.length - 1 : endpoints[0];
        if (!Number.isInteger(startIndex) && manualBoundaryPoints.length) return;
        const startPoint = manualBoundaryPoints[startIndex];
        if (startPoint && manualEdgeIntersects(startPoint, point)) return;
        const before = boundarySnapshot();
        const index = manualBoundaryPoints.push(point) - 1;
        if (index > 0) {
          manualBoundaryEdges.push({ a: startIndex, b: index, curve: false, controls: [] });
        }
        manualBoundaryActiveEndpoint = index;
        commitBoundaryHistory(before);
        renderBoundaryStage();
      };
      svg.ondblclick = e => {
        if (boundaryImageCalibration.active || (boundaryReferenceImage && !boundaryReferenceImage.locked)) return;
        const edgeElement = e.target.closest(".boundary-edge");
        if (!edgeElement) return;
        e.preventDefault();
        if (boundaryEdgeClickTimer) {
          clearTimeout(boundaryEdgeClickTimer);
          boundaryEdgeClickTimer = null;
        }
        addBezierPoint(Number(edgeElement.dataset.edge), svgPoint(e, svg));
      };
      svg.onpointerdown = e => {
        if (beginWorkspacePan(e, svg)) return;
        if (boundaryImageCalibration.active && e.button === 0) {
          e.preventDefault();
          e.stopPropagation();
          addBoundaryImageCalibrationPoint(svgPoint(e, svg));
          boundaryClickSuppressed = true;
          return;
        }
        if (beginBoundaryImageInteraction(e, svg)) return;

        if (boundaryReferenceImage && !boundaryReferenceImage.locked) return;

        const node = e.target.closest(".boundary-node");
        const control = e.target.closest(".boundary-control");
        if (!node && !control) return;
        e.preventDefault();
        if (svg.setPointerCapture) svg.setPointerCapture(e.pointerId);
        const start = svgPoint(e, svg);
        const nodeIndex = node ? Number(node.dataset.point) : null;
        const endpointSelectable = nodeIndex !== null && !manualBoundaryClosed && manualBoundaryOpenEndpoints().includes(nodeIndex) && !manualBoundaryCanCloseAt(nodeIndex);
        if (endpointSelectable) {
          manualBoundaryActiveEndpoint = nodeIndex;
          node.setAttribute("stroke", "#f59e0b");
          node.setAttribute("stroke-width", "3.5");
        }
        boundaryDrag = { point: nodeIndex, edge: control ? Number(control.dataset.edge) : null, control: control ? Number(control.dataset.control) : null, start, moved: false, before: boundarySnapshot(), closeCandidate: nodeIndex !== null && manualBoundaryCanCloseAt(nodeIndex), selectEndpoint: endpointSelectable ? nodeIndex : null };
      };
      svg.oncontextmenu = e => {
        e.preventDefault();
        if (e.target.closest("[data-boundary-image]")) return;
        const node = e.target.closest(".boundary-node");
        if (node && manualBoundaryClosed) {
          removeClosedBoundaryPoint(Number(node.dataset.point));
          return;
        }
        const edge = e.target.closest(".boundary-edge");
        if (!edge) return;
        const target = manualBoundaryEdges[Number(edge.dataset.edge)];
        const controls = target ? edgeControls(target) : [];
        const before = boundarySnapshot();
        if (controls.length) controls.pop();
        if (target) target.curve = controls.length > 0;
        commitBoundaryHistory(before);
        renderBoundaryStage();
      };

      svg.onmousemove = e => {
        if (boundaryImageCalibration.active) svg.style.cursor = "crosshair";
        else if (e.target.closest("[data-boundary-image-rotate]")) svg.style.cursor = boundaryImageDrag?.mode === "rotating" ? "grabbing" : "grab";
        else if (e.target.closest("[data-boundary-image-scale]")) {
          const handle = e.target.closest("[data-boundary-image-scale]").dataset.boundaryImageScale;
          svg.style.cursor = ({ n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize" })[handle] || "nwse-resize";
        }
        else if (e.target.closest("[data-boundary-image]")) svg.style.cursor = "move";
        else svg.style.cursor = "default";
      };
    } else {
      const boundary = activeBoundary();
      const points = boundary.points, bounds = polygonBounds(points), pad = 70;
      setWorkspaceViewBox(svg);
      svg.innerHTML = `${boundaryRulers(points)}<polygon points="${points.map(p => `${p.x},${p.y}`).join(" ")}" fill="rgba(20,184,166,.06)" stroke="var(--accent)" stroke-width="3"/>`;
      svg.onpointerdown = e => { beginWorkspacePan(e, svg); };
    }
  }

  function updateBoundaryDrag(e) {
    if (!boundaryDrag || stage1Substep !== 1 || boundaryType !== "manual") return;
    const point = svgPoint(e, $("drawing"));
    const distance = Math.hypot(point.x - boundaryDrag.start.x, point.y - boundaryDrag.start.y);
    // Mały, naturalny ruch kursora przy kliknięciu nie może zamieniać wyboru
    // końca linii w przeciąganie punktu.
    if (!boundaryDrag.moved && distance < 2) return;
    boundaryDrag.moved = true;
    if (boundaryDrag.point !== null) {
      const old = manualBoundaryPoints[boundaryDrag.point];
      old.x = point.x; old.y = point.y;
    } else if (boundaryDrag.edge !== null && boundaryDrag.control !== null && manualBoundaryEdges[boundaryDrag.edge]) {
      const controls = edgeControls(manualBoundaryEdges[boundaryDrag.edge]);
      if (controls[boundaryDrag.control]) controls[boundaryDrag.control] = point;
    }
    renderBoundaryStage();
  }

  function finishBoundaryDrag() {
    if (!boundaryDrag) return;
    const drag = boundaryDrag;
    if (drag.moved) {
      if (boundaryHasSelfIntersection()) restoreBoundaryHistory(drag.before);
      else commitBoundaryHistory(drag.before);
    }
    if (!drag.moved && drag.closeCandidate) {
      closeManualBoundary();
      boundaryClickSuppressed = true;
      renderBoundaryStage();
    } else if (!drag.moved && drag.selectEndpoint !== null) {
      // Zwykły klik na otwartym końcu musi działać niezależnie od zdarzenia click,
      // które przy przechwyceniu wskaźnika nie zawsze trafia z powrotem do SVG.
      manualBoundaryActiveEndpoint = drag.selectEndpoint;
      boundaryClickSuppressed = false;
      renderBoundaryStage();
    } else {
      boundaryClickSuppressed = Boolean(drag.moved);
    }
    boundaryDrag = null;
  }

  // ===== Core functions (copied from index.backup.html) =====

  function readNumber(id) {
    if (id === "cellType") {
      const profile = activeSavedCellProfile();
      if (profile?.geometry?.diameterMm > 0) return profile.geometry.diameterMm;
    }
    const value = Number($(id).value);
    return Number.isFinite(value) ? value : 0;
  }

  function stage2CellCurrentLimits() {
    return {
      standard_discharge_A: readNumber("cellStandardDischarge"),
      max_continuous_discharge_A: readNumber("cellMaxDischarge"),
      standard_charge_A: readNumber("cellStandardCharge"),
      max_charge_A: readNumber("cellMaxCharge")
    };
  }

  function applyStage2CurrentValidity() {
    const fields = {
      standard_discharge_A: $("cellStandardDischarge"),
      max_continuous_discharge_A: $("cellMaxDischarge"),
      standard_charge_A: $("cellStandardCharge"),
      max_charge_A: $("cellMaxCharge")
    };
    Object.values(fields).forEach(field => field?.setCustomValidity(""));
    const currentModel = window.BATTERY_CURRENT_MODEL;
    if (!currentModel?.validate) {
      Object.values(fields).forEach(field => field?.setCustomValidity("Brak modułu walidacji prądów ogniwa."));
      return false;
    }
    const validation = currentModel.validate(stage2CellCurrentLimits());
    validation.errors.forEach(error => {
      const field = fields[error.field];
      if (!field) return;
      field.setCustomValidity(error.code === "standard_above_maximum"
        ? "Prąd standardowy nie może być większy od prądu maksymalnego."
        : "Podaj dodatnią wartość prądu.");
    });
    return validation.valid;
  }

  function validateCellElectricalParameters() {
    const required = ["cellAh", "cellVoltage", "cellResistance", "cellStandardDischarge", "cellMaxDischarge", "cellStandardCharge", "cellMaxCharge"];
    required.map(id => $(id)).forEach(input => input?.setCustomValidity(""));
    const invalidValue = required.map(id => $(id)).find(input => !input || !Number.isFinite(Number(input.value)) || Number(input.value) <= 0);
    const currentLimitsValid = applyStage2CurrentValidity();
    const invalid = invalidValue || required.map(id => $(id)).find(input => input && !input.checkValidity());
    if (!invalid && currentLimitsValid) return true;
    if (invalid) {
      if (invalidValue) invalid.setCustomValidity("Podaj dodatnią wartość tego parametru.");
      invalid.reportValidity();
      invalid.focus();
    }
    return false;
  }

  function triangleFromSides(values) {
    const sides = [...values].sort((a, b) => a - b);
    const shortest = sides[0], top = sides[1], longest = sides[2];
    if (shortest + top <= longest) {
      throw new Error("Podane boki nie tworzą trójkąta. Suma dwóch krótszych boków musi być większa od najdłuższego.");
    }
    const x = (longest * longest - shortest * shortest + top * top) / (2 * top);
    const y2 = longest * longest - x * x;
    if (y2 <= 0) throw new Error("Nie da się złożyć stabilnego trójkąta z tych wymiarów.");
    const y = Math.sqrt(y2);
    return {
      type: "triangle",
      points: [{ x: 0, y: 0 }, { x: top, y: 0 }, { x, y }],
      shortest, top, longest
    };
  }

  function edgeDistance(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
    const t = c1 / c2;
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  }

  function rotatePoint(p, angle) {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    return { x: p.x * ca - p.y * sa, y: p.x * sa + p.y * ca };
  }

  function polygonBounds(points) {
    return {
      minX: Math.min(...points.map(p => p.x)),
      maxX: Math.max(...points.map(p => p.x)),
      minY: Math.min(...points.map(p => p.y)),
      maxY: Math.max(...points.map(p => p.y))
    };
  }

  function generateGrid(boundary, opts, layout, angleDeg, ox, oy) {
    const radius = opts.cellDiameter / 2;
    const pitch = opts.cellDiameter + opts.cellGap;
    const angle = angleDeg * Math.PI / 180;
    const bounds = polygonBounds(boundaryPoints(boundary));
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) + pitch * 8;
    const cells = [];
    const rowStep = layout === "honeycomb" ? pitch * Math.sqrt(3) / 2 : pitch;
    const colStep = pitch;
    let id = 0;

    for (let row = -Math.ceil(span / rowStep); row <= Math.ceil(span / rowStep); row++) {
      for (let col = -Math.ceil(span / colStep); col <= Math.ceil(span / colStep); col++) {
        const stagger = layout === "honeycomb" && row % 2 !== 0 ? colStep / 2 : 0;
        const local = { x: col * colStep + stagger + ox, y: row * rowStep + oy };
        const rp = rotatePoint(local, angle);
        const p = {
          x: rp.x + (bounds.minX + bounds.maxX) / 2,
          y: rp.y + (bounds.minY + bounds.maxY) / 2
        };
        if (p.x < bounds.minX - pitch || p.x > bounds.maxX + pitch || p.y < bounds.minY - pitch || p.y > bounds.maxY + pitch) continue;
        if (pointInBoundary(p, boundary, opts.frameMargin + radius)) {
          cells.push({ x: p.x, y: p.y, id: id++, row, col });
        }
      }
    }
    return cells;
  }

  function rotatedRectCorners(rect) {
    const angle = (rect.angle || 0) * Math.PI / 180;
    const axes = [
      rotatePoint({ x: -rect.w / 2, y: -rect.h / 2 }, angle),
      rotatePoint({ x: rect.w / 2, y: -rect.h / 2 }, angle),
      rotatePoint({ x: rect.w / 2, y: rect.h / 2 }, angle),
      rotatePoint({ x: -rect.w / 2, y: rect.h / 2 }, angle)
    ];
    return axes.map(p => ({ x: rect.cx + p.x, y: rect.cy + p.y }));
  }

  function centerCellsInBoundary(cells, boundary, margin) {
    if (!cells.length) return;
    const step = 0.2;
    let minX = 0, maxX = 0;
    for (let s = step; s <= 200; s += step) { if (!cells.every(p => pointInBoundary({ x: p.x + s, y: p.y }, boundary, margin))) break; maxX = s; }
    for (let s = step; s <= 200; s += step) { if (!cells.every(p => pointInBoundary({ x: p.x - s, y: p.y }, boundary, margin))) break; minX = -s; }
    const shiftX = (minX + maxX) / 2;
    cells.forEach(c => c.x += shiftX);

    let minY = 0, maxY = 0;
    for (let s = step; s <= 200; s += step) { if (!cells.every(p => pointInBoundary({ x: p.x, y: p.y + s }, boundary, margin))) break; maxY = s; }
    for (let s = step; s <= 200; s += step) { if (!cells.every(p => pointInBoundary({ x: p.x, y: p.y - s }, boundary, margin))) break; minY = -s; }
    const shiftY = (minY + maxY) / 2;
    cells.forEach(c => c.y += shiftY);
  }

  function circleRectOverlap(cell, r, rect, clearance) {
    const angle = -(rect.angle || 0) * Math.PI / 180;
    const local = rotatePoint({ x: cell.x - rect.cx, y: cell.y - rect.cy }, angle);
    const dx = Math.max(Math.abs(local.x) - rect.w / 2, 0);
    const dy = Math.max(Math.abs(local.y) - rect.h / 2, 0);
    return Math.hypot(dx, dy) < r + clearance;
  }

  function findController(boundary, cells, opts) {
    if (!opts.controllerOn) return { rect: null, cells };
    const engine = window.BATTERY_CONTROLLER_PLACEMENT;
    if (!engine?.findPlacement) throw new Error("Brak modułu rozmieszczania sterownika. Sprawdź kompletność opublikowanych plików JavaScript.");
    const target = opts.controllerTarget || null;
    const best = engine.findPlacement({
      boundaryPoints: boundaryPoints(boundary),
      cells,
      controllerWidth: opts.controllerW,
      controllerHeight: opts.controllerH,
      allowRotation: opts.controllerRotate,
      frameMargin: opts.frameMargin,
      cellRadius: opts.cellDiameter / 2,
      cellGap: opts.cellGap,
      target,
      previous: target ? { ...target, angle: opts.controllerTargetAngle || 0 } : null,
      mode: target ? "preferred" : "auto"
    });
    if (!best) {
      const points = boundaryPoints(boundary);
      const radius = opts.cellDiameter / 2;
      const bounds = polygonBounds(points);
      const fallback = {
        cx: (bounds.minX + bounds.maxX) / 2,
        cy: (bounds.minY + bounds.maxY) / 2,
        w: opts.controllerW, h: opts.controllerH, angle: 0
      };
      const kept = cells.filter(cell => !circleRectOverlap(cell, radius, fallback, opts.cellGap + 1));
      return { rect: { ...fallback, cornerDistance: 0, cornerIndex: 0, placementKind: "interior" }, cells: kept, score: kept.length * 1000, removed: cells.length - kept.length };
    }
    return best;
  }

  function verticalSnakePath(cells) {
    if (!cells.length) return [];
    const pitch = readNumber("cellType") + readNumber("cellGap");
    const colTolerance = Math.max(4, pitch * 0.45);
    const cols = [];
    [...cells].sort((a, b) => a.x - b.x || a.y - b.y).forEach(cell => {
      let col = cols.find(c => Math.abs(c.avgX - cell.x) <= colTolerance);
      if (!col) { col = { avgX: cell.x, cells: [] }; cols.push(col); }
      col.cells.push(cell);
      col.avgX = col.cells.reduce((sum, c) => sum + c.x, 0) / col.cells.length;
    });
    cols.sort((a, b) => a.avgX - b.avgX);
    return cols.flatMap((col, colIndex) => {
      const ordered = [...col.cells].sort((a, b) => a.y - b.y);
      return colIndex % 2 === 0 ? ordered : ordered.reverse();
    });
  }

  function assignSections(cells, series) {
    if (!cells.length) return [];
    const parallel = Math.floor(cells.length / series);
    if (parallel === 0) return cells.map(cell => ({ ...cell, section: null, parallelIndex: null }));

    const pitch = readNumber("cellType") + readNumber("cellGap");

    let numSpares = cells.length - series * parallel;
    const spares = [];
    const activeCells = [...cells];

    if (numSpares > 0) {
      let rightmost = activeCells[0];
      for (const c of activeCells) { if (c.x > rightmost.x) rightmost = c; }
      activeCells.sort((a, b) => {
        const da = Math.hypot(a.x - rightmost.x, a.y - rightmost.y);
        const db = Math.hypot(b.x - rightmost.x, b.y - rightmost.y);
        return da - db;
      });
      for (let i = 0; i < numSpares; i++) { spares.push(activeCells.shift()); }
    }

    const sections = [];
    let unvisited = [];

    if (activeVariantTab === 1) {
      const ordered = verticalSnakePath(activeCells);
      for (let s = 0; s < series; s++) {
        const sectionCells = [];
        for (let p = 0; p < parallel; p++) {
          const idx = s * parallel + p;
          if (idx < ordered.length) sectionCells.push(ordered[idx]);
        }
        sections.push(sectionCells);
      }
    } else {
      unvisited = [...activeCells];

      function getDegree(cell) {
        let deg = 0;
        for (const c of unvisited) {
          if (c !== cell && Math.hypot(c.x - cell.x, c.y - cell.y) <= pitch * 1.35) deg++;
        }
        return deg;
      }

      for (let s = 0; s < series; s++) {
        if (unvisited.length === 0) break;
        const sectionCells = [];
        let seedIndex = 0;

        if (s === 0) {
          let minX = Infinity;
          for (let i = 0; i < unvisited.length; i++) {
            if (unvisited[i].x < minX) { minX = unvisited[i].x; seedIndex = i; }
          }
        } else {
          const prevSection = sections[s - 1];
          const candidates = [];
          for (let i = 0; i < unvisited.length; i++) {
            const u = unvisited[i];
            let isNeighbor = false;
            for (const p of prevSection) {
              if (Math.hypot(u.x - p.x, u.y - p.y) <= pitch * 1.35) { isNeighbor = true; break; }
            }
            if (isNeighbor) candidates.push({ idx: i, cell: u });
          }
          if (candidates.length > 0) {
            let minDeg = Infinity, bestCand = null;
            for (const cand of candidates) {
              const deg = getDegree(cand.cell);
              if (deg < minDeg || (deg === minDeg && (!bestCand || cand.cell.x < bestCand.cell.x))) {
                minDeg = deg; bestCand = cand;
              }
            }
            seedIndex = bestCand.idx;
          } else {
            let minX = Infinity;
            for (let i = 0; i < unvisited.length; i++) {
              if (unvisited[i].x < minX) { minX = unvisited[i].x; seedIndex = i; }
            }
          }
        }

        sectionCells.push(unvisited.splice(seedIndex, 1)[0]);

        while (sectionCells.length < parallel && unvisited.length > 0) {
          const candidates = [];
          let cx = 0, cy = 0;
          for (const sc of sectionCells) { cx += sc.x; cy += sc.y; }
          cx /= sectionCells.length; cy /= sectionCells.length;

          for (let i = 0; i < unvisited.length; i++) {
            const u = unvisited[i];
            let isNeighbor = false;
            for (const sc of sectionCells) {
              if (Math.hypot(u.x - sc.x, u.y - sc.y) <= pitch * 1.35) { isNeighbor = true; break; }
            }
            if (isNeighbor) candidates.push({ idx: i, cell: u });
          }

          let bestIdx = -1;
          if (candidates.length > 0) {
            let bestScore = Infinity;
            for (const cand of candidates) {
              const deg = getDegree(cand.cell);
              const distToCentroid = Math.hypot(cand.cell.x - cx, cand.cell.y - cy);
              const score = deg * 1000 + distToCentroid;
              if (score < bestScore) { bestScore = score; bestIdx = cand.idx; }
            }
          } else {
            let bestScore = Infinity;
            for (let i = 0; i < unvisited.length; i++) {
              const distToCentroid = Math.hypot(unvisited[i].x - cx, unvisited[i].y - cy);
              if (distToCentroid < bestScore) { bestScore = distToCentroid; bestIdx = i; }
            }
          }
          sectionCells.push(unvisited.splice(bestIdx, 1)[0]);
        }
        sections.push(sectionCells);
      }

      function isContiguous(secCells) {
        if (secCells.length <= 1) return true;
        const visited = new Set();
        const queue = [secCells[0]];
        visited.add(secCells[0].id);
        let count = 1;
        while (queue.length > 0) {
          const curr = queue.shift();
          for (const other of secCells) {
            if (!visited.has(other.id)) {
              if (Math.hypot(curr.x - other.x, curr.y - other.y) <= pitch * 1.35) {
                visited.add(other.id); queue.push(other); count++;
              }
            }
          }
        }
        return count === secCells.length;
      }

      let changed = true, iters = 0;
      while (changed && iters < 8) {
        changed = false; iters++;
        const centroids = [];
        for (let s = 0; s < series; s++) {
          const secCells = sections[s];
          let cx = 0, cy = 0;
          for (const sc of secCells) { cx += sc.x; cy += sc.y; }
          centroids[s] = { x: cx / secCells.length, y: cy / secCells.length };
        }

        const getBoundaryEdges = (idx1, idx2) => {
          if (idx1 < 0 || idx2 < 0 || idx1 >= series || idx2 >= series) return 0;
          let count = 0;
          for (const c1 of sections[idx1]) for (const c2 of sections[idx2]) {
            if (Math.hypot(c1.x - c2.x, c1.y - c2.y) <= pitch * 1.35) count++;
          }
          return count;
        };

        const getBottleneckPenalty = (s1_idx, s2_idx) => {
          const boundaries = new Set();
          if (s1_idx > 0) boundaries.add(s1_idx - 1);
          if (s1_idx < series - 1) boundaries.add(s1_idx);
          if (s2_idx > 0) boundaries.add(s2_idx - 1);
          if (s2_idx < series - 1) boundaries.add(s2_idx);
          let penalty = 0;
          for (const b of boundaries) {
            const edges = getBoundaryEdges(b, b + 1);
            if (edges === 0) penalty += pitch * pitch * 10000;
            else if (edges === 1) penalty += pitch * pitch * 200;
          }
          return penalty;
        };

        for (let s1 = 0; s1 < series - 1; s1++) {
          for (let s2 = s1 + 1; s2 <= s1 + 1; s2++) {
            for (let i = 0; i < sections[s1].length; i++) {
              for (let j = 0; j < sections[s2].length; j++) {
                const c1 = sections[s1][i], c2 = sections[s2][j];
                if (Math.hypot(c1.x - c2.x, c1.y - c2.y) > pitch * 5) continue;
                const dx1_old = c1.x - centroids[s1].x, dy1_old = c1.y - centroids[s1].y;
                const cost1_old = 4 * (dx1_old * dx1_old) + (dy1_old * dy1_old);
                const dx2_old = c2.x - centroids[s2].x, dy2_old = c2.y - centroids[s2].y;
                const cost2_old = 4 * (dx2_old * dx2_old) + (dy2_old * dy2_old);
                const weightSlider = sectionVariantSettings.edgeWeight;
                const edgeWeight = pitch * pitch * weightSlider;
                const countE = (cell, sIdx) => {
                  let conns = 0;
                  const check = (idx) => {
                    if (idx >= 0 && idx < series) for (const other of sections[idx]) {
                      if (Math.hypot(cell.x - other.x, cell.y - other.y) <= pitch * 1.35) conns++;
                    }
                  };
                  check(sIdx - 1); check(sIdx + 1); return conns;
                };
                const edgesBefore = countE(c1, s1) + countE(c2, s2);
                const penaltyBefore = getBottleneckPenalty(s1, s2);
                const oldCost = cost1_old + cost2_old - (edgesBefore * edgeWeight) + penaltyBefore;
                const dx1_new = c1.x - centroids[s2].x, dy1_new = c1.y - centroids[s2].y;
                const cost1_new = 4 * (dx1_new * dx1_new) + (dy1_new * dy1_new);
                const dx2_new = c2.x - centroids[s1].x, dy2_new = c2.y - centroids[s1].y;
                const cost2_new = 4 * (dx2_new * dx2_new) + (dy2_new * dy2_new);
                sections[s1][i] = c2; sections[s2][j] = c1;
                const edgesAfter = countE(c2, s1) + countE(c1, s2);
                const penaltyAfter = getBottleneckPenalty(s1, s2);
                const newCost = cost1_new + cost2_new - (edgesAfter * edgeWeight) + penaltyAfter;
                if (newCost < oldCost - 0.1) {
                  if (isContiguous(sections[s1]) && isContiguous(sections[s2])) {
                    changed = true;
                    centroids[s1].x += (c2.x - c1.x) / parallel;
                    centroids[s1].y += (c2.y - c1.y) / parallel;
                    centroids[s2].x += (c1.x - c2.x) / parallel;
                    centroids[s2].y += (c1.y - c2.y) / parallel;
                  } else {
                    sections[s1][i] = c1; sections[s2][j] = c2;
                  }
                } else {
                  sections[s1][i] = c1; sections[s2][j] = c2;
                }
              }
            }
          }
        }

        function getLargestComponent(sectionCells) {
          if (sectionCells.length <= 1) return new Set(sectionCells.map(c => c.id));
          let best = new Set();
          for (const start of sectionCells) {
            const visited = new Set([start.id]);
            const queue = [start];
            while (queue.length > 0) {
              const curr = queue.shift();
              for (const other of sectionCells) {
                if (!visited.has(other.id) && Math.hypot(curr.x - other.x, curr.y - other.y) <= pitch * 1.35) {
                  visited.add(other.id); queue.push(other);
                }
              }
            }
            if (visited.size > best.size) best = visited;
            if (visited.size === sectionCells.length) break;
          }
          return best;
        }

        function isContiguousArr(arr) {
          if (arr.length <= 1) return true;
          const visited = new Set([arr[0].id]);
          const queue = [arr[0]];
          while (queue.length > 0) {
            const curr = queue.shift();
            for (const other of arr) {
              if (!visited.has(other.id) && Math.hypot(curr.x - other.x, curr.y - other.y) <= pitch * 1.35) {
                visited.add(other.id); queue.push(other);
              }
            }
          }
          return visited.size === arr.length;
        }

        let repairChanged = true, repairPasses = 0;
        while (repairChanged && repairPasses < 6) {
          repairChanged = false; repairPasses++;
          for (let si = 0; si < sections.length; si++) {
            const main = getLargestComponent(sections[si]);
            const strays = sections[si].filter(c => !main.has(c.id));
            if (strays.length === 0) continue;
            for (const stray of strays) {
              let moved = false;
              for (let sj = 0; sj < sections.length && !moved; sj++) {
                if (sj === si) continue;
                const candidates = sections[sj]
                  .map(c => ({ c, d: Math.hypot(c.x - stray.x, c.y - stray.y) }))
                  .filter(({ d }) => d <= pitch * 1.35)
                  .sort((a, b) => a.d - b.d);
                for (const { c: neighbor } of candidates) {
                  const newSi = [...sections[si].filter(c => c.id !== stray.id), neighbor];
                  const newSj = [...sections[sj].filter(c => c.id !== neighbor.id), stray];
                  if (isContiguousArr(newSi) && isContiguousArr(newSj)) {
                    sections[si] = newSi; sections[sj] = newSj;
                    repairChanged = true; moved = true; break;
                  }
                }
              }
            }
          }
        }

        for (let safety = 0; safety < parallel * series; safety++) {
          const shortIdx = sections.findIndex(sec => sec.length < parallel);
          if (shortIdx === -1) break;
          const longIdx = sections.findIndex(sec => sec.length > parallel);
          if (longIdx !== -1) sections[shortIdx].push(sections[longIdx].pop());
          else if (unvisited.length > 0) sections[shortIdx].push(unvisited.shift());
          else break;
        }
        unvisited.length = 0;
      }
    }

    const finalCells = [];
    const unassigned = unvisited.map(c => ({ ...c, section: null, parallelIndex: null }));
    for (let s = 0; s < sections.length; s++) {
      const sec = sections[s];
      sec.sort((a, b) => a.x - b.x || a.y - b.y);
      sec.forEach((c, idx) => { finalCells.push({ ...c, section: s, parallelIndex: idx + 1 }); });
    }
    unassigned.forEach(c => finalCells.push(c));
    spares.forEach(c => finalCells.push({ ...c, section: null, parallelIndex: null }));
    return finalCells;
  }

  function delayFrame() { return new Promise(resolve => requestAnimationFrame(resolve)); }

  function setProgress(percent, text) {
    $("progressBar").style.width = `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
    if (text) $("status").textContent = text;
  }

  function previewVariant(variant) {
    variants = [variant];
    activeIndex = 0;
    render();
  }

  async function solve(progress = () => { }, runId = solveRunId) {
    const opts = {
      cellDiameter: readNumber("cellType"),
      cellGap: readNumber("cellGap"),
      frameMargin: readNumber("frameMargin"),
      angleStep: readNumber("angleStep"),
      offsetDensity: readNumber("offsetDensity"),
      controllerOn: $("controllerOn").checked,
      controllerW: readNumber("controllerW"),
      controllerH: readNumber("controllerH"),
      controllerRotate: $("controllerRotate").checked,
      controllerTarget: autoControllerPreference ? { x: autoControllerPreference.x, y: autoControllerPreference.y } : null,
      controllerTargetAngle: autoControllerPreference?.angle || 0
    };
    const layoutPref = $("layoutMode").value;
    const layouts = layoutPref === "both" ? ["honeycomb", "square"] : [layoutPref];
    const triInfo = cloneBoundary(placementBoundary || activeBoundary());
    if (triInfo.type === "none") throw new Error("Tryb bez obudowy jest dostępny wyłącznie podczas ręcznego umieszczania ogniw.");
    if (triInfo.type === "manual" && (!manualBoundaryClosed || manualBoundaryPoints.length < 3)) throw new Error("Utwórz i zamknij granicę ręczną przed rozmieszczaniem ogniw.");
    if (boundaryPoints(triInfo).length < 3) throw new Error("Utwórz granicę przed rozmieszczaniem ogniw.");
    const pitch = opts.cellDiameter + opts.cellGap;
    const rawVariants = [];
    const results = [];
    let bestRaw = null;

    const coarseAngleStep = Math.max(2, opts.angleStep);
    const coarseOffsetDensity = Math.min(2, opts.offsetDensity);
    const totalCoarseAngles = layouts.reduce((sum) => sum + Math.ceil(180 / coarseAngleStep), 0);
    let anglePass = 0;

    // ETAP 1/3: ZGRUBNE SKANOWANIE (Szybkie omiatanie)
    for (const layout of layouts) {
      const rowStep = layout === "honeycomb" ? pitch * Math.sqrt(3) / 2 : pitch;
      const oxStep = pitch / coarseOffsetDensity;
      const oyStep = rowStep / coarseOffsetDensity;
      for (let angle = 0; angle < 180; angle += coarseAngleStep) {
        if (runId !== solveRunId) return [];
        for (let ox = 0; ox < pitch - 0.001; ox += oxStep) {
          for (let oy = 0; oy < rowStep - 0.001; oy += oyStep) {
            const rawCells = generateGrid(triInfo, opts, layout, angle, ox, oy);
            if (!rawCells.length) continue;
            const compactness = compactnessScore(rawCells);
            const score = rawCells.length * 100000 + compactness;
            rawVariants.push({ triInfo, layout, angle, ox, oy, rawCells, rawCount: rawCells.length, rawScore: score });
            if (!bestRaw || score > bestRaw.rawScore) bestRaw = rawVariants[rawVariants.length - 1];
          }
        }
        anglePass++;
        progress(anglePass / Math.max(1, totalCoarseAngles) * 25, `Etap 1/3 (Zgrubny): kąt ${anglePass}/${totalCoarseAngles}. Najlepszy podgląd: ${bestRaw?.rawCount || 0} ogniw.`);
        if (!opts.controllerOn && bestRaw && anglePass % 4 === 0) {
          previewVariant({ triInfo: bestRaw.triInfo, layout: bestRaw.layout, angle: bestRaw.angle, ox: bestRaw.ox, oy: bestRaw.oy, cells: bestRaw.rawCells, rawCount: bestRaw.rawCount, controller: null, removedByController: 0, score: bestRaw.rawScore });
        }
        await delayFrame();
      }
    }

    // ETAP 2/3: MIKRO-OPTYMALIZACJA (Dokładna wokół najlepszych punktów)
    if (opts.offsetDensity > coarseOffsetDensity || opts.angleStep < coarseAngleStep) {
      rawVariants.sort((a, b) => b.rawScore - a.rawScore);
      const topCoarse = rawVariants.slice(0, 15);
      let finePass = 0;
      for (const seed of topCoarse) {
        if (runId !== solveRunId) return [];
        const layout = seed.layout;
        const rowStep = layout === "honeycomb" ? pitch * Math.sqrt(3) / 2 : pitch;

        const aStart = Math.max(0, seed.angle - coarseAngleStep);
        const aEnd = Math.min(180, seed.angle + coarseAngleStep);

        const fineOxStep = pitch / opts.offsetDensity;
        const fineOyStep = rowStep / opts.offsetDensity;
        const coarseOxStep = pitch / coarseOffsetDensity;
        const coarseOyStep = rowStep / coarseOffsetDensity;

        for (let angle = aStart; angle <= aEnd; angle += opts.angleStep) {
          for (let ox = 0; ox < pitch - 0.001; ox += fineOxStep) {
            for (let oy = 0; oy < rowStep - 0.001; oy += fineOyStep) {
              const rawCells = generateGrid(triInfo, opts, layout, angle, ox, oy);
              if (!rawCells.length) continue;
              const compactness = compactnessScore(rawCells);
              const score = rawCells.length * 100000 + compactness;
              rawVariants.push({ triInfo, layout, angle, ox, oy, rawCells, rawCount: rawCells.length, rawScore: score });
              if (score > bestRaw.rawScore) bestRaw = rawVariants[rawVariants.length - 1];
            }
          }
        }
        finePass++;
        progress(25 + (finePass / topCoarse.length) * 33, `Etap 2/3 (Precyzyjny): optymalizacja ${finePass}/${topCoarse.length}. Najlepszy podgląd: ${bestRaw.rawCount}.`);
        if (!opts.controllerOn) previewVariant({ triInfo: bestRaw.triInfo, layout: bestRaw.layout, angle: bestRaw.angle, ox: bestRaw.ox, oy: bestRaw.oy, cells: bestRaw.rawCells, rawCount: bestRaw.rawCount, controller: null, removedByController: 0, score: bestRaw.rawScore });
        await delayFrame();
      }
    }

    rawVariants.sort((a, b) => b.rawScore - a.rawScore);
    const margin = opts.frameMargin + opts.cellDiameter / 2;
    for (let i = 0; i < Math.min(20, rawVariants.length); i++) {
      centerCellsInBoundary(rawVariants[i].rawCells, rawVariants[i].triInfo, margin);
    }

    if (!opts.controllerOn) {
      const best = rawVariants[0];
      if (!best) return [];
      progress(100, `Gotowe. Najlepszy układ bez sterownika: ${best.rawCells.length} ogniw.`);
      return [{
        triInfo: best.triInfo,
        layout: best.layout,
        angle: best.angle,
        ox: best.ox,
        oy: best.oy,
        cells: best.rawCells,
        baseCells: best.rawCells.map(cell => ({ ...cell })),
        rawCount: best.rawCount,
        controller: null,
        removedByController: 0,
        score: best.rawScore
      }];
    }
    const maxRaw = rawVariants[0]?.rawCount || 0;
    const controllerSearchPool = rawVariants.filter(v => v.rawCount >= maxRaw - 12).slice(0, 18);

    for (let i = 0; i < controllerSearchPool.length; i++) {
      if (runId !== solveRunId) return [];
      const variant = controllerSearchPool[i];
      const controller = findController(triInfo, variant.rawCells, opts);
      if (opts.controllerOn && !controller.rect) continue;
      const cells = controller.cells;
      const compactness = compactnessScore(cells);
      results.push({
        triInfo: variant.triInfo, layout: variant.layout, angle: variant.angle, ox: variant.ox, oy: variant.oy,
        cells, baseCells: variant.rawCells.map(cell => ({ ...cell })), rawCount: variant.rawCount, controller: controller.rect, removedByController: controller.removed || 0,
        score: cells.length * 1000000 - (opts.controllerOn && controller.rect ? controller.rect.cornerDistance * 100 : 0) + compactness
      });
      results.sort((a, b) => b.score - a.score || b.cells.length - a.cells.length);
      if (results[0]) previewVariant(results[0]);
      progress(58 + ((i + 1) / Math.max(1, controllerSearchPool.length)) * 40,
        opts.controllerOn ? `Etap 2/2: sterownik przy rogu ${i + 1}/${controllerSearchPool.length}. Najlepszy wynik: ${results[0]?.cells.length || 0} ogniw.` : `Porządkowanie wyników ${i + 1}/${controllerSearchPool.length}.`);
      await delayFrame();
    }

    results.sort((a, b) => b.score - a.score || b.cells.length - a.cells.length);
    return results.slice(0, 1);
  }

  function compactnessScore(cells) {
    if (!cells.length) return 0;
    const cx = cells.reduce((s, c) => s + c.x, 0) / cells.length;
    const cy = cells.reduce((s, c) => s + c.y, 0) / cells.length;
    const spread = cells.reduce((s, c) => s + Math.hypot(c.x - cx, c.y - cy), 0) / cells.length;
    return -spread;
  }

  function selectedSeries() {
    return Math.max(1, Math.round(readNumber("seriesSelect")));
  }

  function updateSeriesVoltageDisplay() {
    const display = $("seriesVoltageDisplay");
    if (!display) return;
    const voltage = selectedSeries() * Math.max(0, readNumber("cellVoltage"));
    const text = `${Number(voltage.toFixed(2))} V`;
    display.value = text;
    display.textContent = text;
  }

  function packStats(series, totalCells) {
    const parallel = Math.floor(totalCells / series);
    const usedCells = parallel * series;
    const cellMah = Math.max(0, readNumber("cellAh"));
    const cellAh = cellMah / 1000;
    const cellVoltage = Math.max(0, readNumber("cellVoltage"));
    const capacityAh = parallel * cellAh;
    const voltageV = series * cellVoltage;
    const energyWh = voltageV * capacityAh;
    return { parallel, usedCells, capacityAh, capacityMah: capacityAh * 1000, voltageV, energyWh };
  }

  function renderStage1PackCharacteristics() {
    const target = $("stage1PackCharacteristics");
    if (!target) return;
    if (currentStage !== 2 && stage1Substep !== 2) {
      target.innerHTML = `<div class="stage1-pack-placeholder">Charakterystyka pakietu pojawi się po przejściu do „1.2 Umiejscawianie ogniw”.</div>`;
      return;
    }
    const variant = manualMode ? manualVariant : variants[activeIndex];
    const totalCells = variant?.cells?.length || 0;
    if (!totalCells) {
      target.innerHTML = `<div class="stage1-pack-placeholder">Rozmieść ogniwa, aby obliczyć charakterystykę pakietu.</div>`;
      return;
    }
    const series = selectedSeries();
    const stats = packStats(series, totalCells);
    if (stats.parallel < 1) {
      target.innerHTML = `<div class="stage1-pack-placeholder">Liczba ogniw jest zbyt mała dla konfiguracji ${series}S.</div>`;
      return;
    }
    const cellResistance = Math.max(0, readNumber("cellResistance"));
    const standardDischarge = stats.parallel * Math.max(0, readNumber("cellStandardDischarge"));
    const maxDischarge = stats.parallel * Math.max(0, readNumber("cellMaxDischarge"));
    const standardCharge = stats.parallel * Math.max(0, readNumber("cellStandardCharge"));
    const maxCharge = stats.parallel * Math.max(0, readNumber("cellMaxCharge"));
    const packResistance = cellResistance * series / stats.parallel;
    const spareCells = totalCells - stats.usedCells;
    const metrics = [
      ["Konfiguracja", `${series}S${stats.parallel}P`],
      ["Wykorzystane ogniwa", `${stats.usedCells}${spareCells ? ` + ${spareCells} zapasu` : ""}`],
      ["Napięcie nominalne", `${formatNumber(stats.voltageV, 2)} V`],
      ["Pojemność", `${formatNumber(stats.capacityMah, 0)} mAh`],
      ["Energia", `${formatNumber(stats.energyWh, 1)} Wh`],
      ["Rezystancja pakietu", `${formatNumber(packResistance, 2)} mΩ`],
      ["Rozładowanie standard / maks. ciągłe", `${formatNumber(standardDischarge, 2)} / ${formatNumber(maxDischarge, 2)} A`],
      ["Ładowanie standard / max", `${formatNumber(standardCharge, 2)} / ${formatNumber(maxCharge, 2)} A`]
    ];
    target.innerHTML = metrics.map(([label, value]) => `<div class="stage1-pack-metric"><span>${label}</span><strong>${value}</strong></div>`).join("");
  }
