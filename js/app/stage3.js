  function stage3ViewMarkup(variant, cells, flipHorizontal, flipVertical, radius, frontSide, sideKey) {
    const boundary = variant.triInfo ? boundaryPoints(variant.triInfo) : [];
    const controllerPoints = variant.controller ? rotatedRectCorners(variant.controller) : [];
    const allPoints = [...boundary, ...cells, ...controllerPoints];
    if (!allPoints.length) return { viewBox: "-400 -200 800 400", markup: "" };
    const xs = allPoints.map(point => point.x), ys = allPoints.map(point => point.y);
    const pad = Math.max(35, radius * 3);
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const project = point => ({ x: flipHorizontal ? minX + maxX - point.x : point.x, y: flipVertical ? minY + maxY - point.y : point.y });
    const projectedCells = new Map(cells.map(cell => {
      const point = project(cell);
      return [String(cell.id), { ...cell, px: point.x, py: point.y }];
    }));
    const manualTargetNode = stage3PackPlacementMode === "manual" && stage3ManualPackTarget
      ? stage3ManualPackTarget === "negative" ? 0 : selectedSeries()
      : null;
    const frame = boundary.length ? `<polygon points="${boundary.map(point => { const projected = project(point); return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`; }).join(" ")}" fill="rgba(20,184,166,.025)" stroke="var(--frame)" stroke-width="2.2"/>` : "";
    const controller = variant.controller ? `<g pointer-events="none"><polygon points="${controllerPoints.map(point => { const projected = project(point); return `${projected.x.toFixed(2)},${projected.y.toFixed(2)}`; }).join(" ")}" fill="#ffe8b3" stroke="#9a6700" stroke-width="2"/><text x="${project({ x: variant.controller.cx, y: variant.controller.cy }).x.toFixed(2)}" y="${(project({ x: variant.controller.cx, y: variant.controller.cy }).y + 4).toFixed(2)}" text-anchor="middle" font-size="10" font-weight="800" fill="#694600">sterownik</text></g>` : "";
    const cellSvg = cells.map(cell => {
      const section = Number.isInteger(cell.section) ? cell.section : null;
      const fill = section === null ? "#d8dee8" : colors[section % colors.length];
      const projected = project(cell);
      const x = projected.x, y = projected.y;
      const positive = section === null ? frontSide : frontSide ? section % 2 === 0 : section % 2 !== 0;
      const terminal = positive
        ? `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(radius * .78).toFixed(2)}" fill="#064e2a"/><circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(radius * .36).toFixed(2)}" fill="#d7d7d7" stroke="#b8b8b8" stroke-width=".35"/>`
        : `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(radius * .70).toFixed(2)}" fill="#d7d7d7" stroke="#b8b8b8" stroke-width=".35"/>`;
      const manualCandidate = manualTargetNode !== null && section !== null
        && stage3ElectricalNodeForCell(sideKey, section) === manualTargetNode;
      const candidateHalo = manualCandidate ? `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(radius * 1.2).toFixed(2)}" fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-dasharray="3 2" pointer-events="none"/>` : "";
      return `<g class="stage3-cell${manualCandidate ? " stage3-pack-candidate" : ""}" data-cid="${cell.id}" data-section="${section ?? ""}" data-terminal="${positive ? "positive" : "negative"}">${candidateHalo}<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${fill}" stroke="#050505" stroke-width=".9"/>${terminal}</g>`;
    }).join("");
    const nickelLabels = [];
    const nickelSvg = stage3NickelConnections[sideKey].map(connection => {
      const from = projectedCells.get(String(connection.from)), to = projectedCells.get(String(connection.to));
      if (!from || !to) return "";
      const tapeWidth = Math.max(1, connection.strip_width_mm || stage3StripSelection.width_mm);
      const material = stage3StripCatalog.materials[connection.strip_material_id] || stage3ActiveStripMaterial();
      const tapeColor = material?.display_color_hex || "#cbd5e1";
      const nodeIndex = stage3ConnectionNodeIndex(connection, sideKey, projectedCells);
      const nodeColor = colors[(Number.isInteger(nodeIndex) ? nodeIndex : 0) % colors.length];
      const mx = (from.px + to.px) / 2, my = (from.py + to.py) / 2;
      const dx = to.px - from.px, dy = to.py - from.py, length = Math.max(1e-6, Math.hypot(dx, dy));
      const ux = dx / length, uy = dy / length, arrowSize = Math.min(4.5, Math.max(2.2, tapeWidth * .42));
      const arrow = `${(mx + ux * arrowSize).toFixed(2)},${(my + uy * arrowSize).toFixed(2)} ${(mx - ux * arrowSize - uy * arrowSize * .75).toFixed(2)},${(my - uy * arrowSize + ux * arrowSize * .75).toFixed(2)} ${(mx - ux * arrowSize + uy * arrowSize * .75).toFixed(2)},${(my - uy * arrowSize - ux * arrowSize * .75).toFixed(2)}`;
      const tooltip = `${Number.isInteger(nodeIndex) ? `N${nodeIndex}` : "węzeł ?"} · ${material?.name_pl || "taśma"}\nDługość: ${(connection.length_mm || length).toFixed(2)} mm\nPrzekrój: ${tapeWidth.toFixed(2)} × ${(connection.strip_thickness_mm || stage3StripSelection.thickness_mm).toFixed(2)} mm · ${connection.strip_layers || 1} warstw.\nRezystancja: ${(connection.resistance_mohm || 0).toFixed(3)} mΩ\nPrąd max: ${(connection.current_max_A || 0).toFixed(2)} A\nGęstość: ${(connection.current_density_A_mm2 || 0).toFixed(2)} A/mm²\nSpadek: ${(connection.voltage_drop_mV || 0).toFixed(2)} mV\nStraty: ${(connection.power_loss_max_W || 0).toFixed(3)} W\nTemperatura: ${(connection.predicted_temperature_C || 0).toFixed(1)}°C${connection.locked ? "\nZABLOKOWANA" : ""}`;
      const arrowMarkup = connection.generated ? "" : `<polygon points="${arrow}" fill="${nodeColor}" pointer-events="none"/>`;
      const nodeMarkup = stage3ShowNodeLabels ? `<text class="stage3-node-label" x="${mx.toFixed(2)}" y="${(my - tapeWidth * .65 - 2).toFixed(2)}" text-anchor="middle">N${nodeIndex ?? "?"}</text>` : "";
      const currentMarkup = stage3ShowCurrentLabels && Number.isFinite(connection.current_max_A) ? `<text class="stage3-current-label" x="${mx.toFixed(2)}" y="${(my + tapeWidth * .65 + 5).toFixed(2)}" text-anchor="middle">${connection.current_max_A.toFixed(1)} A</text>` : "";
      nickelLabels.push(nodeMarkup, currentMarkup);
      return `<g><title>${tooltip}</title><line x1="${from.px.toFixed(2)}" y1="${from.py.toFixed(2)}" x2="${to.px.toFixed(2)}" y2="${to.py.toFixed(2)}" stroke="${stage3SelectedConnectionId === connection.id ? "#fbbf24" : connection.bottleneck ? "#ef4444" : nodeColor}" stroke-width="${(tapeWidth + (stage3SelectedConnectionId === connection.id || connection.bottleneck ? 3.2 : 2)).toFixed(2)}" stroke-linecap="round" ${connection.locked ? 'stroke-dasharray="4 2"' : ""} pointer-events="none"/><line class="stage3-nickel" data-nickel-id="${connection.id}" data-side="${sideKey}" x1="${from.px.toFixed(2)}" y1="${from.py.toFixed(2)}" x2="${to.px.toFixed(2)}" y2="${to.py.toFixed(2)}" stroke="${tapeColor}" stroke-width="${tapeWidth.toFixed(2)}" stroke-linecap="round" opacity=".9"/>${arrowMarkup}</g>`;
    }).join("");
    const nickelLabelsSvg = `<g class="stage3-nickel-labels" pointer-events="none">${nickelLabels.join("")}</g>`;
    const leadSvg = [
      ...stage3MainLeads.negative.map(id => ({ id, label: "− PACK", color: "#60a5fa", node: 0 })),
      ...stage3MainLeads.positive.map(id => ({ id, label: "+ PACK", color: "#f87171", node: selectedSeries() }))
    ].map(lead => {
      const cell = projectedCells.get(String(lead.id));
      if (!cell || stage3ElectricalNodeForCell(sideKey, cell.section) !== lead.node) return "";
      return `<g pointer-events="none"><circle cx="${cell.px.toFixed(2)}" cy="${cell.py.toFixed(2)}" r="${(radius * 1.22).toFixed(2)}" fill="none" stroke="${lead.color}" stroke-width="2.4"/><text class="stage3-main-terminal" x="${cell.px.toFixed(2)}" y="${(cell.py - radius * 1.5).toFixed(2)}" text-anchor="middle" fill="${lead.color}">${lead.label}</text></g>`;
    }).join("");
    return { viewBox: `${minX} ${minY} ${maxX - minX} ${maxY - minY}`, markup: `${frame}${controller}${cellSvg}${nickelSvg}${nickelLabelsSvg}${leadSvg}`, projectedCells };
  }

  function stage3CellIsPositiveOnSide(side, section) {
    const frontSideStartsPositive = !stage3PolarityReversed;
    const sideStartsPositive = side === "front" ? frontSideStartsPositive : !frontSideStartsPositive;
    return sideStartsPositive ? section % 2 === 0 : section % 2 !== 0;
  }

  function stage3TouchedCellIds(from, to, projectedCells, radius) {
    const tapeWidth = Math.max(1, stage3StripSelection.width_mm);
    const contactDistance = Math.max(radius * .42, tapeWidth * .55);
    return [...projectedCells.values()]
      .filter(cell => edgeDistance({ x: cell.px, y: cell.py }, { x: from.px, y: from.py }, { x: to.px, y: to.py }) <= contactDistance)
      .map(cell => String(cell.id));
  }

  function stage3SectionsForCellIds(cellIds, projectedCells) {
    return [...new Set(cellIds.map(id => projectedCells.get(String(id))?.section).filter(Number.isInteger))].sort((a, b) => a - b);
  }

  function stage3ConnectionCellIds(connection, projectedCells, radius) {
    if (connection.geometric_row && Array.isArray(connection.cellIds)) {
      return connection.cellIds.map(String).filter(id => projectedCells.has(id));
    }
    const from = projectedCells.get(String(connection.from)), to = projectedCells.get(String(connection.to));
    return from && to ? stage3TouchedCellIds(from, to, projectedCells, radius) : [];
  }

  function stage3TapeDirectionIsLegal(side, from, to, gridStyle, gridAngle) {
    const normalize = angle => {
      let normalized = angle % Math.PI;
      if (normalized < 0) normalized += Math.PI;
      return normalized;
    };
    const angularDistance = (a, b) => {
      const difference = Math.abs(normalize(a) - normalize(b));
      return Math.min(difference, Math.PI - difference);
    };
    const candidate = normalize(Math.atan2(to.py - from.py, to.px - from.px));
    let base = gridAngle;
    if (side === "back") {
      if (stage3BackFlipHorizontal) base = Math.PI - base;
      if (stage3BackFlipVertical) base = -base;
    }
    base = normalize(base);
    const offsets = gridStyle === "square" ? [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4] : [0, Math.PI / 3, 2 * Math.PI / 3];
    const tolerance = 4 * Math.PI / 180;
    return offsets.some(offset => angularDistance(candidate, base + offset) <= tolerance);
  }

  function stage3NickelMoveIsLegal(side, fromId, toId, cells, projectedCells, radius, gridStyle, gridAngle) {
    const from = projectedCells.get(String(fromId)), to = projectedCells.get(String(toId));
    if (!from || !to || String(fromId) === String(toId)) return { valid: false, message: "Wybierz dwa różne ogniwa." };
    if (stage3NickelConnections[side].some(connection => [String(connection.from), String(connection.to)].sort().join(":") === [String(fromId), String(toId)].sort().join(":"))) {
      return { valid: false, message: "Te ogniwa są już połączone taśmą." };
    }
    if (!stage3TapeDirectionIsLegal(side, from, to, gridStyle, gridAngle)) {
      return { valid: false, message: gridStyle === "square" ? "Taśma musi biec wzdłuż osi siatki albo po przekątnej 45°." : "Taśma musi biec w jednym z trzech kierunków siatki honeycomb." };
    }
    const touchedCellIds = stage3TouchedCellIds(from, to, projectedCells, radius);
    const electricalNodes = new Set(touchedCellIds.map(id => {
      const cell = projectedCells.get(String(id));
      return cell && Number.isInteger(cell.section) ? stage3ElectricalNodeForCell(side, cell.section) : null;
    }));
    if (electricalNodes.size !== 1 || electricalNodes.has(null)) {
      return { valid: false, message: `Taśma zwarłaby bieguny należące do różnych węzłów elektrycznych (${[...electricalNodes].map(node => node === null ? "?" : `N${node}`).join(", ")}).` };
    }
    const electricalNode = [...electricalNodes][0];
    const settings = stage3RoutingSettings();
    for (const connection of stage3NickelConnections[side]) {
      const a = projectedCells.get(String(connection.from)), b = projectedCells.get(String(connection.to));
      if (!a || !b) continue;
      const existingNode = stage3ConnectionNodeIndex(connection, side, projectedCells);
      if (existingNode === electricalNode) continue;
      const clearance = settings.clearanceMm + (stage3StripSelection.width_mm + (connection.strip_width_mm || stage3StripSelection.width_mm)) / 2;
      if (stage3SegmentsTooClose({ x: from.px, y: from.py }, { x: to.px, y: to.py }, { x: a.px, y: a.py }, { x: b.px, y: b.py }, clearance)) {
        return { valid: false, message: `Taśma N${electricalNode} narusza odstęp izolacyjny od taśmy N${existingNode}.` };
      }
    }
    return { valid: true, touchedCellIds, electricalNode };
  }

  function stage3RoutingSettings() {
    const number = (id, fallback) => {
      const value = Number($(id)?.value);
      return Number.isFinite(value) ? value : fallback;
    };
    return {
      strategy: $("stage3RouteStrategy")?.value || "balanced",
      maxTemperatureC: Math.max(30, number("stage3RouteMaxTemp", 80)),
      maxDropMv: Math.max(1, number("stage3RouteMaxDrop", 25)),
      maxCurrentDensity: Math.max(1, number("stage3RouteMaxDensity", 8)),
      safetyFactor: 1 + Math.max(0, number("stage3RouteSafety", 30)) / 100,
      clearanceMm: Math.max(0, number("stage3RouteClearance", 2)),
      maxLayers: 1,
      minimumLossImprovement: Math.max(0, number("stage3RouteLossImprovement", 3) / 100),
      minimumBalanceImprovement: Math.max(0, number("stage3RouteBalanceImprovement", 2) / 100),
      maxIterations: Math.max(1, Math.min(50, Math.round(number("stage3RouteIterations", 20)))),
      patience: Math.max(1, Math.min(10, Math.round(number("stage3RoutePatience", 3)))),
      minimumImprovement: Math.max(.0001, number("stage3RouteImprovement", .1) / 100),
      ambientC: stage3CellModel?.initial_temperature_C ?? 25
    };
  }

  function stage3StrategyProfile(strategy) {
    const profiles = {
      performance: { name: "Wydajność", redundancy: 1.15, minimumDegree: 3, minimumBridges: 3, leadPoints: 3, lengthWeight: .25, balanceWeight: 2.2 },
      balanced: { name: "Kompromis", redundancy: .55, minimumDegree: 2, minimumBridges: 2, leadPoints: 2, lengthWeight: .65, balanceWeight: 1.25 },
      minimal: { name: "Minimum taśmy", redundancy: .12, minimumDegree: 1, minimumBridges: 1, leadPoints: 1, lengthWeight: 1.25, balanceWeight: .65 }
    };
    return profiles[strategy] || profiles.balanced;
  }

  function stage3AutomationContext() {
    const variant = manualMode ? manualVariant : variants[activeIndex];
    if (!variant) return null;
    const series = selectedSeries();
    const allCells = getStage2Assignment(variant, series);
    const cells = allCells.filter(cell => Number.isInteger(cell.section));
    if (!cells.length) return null;
    const radius = (manualMode ? manualCellSize : readNumber("cellType")) / 2;
    const gridStyle = manualMode ? manualGridStyle : variant.layout === "square" ? "square" : "honeycomb";
    const gridAngle = manualMode ? manualGridAngle : (variant.angle || 0) * Math.PI / 180;
    const sectionCounts = Array.from({ length: series }, (_, section) => cells.filter(cell => cell.section === section).length);
    const parallel = Math.max(1, Math.min(...sectionCounts.filter(Boolean)));
    const nominalPerCell = Math.max(.001, readNumber("cellStandardDischarge") || stage3CellModel?.standard_discharge_A || 1);
    const maximumPerCell = Math.max(nominalPerCell, readNumber("cellMaxDischarge") || stage3CellModel?.max_continuous_discharge_A || nominalPerCell);
    const context = {
      variant, allCells, cells, series, radius, gridStyle, gridAngle, sectionCounts, parallel,
      nominalCurrentA: nominalPerCell * parallel,
      maximumCurrentA: maximumPerCell * parallel,
      settings: stage3RoutingSettings(),
      projected: {
        front: stage3ViewMarkup(variant, cells, false, false, radius, !stage3PolarityReversed, "front").projectedCells,
        back: stage3ViewMarkup(variant, cells, stage3BackFlipHorizontal, stage3BackFlipVertical, radius, stage3PolarityReversed, "back").projectedCells
      }
    };
    context.stage2Transitions = stage2ConnectionAnalysis(cells, series, radius).connections.map(connection => ({
      boundaryIndex: connection.section + 1,
      fromId: String(connection.from.id),
      toId: String(connection.to.id),
      distance: connection.distance
    }));
    context.gridGeometry = stage3DetectGridGeometry(context);
    return context;
  }

  function stage3ElectricalNodeForCell(side, section) {
    return section + (stage3CellIsPositiveOnSide(side, section) ? 1 : 0);
  }

  function stage3BuildElectricalNodes(context) {
    const nodes = Array.from({ length: context.series + 1 }, (_, index) => ({ index, id: `N${index}`, side: null, terminals: [] }));
    context.cells.forEach(cell => {
      ["front", "back"].forEach(side => {
        const nodeIndex = stage3ElectricalNodeForCell(side, cell.section);
        const projected = context.projected[side].get(String(cell.id));
        if (!projected || !nodes[nodeIndex]) return;
        nodes[nodeIndex].terminals.push({ ...cell, side, px: projected.px, py: projected.py });
        if (!nodes[nodeIndex].side) nodes[nodeIndex].side = side;
      });
    });
    return nodes;
  }

  function stage3Median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function stage3NormalizeAxisAngle(angle) {
    let normalized = angle % Math.PI;
    if (normalized < 0) normalized += Math.PI;
    return normalized;
  }

  function stage3AxisAngularDistance(left, right) {
    const difference = Math.abs(stage3NormalizeAxisAngle(left) - stage3NormalizeAxisAngle(right));
    return Math.min(difference, Math.PI - difference);
  }

  function stage3AngleClusterMean(records) {
    const x = records.reduce((sum, record) => sum + Math.cos(record.angle * 2), 0);
    const y = records.reduce((sum, record) => sum + Math.sin(record.angle * 2), 0);
    return stage3NormalizeAxisAngle(Math.atan2(y, x) / 2);
  }

  function stage3DetectSideGrid(context, side) {
    const points = [...context.projected[side].values()];
    const fallbackPitch = Math.max(1, context.radius * 2 + (manualMode ? manualCellGap : readNumber("cellGap") || 1));
    if (points.length < 2) return { pitch: fallbackPitch, axes: [] };
    const nearest = [];
    for (let left = 0; left < points.length; left++) {
      let distance = Number.POSITIVE_INFINITY;
      for (let right = 0; right < points.length; right++) {
        if (left === right) continue;
        distance = Math.min(distance, Math.hypot(points[left].px - points[right].px, points[left].py - points[right].py));
      }
      if (Number.isFinite(distance)) nearest.push(distance);
    }
    const pitch = stage3Median(nearest) || fallbackPitch;
    const maximumNeighborDistance = pitch * (context.gridStyle === "square" ? 1.5 : 1.22);
    const records = [];
    for (let left = 0; left < points.length; left++) for (let right = left + 1; right < points.length; right++) {
      const dx = points[right].px - points[left].px, dy = points[right].py - points[left].py;
      const distance = Math.hypot(dx, dy);
      if (distance < pitch * .72 || distance > maximumNeighborDistance) continue;
      records.push({ angle: stage3NormalizeAxisAngle(Math.atan2(dy, dx)), distance });
    }
    const clusterTolerance = 7 * Math.PI / 180;
    const clusters = [];
    records.sort((a, b) => a.distance - b.distance || a.angle - b.angle).forEach(record => {
      const match = clusters.map(cluster => ({ cluster, distance: stage3AxisAngularDistance(record.angle, cluster.angle) }))
        .filter(candidate => candidate.distance <= clusterTolerance)
        .sort((a, b) => a.distance - b.distance)[0]?.cluster;
      if (match) {
        match.records.push(record);
        match.angle = stage3AngleClusterMean(match.records);
      } else {
        clusters.push({ angle: record.angle, records: [record] });
      }
    });
    const expectedAxisCount = context.gridStyle === "square" ? 4 : 3;
    const selected = [];
    clusters.sort((a, b) => b.records.length - a.records.length).forEach(cluster => {
      if (selected.length >= expectedAxisCount) return;
      if (selected.every(existing => stage3AxisAngularDistance(existing.angle, cluster.angle) > 14 * Math.PI / 180)) selected.push(cluster);
    });
    let fallbackBase = context.gridAngle;
    if (side === "back") {
      if (stage3BackFlipHorizontal) fallbackBase = Math.PI - fallbackBase;
      if (stage3BackFlipVertical) fallbackBase = -fallbackBase;
    }
    const fallbackOffsets = context.gridStyle === "square" ? [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4] : [0, Math.PI / 3, 2 * Math.PI / 3];
    fallbackOffsets.forEach((offset, index) => {
      if (selected.length >= expectedAxisCount) return;
      const angle = stage3NormalizeAxisAngle(fallbackBase + offset);
      if (selected.every(existing => stage3AxisAngularDistance(existing.angle, angle) > 14 * Math.PI / 180)) {
        selected.push({ angle, records: [{ angle, distance: context.gridStyle === "square" && index % 2 ? pitch * Math.SQRT2 : pitch }] });
      }
    });
    const axes = selected.map(cluster => {
      const angle = stage3NormalizeAxisAngle(cluster.angle);
      return {
        angle,
        x: Math.cos(angle),
        y: Math.sin(angle),
        step: stage3Median(cluster.records.map(record => record.distance)) || pitch,
        support: cluster.records.length
      };
    }).sort((a, b) => a.angle - b.angle).slice(0, expectedAxisCount);
    return { pitch, axes, toleranceRad: 4 * Math.PI / 180 };
  }

  function stage3DetectGridGeometry(context) {
    return {
      front: stage3DetectSideGrid(context, "front"),
      back: stage3DetectSideGrid(context, "back")
    };
  }

  function stage3DirectionMatchesDetectedGrid(context, side, from, to) {
    const geometry = context?.gridGeometry?.[side];
    if (!geometry?.axes?.length) return stage3TapeDirectionIsLegal(side, from, to, context.gridStyle, context.gridAngle);
    const angle = stage3NormalizeAxisAngle(Math.atan2(to.py - from.py, to.px - from.px));
    return geometry.axes.some(axis => stage3AxisAngularDistance(angle, axis.angle) <= geometry.toleranceRad);
  }

  function stage3CandidateFollowsContinuousGridRow(context, side, from, to, touchedCellIds) {
    const geometry = context?.gridGeometry?.[side];
    if (!geometry?.axes?.length || touchedCellIds.length < 2) return false;
    const dx = to.px - from.px, dy = to.py - from.py;
    const length = Math.hypot(dx, dy);
    if (length < 1e-6) return false;
    const ux = dx / length, uy = dy / length;
    const angle = stage3NormalizeAxisAngle(Math.atan2(dy, dx));
    const axis = geometry.axes
      .map(candidate => ({ ...candidate, angularError: stage3AxisAngularDistance(angle, candidate.angle) }))
      .sort((a, b) => a.angularError - b.angularError)[0];
    if (!axis || axis.angularError > Math.min(geometry.toleranceRad, 2 * Math.PI / 180)) return false;

    const projected = context.projected[side];
    const rowTolerance = Math.max(.35, Math.min(context.radius * .16, axis.step * .09));
    const row = touchedCellIds.map(id => projected.get(String(id))).filter(Boolean).map(cell => {
      const offsetX = cell.px - from.px, offsetY = cell.py - from.py;
      return {
        id: String(cell.id),
        along: offsetX * ux + offsetY * uy,
        perpendicular: Math.abs(offsetX * uy - offsetY * ux)
      };
    }).filter(cell => cell.along >= -rowTolerance && cell.along <= length + rowTolerance && cell.perpendicular <= rowTolerance)
      .sort((a, b) => a.along - b.along);
    if (row.length !== touchedCellIds.length || row[0]?.id !== String(from.id) || row[row.length - 1]?.id !== String(to.id)) return false;

    const maximumStep = axis.step * 1.32;
    for (let index = 1; index < row.length; index++) {
      const gap = row[index].along - row[index - 1].along;
      if (gap < axis.step * .55 || gap > maximumStep) return false;
    }
    return true;
  }

  function stage3SegmentInsideFrame(context, fromId, toId) {
    const boundary = context.variant?.triInfo;
    if (!boundary || boundaryPoints(boundary).length < 3) return true;
    const byId = new Map(context.cells.map(cell => [String(cell.id), cell]));
    const from = byId.get(String(fromId)), to = byId.get(String(toId));
    if (!from || !to) return false;
    for (let step = 0; step <= 16; step++) {
      const ratio = step / 16;
      if (!pointInBoundary({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio }, boundary, 0)) return false;
    }
    return true;
  }

  function stage3SegmentTouchesForeignPole(context, side, nodeIndex, from, to) {
    const dx = to.px - from.px, dy = to.py - from.py;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared < 1e-9) return true;
    const tolerance = Math.max(.35, context.radius * .22);
    return [...context.projected[side].values()].some(cell => {
      if (stage3ElectricalNodeForCell(side, cell.section) === nodeIndex) return false;
      const ratio = ((cell.px - from.px) * dx + (cell.py - from.py) * dy) / lengthSquared;
      if (ratio < -.01 || ratio > 1.01) return false;
      return edgeDistance({ x: cell.px, y: cell.py }, { x: from.px, y: from.py }, { x: to.px, y: to.py }) <= tolerance;
    });
  }

  function stage3RowsForNodeAxis(context, node, axisIndex) {
    const geometry = context.gridGeometry[node.side];
    const axis = geometry?.axes?.[axisIndex];
    if (!axis) return [];
    const rowTolerance = Math.max(.45, Math.min(context.radius * .32, axis.step * .12));
    const projected = context.projected[node.side];
    const entries = node.terminals.map(terminal => {
      const cell = projected.get(String(terminal.id));
      if (!cell) return null;
      return {
        id: String(cell.id),
        section: cell.section,
        px: cell.px,
        py: cell.py,
        u: cell.px * axis.x + cell.py * axis.y,
        v: -cell.px * axis.y + cell.py * axis.x
      };
    }).filter(Boolean).sort((a, b) => a.v - b.v || a.u - b.u);
    const groups = [];
    entries.forEach(entry => {
      const group = groups.map(candidate => ({ candidate, distance: Math.abs(entry.v - candidate.meanV) }))
        .filter(candidate => candidate.distance <= rowTolerance)
        .sort((a, b) => a.distance - b.distance)[0]?.candidate;
      if (group) {
        group.items.push(entry);
        group.meanV = group.items.reduce((sum, item) => sum + item.v, 0) / group.items.length;
      } else groups.push({ meanV: entry.v, items: [entry] });
    });
    const rows = [];
    const appendRow = items => {
      if (items.length < 2) return;
      const ordered = [...items].sort((a, b) => a.u - b.u);
      const from = ordered[0], to = ordered[ordered.length - 1];
      if (ordered.some(item => edgeDistance({ x: item.px, y: item.py }, { x: from.px, y: from.py }, { x: to.px, y: to.py }) > rowTolerance * 1.35)) return;
      const sections = [...new Set(ordered.map(item => item.section))].sort((a, b) => a - b);
      rows.push({
        key: `${node.side}:N${node.index}:A${axisIndex}:${from.id}:${to.id}`,
        axisIndex,
        fromId: from.id,
        toId: to.id,
        cellIds: ordered.map(item => item.id),
        sections,
        distance: Math.hypot(to.px - from.px, to.py - from.py),
        parallelCoordinate: ordered.reduce((sum, item) => sum + item.v, 0) / ordered.length,
        midpoint: { x: (from.px + to.px) / 2, y: (from.py + to.py) / 2 }
      });
    };
    groups.forEach(group => {
      const ordered = group.items.sort((a, b) => a.u - b.u);
      let run = [];
      ordered.forEach(item => {
        const previous = run[run.length - 1];
        const from = previous && projected.get(previous.id), to = projected.get(item.id);
        const continuous = !previous || (
          item.u - previous.u <= axis.step * 1.42 &&
          from && to &&
          !stage3SegmentTouchesForeignPole(context, node.side, node.index, from, to) &&
          stage3SegmentInsideFrame(context, previous.id, item.id)
        );
        if (!continuous) {
          appendRow(run);
          run = [];
        }
        run.push(item);
      });
      appendRow(run);
    });
    return rows.filter((row, index, all) => all.findIndex(candidate => candidate.key === row.key) === index);
  }

  function stage3RowAlreadyCovered(context, layout, node, row) {
    const required = new Set(row.cellIds.map(String));
    return layout[node.side].some(connection => {
      if (stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) !== node.index) return false;
      const touched = new Set(stage3ConnectionCellIds(connection, context.projected[node.side], context.radius).map(String));
      return [...required].every(id => touched.has(id));
    });
  }

  function stage3AddGeometricRow(context, layout, node, row, variantKey) {
    if (stage3RowAlreadyCovered(context, layout, node, row)) return null;
    const projected = context.projected[node.side];
    const from = projected.get(row.fromId), to = projected.get(row.toId);
    if (!from || !to || stage3CandidateCollision(context, layout, node.side, node.index, from, to, stage3StripSelection.width_mm)) return null;
    const crossesBoundary = node.index > 0 && node.index < context.series && row.sections.includes(node.index - 1) && row.sections.includes(node.index);
    const connection = {
      id: `geo-${variantKey}-${node.side}-N${node.index}-A${row.axisIndex}-${layout[node.side].length}`,
      from: row.fromId,
      to: row.toId,
      cellIds: [...row.cellIds],
      electrical_node: node.index,
      geometric_row: true,
      axis_index: row.axisIndex,
      generated: true,
      locked: false,
      ...stage3StripConnectionProperties()
    };
    if (crossesBoundary) connection.passage_boundary = node.index;
    layout[node.side].push(connection);
    return connection;
  }

  async function stage3BuildGeometricNode(context, node, layout, mainAxisIndex, variantKey, onAdded = null) {
    const issues = [];
    const terminalIds = node.terminals.map(terminal => String(terminal.id));
    if (terminalIds.length <= 1) return { valid: true, issues, rows: 0, passages: 0 };
    const geometry = context.gridGeometry[node.side];
    if (!geometry?.axes?.[mainAxisIndex]) return { valid: false, issues: [`${node.id}: brak wykrytej osi ${mainAxisIndex + 1} po stronie ${node.side === "front" ? "A" : "B"}.`], rows: 0, passages: 0 };
    const rowsByAxis = geometry.axes.map((_, axisIndex) => stage3RowsForNodeAxis(context, node, axisIndex));
    const allRows = rowsByAxis.flat();
    const parent = new Map(terminalIds.map(id => [id, id]));
    const find = id => {
      const key = String(id);
      if (!parent.has(key)) return null;
      if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
      return parent.get(key);
    };
    const join = (left, right) => {
      const a = find(left), b = find(right);
      if (a !== null && b !== null && a !== b) parent.set(b, a);
    };
    const joinRow = row => row.cellIds.slice(1).forEach(id => join(row.cellIds[0], id));
    layout[node.side].filter(connection => stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) === node.index).forEach(connection => {
      const ids = stage3ConnectionCellIds(connection, context.projected[node.side], context.radius).map(String).filter(id => parent.has(id));
      ids.slice(1).forEach(id => join(ids[0], id));
    });
    const used = new Set();
    const touched = new Set();
    const accept = async row => {
      if (used.has(row.key)) return false;
      if (stage3RowAlreadyCovered(context, layout, node, row)) {
        used.add(row.key);
        row.cellIds.forEach(id => touched.add(id));
        joinRow(row);
        return true;
      }
      const connection = stage3AddGeometricRow(context, layout, node, row, variantKey);
      if (!connection) return false;
      used.add(row.key);
      row.cellIds.forEach(id => touched.add(id));
      joinRow(row);
      if (onAdded) await onAdded(connection, { phase: "parallel", nodeIndex: node.index });
      return true;
    };
    const isIntermediate = node.index > 0 && node.index < context.series;
    const primaryRows = rowsByAxis[mainAxisIndex];
    const transitionRows = primaryRows.filter(row => row.sections.includes(node.index - 1) && row.sections.includes(node.index));
    const existingBoundaryPassages = isIntermediate
      ? layout[node.side].filter(connection => connection.passage_boundary === node.index).length
      : 0;
    if (isIntermediate && !transitionRows.length && !existingBoundaryPassages) {
      return { valid: false, issues: [`${node.id}: oś ${mainAxisIndex + 1} nie tworzy żadnego prostego przejścia S${node.index}–S${node.index + 1}.`], rows: 0, passages: 0 };
    }
    for (const row of transitionRows.sort((a, b) => a.parallelCoordinate - b.parallelCoordinate)) await accept(row);
    for (const row of primaryRows.filter(row => !used.has(row.key)).sort((a, b) => a.parallelCoordinate - b.parallelCoordinate)) await accept(row);
    const center = {
      x: node.terminals.reduce((sum, terminal) => sum + terminal.px, 0) / node.terminals.length,
      y: node.terminals.reduce((sum, terminal) => sum + terminal.py, 0) / node.terminals.length
    };
    const componentCount = () => new Set(terminalIds.map(find)).size;
    while (componentCount() > 1) {
      const candidates = allRows.filter(row => !used.has(row.key)).map(row => {
        const roots = new Set(row.cellIds.map(find).filter(root => root !== null));
        const uncovered = row.cellIds.filter(id => !touched.has(id)).length;
        const centrality = Math.hypot(row.midpoint.x - center.x, row.midpoint.y - center.y);
        return { row, roots, uncovered, centrality };
      }).filter(candidate => candidate.roots.size > 1 && !stage3CandidateCollision(
        context,
        layout,
        node.side,
        node.index,
        context.projected[node.side].get(candidate.row.fromId),
        context.projected[node.side].get(candidate.row.toId),
        stage3StripSelection.width_mm
      )).sort((a, b) =>
        b.roots.size - a.roots.size ||
        b.uncovered - a.uncovered ||
        a.centrality - b.centrality ||
        a.row.distance - b.row.distance ||
        a.row.axisIndex - b.row.axisIndex
      );
      if (!candidates.length || !(await accept(candidates[0].row))) break;
    }
    if (componentCount() > 1) issues.push(`${node.id}: osie siatki nie pozwalają połączyć wszystkich ${terminalIds.length} biegunów jedną spójną siecią.`);
    const nodeConnections = layout[node.side].filter(connection => stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) === node.index);
    const passages = nodeConnections.filter(connection => connection.passage_boundary === node.index).length;
    if (isIntermediate && passages < 1) issues.push(`${node.id}: nie utworzono przejścia pomiędzy kolejnymi sekcjami.`);
    return { valid: !issues.length, issues, rows: nodeConnections.length, passages };
  }

  function stage3ValidateGeometricLayout(context, layout, generationIssues = []) {
    const issues = [...generationIssues];
    const seen = new Set();
    ["front", "back"].forEach(side => {
      const projected = context.projected[side];
      layout[side].forEach(connection => {
        const from = projected.get(String(connection.from)), to = projected.get(String(connection.to));
        const label = `${side === "front" ? "A" : "B"}/N${connection.electrical_node ?? "?"}`;
        if (!from || !to || String(connection.from) === String(connection.to)) {
          issues.push(`${label}: taśma nie kończy się w środkach dwóch istniejących biegunów.`);
          return;
        }
        if (!stage3DirectionMatchesDetectedGrid(context, side, from, to)) issues.push(`${label}: taśma nie jest zgodna z żadną wykrytą osią siatki.`);
        if (!stage3SegmentInsideFrame(context, connection.from, connection.to)) issues.push(`${label}: taśma wychodzi poza obrys pakietu.`);
        const touched = stage3ConnectionCellIds(connection, projected, context.radius).map(String);
        const touchedNodes = new Set(touched.map(id => {
          const cell = projected.get(id);
          return cell ? stage3ElectricalNodeForCell(side, cell.section) : null;
        }));
        if (touchedNodes.size !== 1 || !touchedNodes.has(connection.electrical_node)) issues.push(`${label}: taśma dotyka bieguna obcego węzła.`);
        if (stage3SegmentTouchesForeignPole(context, side, connection.electrical_node, from, to)) issues.push(`${label}: taśma przechodzi przez środek obcego bieguna.`);
        const key = `${side}:${connection.electrical_node}:${[String(connection.from), String(connection.to)].sort().join(":")}`;
        if (seen.has(key)) issues.push(`${label}: wykryto powielony pasek.`);
        seen.add(key);
      });
      for (let left = 0; left < layout[side].length; left++) for (let right = left + 1; right < layout[side].length; right++) {
        const first = layout[side][left], second = layout[side][right];
        if (first.electrical_node === second.electrical_node) continue;
        const a = projected.get(String(first.from)), b = projected.get(String(first.to));
        const c = projected.get(String(second.from)), d = projected.get(String(second.to));
        if (a && b && c && d && stage3SegmentsIntersect({ x: a.px, y: a.py }, { x: b.px, y: b.py }, { x: c.px, y: c.py }, { x: d.px, y: d.py })) {
          issues.push(`Strona ${side === "front" ? "A" : "B"}: taśmy N${first.electrical_node} i N${second.electrical_node} przecinają się.`);
        }
      }
    });
    stage3BuildElectricalNodes(context).forEach(node => {
      const visited = stage3ConnectedIdsForNode(context, node, layout);
      if (visited.size !== node.terminals.length) issues.push(`${node.id}: sieć geometryczna obejmuje ${visited.size}/${node.terminals.length} biegunów.`);
      if (node.index > 0 && node.index < context.series) {
        const transitionExists = layout[node.side].some(connection => {
          if (stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) !== node.index) return false;
          const sections = stage3SectionsForCellIds(stage3ConnectionCellIds(connection, context.projected[node.side], context.radius), context.projected[node.side]);
          return sections.includes(node.index - 1) && sections.includes(node.index);
        });
        if (!transitionExists) issues.push(`${node.id}: brak bezpośredniego przejścia S${node.index}–S${node.index + 1}.`);
      }
    });
    return { valid: !issues.length, issues: [...new Set(issues)] };
  }

  function stage3CreateGeometricPassagePlan(context, layout) {
    const boundaries = [];
    for (let boundaryIndex = 1; boundaryIndex < context.series; boundaryIndex++) {
      const stats = stage3BoundaryPassageStats(context, boundaryIndex, layout);
      boundaries.push({
        boundaryIndex,
        nodeIndex: boundaryIndex,
        side: stats.geometry?.side || stage3BuildElectricalNodes(context)[boundaryIndex]?.side,
        maximumPassages: stats.count,
        minimumSeparation: context.settings.clearanceMm + stage3StripSelection.width_mm,
        preferredPositions: stats.clusters.map(cluster => cluster.coordinate),
        candidates: []
      });
    }
    return { boundaries, averageMaximum: boundaries.reduce((sum, boundary) => sum + boundary.maximumPassages, 0) / Math.max(1, boundaries.length), geometric: true };
  }

  function stage3SelectLiveMainAxis(context) {
    const nodes = stage3BuildElectricalNodes(context);
    const maximumAxes = Math.max(...["front", "back"].map(side => context.gridGeometry?.[side]?.axes?.length || 0), 1);
    const candidates = [];
    for (let axisIndex = 0; axisIndex < maximumAxes; axisIndex++) {
      let coveredTerminals = 0, transitionRows = 0, rowCount = 0, totalSpan = 0;
      nodes.forEach(node => {
        if (!context.gridGeometry?.[node.side]?.axes?.[axisIndex]) return;
        const rows = stage3RowsForNodeAxis(context, node, axisIndex);
        const covered = new Set(rows.flatMap(row => row.cellIds.map(String)));
        coveredTerminals += covered.size;
        rowCount += rows.length;
        totalSpan += rows.reduce((sum, row) => sum + row.cellIds.length, 0);
        if (node.index > 0 && node.index < context.series) {
          transitionRows += rows.filter(row => row.sections.includes(node.index - 1) && row.sections.includes(node.index)).length;
        }
      });
      candidates.push({ axisIndex, coveredTerminals, transitionRows, rowCount, totalSpan });
    }
    return candidates.sort((a, b) =>
      b.coveredTerminals - a.coveredTerminals ||
      b.transitionRows - a.transitionRows ||
      b.totalSpan - a.totalSpan ||
      a.rowCount - b.rowCount ||
      a.axisIndex - b.axisIndex
    )[0] || { axisIndex: 0, coveredTerminals: 0, transitionRows: 0, rowCount: 0, totalSpan: 0 };
  }

  async function stage3BuildGeometricVariant(context, mainAxisIndex, strategy, lockedLayout, label, onAdded = null) {
    const layout = {
      front: lockedLayout.front.map(connection => ({ ...connection })),
      back: lockedLayout.back.map(connection => ({ ...connection }))
    };
    const issues = [];
    const nodeReports = [];
    const emitAdded = onAdded ? (connection, details) => onAdded(layout, connection, details) : null;
    // Najpierw rozplanuj możliwie dużo fizycznie oddzielnych, krótkich mostków
    // pomiędzy każdą parą kolejnych sekcji. Dopiero potem dobuduj szyny
    // równoległe wewnątrz sekcji. Wcześniej pojedynczy długi rząd przecinający
    // granicę był traktowany jako wystarczające połączenie międzysekcyjne.
    const passagePlan = stage3CreateGlobalPassagePlan(context, lockedLayout);
    for (const boundaryPlan of passagePlan.boundaries) {
      await stage3AddPlannedPassagesLive(context, layout, boundaryPlan, strategy, "uniform", mainAxisIndex * .37, issues, emitAdded);
    }
    for (const node of stage3BuildElectricalNodes(context)) {
      const result = await stage3BuildGeometricNode(context, node, layout, mainAxisIndex, `V${mainAxisIndex + 1}`, emitAdded);
      nodeReports.push({ nodeIndex: node.index, ...result });
      issues.push(...result.issues);
    }
    const geometryValidation = stage3ValidateGeometricLayout(context, layout, issues);
    if (!geometryValidation.valid) {
      return { name: label, axisIndex: mainAxisIndex, layout, geometryValidation, validation: { valid: false, issues: geometryValidation.issues }, analysis: null, diagnostics: null, passagePlan: null, nodeReports, profileScore: Number.POSITIVE_INFINITY, rank: [1, geometryValidation.issues.length, Number.POSITIVE_INFINITY] };
    }
    const analysis = stage3OptimizeLayout(context, layout, strategy);
    const validation = stage3ValidateNickelLayout(context, layout, analysis, passagePlan);
    const diagnostics = stage3BoundaryDiagnostics(context, layout, passagePlan);
    const profileScore = stage3NormalizedProfileScore(context, analysis, diagnostics, strategy);
    return {
      name: label,
      axisIndex: mainAxisIndex,
      routeMode: `axis-${mainAxisIndex + 1}`,
      layout,
      geometryValidation,
      validation,
      analysis,
      diagnostics,
      passagePlan,
      nodeReports,
      profileScore,
      score: profileScore,
      rank: [validation.valid ? 0 : 1, validation.issues.length, analysis.metrics.bottlenecks, profileScore]
    };
  }

  function stage3FixedStripLimit(context, lengthMm) {
    const material = stage3ActiveStripMaterial();
    const width = Math.min(10, Math.max(.1, stage3StripSelection.width_mm));
    const thickness = Math.max(.01, stage3StripSelection.thickness_mm);
    const area = width * thickness;
    const resistivity = material?.electrical_resistivity_ohm_m?.nominal || 9e-8;
    const resistance = resistivity * (Math.max(1, lengthMm) / 1000) / (area * 1e-6);
    const densityLimit = context.settings.maxCurrentDensity * area;
    const dropLimit = (context.settings.maxDropMv / 1000) / Math.max(1e-12, resistance);
    const thermalResistance = Math.max(4, 42 / width);
    const thermalLimit = Math.sqrt(Math.max(0, context.settings.maxTemperatureC - context.settings.ambientC) / Math.max(1e-12, resistance * thermalResistance));
    return {
      area,
      resistance,
      allowableCurrentA: Math.max(.01, Math.min(densityLimit, dropLimit, thermalLimit))
    };
  }

  function stage3UniformMainRowOrder(rows, variantIndex = 0) {
    if (!rows.length) return [];
    const sorted = [...rows].sort((a, b) => a.parallelCoordinate - b.parallelCoordinate);
    const minimum = sorted[0].parallelCoordinate, maximum = sorted[sorted.length - 1].parallelCoordinate;
    const bias = [0, -.16, .16][variantIndex % 3] || 0;
    const target = (minimum + maximum) / 2 + (maximum - minimum) * bias;
    const remaining = [...sorted];
    const selected = [];
    while (remaining.length) {
      const candidate = remaining.map(row => {
        const nearest = selected.length ? Math.min(...selected.map(item => Math.abs(item.parallelCoordinate - row.parallelCoordinate))) : 0;
        const centerDistance = Math.abs(row.parallelCoordinate - target);
        return { row, nearest, centerDistance };
      }).sort((a, b) => selected.length
        ? b.nearest - a.nearest || (b.row.stage2TransitionCount || 0) - (a.row.stage2TransitionCount || 0) || b.row.cellIds.length - a.row.cellIds.length || a.centerDistance - b.centerDistance
        : a.centerDistance - b.centerDistance || (b.row.stage2TransitionCount || 0) - (a.row.stage2TransitionCount || 0) || b.row.cellIds.length - a.row.cellIds.length
      )[0];
      selected.push(candidate.row);
      remaining.splice(remaining.indexOf(candidate.row), 1);
    }
    return selected;
  }

  function stage3MainAxisPlan(context, node, axisIndex, layout, variantIndex = 0) {
    const projected = context.projected[node.side];
    const requiredCurrentA = context.maximumCurrentA * context.settings.safetyFactor;
    const candidateRows = stage3RowsForNodeAxis(context, node, axisIndex).filter(row => {
      if (row.sections.length !== 2 || row.sections[0] !== node.index - 1 || row.sections[1] !== node.index) return false;
      const from = projected.get(row.fromId), to = projected.get(row.toId);
      return from && to && !stage3CandidateCollision(context, layout, node.side, node.index, from, to, stage3StripSelection.width_mm);
    }).map(row => {
      const ids = new Set(row.cellIds.map(String));
      const stage2TransitionCount = (context.stage2Transitions || []).filter(transition => transition.boundaryIndex === node.index && ids.has(transition.fromId) && ids.has(transition.toId)).length;
      return { ...row, stage2TransitionCount };
    });
    const legalRows = candidateRows;
    const ordered = stage3UniformMainRowOrder(legalRows, variantIndex);
    const selected = [];
    const usedCells = new Set();
    let totalConductance = 0;
    let totalCapacityA = 0;
    let coveredCells = 0;
    for (const row of ordered) {
      if (row.cellIds.some(id => usedCells.has(String(id)))) continue;
      const limits = stage3FixedStripLimit(context, row.distance);
      const oldResistance = totalConductance > 0 ? 1 / totalConductance : Number.POSITIVE_INFINITY;
      const newConductance = totalConductance + 1 / limits.resistance;
      const newResistance = 1 / newConductance;
      const lossImprovement = Number.isFinite(oldResistance) ? Math.max(0, (oldResistance - newResistance) / oldResistance) : 1;
      const newCells = row.cellIds.filter(id => !usedCells.has(String(id))).length;
      const coverageImprovement = newCells / Math.max(1, node.terminals.length);
      const minimumReached = totalCapacityA >= requiredCurrentA;
      const significant = lossImprovement >= context.settings.minimumLossImprovement || coverageImprovement >= context.settings.minimumBalanceImprovement;
      const variantExtra = minimumReached && selected.length < Math.min(ordered.length, Math.max(1, Math.ceil(context.parallel / 3)) + variantIndex);
      if (minimumReached && !significant && !variantExtra) continue;
      selected.push({ ...row, limits });
      row.cellIds.forEach(id => usedCells.add(String(id)));
      coveredCells += newCells;
      totalConductance = newConductance;
      totalCapacityA += limits.allowableCurrentA;
    }
    const coordinates = selected.map(row => row.parallelCoordinate).sort((a, b) => a - b);
    const gaps = coordinates.slice(1).map((value, index) => value - coordinates[index]);
    const meanGap = gaps.reduce((sum, value) => sum + value, 0) / Math.max(1, gaps.length);
    const spacingPenalty = gaps.length > 1 && meanGap > 0
      ? Math.sqrt(gaps.reduce((sum, value) => sum + (value - meanGap) ** 2, 0) / gaps.length) / meanGap
      : 0;
    const totalLengthMm = selected.reduce((sum, row) => sum + row.distance, 0);
    const theoreticalTransitions = (context.stage2Transitions || []).filter(transition => transition.boundaryIndex === node.index).reduce((count, transition) => {
      return count + (selected.some(row => {
        const ids = new Set(row.cellIds.map(String));
        return ids.has(transition.fromId) && ids.has(transition.toId);
      }) ? 1 : 0);
    }, 0);
    return {
      axisIndex,
      legalRows,
      selected,
      totalCapacityA,
      requiredCurrentA,
      coveredCells,
      uncoveredCells: Math.max(0, node.terminals.length - coveredCells),
      totalLengthMm,
      theoreticalTransitions,
      effectiveResistance: totalConductance > 0 ? 1 / totalConductance : Number.POSITIVE_INFINITY,
      spacingPenalty,
      valid: selected.length > 0 && totalCapacityA >= requiredCurrentA
    };
  }

  function stage3RankMainAxisPlans(plans) {
    return [...plans].sort((a, b) =>
      Number(b.valid) - Number(a.valid) ||
      b.theoreticalTransitions - a.theoreticalTransitions ||
      a.spacingPenalty - b.spacingPenalty ||
      b.coveredCells - a.coveredCells ||
      a.uncoveredCells - b.uncoveredCells ||
      a.effectiveResistance - b.effectiveResistance ||
      a.totalLengthMm - b.totalLengthMm ||
      a.axisIndex - b.axisIndex
    );
  }

  async function stage3BuildMinimalCrosslinks(context, node, layout, mainAxisIndex, variantKey, onAdded = null) {
    const terminalIds = node.terminals.map(terminal => String(terminal.id));
    const parent = new Map(terminalIds.map(id => [id, id]));
    const find = id => {
      const key = String(id);
      if (!parent.has(key)) return null;
      if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
      return parent.get(key);
    };
    const join = (left, right) => {
      const a = find(left), b = find(right);
      if (a !== null && b !== null && a !== b) parent.set(b, a);
    };
    const joinConnection = connection => {
      const ids = stage3ConnectionCellIds(connection, context.projected[node.side], context.radius).map(String).filter(id => parent.has(id));
      ids.slice(1).forEach(id => join(ids[0], id));
    };
    layout[node.side].filter(connection => stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) === node.index).forEach(joinConnection);
    const componentCount = () => new Set(terminalIds.map(find)).size;
    const issues = [];
    let added = 0;
    const axes = context.gridGeometry[node.side]?.axes || [];
    const allowedAxes = axes.map((_, index) => index).filter(index => index !== mainAxisIndex);
    if (!allowedAxes.length) axes.forEach((_, index) => allowedAxes.push(index));

    // Drugi etap nie może "dorysowywać" najkrótszych fragmentów między
    // przypadkowymi parami ogniw. To właśnie tworzyło widoczne drzewka.
    // Wybieramy jedną dodatkową oś siatki i prowadzimy po niej wyłącznie pełne,
    // maksymalnie długie, ciągłe rzędy. Dzięki temu układ pozostaje regularny
    // oraz czytelny również po kolejnych iteracjach generatora.
    const evaluateAxis = axisIndex => {
      const rows = stage3RowsForNodeAxis(context, node, axisIndex).filter(row => {
        if (stage3LayoutHasConnection(layout, node.side, row.fromId, row.toId) || stage3RowAlreadyCovered(context, layout, node, row)) return false;
        const from = context.projected[node.side].get(row.fromId), to = context.projected[node.side].get(row.toId);
        return from && to && !stage3CandidateCollision(context, layout, node.side, node.index, from, to, stage3StripSelection.width_mm);
      });
      const joiningRows = rows.filter(row => new Set(row.cellIds.map(find).filter(root => root !== null)).size > 1);
      return {
        axisIndex,
        rows: joiningRows,
        joinedComponents: joiningRows.reduce((sum, row) => sum + new Set(row.cellIds.map(find).filter(root => root !== null)).size, 0),
        coveredCells: new Set(joiningRows.flatMap(row => row.cellIds.map(String))).size,
        totalLength: joiningRows.reduce((sum, row) => sum + row.distance, 0)
      };
    };
    const axisPlan = allowedAxes.map(evaluateAxis).filter(plan => plan.rows.length).sort((a, b) =>
      b.joinedComponents - a.joinedComponents ||
      b.coveredCells - a.coveredCells ||
      a.totalLength - b.totalLength ||
      a.axisIndex - b.axisIndex
    )[0];

    if (axisPlan) {
      const orderedRows = stage3UniformMainRowOrder(axisPlan.rows);
      for (const row of orderedRows) {
        if (componentCount() <= 1) break;
        const roots = new Set(row.cellIds.map(find).filter(root => root !== null));
        if (roots.size < 2 || stage3LayoutHasConnection(layout, node.side, row.fromId, row.toId) || stage3RowAlreadyCovered(context, layout, node, row)) continue;
        const connection = stage3AddGeometricRow(context, layout, node, row, `${variantKey}-X`);
        if (!connection) continue;
        connection.generation_stage = "crosslink";
        connection.routing_group = `N${node.index}`;
        connection.crosslink_axis = axisPlan.axisIndex;
        joinConnection(connection);
        added++;
        if (onAdded) await onAdded(connection, { phase: "crosslink", nodeIndex: node.index, components: componentCount() });
      }
    }
    if (componentCount() > 1) issues.push(`${node.id}: połączenia poprzeczne nie zdołały scalić ${componentCount()} oddzielnych komponentów.`);
    return { valid: !issues.length, issues, added, components: componentCount(), axisIndex: axisPlan?.axisIndex ?? null };
  }

  async function stage3CompleteNodeCoverage(context, node, layout, variantKey, onAdded = null) {
    const terminalIds = node.terminals.map(terminal => String(terminal.id));
    const parent = new Map(terminalIds.map(id => [id, id]));
    const find = id => {
      const key = String(id);
      if (!parent.has(key)) return null;
      if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
      return parent.get(key);
    };
    const join = (left, right) => {
      const a = find(left), b = find(right);
      if (a !== null && b !== null && a !== b) parent.set(b, a);
    };
    const joinConnection = connection => {
      const ids = stage3ConnectionCellIds(connection, context.projected[node.side], context.radius).map(String).filter(id => parent.has(id));
      ids.slice(1).forEach(id => join(ids[0], id));
    };
    layout[node.side]
      .filter(connection => stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) === node.index)
      .forEach(joinConnection);
    const componentCount = () => new Set(terminalIds.map(find)).size;
    const componentSizes = () => terminalIds.reduce((sizes, id) => {
      const root = find(id);
      sizes.set(root, (sizes.get(root) || 0) + 1);
      return sizes;
    }, new Map());
    const remainingIds = () => {
      const sizes = componentSizes();
      const largestRoot = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return terminalIds.filter(id => find(id) !== largestRoot);
    };
    const issues = [];
    let added = 0;
    const rejectedRows = new Set();

    // Ostatni etap jest wyłącznie kontrolą kompletności. Nie tworzy skrótów
    // między pojedynczymi punktami: rozważa tylko pełne, maksymalnie długie
    // rzędy wykrytej siatki, które dołączają odłączony fragment do właściwego N.
    const candidateRows = (context.gridGeometry[node.side]?.axes || []).flatMap((_, axisIndex) =>
      stage3RowsForNodeAxis(context, node, axisIndex)
    );
    while (componentCount() > 1) {
      const sizes = componentSizes();
      const candidates = candidateRows.map(row => {
        if (rejectedRows.has(row.key)) return null;
        if (stage3LayoutHasConnection(layout, node.side, row.fromId, row.toId) || stage3RowAlreadyCovered(context, layout, node, row)) return null;
        const from = context.projected[node.side].get(row.fromId), to = context.projected[node.side].get(row.toId);
        if (!from || !to || stage3CandidateCollision(context, layout, node.side, node.index, from, to, stage3StripSelection.width_mm)) return null;
        const roots = new Set(row.cellIds.map(find).filter(root => root !== null));
        if (roots.size < 2) return null;
        return {
          row,
          roots,
          smallestJoinedComponent: Math.min(...[...roots].map(root => sizes.get(root) || 0)),
          cellCoverage: row.cellIds.length
        };
      }).filter(Boolean).sort((a, b) =>
        b.roots.size - a.roots.size ||
        a.smallestJoinedComponent - b.smallestJoinedComponent ||
        b.cellCoverage - a.cellCoverage ||
        b.row.distance - a.row.distance ||
        a.row.axisIndex - b.row.axisIndex
      );
      if (!candidates.length) break;
      const connection = stage3AddGeometricRow(context, layout, node, candidates[0].row, `${variantKey}-COMPLETE`);
      if (!connection) {
        rejectedRows.add(candidates[0].row.key);
        continue;
      }
      connection.generation_stage = "completion";
      connection.routing_group = `N${node.index}`;
      connection.completion_axis = candidates[0].row.axisIndex;
      joinConnection(connection);
      added++;
      if (onAdded) await onAdded(connection, { phase: "completion", nodeIndex: node.index, components: componentCount() });
    }
    const missing = remainingIds();
    if (missing.length) issues.push(`${node.id}: kontrola kompletności nie mogła dołączyć ${missing.length} ogniw do wspólnej grupy.`);
    return { valid: !issues.length, issues, added, components: componentCount(), missingIds: missing };
  }

  async function stage3BuildTwoStageVariant(context, variantIndex, strategy, lockedLayout, label, onAdded = null) {
    const layout = {
      front: lockedLayout.front.map(connection => ({ ...connection, ...stage3StripConnectionProperties() })),
      back: lockedLayout.back.map(connection => ({ ...connection, ...stage3StripConnectionProperties() }))
    };
    const emitAdded = onAdded ? (connection, details) => onAdded(layout, connection, details) : null;
    const nodes = stage3BuildElectricalNodes(context);
    const issues = [];
    const electricalWarnings = [];
    const mainAxisByNode = new Map();
    const mainReports = [];

    for (const node of nodes.filter(item => item.index > 0 && item.index < context.series)) {
      const axes = context.gridGeometry[node.side]?.axes || [];
      const plans = stage3RankMainAxisPlans(axes.map((_, axisIndex) => stage3MainAxisPlan(context, node, axisIndex, layout, variantIndex)));
      const usable = plans.filter(plan => plan.selected.length);
      const plan = usable[Math.min(variantIndex, Math.max(0, usable.length - 1))] || plans[0];
      if (!plan?.selected.length) {
        issues.push(`${node.id}: nie znaleziono żadnej legalnej magistrali przechodzącej pomiędzy obiema sekcjami.`);
        continue;
      }
      if (!plan.valid) electricalWarnings.push(`${node.id}: dostępna rodzina magistral zapewnia ${(plan.totalCapacityA || 0).toFixed(1)}/${(plan.requiredCurrentA || 0).toFixed(1)} A obliczonej przewodności.`);
      mainAxisByNode.set(node.index, plan.axisIndex);
      const installedRows = [];
      for (const row of plan.selected) {
        const connection = stage3AddGeometricRow(context, layout, node, row, `T${variantIndex + 1}-MAIN`);
        if (!connection) continue;
        connection.generation_stage = "main_bus";
        connection.routing_group = `S${node.index}↔S${node.index + 1}`;
        connection.passage_boundary = node.index;
        installedRows.push(row);
        if (emitAdded) await emitAdded(connection, { phase: "main", boundaryIndex: node.index, nodeIndex: node.index, axisIndex: plan.axisIndex });
      }
      const installedConnections = layout[node.side].filter(connection => connection.passage_boundary === node.index);
      const installedCapacityA = installedConnections.reduce((sum, connection) => {
        const from = context.projected[node.side].get(String(connection.from)), to = context.projected[node.side].get(String(connection.to));
        return sum + (from && to ? stage3FixedStripLimit(context, Math.hypot(to.px - from.px, to.py - from.py)).allowableCurrentA : 0);
      }, 0);
      if (installedCapacityA < plan.requiredCurrentA) electricalWarnings.push(`${node.id}: faktycznie dodane magistrale zapewniają ${installedCapacityA.toFixed(1)}/${plan.requiredCurrentA.toFixed(1)} A wymaganej przewodności.`);
      mainReports.push({ nodeIndex: node.index, ...plan, selected: installedRows, selectedCount: installedRows.length, installedCapacityA });
    }

    const crossReports = [];
    for (const node of nodes) {
      const result = await stage3BuildMinimalCrosslinks(context, node, layout, mainAxisByNode.get(node.index), `T${variantIndex + 1}`, emitAdded);
      crossReports.push({ nodeIndex: node.index, ...result });
    }

    const completionReports = [];
    for (const node of nodes) {
      const result = await stage3CompleteNodeCoverage(context, node, layout, `T${variantIndex + 1}`, emitAdded);
      completionReports.push({ nodeIndex: node.index, ...result });
      issues.push(...result.issues);
    }

    const geometryValidation = stage3ValidateGeometricLayout(context, layout, issues);
    const passagePlan = {
      geometric: true,
      twoStage: true,
      boundaries: mainReports.map(report => ({
        boundaryIndex: report.nodeIndex,
        nodeIndex: report.nodeIndex,
        side: nodes[report.nodeIndex]?.side,
        maximumPassages: stage3BoundaryPassageStats(context, report.nodeIndex, layout).count,
        minimumSeparation: context.settings.clearanceMm + stage3StripSelection.width_mm,
        preferredPositions: report.selected.map(row => row.parallelCoordinate),
        candidates: report.legalRows
      }))
    };
    const previousLeads = { negative: [...stage3MainLeads.negative], positive: [...stage3MainLeads.positive] };
    const previousLeadDiagnostics = stage3PackLeadDiagnostics;
    let packLeads = previousLeads;
    let packLeadDiagnostics = previousLeadDiagnostics;
    if (stage3PackPlacementMode === "automatic") {
      stage3ChooseAutomaticPackLeads(context, layout);
      packLeads = { negative: [...stage3MainLeads.negative], positive: [...stage3MainLeads.positive] };
      packLeadDiagnostics = stage3PackLeadDiagnostics;
    }
    const analysis = stage3OptimizeLayout(context, layout, strategy);
    const validation = stage3ValidateNickelLayout(context, layout, analysis, passagePlan);
    validation.diagnosticIssues = [...new Set([
      ...(validation.diagnosticIssues || []),
      ...(geometryValidation.issues || []),
      ...electricalWarnings,
      ...(stage3PackPlacementMode === "automatic" && (!packLeads.negative.length || !packLeads.positive.length)
        ? ["Nie znaleziono poprawnych punktów +PACK i −PACK na gotowej sieci."]
        : [])
    ])];
    const diagnostics = analysis ? stage3BoundaryDiagnostics(context, layout, passagePlan) : null;
    const profileScore = analysis ? stage3NormalizedProfileScore(context, analysis, diagnostics, strategy) : Number.POSITIVE_INFINITY;
    stage3MainLeads = previousLeads;
    stage3PackLeadDiagnostics = previousLeadDiagnostics;
    return {
      name: label,
      routeMode: `two-stage-${variantIndex + 1}`,
      layout,
      mainReports,
      crossReports,
      completionReports,
      nodeReports: mainReports,
      geometryValidation,
      validation,
      analysis,
      diagnostics,
      electricalWarnings,
      packLeads,
      packLeadDiagnostics,
      passagePlan,
      profileScore,
      score: profileScore,
      rank: [validation.valid ? 0 : 1, validation.issues.length, analysis?.metrics?.bottlenecks || 0, profileScore]
    };
  }

  function stage3ValidateAutomationInput(context) {
    if (!context) return { valid: false, issues: ["Brak pakietu lub przypisanych ogniw."] };
    const issues = [];
    if (context.series < 1) issues.push("Liczba sekcji musi być większa od zera.");
    const ids = context.cells.map(cell => String(cell.id));
    if (new Set(ids).size !== ids.length) issues.push("Wykryto powielone identyfikatory ogniw.");
    context.cells.forEach(cell => {
      if (!Number.isInteger(cell.section) || cell.section < 0 || cell.section >= context.series) issues.push(`Ogniwo ${cell.id} ma nieprawidłowe przypisanie sekcji.`);
    });
    if (context.sectionCounts.some(count => count === 0)) issues.push("Co najmniej jedna sekcja nie zawiera żadnego ogniwa.");
    const nodes = stage3BuildElectricalNodes(context);
    nodes.forEach(node => {
      const sides = new Set(node.terminals.map(terminal => terminal.side));
      if (!node.terminals.length) issues.push(`${node.id} nie ma żadnego fizycznego bieguna.`);
      if (sides.size !== 1) issues.push(`${node.id} wymaga niedozwolonego przejścia pomiędzy stronami pakietu.`);
    });
    if (!stage3ActiveStripMaterial() || !stage3StripCatalog.presets.length) issues.push("Brak prawidłowych danych materiału lub rozmiarów taśmy.");
    if (!stage3CellModel || !(stage3CellModel.dcir_at_current_soh_mohm > 0)) issues.push("Model elektryczny ogniwa jest niekompletny.");
    return { valid: !issues.length, issues, nodes };
  }

  function stage3SegmentsIntersect(a, b, c, d) {
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    return ((abC > 1e-7 && abD < -1e-7) || (abC < -1e-7 && abD > 1e-7)) && ((cdA > 1e-7 && cdB < -1e-7) || (cdA < -1e-7 && cdB > 1e-7));
  }

  function stage3SegmentsTooClose(a, b, c, d, clearance) {
    if (stage3SegmentsIntersect(a, b, c, d)) return true;
    return Math.min(edgeDistance(a, c, d), edgeDistance(b, c, d), edgeDistance(c, a, b), edgeDistance(d, a, b)) < clearance;
  }

  function stage3ConnectionNodeIndex(connection, side, projected) {
    if (Number.isInteger(connection.electrical_node)) return connection.electrical_node;
    const from = projected.get(String(connection.from));
    return from && Number.isInteger(from.section) ? stage3ElectricalNodeForCell(side, from.section) : null;
  }

  function stage3CandidateCollision(context, layout, side, nodeIndex, from, to, candidateWidth) {
    const clearance = context.settings.clearanceMm;
    const maximumCatalogWidth = Math.max(stage3StripSelection.width_mm, ...stage3StripCatalog.presets.map(preset => preset.width_mm || 0));
    for (const connection of layout[side]) {
      const projected = context.projected[side];
      const a = projected.get(String(connection.from)), b = projected.get(String(connection.to));
      if (!a || !b || stage3ConnectionNodeIndex(connection, side, projected) === nodeIndex) continue;
      const existingWidth = connection.locked ? (connection.strip_width_mm || stage3StripSelection.width_mm) : maximumCatalogWidth;
      const required = clearance + (candidateWidth + existingWidth) / 2;
      if (stage3SegmentsTooClose({ x: from.px, y: from.py }, { x: to.px, y: to.py }, { x: a.px, y: a.py }, { x: b.px, y: b.py }, required)) return connection;
    }
    return null;
  }

  function stage3NodeCandidates(context, node, layout) {
    const projected = context.projected[node.side];
    const candidates = [];
    for (let left = 0; left < node.terminals.length; left++) for (let right = left + 1; right < node.terminals.length; right++) {
      const from = projected.get(String(node.terminals[left].id)), to = projected.get(String(node.terminals[right].id));
      if (!from || !to || !stage3DirectionMatchesDetectedGrid(context, node.side, from, to)) continue;
      const touchedCellIds = stage3TouchedCellIds(from, to, projected, context.radius).map(String);
      if (touchedCellIds.length < 2) continue;
      if (!stage3CandidateFollowsContinuousGridRow(context, node.side, from, to, touchedCellIds)) continue;
      const touchedNodes = new Set(touchedCellIds.map(id => {
        const cell = projected.get(id);
        return cell ? stage3ElectricalNodeForCell(node.side, cell.section) : null;
      }));
      if (touchedNodes.size !== 1 || !touchedNodes.has(node.index)) continue;
      if (stage3CandidateCollision(context, layout, node.side, node.index, from, to, Math.max(stage3StripSelection.width_mm, ...stage3StripCatalog.presets.map(preset => preset.width_mm || 0)))) continue;
      const distance = Math.hypot(from.px - to.px, from.py - to.py);
      const sections = [...new Set(touchedCellIds.map(id => projected.get(id)?.section).filter(Number.isInteger))];
      candidates.push({
        fromId: String(from.id), toId: String(to.id), touchedCellIds, distance, sections,
        midpoint: { x: (from.px + to.px) / 2, y: (from.py + to.py) / 2 },
        score: distance / Math.max(1, touchedCellIds.length - 1)
      });
    }
    return candidates.sort((a, b) => a.score - b.score || a.distance - b.distance);
  }

  function stage3LayoutHasConnection(layout, side, fromId, toId) {
    const key = [String(fromId), String(toId)].sort().join(":");
    return layout[side].some(connection => [String(connection.from), String(connection.to)].sort().join(":") === key);
  }

  function stage3CandidateCoveredByNodeTape(context, layout, side, nodeIndex, candidate) {
    const required = new Set(candidate.touchedCellIds.map(String));
    return layout[side].some(connection => {
      if (stage3ConnectionNodeIndex(connection, side, context.projected[side]) !== nodeIndex) return false;
      const existing = new Set(stage3ConnectionCellIds(connection, context.projected[side], context.radius).map(String));
      return [...required].every(id => existing.has(id));
    });
  }

  function stage3BoundaryGeometry(context, boundaryIndex) {
    if (boundaryIndex < 1 || boundaryIndex >= context.series) return null;
    const node = stage3BuildElectricalNodes(context)[boundaryIndex];
    if (!node) return null;
    const lower = node.terminals.filter(terminal => terminal.section === boundaryIndex - 1);
    const upper = node.terminals.filter(terminal => terminal.section === boundaryIndex);
    if (!lower.length || !upper.length) return null;
    const centroid = terminals => ({
      x: terminals.reduce((sum, terminal) => sum + terminal.px, 0) / terminals.length,
      y: terminals.reduce((sum, terminal) => sum + terminal.py, 0) / terminals.length
    });
    const a = centroid(lower), b = centroid(upper);
    const length = Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y));
    const normal = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const tangent = { x: -normal.y, y: normal.x };
    return { boundaryIndex, node, side: node.side, lower, upper, midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, normal, tangent };
  }

  function stage3BoundaryIntersection(context, geometry, fromId, toId) {
    const projected = context.projected[geometry.side];
    const from = projected.get(String(fromId)), to = projected.get(String(toId));
    if (!from || !to) return null;
    const signed = point => (point.px - geometry.midpoint.x) * geometry.normal.x + (point.py - geometry.midpoint.y) * geometry.normal.y;
    const fromDistance = signed(from), toDistance = signed(to);
    const denominator = fromDistance - toDistance;
    let t = Math.abs(denominator) > 1e-9 ? fromDistance / denominator : .5;
    if (!Number.isFinite(t) || t < 0 || t > 1) t = .5;
    const point = { x: from.px + (to.px - from.px) * t, y: from.py + (to.py - from.py) * t };
    return { point, coordinate: (point.x - geometry.midpoint.x) * geometry.tangent.x + (point.y - geometry.midpoint.y) * geometry.tangent.y };
  }

  function stage3BoundaryCandidateRecord(context, geometry, candidate) {
    const intersection = stage3BoundaryIntersection(context, geometry, candidate.fromId, candidate.toId);
    return intersection ? { ...candidate, ...intersection } : null;
  }

  function stage3MaximumSeparatedRecords(records, minimumGap) {
    const selected = [];
    [...records].sort((a, b) =>
      a.coordinate - b.coordinate ||
      b.touchedCellIds.length - a.touchedCellIds.length ||
      b.distance - a.distance
    ).forEach(record => {
      if (!selected.length || record.coordinate - selected[selected.length - 1].coordinate >= minimumGap) selected.push(record);
    });
    return selected;
  }

  function stage3BoundaryPassageStats(context, boundaryIndex, layout) {
    const geometry = stage3BoundaryGeometry(context, boundaryIndex);
    if (!geometry) return { boundaryIndex, count: 0, crossings: [], currentImbalance: 0, spacingPenalty: 1 };
    const projected = context.projected[geometry.side];
    const crossings = layout[geometry.side].map(connection => {
      if (stage3ConnectionNodeIndex(connection, geometry.side, projected) !== boundaryIndex) return null;
      const sections = stage3SectionsForCellIds(stage3ConnectionCellIds(connection, projected, context.radius), projected);
      if (!sections.includes(boundaryIndex - 1) || !sections.includes(boundaryIndex)) return null;
      const intersection = stage3BoundaryIntersection(context, geometry, connection.from, connection.to);
      return intersection ? { ...intersection, connection, width: connection.strip_width_mm || stage3StripSelection.width_mm, currentA: connection.current_max_A || 0 } : null;
    }).filter(Boolean).sort((a, b) => a.coordinate - b.coordinate);
    const clusters = [];
    crossings.forEach(crossing => {
      const previous = clusters[clusters.length - 1];
      const requiredGap = context.settings.clearanceMm + Math.max(crossing.width, previous?.width || 0);
      if (!previous || crossing.coordinate - previous.coordinate >= requiredGap) {
        clusters.push({ ...crossing, connections: [crossing.connection], currents: [crossing.currentA] });
      } else {
        previous.connections.push(crossing.connection);
        previous.currents.push(crossing.currentA);
        previous.currentA = Math.max(previous.currentA, crossing.currentA);
        previous.width = Math.max(previous.width, crossing.width);
      }
    });
    const currents = clusters.map(cluster => cluster.currents.reduce((sum, current) => sum + Math.abs(current), 0));
    const averageCurrent = currents.reduce((sum, current) => sum + current, 0) / Math.max(1, currents.length);
    const currentImbalance = averageCurrent > 1e-9 ? (Math.max(...currents) - Math.min(...currents)) / averageCurrent : 0;
    const gaps = clusters.slice(1).map((cluster, index) => cluster.coordinate - clusters[index].coordinate);
    const averageGap = gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(1, gaps.length);
    const spacingPenalty = gaps.length > 1 && averageGap > 1e-9 ? Math.sqrt(gaps.reduce((sum, gap) => sum + (gap - averageGap) ** 2, 0) / gaps.length) / averageGap : 0;
    return { boundaryIndex, geometry, count: clusters.length, crossings, clusters, currentImbalance, spacingPenalty };
  }

  function stage3CreateGlobalPassagePlan(context, lockedLayout) {
    const boundaries = [];
    const nodes = stage3BuildElectricalNodes(context);
    for (let boundaryIndex = 1; boundaryIndex < context.series; boundaryIndex++) {
      const geometry = stage3BoundaryGeometry(context, boundaryIndex);
      const node = nodes[boundaryIndex];
      if (!geometry || !node) continue;
      const candidates = stage3NodeCandidates(context, node, lockedLayout)
        .filter(candidate => candidate.sections.includes(boundaryIndex - 1) && candidate.sections.includes(boundaryIndex))
        .map(candidate => stage3BoundaryCandidateRecord(context, geometry, candidate)).filter(Boolean);
      const planningWidth = Math.max(1, stage3StripSelection.width_mm);
      const minimumSeparation = context.settings.clearanceMm + planningWidth;
      const maximumSelection = stage3MaximumSeparatedRecords(candidates, minimumSeparation);
      const lockedCount = stage3BoundaryPassageStats(context, boundaryIndex, lockedLayout).count;
      const maximumPassages = Math.max(lockedCount, maximumSelection.length);
      boundaries.push({
        boundaryIndex,
        nodeIndex: boundaryIndex,
        side: node.side,
        maximumPassages,
        minimumSeparation,
        candidates,
        preferredPositions: maximumSelection.map(record => record.coordinate),
        constrained: maximumPassages < Math.max(2, context.parallel)
      });
    }
    return {
      boundaries,
      averageMaximum: boundaries.reduce((sum, boundary) => sum + boundary.maximumPassages, 0) / Math.max(1, boundaries.length),
      createdAt: Date.now()
    };
  }

  function stage3SelectPassageSet(records, targetCount, minimumSeparation, mode, preferredPositions, bias = 0) {
    if (targetCount <= 0) return [];
    const sorted = [...records].sort((a, b) => a.coordinate - b.coordinate || a.distance - b.distance);
    const previous = sorted.map((record, index) => {
      let cursor = index - 1;
      while (cursor >= 0 && record.coordinate - sorted[cursor].coordinate < minimumSeparation) cursor--;
      return cursor;
    });
    const cost = record => {
      // Mostek ma przede wszystkim objąć jak najwięcej zgodnych biegunów po
      // obu stronach granicy. Pozostałe kryteria rozstrzygają dopiero remis.
      const coverageReward = record.touchedCellIds.length * 100000;
      if (mode === "shortest") return -coverageReward + record.distance;
      if (mode === "resistance") return -coverageReward + record.distance / Math.max(1, record.touchedCellIds.length);
      const spacing = preferredPositions.length ? Math.min(...preferredPositions.map(position => Math.abs(record.coordinate - position))) : 0;
      return -coverageReward + spacing * 10 + record.distance * .001 + Math.abs(Math.sin(record.coordinate * (bias + 1.31))) * .0001;
    };
    const rows = sorted.length + 1;
    const dp = Array.from({ length: rows }, () => Array(targetCount + 1).fill(Number.POSITIVE_INFINITY));
    const take = Array.from({ length: rows }, () => Array(targetCount + 1).fill(false));
    dp[0][0] = 0;
    for (let row = 1; row < rows; row++) {
      const recordIndex = row - 1;
      for (let count = 0; count <= targetCount; count++) {
        dp[row][count] = dp[row - 1][count];
        if (count === 0) continue;
        const previousRow = previous[recordIndex] + 1;
        const candidateCost = dp[previousRow][count - 1] + cost(sorted[recordIndex]);
        if (candidateCost < dp[row][count]) {
          dp[row][count] = candidateCost;
          take[row][count] = true;
        }
      }
    }
    if (!Number.isFinite(dp[rows - 1][targetCount])) return [];
    const selected = [];
    let row = rows - 1, count = targetCount;
    while (row > 0 && count > 0) {
      if (take[row][count]) {
        const recordIndex = row - 1;
        selected.push(sorted[recordIndex]);
        row = previous[recordIndex] + 1;
        count--;
      } else row--;
    }
    return selected.reverse();
  }

  function stage3AddPlannedPassages(context, layout, boundaryPlan, strategy, mode, bias, issues) {
    if (!boundaryPlan || boundaryPlan.maximumPassages < 1) {
      issues.push(`N${boundaryPlan?.nodeIndex ?? "?"}: nie znaleziono fizycznego korytarza przejścia pomiędzy sekcjami.`);
      return;
    }
    const node = stage3BuildElectricalNodes(context)[boundaryPlan.nodeIndex];
    const geometry = stage3BoundaryGeometry(context, boundaryPlan.boundaryIndex);
    const liveCandidates = stage3NodeCandidates(context, node, layout)
      .filter(candidate => candidate.sections.includes(boundaryPlan.boundaryIndex - 1) && candidate.sections.includes(boundaryPlan.boundaryIndex))
      .map(candidate => stage3BoundaryCandidateRecord(context, geometry, candidate)).filter(Boolean);
    const initialStats = stage3BoundaryPassageStats(context, boundaryPlan.boundaryIndex, layout);
    const remaining = Math.max(0, boundaryPlan.maximumPassages - initialStats.count);
    const available = liveCandidates.filter(candidate => initialStats.clusters.every(cluster => Math.abs(candidate.coordinate - cluster.coordinate) >= boundaryPlan.minimumSeparation));
    const selected = stage3SelectPassageSet(available, remaining, boundaryPlan.minimumSeparation, mode, boundaryPlan.preferredPositions, bias);
    for (const candidate of selected) {
      if (stage3LayoutHasConnection(layout, node.side, candidate.fromId, candidate.toId)) continue;
      const connection = stage3AddGeneratedConnection(layout, node.side, node.index, candidate, strategy);
      if (connection) connection.passage_boundary = boundaryPlan.boundaryIndex;
    }
  }

  async function stage3AddPlannedPassagesLive(context, layout, boundaryPlan, strategy, mode, bias, issues, onAdded = null) {
    if (!boundaryPlan || boundaryPlan.maximumPassages < 1) {
      issues.push(`N${boundaryPlan?.nodeIndex ?? "?"}: nie znaleziono fizycznego korytarza przejścia pomiędzy sekcjami.`);
      return;
    }
    const node = stage3BuildElectricalNodes(context)[boundaryPlan.nodeIndex];
    const geometry = stage3BoundaryGeometry(context, boundaryPlan.boundaryIndex);
    const liveCandidates = stage3NodeCandidates(context, node, layout)
      .filter(candidate => candidate.sections.includes(boundaryPlan.boundaryIndex - 1) && candidate.sections.includes(boundaryPlan.boundaryIndex))
      .map(candidate => stage3BoundaryCandidateRecord(context, geometry, candidate)).filter(Boolean);
    const initialStats = stage3BoundaryPassageStats(context, boundaryPlan.boundaryIndex, layout);
    const remaining = Math.max(0, boundaryPlan.maximumPassages - initialStats.count);
    const available = liveCandidates.filter(candidate => initialStats.clusters.every(cluster => Math.abs(candidate.coordinate - cluster.coordinate) >= boundaryPlan.minimumSeparation));
    const selected = stage3SelectPassageSet(available, remaining, boundaryPlan.minimumSeparation, mode, boundaryPlan.preferredPositions, bias);
    for (const candidate of selected) {
      if (stage3LayoutHasConnection(layout, node.side, candidate.fromId, candidate.toId)) continue;
      const connection = stage3AddGeneratedConnection(layout, node.side, node.index, candidate, strategy);
      if (!connection) continue;
      connection.passage_boundary = boundaryPlan.boundaryIndex;
      if (onAdded) await onAdded(connection, { phase: "boundary", boundaryIndex: boundaryPlan.boundaryIndex, nodeIndex: node.index });
    }
  }

  function stage3AddGeneratedConnection(layout, side, nodeIndex, candidate, strategy) {
    if (stage3LayoutHasConnection(layout, side, candidate.fromId, candidate.toId)) return null;
    const connection = {
      id: `${side}-${strategy}-N${nodeIndex}-${layout[side].length}-${Date.now()}`,
      from: candidate.fromId,
      to: candidate.toId,
      cellIds: candidate.touchedCellIds,
      electrical_node: nodeIndex,
      generated: true,
      locked: false,
      ...stage3StripConnectionProperties()
    };
    layout[side].push(connection);
    return connection;
  }

  function stage3OrderNodeRoutingCandidates(node, candidates, mode, bias = 0) {
    const cx = node.terminals.reduce((sum, terminal) => sum + terminal.px, 0) / Math.max(1, node.terminals.length);
    const cy = node.terminals.reduce((sum, terminal) => sum + terminal.py, 0) / Math.max(1, node.terminals.length);
    return [...candidates].sort((a, b) => {
      if (mode === "shortest") return a.distance - b.distance || a.score - b.score;
      if (mode === "resistance") return a.score - b.score || b.touchedCellIds.length - a.touchedCellIds.length || a.distance - b.distance;
      const radialA = Math.hypot(a.midpoint.x - cx, a.midpoint.y - cy);
      const radialB = Math.hypot(b.midpoint.x - cx, b.midpoint.y - cy);
      const jitterA = Math.abs(Math.sin((a.midpoint.x * .73 + a.midpoint.y) * (bias + 1))) * .01;
      const jitterB = Math.abs(Math.sin((b.midpoint.x * .73 + b.midpoint.y) * (bias + 1))) * .01;
      return a.score - b.score || radialA - radialB || jitterA - jitterB;
    });
  }

  function stage3CandidateAddsSeparatedPassage(context, boundaryIndex, candidate, layout, minimumSeparation) {
    const geometry = stage3BoundaryGeometry(context, boundaryIndex);
    const record = geometry ? stage3BoundaryCandidateRecord(context, geometry, candidate) : null;
    if (!record) return false;
    const stats = stage3BoundaryPassageStats(context, boundaryIndex, layout);
    return stats.clusters.every(cluster => Math.abs(record.coordinate - cluster.coordinate) >= minimumSeparation);
  }

  function stage3BuildNodeNetwork(context, node, layout, strategy, issues, targetPassages = null, routeMode = "uniform", bias = 0) {
    const profile = stage3StrategyProfile(strategy);
    const terminalIds = node.terminals.map(terminal => String(terminal.id));
    if (terminalIds.length <= 1) return;
    const parent = new Map(terminalIds.map(id => [id, id]));
    const find = id => {
      const key = String(id);
      if (!parent.has(key)) return null;
      if (parent.get(key) !== key) parent.set(key, find(parent.get(key)));
      return parent.get(key);
    };
    const join = (a, b) => {
      const rootA = find(a), rootB = find(b);
      if (rootA !== null && rootB !== null && rootA !== rootB) parent.set(rootB, rootA);
    };
    layout[node.side].filter(connection => stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) === node.index).forEach(connection => {
      const ids = stage3ConnectionCellIds(connection, context.projected[node.side], context.radius).map(String).filter(id => parent.has(id));
      ids.slice(1).forEach(id => join(ids[0], id));
    });
    const candidates = stage3OrderNodeRoutingCandidates(node, stage3NodeCandidates(context, node, layout), routeMode, bias);
    const isIntermediate = node.index > 0 && node.index < context.series;
    const passagePlan = stage3LastPassagePlan?.boundaries?.find(boundary => boundary.boundaryIndex === node.index);
    const minimumPassageSeparation = passagePlan?.minimumSeparation || context.settings.clearanceMm + stage3StripSelection.width_mm;
    for (const candidate of candidates) {
      const roots = new Set(candidate.touchedCellIds.map(find).filter(root => root !== null));
      if (roots.size <= 1) continue;
      if (isIntermediate && targetPassages !== null && candidate.sections.length === 2) {
        const currentPassages = stage3BoundaryPassageStats(context, node.index, layout).count;
        if (currentPassages >= targetPassages && stage3CandidateAddsSeparatedPassage(context, node.index, candidate, layout, minimumPassageSeparation)) continue;
      }
      const from = context.projected[node.side].get(candidate.fromId), to = context.projected[node.side].get(candidate.toId);
      if (stage3CandidateCollision(context, layout, node.side, node.index, from, to, Math.max(stage3StripSelection.width_mm, ...stage3StripCatalog.presets.map(preset => preset.width_mm || 0)))) continue;
      stage3AddGeneratedConnection(layout, node.side, node.index, candidate, strategy);
      const anchor = candidate.touchedCellIds.find(id => parent.has(id));
      candidate.touchedCellIds.filter(id => parent.has(id)).forEach(id => join(anchor, id));
      if (new Set(terminalIds.map(find)).size === 1) break;
    }
    if (new Set(terminalIds.map(find)).size > 1) {
      issues.push(`${node.id}: nie można utworzyć ciągłej magistrali zgodnej z kierunkami siatki i odstępem izolacyjnym.`);
      return;
    }

    const selectedForNode = () => layout[node.side].filter(connection => stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) === node.index);
    const activePreset = stage3ActiveStripPreset();
    const baseArea = Math.max(.01, (activePreset?.cross_section_mm2 || stage3StripSelection.width_mm * stage3StripSelection.thickness_mm));
    const capacityPerRoute = baseArea * context.settings.maxCurrentDensity / context.settings.safetyFactor;
    const bridgeCapacityTarget = Math.max(profile.minimumBridges, Math.ceil(context.maximumCurrentA / Math.max(.1, capacityPerRoute)));
    const bridgeLimit = isIntermediate ? Math.min(context.sectionCounts[node.index - 1], context.sectionCounts[node.index]) : 0;
    const bridgeTarget = targetPassages === null ? Math.max(1, Math.min(bridgeLimit || 1, bridgeCapacityTarget)) : Math.max(1, targetPassages);
    const degree = new Map(terminalIds.map(id => [id, 0]));
    const updateDegree = () => {
      degree.forEach((_, id) => degree.set(id, 0));
      selectedForNode().forEach(connection => stage3ConnectionCellIds(connection, context.projected[node.side], context.radius).map(String).filter(id => degree.has(id)).forEach(id => degree.set(id, degree.get(id) + 1)));
    };
    updateDegree();
    const bridgeCount = () => isIntermediate ? stage3BoundaryPassageStats(context, node.index, layout).count : 0;
    const extraLimit = Math.ceil(node.terminals.length * profile.redundancy);
    let extras = 0;
    if (isIntermediate && bridgeCount() < bridgeTarget) {
      const bridgeCandidates = candidates.filter(candidate => candidate.sections.length === 2);
      const xs = bridgeCandidates.map(candidate => candidate.midpoint.x), ys = bridgeCandidates.map(candidate => candidate.midpoint.y);
      const useX = xs.length && (Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys));
      const coordinate = candidate => useX ? candidate.midpoint.x : candidate.midpoint.y;
      const minimum = bridgeCandidates.length ? Math.min(...bridgeCandidates.map(coordinate)) : 0;
      const maximum = bridgeCandidates.length ? Math.max(...bridgeCandidates.map(coordinate)) : 0;
      const required = bridgeTarget - bridgeCount();
      for (let slot = 0; slot < required; slot++) {
        const target = required === 1 ? (minimum + maximum) / 2 : minimum + (maximum - minimum) * slot / (required - 1);
        const ranked = bridgeCandidates
          .filter(candidate => !stage3LayoutHasConnection(layout, node.side, candidate.fromId, candidate.toId) && !stage3CandidateCoveredByNodeTape(context, layout, node.side, node.index, candidate))
          .sort((a, b) => Math.abs(coordinate(a) - target) - Math.abs(coordinate(b) - target) || a.distance - b.distance);
        const candidate = ranked.find(item => {
          const from = context.projected[node.side].get(item.fromId), to = context.projected[node.side].get(item.toId);
          return !stage3CandidateCollision(context, layout, node.side, node.index, from, to, Math.max(stage3StripSelection.width_mm, ...stage3StripCatalog.presets.map(preset => preset.width_mm || 0)));
        });
        if (!candidate) continue;
        stage3AddGeneratedConnection(layout, node.side, node.index, candidate, strategy);
        extras++;
        updateDegree();
      }
    }
    const orderedExtras = [...candidates].sort((a, b) => {
      const aBridge = a.sections.length === 2 ? -1 : 0, bBridge = b.sections.length === 2 ? -1 : 0;
      return aBridge - bBridge || a.score - b.score;
    });
    for (const candidate of orderedExtras) {
      if (stage3LayoutHasConnection(layout, node.side, candidate.fromId, candidate.toId) || stage3CandidateCoveredByNodeTape(context, layout, node.side, node.index, candidate)) continue;
      if (isIntermediate && candidate.sections.length === 2 && bridgeCount() >= bridgeTarget && stage3CandidateAddsSeparatedPassage(context, node.index, candidate, layout, minimumPassageSeparation)) continue;
      const needsBridge = isIntermediate && bridgeCount() < bridgeTarget && candidate.sections.length === 2;
      const needsDegree = candidate.touchedCellIds.some(id => (degree.get(String(id)) || 0) < profile.minimumDegree);
      if (!needsBridge && (!needsDegree || extras >= extraLimit)) continue;
      const from = context.projected[node.side].get(candidate.fromId), to = context.projected[node.side].get(candidate.toId);
      if (stage3CandidateCollision(context, layout, node.side, node.index, from, to, Math.max(stage3StripSelection.width_mm, ...stage3StripCatalog.presets.map(preset => preset.width_mm || 0)))) continue;
      stage3AddGeneratedConnection(layout, node.side, node.index, candidate, strategy);
      extras++;
      updateDegree();
      if (extras >= extraLimit && (!isIntermediate || bridgeCount() >= bridgeTarget)) break;
    }
    if (isIntermediate && bridgeCount() < bridgeTarget) issues.push(`${node.id}: utworzono ${bridgeCount()} z ${bridgeTarget} wymaganych rozłożonych dróg pomiędzy S${node.index} i S${node.index + 1}.`);
  }

  function stage3ConnectionResistanceOhm(connection, lengthMm) {
    const material = stage3StripCatalog.materials[connection.strip_material_id] || stage3ActiveStripMaterial();
    const resistivity = material?.electrical_resistivity_ohm_m?.nominal;
    const width = Math.max(.01, connection.strip_width_mm || stage3StripSelection.width_mm);
    const thickness = Math.max(.001, connection.strip_thickness_mm || stage3StripSelection.thickness_mm);
    const layers = Math.max(1, connection.strip_layers || 1);
    if (!Number.isFinite(resistivity)) return 1e-3;
    return Math.max(1e-9, resistivity * (lengthMm / 1000) / (width * thickness * layers * 1e-6));
  }

  function stage3ExpandedNodeEdges(context, node, layout) {
    const projected = context.projected[node.side];
    const edges = [];
    layout[node.side].filter(connection => stage3ConnectionNodeIndex(connection, node.side, projected) === node.index).forEach(connection => {
      const from = projected.get(String(connection.from)), to = projected.get(String(connection.to));
      if (!from || !to) return;
      const dx = to.px - from.px, dy = to.py - from.py;
      const denominator = Math.max(1e-9, dx * dx + dy * dy);
      const ids = stage3ConnectionCellIds(connection, projected, context.radius).map(String).filter(id => stage3ElectricalNodeForCell(node.side, projected.get(id)?.section) === node.index);
      const ordered = [...new Set(ids)].sort((a, b) => {
        const pa = projected.get(a), pb = projected.get(b);
        return (((pa.px - from.px) * dx + (pa.py - from.py) * dy) - ((pb.px - from.px) * dx + (pb.py - from.py) * dy)) / denominator;
      });
      for (let index = 1; index < ordered.length; index++) {
        const a = projected.get(ordered[index - 1]), b = projected.get(ordered[index]);
        const lengthMm = Math.hypot(a.px - b.px, a.py - b.py);
        if (lengthMm < 1e-6) continue;
        edges.push({ a: ordered[index - 1], b: ordered[index], resistance: stage3ConnectionResistanceOhm(connection, lengthMm), lengthMm, connection });
      }
    });
    return edges;
  }

  function stage3SolveLinearSystem(matrix, vector) {
    const size = vector.length;
    const rows = matrix.map((row, index) => [...row, vector[index]]);
    for (let column = 0; column < size; column++) {
      let pivot = column;
      for (let row = column + 1; row < size; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
      if (Math.abs(rows[pivot][column]) < 1e-12) return null;
      [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
      const divisor = rows[column][column];
      for (let cursor = column; cursor <= size; cursor++) rows[column][cursor] /= divisor;
      for (let row = 0; row < size; row++) {
        if (row === column) continue;
        const factor = rows[row][column];
        if (Math.abs(factor) < 1e-16) continue;
        for (let cursor = column; cursor <= size; cursor++) rows[row][cursor] -= factor * rows[column][cursor];
      }
    }
    return rows.map(row => row[size]);
  }

  function stage3CentralTerminalIds(node, count) {
    const cx = node.terminals.reduce((sum, terminal) => sum + terminal.px, 0) / Math.max(1, node.terminals.length);
    const cy = node.terminals.reduce((sum, terminal) => sum + terminal.py, 0) / Math.max(1, node.terminals.length);
    return [...node.terminals].sort((a, b) => Math.hypot(a.px - cx, a.py - cy) - Math.hypot(b.px - cx, b.py - cy)).slice(0, Math.max(1, Math.min(count, node.terminals.length))).map(terminal => String(terminal.id));
  }

  function stage3PackLeadCandidates(context, node, layout) {
    const connected = new Set(layout[node.side].filter(connection => stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) === node.index)
      .flatMap(connection => stage3ConnectionCellIds(connection, context.projected[node.side], context.radius).map(String)));
    return node.terminals.filter(terminal => connected.has(String(terminal.id)));
  }

  function stage3ScorePackLead(context, node, layout, terminal) {
    const result = stage3SolveNodeFlow(context, node, layout, context.maximumCurrentA, 1, [String(terminal.id)]);
    if (!result.valid) return { valid: false, score: Number.POSITIVE_INFINITY, terminal };
    const currents = result.edges.map(edge => Math.abs(edge.currentA || 0));
    const losses = result.edges.reduce((sum, edge) => sum + (edge.powerW || 0), 0);
    const maximumDropV = Math.max(0, ...result.edges.map(edge => edge.dropV || 0));
    const potentials = [...result.potentials.values()];
    const pathSpreadV = potentials.length ? Math.max(...potentials) - Math.min(...potentials) : 0;
    const maximumTemperatureC = Math.max(context.settings.ambientC, ...result.edges.map(edge => {
      const width = edge.connection?.strip_width_mm || stage3StripSelection.width_mm;
      return context.settings.ambientC + (edge.powerW || 0) * Math.max(4, 42 / Math.max(1, width));
    }));
    const points = [...context.projected[node.side].values()];
    const minX = Math.min(...points.map(point => point.px)), maxX = Math.max(...points.map(point => point.px));
    const minY = Math.min(...points.map(point => point.py)), maxY = Math.max(...points.map(point => point.py));
    const edgeDistanceMm = Math.min(terminal.px - minX, maxX - terminal.px, terminal.py - minY, maxY - terminal.py);
    const maximumCurrentA = Math.max(0, ...currents);
    const score = maximumCurrentA * 12 + losses * 240 + maximumDropV * 8000 + pathSpreadV * 4000 + maximumTemperatureC * 2 + edgeDistanceMm * .08;
    return { valid: true, score, terminal, maximumCurrentA, losses, maximumDropV, pathSpreadV, maximumTemperatureC, edgeDistanceMm };
  }

  function stage3ChooseAutomaticPackLeads(context, layout) {
    const nodes = stage3BuildElectricalNodes(context);
    const choose = node => stage3PackLeadCandidates(context, node, layout)
      .map(terminal => stage3ScorePackLead(context, node, layout, terminal))
      .filter(result => result.valid)
      .sort((a, b) => a.score - b.score)[0] || null;
    const negative = choose(nodes[0]);
    const positive = choose(nodes[nodes.length - 1]);
    stage3MainLeads = {
      negative: negative ? [String(negative.terminal.id)] : [],
      positive: positive ? [String(positive.terminal.id)] : []
    };
    stage3PackLeadDiagnostics = { negative, positive };
    return { negative, positive };
  }

  function stage3SetManualPackLead(context, layout, side, cellId, target) {
    if (target !== "negative" && target !== "positive") return { valid: false, message: "Najpierw wybierz kafelek −PACK albo +PACK." };
    const cell = context.projected[side].get(String(cellId));
    if (!cell) return { valid: false, message: "Nie znaleziono wybranego bieguna." };
    const nodeIndex = stage3ElectricalNodeForCell(side, cell.section);
    if (nodeIndex !== 0 && nodeIndex !== context.series) return { valid: false, message: "Punkt PACK można umieścić tylko na skrajnym węźle N0 albo NS." };
    const expectedNode = target === "negative" ? 0 : context.series;
    if (nodeIndex !== expectedNode) return { valid: false, message: `Wybrano ${target === "negative" ? "−PACK" : "+PACK"}. Wskaż podświetloną, właściwą sekcję pakietu.` };
    const node = stage3BuildElectricalNodes(context)[nodeIndex];
    if (!node || node.side !== side) return { valid: false, message: "Wybrano niewłaściwą stronę pakietu." };
    if (!stage3PackLeadCandidates(context, node, layout).some(terminal => String(terminal.id) === String(cellId))) {
      return { valid: false, message: "Wybrany biegun nie jest połączony z gotową magistralą." };
    }
    const diagnostic = stage3ScorePackLead(context, node, layout, cell);
    if (!diagnostic.valid) return { valid: false, message: "Dla wybranego punktu nie można rozwiązać rozpływu prądu." };
    const bestAutomatic = stage3PackLeadCandidates(context, node, layout).map(terminal => stage3ScorePackLead(context, node, layout, terminal))
      .filter(result => result.valid).sort((a, b) => a.score - b.score)[0];
    const warning = bestAutomatic && diagnostic.score > bestAutomatic.score * 1.15
      ? "Wybrany punkt jest elektrycznie poprawny, ale wyraźnie gorszy od punktu automatycznego."
      : "";
    if (nodeIndex === 0) {
      stage3MainLeads.negative = [String(cellId)];
      stage3PackLeadDiagnostics.negative = diagnostic;
    } else {
      stage3MainLeads.positive = [String(cellId)];
      stage3PackLeadDiagnostics.positive = diagnostic;
    }
    return { valid: true, nodeIndex, diagnostic, warning };
  }

  function stage3SolveNodeFlow(context, node, layout, currentA, leadPointCount, explicitLeadIds = null) {
    const ids = node.terminals.map(terminal => String(terminal.id));
    const indexById = new Map(ids.map((id, index) => [id, index]));
    const edges = stage3ExpandedNodeEdges(context, node, layout);
    const injections = Array(ids.length).fill(0);
    const perCell = currentA / Math.max(1, context.parallel);
    let leadIds = [];
    if (node.index === 0 || node.index === context.series) {
      ids.forEach((_, index) => { injections[index] += perCell; });
      const configured = node.index === 0 ? stage3MainLeads.negative : stage3MainLeads.positive;
      leadIds = (explicitLeadIds || configured || []).map(String).filter(id => indexById.has(id));
      if (!leadIds.length) leadIds = stage3CentralTerminalIds(node, leadPointCount);
      leadIds.forEach(id => { injections[indexById.get(id)] -= currentA / leadIds.length; });
    } else {
      node.terminals.forEach(terminal => {
        const direction = terminal.section === node.index - 1 ? 1 : -1;
        injections[indexById.get(String(terminal.id))] += direction * perCell;
      });
    }
    if (ids.length === 1) return { valid: true, edges: [], potentials: new Map([[ids[0], 0]]), leadIds };
    const ground = ids.length - 1;
    const matrix = Array.from({ length: ground }, () => Array(ground).fill(0));
    const vector = injections.slice(0, ground);
    edges.forEach(edge => {
      const a = indexById.get(edge.a), b = indexById.get(edge.b);
      if (a === undefined || b === undefined) return;
      const conductance = 1 / Math.max(1e-12, edge.resistance);
      if (a !== ground) matrix[a][a] += conductance;
      if (b !== ground) matrix[b][b] += conductance;
      if (a !== ground && b !== ground) { matrix[a][b] -= conductance; matrix[b][a] -= conductance; }
    });
    const solution = stage3SolveLinearSystem(matrix, vector);
    if (!solution) return { valid: false, edges, potentials: new Map(), leadIds };
    const potentials = new Map(ids.map((id, index) => [id, index === ground ? 0 : solution[index]]));
    edges.forEach(edge => {
      edge.currentA = (potentials.get(edge.a) - potentials.get(edge.b)) / edge.resistance;
      edge.powerW = edge.currentA * edge.currentA * edge.resistance;
      edge.dropV = Math.abs(edge.currentA * edge.resistance);
    });
    return { valid: true, edges, potentials, leadIds };
  }

  function stage3AggregateFlow(results) {
    const aggregate = new Map();
    results.forEach(result => result.edges.forEach(edge => {
      const current = Math.abs(edge.currentA || 0);
      const item = aggregate.get(edge.connection.id) || { maxCurrentA: 0, powerW: 0, maxDropV: 0 };
      item.maxCurrentA = Math.max(item.maxCurrentA, current);
      item.powerW += edge.powerW || 0;
      item.maxDropV = Math.max(item.maxDropV, edge.dropV || 0);
      aggregate.set(edge.connection.id, item);
    }));
    return aggregate;
  }

  function stage3AnalyzeImbalance(context, maximumResults) {
    const potentialsByNode = new Map(maximumResults.map((result, index) => [index, result.potentials]));
    const cellCurrent = context.maximumCurrentA / Math.max(1, context.parallel);
    const cellDcirOhm = Math.max(1e-6, (stage3CellModel?.dcir_at_current_soh_mohm || 20) / 1000);
    let maximumCurrentImbalance = 0, maximumPathImbalance = 0;
    for (let section = 0; section < context.series; section++) {
      const sectionCells = context.cells.filter(cell => cell.section === section);
      const negative = potentialsByNode.get(section) || new Map();
      const positive = potentialsByNode.get(section + 1) || new Map();
      const negativeValues = sectionCells.map(cell => negative.get(String(cell.id)) || 0);
      const positiveValues = sectionCells.map(cell => positive.get(String(cell.id)) || 0);
      const negativeMean = negativeValues.reduce((sum, value) => sum + value, 0) / Math.max(1, negativeValues.length);
      const positiveMean = positiveValues.reduce((sum, value) => sum + value, 0) / Math.max(1, positiveValues.length);
      const paths = sectionCells.map((cell, index) => (Math.abs(negativeValues[index] - negativeMean) + Math.abs(positiveValues[index] - positiveMean)) / Math.max(.001, cellCurrent));
      const effective = paths.map(path => cellDcirOhm + path);
      const conductances = effective.map(resistance => 1 / resistance);
      const conductanceSum = conductances.reduce((sum, value) => sum + value, 0);
      const currents = conductances.map(value => context.maximumCurrentA * value / Math.max(1e-12, conductanceSum));
      const averageCurrent = currents.reduce((sum, value) => sum + value, 0) / Math.max(1, currents.length);
      const averagePath = paths.reduce((sum, value) => sum + value, 0) / Math.max(1, paths.length);
      if (averageCurrent > 0) maximumCurrentImbalance = Math.max(maximumCurrentImbalance, (Math.max(...currents) - Math.min(...currents)) / averageCurrent);
      if (averagePath > 1e-12) maximumPathImbalance = Math.max(maximumPathImbalance, (Math.max(...paths) - Math.min(...paths)) / averagePath);
    }
    return { currentImbalance: maximumCurrentImbalance, pathResistanceImbalance: maximumPathImbalance };
  }

  function stage3AnalyzeLayout(context, layout, strategy) {
    const profile = stage3StrategyProfile(strategy);
    const nodes = stage3BuildElectricalNodes(context);
    const nominalResults = nodes.map(node => stage3SolveNodeFlow(context, node, layout, context.nominalCurrentA, profile.leadPoints));
    const maximumResults = nodes.map(node => stage3SolveNodeFlow(context, node, layout, context.maximumCurrentA, profile.leadPoints));
    const nominal = stage3AggregateFlow(nominalResults);
    const maximum = stage3AggregateFlow(maximumResults);
    const metrics = { totalLengthMm: 0, totalMassG: 0, nominalLossW: 0, maximumLossW: 0, maximumTemperatureC: context.settings.ambientC, maximumDropMv: 0, bottlenecks: 0, segmentCount: 0, layerCount: 0 };
    ["front", "back"].forEach(side => layout[side].forEach(connection => {
      const from = context.projected[side].get(String(connection.from)), to = context.projected[side].get(String(connection.to));
      if (!from || !to) return;
      const lengthMm = Math.hypot(from.px - to.px, from.py - to.py);
      const maxFlow = maximum.get(connection.id) || { maxCurrentA: 0, powerW: 0, maxDropV: 0 };
      const nominalFlow = nominal.get(connection.id) || { maxCurrentA: 0, powerW: 0, maxDropV: 0 };
      const width = Math.max(.01, connection.strip_width_mm || stage3StripSelection.width_mm);
      const thickness = Math.max(.001, connection.strip_thickness_mm || stage3StripSelection.thickness_mm);
      const layers = Math.max(1, connection.strip_layers || 1);
      const area = width * thickness * layers;
      const material = stage3StripCatalog.materials[connection.strip_material_id] || stage3ActiveStripMaterial();
      const density = material?.density_kg_m3 || 8900;
      const currentDensity = maxFlow.maxCurrentA / Math.max(.001, area);
      const thermalResistance = Math.max(4, 42 / Math.max(1, width * layers));
      const temperature = context.settings.ambientC + maxFlow.powerW * thermalResistance;
      const resistanceMohm = stage3ConnectionResistanceOhm(connection, lengthMm) * 1000;
      const bottleneck = currentDensity > context.settings.maxCurrentDensity || maxFlow.maxDropV * 1000 > context.settings.maxDropMv || temperature > context.settings.maxTemperatureC;
      Object.assign(connection, {
        electrical_node: stage3ConnectionNodeIndex(connection, side, context.projected[side]),
        length_mm: lengthMm,
        resistance_mohm: resistanceMohm,
        current_nominal_A: nominalFlow.maxCurrentA,
        current_max_A: maxFlow.maxCurrentA,
        current_density_A_mm2: currentDensity,
        voltage_drop_mV: maxFlow.maxDropV * 1000,
        power_loss_nominal_W: nominalFlow.powerW,
        power_loss_max_W: maxFlow.powerW,
        predicted_temperature_C: temperature,
        bottleneck
      });
      metrics.totalLengthMm += lengthMm * layers;
      metrics.totalMassG += lengthMm * width * thickness * layers * density * 1e-6;
      metrics.nominalLossW += nominalFlow.powerW;
      metrics.maximumLossW += maxFlow.powerW;
      metrics.maximumTemperatureC = Math.max(metrics.maximumTemperatureC, temperature);
      metrics.maximumDropMv = Math.max(metrics.maximumDropMv, maxFlow.maxDropV * 1000);
      metrics.bottlenecks += bottleneck ? 1 : 0;
      metrics.segmentCount++;
      metrics.layerCount += layers;
    }));
    const imbalance = stage3AnalyzeImbalance(context, maximumResults);
    Object.assign(metrics, imbalance);
    const invalidFlow = maximumResults.some(result => !result.valid) || nominalResults.some(result => !result.valid);
    const asymmetryPenalty = metrics.currentImbalance * 100 + metrics.pathResistanceImbalance * 35;
    metrics.score = metrics.maximumLossW * 160 + Math.max(0, metrics.maximumTemperatureC - context.settings.ambientC) * 5 + asymmetryPenalty * profile.balanceWeight + metrics.totalLengthMm * .018 * profile.lengthWeight + metrics.segmentCount * 1.5 + metrics.bottlenecks * 10000;
    metrics.quality = invalidFlow ? 0 : Math.max(0, Math.min(100, 100 / (1 + metrics.score / 650)));
    return { metrics, nominalResults, maximumResults, invalidFlow, nodes };
  }

  function stage3SelectUniformStripForLayout(context, layout, strategy) {
    const materialId = stage3StripSelection.materialId;
    const material = stage3StripCatalog.materials[materialId] || stage3ActiveStripMaterial();
    const presets = stage3StripCatalog.presets.slice().sort((a, b) => (a.width_mm * a.thickness_mm) - (b.width_mm * b.thickness_mm));
    const connections = ["front", "back"].flatMap(side => layout[side]);
    if (!connections.length || !material || !presets.length) return { analysis: stage3AnalyzeLayout(context, layout, strategy), profile: stage3StripConnectionProperties(), feasible: false };
    const applyProfile = preset => {
      const profile = { strip_material_id: materialId, strip_preset_id: preset.id, strip_width_mm: preset.width_mm, strip_thickness_mm: preset.thickness_mm, strip_layers: 1 };
      connections.forEach(connection => Object.assign(connection, profile));
      return profile;
    };
    // Najpierw liczony jest najmniejszy profil. Na podstawie jego rzeczywistych
    // przeciążeń wybieramy pierwszy kandydat o wystarczającym przekroju, zamiast
    // wykonywać pełną analizę dla wszystkich rozmiarów przy każdej iteracji.
    const smallestProfile = applyProfile(presets[0]);
    const smallestAnalysis = stage3AnalyzeLayout(context, layout, strategy);
    const requiredAreaScale = Math.max(1, ...connections.map(connection => {
      const densityRatio = (connection.current_density_A_mm2 || 0) / Math.max(.001, context.settings.maxCurrentDensity);
      const dropRatio = (connection.voltage_drop_mV || 0) / Math.max(.001, context.settings.maxDropMv);
      const thermalRise = Math.max(0, (connection.predicted_temperature_C || context.settings.ambientC) - context.settings.ambientC);
      const allowedRise = Math.max(.001, context.settings.maxTemperatureC - context.settings.ambientC);
      return Math.max(densityRatio, dropRatio, thermalRise / allowedRise);
    }));
    const smallestArea = presets[0].width_mm * presets[0].thickness_mm;
    const estimatedIndex = presets.findIndex(preset => preset.width_mm * preset.thickness_mm >= smallestArea * requiredAreaScale - 1e-9);
    const startIndex = estimatedIndex >= 0 ? estimatedIndex : presets.length - 1;
    const evaluated = [{ preset: presets[0], profile: smallestProfile, analysis: smallestAnalysis, feasible: !smallestAnalysis.invalidFlow && smallestAnalysis.metrics.bottlenecks === 0 }];
    let selected = evaluated[0];
    if (!selected.feasible) {
      for (let index = startIndex; index < presets.length; index++) {
        if (index === 0) continue;
        const profile = applyProfile(presets[index]);
        const analysis = stage3AnalyzeLayout(context, layout, strategy);
        const item = { preset: presets[index], profile, analysis, feasible: !analysis.invalidFlow && analysis.metrics.bottlenecks === 0 };
        evaluated.push(item);
        selected = item;
        if (item.feasible) break;
      }
    }
    // Przekrój pozostaje jeden dla całego pakietu. Wybieramy najmniejszy
    // możliwy profil; gdy żaden nie wystarcza, zostawiamy największy sprawdzony
    // profil, aby kolejne iteracje generatora mogły dołożyć równoległe drogi.
    applyProfile(selected.preset);
    const analysis = stage3AnalyzeLayout(context, layout, strategy);
    analysis.uniformStrip = { materialId, presetId: selected.preset.id, widthMm: selected.preset.width_mm, thicknessMm: selected.preset.thickness_mm, feasible: selected.feasible, evaluatedProfiles: evaluated.map(item => ({ presetId: item.preset.id, widthMm: item.preset.width_mm, thicknessMm: item.preset.thickness_mm, feasible: item.feasible, bottlenecks: item.analysis.metrics.bottlenecks, maximumLossW: item.analysis.metrics.maximumLossW, maximumTemperatureC: item.analysis.metrics.maximumTemperatureC })) };
    return { analysis, profile: selected.profile, feasible: selected.feasible };
  }

  function stage3OptimizeLayout(context, layout, strategy) {
    const selection = stage3SelectUniformStripForLayout(context, layout, strategy);
    const analysis = selection.analysis;
    ["front", "back"].forEach(side => layout[side].forEach(connection => {
      connection.sizing_failed = !selection.feasible || Boolean(connection.bottleneck);
    }));
    return analysis;
  }

  function stage3BoundaryDiagnostics(context, layout, passagePlan) {
    const boundaries = (passagePlan?.boundaries || []).map(boundary => {
      const stats = stage3BoundaryPassageStats(context, boundary.boundaryIndex, layout);
      const connections = stats.clusters.flatMap(cluster => cluster.connections);
      return {
        boundaryIndex: boundary.boundaryIndex,
        count: stats.count,
        maximum: boundary.maximumPassages,
        deficit: Math.max(0, boundary.maximumPassages - stats.count),
        currentImbalance: stats.currentImbalance,
        spacingPenalty: stats.spacingPenalty,
        resistanceMohm: connections.reduce((sum, connection) => sum + (connection.resistance_mohm || 0), 0),
        lossW: connections.reduce((sum, connection) => sum + (connection.power_loss_max_W || 0), 0),
        maximumTemperatureC: Math.max(context.settings.ambientC, ...connections.map(connection => connection.predicted_temperature_C || context.settings.ambientC))
      };
    });
    return {
      boundaries,
      totalDeficit: boundaries.reduce((sum, boundary) => sum + boundary.deficit, 0),
      maximumCurrentImbalance: Math.max(0, ...boundaries.map(boundary => boundary.currentImbalance)),
      spacingPenalty: boundaries.reduce((sum, boundary) => sum + boundary.spacingPenalty, 0) / Math.max(1, boundaries.length)
    };
  }

  function stage3NormalizedProfileScore(context, analysis, diagnostics, strategy) {
    const metrics = analysis.metrics;
    const lengthReference = Math.max(1, context.cells.length * (context.radius * 2 + (manualMode ? manualCellGap : readNumber("cellGap") || 1)) * 2);
    const massReference = Math.max(1, lengthReference * stage3StripSelection.width_mm * stage3StripSelection.thickness_mm * (stage3ActiveStripMaterial()?.density_kg_m3 || 8900) * 1e-6);
    const lossReference = Math.max(.1, context.maximumCurrentA * context.maximumCurrentA * .001);
    const values = {
      loss: Math.min(4, metrics.maximumLossW / lossReference),
      temperature: Math.min(4, Math.max(0, metrics.maximumTemperatureC - context.settings.ambientC) / Math.max(1, context.settings.maxTemperatureC - context.settings.ambientC)),
      currentImbalance: Math.min(4, Math.max(metrics.currentImbalance, diagnostics.maximumCurrentImbalance) / .2),
      drop: Math.min(4, metrics.maximumDropMv / Math.max(1, context.settings.maxDropMv)),
      tape: Math.min(4, (metrics.totalLengthMm / lengthReference + metrics.totalMassG / massReference) / 2),
      simplicity: Math.min(4, metrics.segmentCount / Math.max(1, context.cells.length * 1.5)),
      aesthetics: Math.min(4, diagnostics.spacingPenalty + metrics.pathResistanceImbalance * .35)
    };
    const weights = strategy === "performance"
      ? { loss: .30, temperature: .25, currentImbalance: .20, drop: .15, tape: .05, simplicity: 0, aesthetics: .05 }
      : strategy === "minimal"
        ? { loss: .15, temperature: .10, currentImbalance: .10, drop: 0, tape: .40, simplicity: .20, aesthetics: .05 }
        : { loss: .20, temperature: .15, currentImbalance: .15, drop: .10, tape: .20, simplicity: .10, aesthetics: .10 };
    return Object.entries(weights).reduce((sum, [key, weight]) => sum + values[key] * weight, 0);
  }

  function stage3TopologyIssueCount(issues) {
    return issues.filter(issue => !/przewężeń|Nierównomierność prądów ogniw|Nierównomierność rezystancji|nierównomierność obciążenia przejść/i.test(issue)).length;
  }

  function stage3EvaluateIterativeVariant(context, layout, strategy, routeMode, passagePlan, generationIssues = [], label = "") {
    const topologyHash = stage3LayoutTopologyHash(layout);
    const cached = stage3OptimizationEvaluationCache?.get(topologyHash);
    if (cached) {
      return {
        ...cached,
        routeMode,
        name: label || cached.name,
        layout: {
          front: cached.layout.front.map(connection => ({ ...connection })),
          back: cached.layout.back.map(connection => ({ ...connection }))
        }
      };
    }
    const analysis = stage3OptimizeLayout(context, layout, strategy);
    const validation = stage3ValidateNickelLayout(context, layout, analysis, passagePlan);
    const diagnostics = stage3BoundaryDiagnostics(context, layout, passagePlan);
    const issues = [...new Set(validation.issues)];
    const topologyFailures = stage3TopologyIssueCount(issues);
    const profileScore = stage3NormalizedProfileScore(context, analysis, diagnostics, strategy);
    const rank = [topologyFailures, diagnostics.totalDeficit, analysis.metrics.bottlenecks, profileScore];
    const evaluated = {
      strategy,
      routeMode,
      name: label || `${stage3StrategyProfile(strategy).name} · ${routeMode}`,
      layout,
      analysis,
      diagnostics,
      validation: { ...validation, valid: validation.valid, issues },
      profileScore,
      rank,
      score: profileScore
    };
    stage3OptimizationEvaluationCache?.set(topologyHash, evaluated);
    return evaluated;
  }

  function stage3CompareIterativeVariants(left, right) {
    if (!right) return -1;
    for (let index = 0; index < left.rank.length; index++) {
      const difference = left.rank[index] - right.rank[index];
      if (Math.abs(difference) > 1e-9) return difference;
    }
    return 0;
  }

  function stage3LayoutTopologyHash(layout) {
    return ["front", "back"].flatMap(side => layout[side].map(connection => {
      const endpoints = [String(connection.from), String(connection.to)].sort();
      const lockedGeometry = connection.locked ? `:${connection.strip_material_id}:${connection.strip_preset_id}:${connection.strip_layers || 1}` : "";
      return `${side}:${connection.electrical_node}:${endpoints[0]}-${endpoints[1]}${lockedGeometry}`;
    })).sort().join("|");
  }

  function stage3ValidateBuiltNode(context, node, layout, targetPassages, strategy) {
    const issues = [];
    const visited = stage3ConnectedIdsForNode(context, node, layout);
    if (visited.size !== node.terminals.length) issues.push(`${node.id}: lokalna magistrala obejmuje ${visited.size}/${node.terminals.length} biegunów.`);
    const flow = stage3SolveNodeFlow(context, node, layout, context.maximumCurrentA, stage3StrategyProfile(strategy).leadPoints);
    if (!flow.valid) issues.push(`${node.id}: lokalny test rozpływu prądu nie ma rozwiązania.`);
    if (targetPassages !== null && node.index > 0 && node.index < context.series) {
      const count = stage3BoundaryPassageStats(context, node.index, layout).count;
      if (count !== targetPassages) issues.push(`${node.id}: lokalna walidacja przejść ${count}/${targetPassages}.`);
    }
    return { valid: !issues.length, issues };
  }

  function stage3BuildPlannedVariant(context, strategy, routeMode, passagePlan, lockedLayout, bias = 0, label = "") {
    const layout = {
      front: lockedLayout.front.map(connection => ({ ...connection })),
      back: lockedLayout.back.map(connection => ({ ...connection }))
    };
    const issues = [];
    [...passagePlan.boundaries].sort((a, b) => a.maximumPassages - b.maximumPassages).forEach(boundary => {
      stage3AddPlannedPassages(context, layout, boundary, strategy, routeMode, bias, issues);
    });
    const nodes = stage3BuildElectricalNodes(context);
    nodes.forEach(node => {
      const boundary = passagePlan.boundaries.find(item => item.nodeIndex === node.index);
      const targetPassages = boundary?.maximumPassages ?? null;
      const before = layout[node.side].map(connection => ({ ...connection }));
      const localIssues = [];
      stage3BuildNodeNetwork(context, node, layout, strategy, localIssues, targetPassages, routeMode, bias);
      let localValidation = stage3ValidateBuiltNode(context, node, layout, targetPassages, strategy);
      let usedAlternative = false;
      if (!localValidation.valid) {
        const alternatives = ["uniform", "shortest", "resistance"].filter(mode => mode !== routeMode);
        let recovered = false;
        for (const alternative of alternatives) {
          layout[node.side] = before.map(connection => ({ ...connection }));
          const alternativeIssues = [];
          stage3BuildNodeNetwork(context, node, layout, strategy, alternativeIssues, targetPassages, alternative, bias + .19);
          localValidation = stage3ValidateBuiltNode(context, node, layout, targetPassages, strategy);
          if (localValidation.valid) { recovered = true; usedAlternative = true; break; }
        }
        if (!recovered) {
          layout[node.side] = before;
          issues.push(...localIssues, ...localValidation.issues);
          return;
        }
      }
      if (!usedAlternative) issues.push(...localIssues.filter(issue => !/nie można utworzyć ciągłej magistrali|osiągnięto/i.test(issue)));
    });
    return stage3EvaluateIterativeVariant(context, layout, strategy, routeMode, passagePlan, issues, label);
  }

  function stage3RankProblemNodes(context, candidate, passagePlan) {
    const nodes = stage3BuildElectricalNodes(context);
    return nodes.map(node => {
      const projected = context.projected[node.side];
      const connections = candidate.layout[node.side].filter(connection => stage3ConnectionNodeIndex(connection, node.side, projected) === node.index);
      const boundary = candidate.diagnostics.boundaries.find(item => item.boundaryIndex === node.index);
      const loss = connections.reduce((sum, connection) => sum + (connection.power_loss_max_W || 0), 0);
      const temperature = Math.max(context.settings.ambientC, ...connections.map(connection => connection.predicted_temperature_C || context.settings.ambientC));
      const bottlenecks = connections.filter(connection => connection.bottleneck).length;
      const length = connections.reduce((sum, connection) => sum + (connection.length_mm || 0), 0);
      const score = (boundary?.deficit || 0) * 10000 + bottlenecks * 1000 + (boundary?.currentImbalance || 0) * 300 + Math.max(0, temperature - context.settings.ambientC) * 8 + loss * 120 + length * .01;
      return { nodeIndex: node.index, score, boundary };
    }).sort((a, b) => b.score - a.score);
  }

  function stage3RebuildCandidateNodes(context, best, passagePlan, strategy, nodeIndexes, routeMode, bias, label) {
    const scope = new Set(nodeIndexes.filter(index => index >= 0 && index <= context.series));
    const layout = {
      front: best.layout.front.filter(connection => connection.locked || !scope.has(stage3ConnectionNodeIndex(connection, "front", context.projected.front))).map(connection => ({ ...connection })),
      back: best.layout.back.filter(connection => connection.locked || !scope.has(stage3ConnectionNodeIndex(connection, "back", context.projected.back))).map(connection => ({ ...connection }))
    };
    const issues = [];
    passagePlan.boundaries.filter(boundary => scope.has(boundary.nodeIndex)).forEach(boundary => stage3AddPlannedPassages(context, layout, boundary, strategy, routeMode, bias, issues));
    const nodes = stage3BuildElectricalNodes(context);
    [...scope].sort((a, b) => a - b).forEach(nodeIndex => {
      const node = nodes[nodeIndex];
      if (!node) return;
      const boundary = passagePlan.boundaries.find(item => item.nodeIndex === nodeIndex);
      const targetPassages = boundary?.maximumPassages ?? null;
      const before = layout[node.side].map(connection => ({ ...connection }));
      const localIssues = [];
      stage3BuildNodeNetwork(context, node, layout, strategy, localIssues, targetPassages, routeMode, bias);
      const localValidation = stage3ValidateBuiltNode(context, node, layout, targetPassages, strategy);
      if (!localValidation.valid) {
        layout[node.side] = before;
        issues.push(...localValidation.issues);
      } else {
        issues.push(...localIssues.filter(issue => !/nie można utworzyć ciągłej magistrali|osiągnięto/i.test(issue)));
      }
    });
    return stage3EvaluateIterativeVariant(context, layout, strategy, routeMode, passagePlan, issues, label);
  }

  async function stage3CreateIterativeChildren(context, best, passagePlan, strategy, lockedLayout, iteration) {
    const ranked = stage3RankProblemNodes(context, best, passagePlan);
    const worst = ranked[0]?.nodeIndex ?? Math.floor(context.series / 2);
    const local = stage3RebuildCandidateNodes(context, best, passagePlan, strategy, [worst], "resistance", iteration * .31, `Iteracja ${iteration} · naprawa N${worst}`);
    await new Promise(requestAnimationFrame);
    const area = stage3RebuildCandidateNodes(context, best, passagePlan, strategy, [worst - 1, worst, worst + 1], "uniform", iteration * .67, `Iteracja ${iteration} · przebudowa obszaru N${worst}`);
    await new Promise(requestAnimationFrame);
    const modes = ["uniform", "shortest", "resistance"];
    const global = stage3BuildPlannedVariant(context, strategy, modes[iteration % modes.length], passagePlan, lockedLayout, iteration * .93, `Iteracja ${iteration} · optymalizacja globalna`);
    return { children: [local, area, global], rebuiltNodes: [...new Set([worst - 1, worst, worst + 1].filter(index => index >= 0 && index <= context.series))] };
  }

  function stage3ConnectedIdsForNode(context, node, layout) {
    const graph = new Map(node.terminals.map(terminal => [String(terminal.id), new Set()]));
    layout[node.side].filter(connection => stage3ConnectionNodeIndex(connection, node.side, context.projected[node.side]) === node.index).forEach(connection => {
      const ids = stage3ConnectionCellIds(connection, context.projected[node.side], context.radius).map(String).filter(id => graph.has(id));
      ids.forEach(a => ids.forEach(b => { if (a !== b) graph.get(a).add(b); }));
    });
    if (!graph.size) return new Set();
    const first = graph.keys().next().value;
    const visited = new Set([first]), queue = [first];
    while (queue.length) {
      const current = queue.shift();
      graph.get(current).forEach(next => { if (!visited.has(next)) { visited.add(next); queue.push(next); } });
    }
    return visited;
  }

  function stage3ContainsInvalidNumber(value, visited = new Set()) {
    if (typeof value === "number") return !Number.isFinite(value);
    if (!value || typeof value !== "object" || visited.has(value)) return false;
    visited.add(value);
    if (value instanceof Map) return [...value.values()].some(item => stage3ContainsInvalidNumber(item, visited));
    return Object.values(value).some(item => stage3ContainsInvalidNumber(item, visited));
  }

  function stage3ValidateNickelLayout(context = stage3AutomationContext(), layout = stage3NickelConnections, suppliedAnalysis = null, passagePlan = stage3LastPassagePlan) {
    const input = stage3ValidateAutomationInput(context);
    if (!input.valid) {
      const blockingIssues = [...new Set(input.issues || ["Nieprawidłowe dane wejściowe etapu 3."])];
      return { valid: false, simulationAllowed: false, blockingIssues, warnings: [], diagnostics: blockingIssues, issues: blockingIssues, analysis: null };
    }
    const blockingIssues = [];
    const warnings = [];
    if (new Set(context.sectionCounts).size > 1) warnings.push(`Sekcje mają różną liczbę ogniw: ${context.sectionCounts.map((count, index) => `S${index + 1}=${count}`).join(", ")}.`);
    const seen = new Set();
    const stripProfiles = new Set();
    ["front", "back"].forEach(side => {
      const projected = context.projected[side];
      layout[side].forEach((connection, index) => {
        const from = projected.get(String(connection.from)), to = projected.get(String(connection.to));
        const location = `${side === "front" ? "A" : "B"}/${connection.electrical_node === undefined ? index + 1 : `N${connection.electrical_node}`}`;
        if (!from || !to) { blockingIssues.push(`${location}: taśma wskazuje nieistniejące ogniwo.`); return; }
        const width = connection.strip_width_mm || stage3StripSelection.width_mm;
        const thickness = connection.strip_thickness_mm || stage3StripSelection.thickness_mm;
        stripProfiles.add(`${connection.strip_material_id || stage3StripSelection.materialId}:${width}:${thickness}:${connection.strip_layers || 1}`);
        if (!Number.isFinite(width) || width <= 0 || width > 10) warnings.push(`${location}: nieprawidłowa szerokość taśmy ${width} mm (zalecane: > 0 i ≤ 10 mm).`);
        if (!Number.isFinite(thickness) || thickness <= 0) warnings.push(`${location}: grubość taśmy powinna być dodatnią liczbą.`);
        if (!Number.isInteger(connection.strip_layers || 1) || (connection.strip_layers || 1) !== 1) warnings.push(`${location}: generator zaleca dokładnie jedną warstwę taśmy.`);
        if (!stage3DirectionMatchesDetectedGrid(context, side, from, to)) warnings.push(`${location}: kierunek nie jest zgodny z wykrytą osią siatki.`);
        const touched = stage3ConnectionCellIds(connection, projected, context.radius);
        const nodes = new Set(touched.map(id => {
          const cell = projected.get(String(id));
          return cell ? stage3ElectricalNodeForCell(side, cell.section) : null;
        }));
        if (nodes.size !== 1 || nodes.has(null)) blockingIssues.push(`${location}: odcinek zwiera różne lub nieznane potencjały (${[...nodes].map(node => node === null ? "?" : `N${node}`).join(", ")}).`);
        const nodeIndex = [...nodes][0];
        connection.electrical_node = nodeIndex;
        const key = `${side}:${[String(connection.from), String(connection.to)].sort().join(":")}`;
        if (seen.has(key)) warnings.push(`${location}: powielony odcinek taśmy.`);
        seen.add(key);
      });
      for (let left = 0; left < layout[side].length; left++) for (let right = left + 1; right < layout[side].length; right++) {
        const first = layout[side][left], second = layout[side][right];
        const firstNode = stage3ConnectionNodeIndex(first, side, projected), secondNode = stage3ConnectionNodeIndex(second, side, projected);
        if (firstNode === secondNode) continue;
        const a = projected.get(String(first.from)), b = projected.get(String(first.to)), c = projected.get(String(second.from)), d = projected.get(String(second.to));
        if (!a || !b || !c || !d) continue;
        const clearance = context.settings.clearanceMm + ((first.strip_width_mm || 0) + (second.strip_width_mm || 0)) / 2;
        if (stage3SegmentsTooClose({ x: a.px, y: a.py }, { x: b.px, y: b.py }, { x: c.px, y: c.py }, { x: d.px, y: d.py }, clearance)) blockingIssues.push(`Strona ${side === "front" ? "A" : "B"}: taśmy N${firstNode} i N${secondNode} naruszają odstęp izolacyjny.`);
      }
    });
    if (stripProfiles.size > 1) warnings.push("Pakiet zawiera więcej niż jeden materiał lub przekrój taśmy.");
    input.nodes.forEach(node => {
      const visited = stage3ConnectedIdsForNode(context, node, layout);
      if (visited.size !== node.terminals.length) blockingIssues.push(`${node.id}: połączono ${visited.size} z ${node.terminals.length} wymaganych biegunów.`);
    });
    for (let boundaryIndex = 1; boundaryIndex < context.series; boundaryIndex++) {
      const planned = passagePlan?.boundaries?.find(boundary => boundary.boundaryIndex === boundaryIndex);
      const requiredPassages = Math.max(1, Number(planned?.maximumPassages) || 1);
      const stats = stage3BoundaryPassageStats(context, boundaryIndex, layout);
      if (stats.count < requiredPassages) warnings.push(`Granica S${boundaryIndex}↔S${boundaryIndex + 1}: ${stats.count}/${requiredPassages} zalecanych, fizycznie oddzielnych przejść.`);
    }
    const analysis = suppliedAnalysis || stage3AnalyzeLayout(context, layout, stage3RoutingSettings().strategy);
    const requiredMetricNames = ["totalLengthMm", "totalMassG", "nominalLossW", "maximumLossW", "maximumTemperatureC", "maximumDropMv", "bottlenecks", "segmentCount", "layerCount", "currentImbalance", "pathResistanceImbalance", "score", "quality"];
    const missingOrInvalidMetric = requiredMetricNames.some(name => !Number.isFinite(analysis?.metrics?.[name]));
    if (!analysis || missingOrInvalidMetric || stage3ContainsInvalidNumber(analysis)) blockingIssues.push("Analiza rozpływu zawiera brakujące lub nieprawidłowe wartości liczbowe.");
    if (analysis?.invalidFlow) blockingIssues.push("Nie można rozwiązać rozpływu prądu — co najmniej jeden węzeł jest nieciągły.");
    if (analysis?.metrics?.bottlenecks) warnings.push(`Wykryto ${analysis.metrics.bottlenecks} przewężeń przekraczających zalecany limit gęstości prądu, spadku napięcia lub temperatury.`);
    if (analysis?.metrics?.currentImbalance > .20) warnings.push(`Nierównomierność prądów ogniw wynosi ${(analysis.metrics.currentImbalance * 100).toFixed(1)}% (zalecany limit 20%).`);
    if (analysis?.metrics?.pathResistanceImbalance > .60) warnings.push(`Nierównomierność rezystancji ścieżek wynosi ${(analysis.metrics.pathResistanceImbalance * 100).toFixed(1)}% (zalecany limit 60%).`);
    const uniqueBlockingIssues = [...new Set(blockingIssues)];
    const uniqueWarnings = [...new Set(warnings)];
    const simulationAllowed = uniqueBlockingIssues.length === 0;
    return {
      valid: simulationAllowed,
      simulationAllowed,
      blockingIssues: uniqueBlockingIssues,
      warnings: uniqueWarnings,
      diagnostics: [...uniqueBlockingIssues, ...uniqueWarnings],
      issues: uniqueBlockingIssues,
      analysis
    };
  }

  function stage3RenderValidationReport() {
    const target = $("stage3ValidationReport");
    if (!target) return;
    if (!stage3LastValidation) { target.className = "stage3-validation"; target.textContent = "Brak wyniku walidacji."; return; }
    const allowed = stage3LastValidation.simulationAllowed === true;
    const warnings = stage3LastValidation.warnings || [];
    target.className = `stage3-validation ${allowed ? (warnings.length ? "warning" : "ok") : "error"}`;
    target.replaceChildren();
    const title = document.createElement("strong");
    title.textContent = allowed ? "Projekt dopuszczony do symulacji." : "Projekt nie może przejść do symulacji:";
    target.appendChild(title);
    const messages = allowed ? warnings : (stage3LastValidation.blockingIssues || stage3LastValidation.issues || []);
    if (messages.length) {
      const list = document.createElement("ul");
      messages.slice(0, 8).forEach(message => {
        const item = document.createElement("li");
        item.textContent = message;
        list.appendChild(item);
      });
      target.appendChild(list);
    } else if (stage3LastAnalysis?.metrics) {
      const metrics = stage3LastAnalysis.metrics;
      const detail = document.createElement("div");
      detail.textContent = `Straty maks.: ${metrics.maximumLossW.toFixed(2)} W · spadek maks.: ${metrics.maximumDropMv.toFixed(2)} mV · temperatura maks.: ${metrics.maximumTemperatureC.toFixed(1)}°C.`;
      target.appendChild(detail);
    }
  }

  function stage3FindConnection(id = stage3SelectedConnectionId) {
    for (const side of ["front", "back"]) {
      const connection = stage3NickelConnections[side].find(item => item.id === id);
      if (connection) return { side, connection };
    }
    return null;
  }

  function stage3RenderSegmentEditor() {
    const target = $("stage3SegmentEditor");
    if (!target) return;
    const selected = stage3FindConnection();
    if (!selected) {
      stage3SelectedConnectionId = null;
      target.innerHTML = "Kliknij taśmę, aby zobaczyć jej rolę. Profil materiału i przekrój są wspólne dla całego pakietu.";
      return;
    }
    const connection = selected.connection;
    const role = connection.generation_stage === "main_bus" ? `magistrala główna ${connection.routing_group || ""}` : connection.generation_stage === "crosslink" ? `połączenie poprzeczne ${connection.routing_group || ""}` : "odcinek ręczny";
    const material = stage3StripCatalog.materials[connection.strip_material_id] || stage3ActiveStripMaterial();
    target.innerHTML = `<strong>Wybrany odcinek ${selected.side === "front" ? "A" : "B"} · N${connection.electrical_node ?? "?"}</strong><br>${role}<br>${material?.name_pl || "taśma"} · ${(connection.strip_thickness_mm || stage3StripSelection.thickness_mm).toFixed(2).replace(".", ",")} × ${(connection.strip_width_mm || stage3StripSelection.width_mm).toFixed(1).replace(".", ",")} mm · wspólny profil pakietu.`;
  }

  function stage3RefreshAnalysis() {
    const context = stage3AutomationContext();
    if (!context) return;
    stage3LastAnalysis = stage3AnalyzeLayout(context, stage3NickelConnections, stage3RoutingSettings().strategy);
    stage3LastValidation = stage3ValidateNickelLayout(context, stage3NickelConnections, stage3LastAnalysis);
    if (typeof updateNextBtn === "function") updateNextBtn();
  }

  async function generateStage3NickelLayout() {
    if (stage3OptimizationRunning) return;
    const context = stage3AutomationContext();
    const input = stage3ValidateAutomationInput(context);
    if (!input.valid) {
      stage3LastAnalysis = null;
      stage3LastValidation = input;
      stage3Notice = `Generowanie przerwane: ${input.issues.slice(0, 3).join(" ")}`;
      renderStage3();
      return;
    }
    stage3OptimizationRunning = true;
    stage3Notice = "Wykrywanie odległości sąsiednich ogniw i naturalnych osi siatki…";
    $("stage3AutoNickel").disabled = true;
    $("stage3OptimizeNickel").disabled = true;
    renderStage3();
    await new Promise(requestAnimationFrame);
    const lockedLayout = {
      front: stage3NickelConnections.front.filter(connection => connection.locked).map(connection => ({ ...connection })),
      back: stage3NickelConnections.back.filter(connection => connection.locked).map(connection => ({ ...connection }))
    };
    try {
      const strategy = context.settings.strategy;
      let generatedSteps = 0;
      if (stage3PackPlacementMode === "automatic") stage3MainLeads = { negative: [], positive: [] };

      stage3NickelConnections.front = lockedLayout.front.map(connection => ({ ...connection, ...stage3StripConnectionProperties() }));
      stage3NickelConnections.back = lockedLayout.back.map(connection => ({ ...connection, ...stage3StripConnectionProperties() }));
      stage3LastAnalysis = stage3AnalyzeLayout(context, stage3NickelConnections, strategy);
      stage3LastValidation = null;
      stage3Notice = "Generowanie · etap 1/3: magistrale S1↔S2, S2↔S3…";
      renderStage3();
      await new Promise(requestAnimationFrame);

      const renderGeneratedStep = async (liveLayout, connection, details) => {
        generatedSteps++;
        stage3NickelConnections.front = liveLayout.front.map(item => ({ ...item }));
        stage3NickelConnections.back = liveLayout.back.map(item => ({ ...item }));
        stage3LastAnalysis = stage3AnalyzeLayout(context, stage3NickelConnections, strategy);
        stage3LastValidation = null;
        const phaseText = details.phase === "main"
          ? `etap 1/3 · magistrala S${details.boundaryIndex}↔S${details.boundaryIndex + 1}`
          : details.phase === "completion"
            ? `etap 3/3 · domknięcie N${details.nodeIndex} · pozostało ${details.components} komponentów`
            : `etap 2/3 · poprzeczka N${details.nodeIndex} · pozostało ${details.components} komponentów`;
        stage3Notice = `${phaseText} · odcinek ${generatedSteps}.`;
        renderStage3();
        await new Promise(requestAnimationFrame);
      };

      const result = await stage3BuildTwoStageVariant(
        context,
        0,
        strategy,
        lockedLayout,
        "Automatyczny układ taśm",
        renderGeneratedStep
      );
      if (!result.analysis) {
        if (result.layout.front.length + result.layout.back.length === 0) {
          throw new Error(result.geometryValidation?.issues?.[0] || "nie znaleziono ani jednej legalnej magistrali międzysekcyjnej");
        }
        result.analysis = stage3OptimizeLayout(context, result.layout, strategy);
        result.validation = {
          valid: false,
          issues: [...new Set([...(result.geometryValidation?.issues || []), ...(result.electricalWarnings || [])])],
          analysis: result.analysis
        };
        result.diagnostics = stage3BoundaryDiagnostics(context, result.layout, result.passagePlan);
      }

      stage3LastPassagePlan = result.passagePlan;
      stage3NickelConnections.front = result.layout.front.map(connection => ({ ...connection }));
      stage3NickelConnections.back = result.layout.back.map(connection => ({ ...connection }));
      if (stage3PackPlacementMode === "automatic") {
        stage3MainLeads = { negative: [...(result.packLeads?.negative || [])], positive: [...(result.packLeads?.positive || [])] };
        stage3PackLeadDiagnostics = result.packLeadDiagnostics || { negative: null, positive: null };
      }
      stage3LastAnalysis = stage3AnalyzeLayout(context, stage3NickelConnections, strategy);
      const selectedUniformStrip = stage3NickelConnections.front[0] || stage3NickelConnections.back[0];
      if (selectedUniformStrip) {
        stage3StripSelection = {
          materialId: selectedUniformStrip.strip_material_id,
          presetId: selectedUniformStrip.strip_preset_id,
          width_mm: selectedUniformStrip.strip_width_mm,
          thickness_mm: selectedUniformStrip.strip_thickness_mm
        };
      }
      stage3LastValidation = stage3ValidateNickelLayout(context, stage3NickelConnections, stage3LastAnalysis, result.passagePlan);
      stage3LastValidation.diagnosticIssues = [...new Set([
        ...(stage3LastValidation.diagnosticIssues || []),
        ...(result.geometryValidation?.issues || []),
        ...(result.electricalWarnings || [])
      ])];
      commitStage3NickelHistory();
      stage3Notice = stage3LastValidation.valid
        ? `Generator ukończony: ${(result.mainReports || []).reduce((sum, report) => sum + report.selectedCount, 0)} magistral głównych, ${(result.crossReports || []).reduce((sum, report) => sum + report.added, 0)} poprzeczek i ${(result.completionReports || []).reduce((sum, report) => sum + report.added, 0)} taśm domykających.`
        : `Sieć jest kompletna, ale wymaga uwagi: ${stage3LastValidation.issues.slice(0, 2).join(" ")}`;
    } catch (error) {
      stage3LastAnalysis = null;
      stage3LastValidation = { valid: false, issues: [`Generowanie zostało przerwane: ${error.message}`] };
      stage3Notice = `Generowanie zostało przerwane: ${error.message}`;
    } finally {
      stage3OptimizationRunning = false;
      $("stage3AutoNickel").disabled = false;
      $("stage3OptimizeNickel").disabled = false;
      renderStage3();
    }
  }

  function stage3NickelSnapshot() {
    return { front: stage3NickelConnections.front.map(connection => ({ ...connection })), back: stage3NickelConnections.back.map(connection => ({ ...connection })) };
  }

  function commitStage3NickelHistory() {
    const snapshot = stage3NickelSnapshot();
    const current = stage3NickelHistory[stage3NickelHistoryIndex];
    if (current && JSON.stringify(current) === JSON.stringify(snapshot)) return;
    stage3NickelHistory = stage3NickelHistory.slice(0, stage3NickelHistoryIndex + 1);
    stage3NickelHistory.push(snapshot);
    stage3NickelHistoryIndex = stage3NickelHistory.length - 1;
  }

  function restoreStage3NickelHistory(index) {
    if (index < 0 || index >= stage3NickelHistory.length) return;
    stage3NickelHistoryIndex = index;
    const snapshot = stage3NickelHistory[index];
    stage3NickelConnections.front = snapshot.front.map(connection => ({ ...connection }));
    stage3NickelConnections.back = snapshot.back.map(connection => ({ ...connection }));
    stage3Notice = "";
    stage3RefreshAnalysis();
    renderStage3();
  }

  function undoStage3Nickel() { restoreStage3NickelHistory(stage3NickelHistoryIndex - 1); }
  function redoStage3Nickel() { restoreStage3NickelHistory(stage3NickelHistoryIndex + 1); }

  function flashStage3Illegal(svg, ids) {
    ids.forEach(id => {
      const outer = svg.querySelector(`.stage3-cell[data-cid="${id}"] > circle:first-child`);
      if (!outer) return;
      outer.style.stroke = "#ef4444";
      outer.style.strokeWidth = "3";
      setTimeout(() => {
        if (!outer.isConnected) return;
        outer.style.transition = "stroke .5s, stroke-width .5s";
        outer.style.stroke = "#050505";
        outer.style.strokeWidth = ".9";
      }, 90);
    });
  }

  function bindStage3NickelDrawing(svg, side, cells, projectedCells, radius, gridStyle, gridAngle) {
    svg.onpointerdown = event => {
      if (event.button !== 0) return;
      const point = svgPoint(event, svg);
      let from = null;
      let nearest = radius * 1.15;
      projectedCells.forEach(cell => {
        const distance = Math.hypot(point.x - cell.px, point.y - cell.py);
        if (distance < nearest) { nearest = distance; from = cell; }
      });
      if (!from) return;
      if (stage3PackPlacementMode === "manual" && stage3ManualPackTarget) {
        event.preventDefault();
        event.stopPropagation();
        const context = stage3AutomationContext();
        const result = context ? stage3SetManualPackLead(context, stage3NickelConnections, side, from.id, stage3ManualPackTarget) : { valid: false, message: "Brak gotowej sieci pakietu." };
        if (!result.valid) {
          stage3Notice = result.message;
          flashStage3Illegal(svg, [from.id]);
        } else {
          stage3RefreshAnalysis();
          const label = result.nodeIndex === 0 ? "−PACK" : "+PACK";
          stage3Notice = `Ustawiono ${label} na ogniwie ${from.id}. Rozpływ prądu został przeliczony.${result.warning ? ` ${result.warning}` : ""}`;
          stage3ManualPackTarget = null;
        }
        renderStage3();
        return;
      }
      event.preventDefault();
      const fromId = String(from.id);
      const preview = document.createElementNS("http://www.w3.org/2000/svg", "line");
      preview.setAttribute("x1", from.px); preview.setAttribute("y1", from.py);
      preview.setAttribute("x2", from.px); preview.setAttribute("y2", from.py);
      preview.setAttribute("stroke", stage3ActiveStripMaterial()?.display_color_hex || "#f8fafc"); preview.setAttribute("stroke-width", Math.max(1, stage3StripSelection.width_mm));
      preview.setAttribute("stroke-linecap", "round"); preview.setAttribute("opacity", ".72"); preview.setAttribute("pointer-events", "none");
      svg.appendChild(preview);
      stage3NickelDrag = { side, fromId, preview, svg };
      svg.setPointerCapture(event.pointerId);
    };
    svg.onpointermove = event => {
      if (!stage3NickelDrag || stage3NickelDrag.svg !== svg) return;
      const point = svgPoint(event, svg);
      stage3NickelDrag.preview.setAttribute("x2", point.x);
      stage3NickelDrag.preview.setAttribute("y2", point.y);
    };
    svg.onpointerup = event => {
      if (!stage3NickelDrag || stage3NickelDrag.svg !== svg) return;
      const drag = stage3NickelDrag;
      stage3NickelDrag = null;
      if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
      drag.preview.remove();
      const point = svgPoint(event, svg);
      let target = null, nearest = radius * 1.2;
      projectedCells.forEach(cell => {
        const distance = Math.hypot(point.x - cell.px, point.y - cell.py);
        if (distance < nearest) { nearest = distance; target = cell; }
      });
      if (!target) { stage3Notice = "Upuść taśmę bezpośrednio na drugim ogniwie."; renderStage3(); return; }
      const legal = stage3NickelMoveIsLegal(side, drag.fromId, target.id, cells, projectedCells, radius, gridStyle, gridAngle);
      if (!legal.valid) {
        stage3Notice = legal.message;
        renderStage3();
        flashStage3Illegal(side === "front" ? $("stage3FrontDrawing") : $("stage3BackDrawing"), [drag.fromId, target.id]);
        return;
      }
      stage3NickelConnections[side].push({ id: `${side}-${Date.now()}-${Math.random()}`, from: drag.fromId, to: target.id, cellIds: legal.touchedCellIds, electrical_node: legal.electricalNode, generated: false, locked: false, ...stage3StripConnectionProperties() });
      commitStage3NickelHistory();
      stage3Notice = "";
      stage3RefreshAnalysis();
      renderStage3();
    };
    svg.onpointercancel = () => {
      if (!stage3NickelDrag || stage3NickelDrag.svg !== svg) return;
      stage3NickelDrag.preview.remove();
      stage3NickelDrag = null;
    };
    svg.oncontextmenu = event => {
      event.preventDefault();
      const tape = event.target.closest(".stage3-nickel");
      if (!tape) return;
      if (stage3SelectedConnectionId === tape.dataset.nickelId) stage3SelectedConnectionId = null;
      stage3NickelConnections[side] = stage3NickelConnections[side].filter(connection => connection.id !== tape.dataset.nickelId);
      commitStage3NickelHistory();
      stage3Notice = "";
      stage3RefreshAnalysis();
      renderStage3();
    };
    svg.ondblclick = event => {
      const tape = event.target.closest(".stage3-nickel");
      if (!tape) return;
      event.preventDefault();
      event.stopPropagation();
      const connection = stage3NickelConnections[side].find(item => item.id === tape.dataset.nickelId);
      if (!connection) return;
      stage3SelectedConnectionId = connection.id;
      connection.locked = !connection.locked;
      stage3Notice = connection.locked ? `Zablokowano odcinek ${connection.electrical_node === undefined ? "" : `N${connection.electrical_node}`}.` : "Odblokowano odcinek taśmy.";
      commitStage3NickelHistory();
      renderStage3();
    };
    svg.onclick = event => {
      const tape = event.target.closest(".stage3-nickel");
      if (!tape) return;
      stage3SelectedConnectionId = tape.dataset.nickelId;
      stage3RenderSegmentEditor();
    };
  }

  function renderStage3() {
    const variant = manualMode ? manualVariant : variants[activeIndex];
    const frontSvg = $("stage3FrontDrawing"), backSvg = $("stage3BackDrawing");
    if (!variant || !frontSvg || !backSvg) return;
    const series = selectedSeries();
    const allCells = getStage2Assignment(variant, series);
    const cells = allCells.filter(cell => Number.isInteger(cell.section));
    const radius = (manualMode ? manualCellSize : readNumber("cellType")) / 2;
    const validIds = new Set(cells.map(cell => String(cell.id)));
    ["front", "back"].forEach(side => { stage3NickelConnections[side] = stage3NickelConnections[side].filter(connection => validIds.has(String(connection.from)) && validIds.has(String(connection.to))); });
    const front = stage3ViewMarkup(variant, cells, false, false, radius, !stage3PolarityReversed, "front");
    const back = stage3ViewMarkup(variant, cells, stage3BackFlipHorizontal, stage3BackFlipVertical, radius, stage3PolarityReversed, "back");
    frontSvg.setAttribute("viewBox", front.viewBox);
    backSvg.setAttribute("viewBox", back.viewBox);
    frontSvg.innerHTML = front.markup;
    backSvg.innerHTML = back.markup;
    const gridStyle = manualMode ? manualGridStyle : variant.layout === "square" ? "square" : "honeycomb";
    const gridAngle = manualMode ? manualGridAngle : (variant.angle || 0) * Math.PI / 180;
    bindStage3NickelDrawing(frontSvg, "front", cells, front.projectedCells, radius, gridStyle, gridAngle);
    bindStage3NickelDrawing(backSvg, "back", cells, back.projectedCells, radius, gridStyle, gridAngle);
    $("stage3BackFlipHorizontal").classList.toggle("active", stage3BackFlipHorizontal);
    $("stage3BackFlipVertical").classList.toggle("active", stage3BackFlipVertical);
    const hiddenEmptySlots = allCells.length - cells.length;
    const stripMaterial = stage3ActiveStripMaterial();
    const cellChemistry = stage3CellCatalog.chemistries?.[stage3CellModel?.chemistry_id];
    $("stage3Summary").innerHTML = `<span class="pill">${cells.length} ogniw</span><span class="pill">${series}S</span><span class="pill">2 strony pakietu</span>${stripMaterial ? `<span class="pill">${stripMaterial.name_pl} ${stage3StripSelection.thickness_mm.toFixed(2).replace(".", ",")} × ${stage3StripSelection.width_mm} mm</span>` : ""}${cellChemistry ? `<span class="pill">Ogniwo ${cellChemistry.name_pl} · ${stage3CellModel.capacity_nominal_Ah} Ah</span>` : ""}`;
    const tapeCount = stage3NickelConnections.front.length + stage3NickelConnections.back.length;
    const metrics = stage3LastAnalysis?.metrics;
    const manualPackPicker = $("stage3ManualPackPicker");
    if (manualPackPicker) manualPackPicker.hidden = stage3PackPlacementMode !== "manual";
    ["negative", "positive"].forEach(target => {
      const tile = $(target === "negative" ? "stage3ManualPackNegative" : "stage3ManualPackPositive");
      if (!tile) return;
      const selected = stage3ManualPackTarget === target;
      const selectedId = stage3MainLeads[target][0];
      tile.classList.toggle("is-selecting", selected);
      tile.setAttribute("aria-pressed", String(selected));
      const detail = tile.querySelector("small");
      if (detail) detail.textContent = selected
        ? "Wskaż żółto podświetlone ogniwo"
        : selectedId ? `Wybrano ogniwo ${selectedId} · kliknij, aby zmienić`
        : "Kliknij, aby wybrać punkt";
    });
    const packStatus = $("stage3PackPlacementStatus");
    if (packStatus) {
      const negativeId = stage3MainLeads.negative[0], positiveId = stage3MainLeads.positive[0];
      const diagnosticText = [stage3PackLeadDiagnostics.negative, stage3PackLeadDiagnostics.positive].filter(Boolean)
        .map(item => `${item.maximumCurrentA.toFixed(1)} A max · ${(item.losses || 0).toFixed(2)} W`).join(" / ");
      packStatus.textContent = stage3PackPlacementMode === "manual"
        ? stage3ManualPackTarget
          ? `Wybierasz ${stage3ManualPackTarget === "negative" ? "−PACK" : "+PACK"}. Kliknij żółto podświetlone ogniwo na właściwej magistrali.`
          : `Tryb ręczny: −PACK ${negativeId || "nie wybrano"}, +PACK ${positiveId || "nie wybrano"}. Wybierz kafelek, a następnie właściwe ogniwo.`
        : `Automatyczne: −PACK ${negativeId || "oczekuje"}, +PACK ${positiveId || "oczekuje"}${diagnosticText ? ` · ${diagnosticText}` : ""}.`;
    }
    $("stage3Stats").innerHTML = `${cells.length}/${allCells.length} ogniw przypisanych do sekcji.${hiddenEmptySlots ? `<br>Ukryto ${hiddenEmptySlots} pustych miejsc bez przypisania.` : ""}<br>${stage3PolarityReversed ? "Odwrócona" : "Standardowa"} polaryzacja pakietu · ${tapeCount} odcinków taśmy.${metrics ? `<br>Długość: ${(metrics.totalLengthMm / 1000).toFixed(2)} m · masa: ${metrics.totalMassG.toFixed(1)} g<br>Straty nominalne / max: ${metrics.nominalLossW.toFixed(2)} / ${metrics.maximumLossW.toFixed(2)} W · max ${metrics.maximumTemperatureC.toFixed(1)}°C<br>Nierównomierność prądu / ścieżek: ${(metrics.currentImbalance * 100).toFixed(1)}% / ${(metrics.pathResistanceImbalance * 100).toFixed(1)}%` : ""}${stage3Notice ? `<br><span style="color:#f59e0b">${stage3Notice}</span>` : ""}`;
    stage3RenderValidationReport();
    stage3RenderSegmentEditor();
    if (typeof updateNextBtn === "function") updateNextBtn();
  }

  function renderSummary(variant, cells) {
    const controllerPlacement = variant.controller
      ? variant.controller.placementKind === "corner"
        ? `róg ${cornerNames[variant.controller.cornerIndex] || variant.controller.cornerIndex + 1}`
        : "przy krawędzi"
      : "";
    $("summary").innerHTML = `
      <span class="pill">${cells.length} ogniw</span>
      <span class="pill">${variant.layout === "honeycomb" ? "honeycomb" : "kwadrat"}, ${variant.angle.toFixed(0)}°</span>
      <span class="pill">${variant.controller ? `sterownik ${variant.controller.angle.toFixed(0)}°, ${controllerPlacement}` : "bez sterownika"}</span>
    `;
  }

  function applyVariantTab(tabIdx) {
    activeVariantTab = tabIdx;
    manualMode = false;
    manualVariant = null;
    selectedCellId = null;
    render();
  }
