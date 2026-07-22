  function readableTextColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (r * 299 + g * 587 + b * 114) / 1000 > 138 ? "#172033" : "#ffffff";
  }

  function stage2AssignmentKey(variant, cells, series) {
    const geometry = cells.map(cell => `${cell.id}:${cell.x.toFixed(2)}:${cell.y.toFixed(2)}`).join("|");
    return `${stage2ManualMode ? "paint" : manualMode ? "manual" : "auto"}:${activeIndex}:${series}:${activeVariantTab}:${sectionVariantSettings.edgeWeight}:${geometry}`;
  }

  function createStage2Worker() {
    const source = `
      let activeVariantTab = 0;
      let sectionVariantSettings = { edgeWeight: 5 };
      let workerCellType = 21;
      let workerCellGap = 1.5;
      function readNumber(id) { return id === "cellType" ? workerCellType : id === "cellGap" ? workerCellGap : 0; }
      const assignSections = ${assignSections.toString()};
      self.onmessage = event => {
        const job = event.data;
        activeVariantTab = job.method;
        sectionVariantSettings.edgeWeight = job.edgeWeight;
        workerCellType = job.cellType;
        workerCellGap = job.cellGap;
        try { self.postMessage({ key: job.key, cells: assignSections(job.cells, job.series), requested: job.requested }); }
        catch (error) { self.postMessage({ key: job.key, error: String(error), requested: job.requested }); }
      };
    `;
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = event => {
      const result = event.data;
      stage2WorkerBusy = false;
      stage2WorkerPending.delete(result.key);
      if (!result.error && Array.isArray(result.cells)) {
        reindexStage2Sections(result.cells);
        stage2AssignmentVariants.set(result.key, result.cells);
        const variant = manualMode ? manualVariant : variants[activeIndex];
        if (variant && result.key === stage2AssignmentKey(variant, variant.cells || [], selectedSeries())) {
          stage2AssignmentCache = { key: result.key, cells: result.cells };
          stage2Notice = "";
          if (currentStage === 2) renderStage2();
        }
      } else if (result.requested) {
        stage2Notice = "Nie udało się obliczyć wybranego poziomu agresywności.";
        if (currentStage === 2) renderStage2();
      }
      setTimeout(runNextStage2WorkerJob, 120);
    };
    worker.onerror = () => {
      stage2WorkerBusy = false;
      stage2Worker = null;
      setTimeout(runNextStage2WorkerJob, 120);
    };
    return worker;
  }

  function runNextStage2WorkerJob() {
    if (stage2WorkerBusy || !stage2WorkerQueue.length) return;
    const run = () => {
      if (stage2WorkerBusy || !stage2WorkerQueue.length) return;
      const job = stage2WorkerQueue.shift();
      if (stage2AssignmentVariants.has(job.key)) {
        stage2WorkerPending.delete(job.key);
        runNextStage2WorkerJob();
        return;
      }
      if (!stage2Worker) stage2Worker = createStage2Worker();
      stage2WorkerBusy = true;
      stage2Worker.postMessage(job);
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 500 });
    else setTimeout(run, 30);
  }

  function queueStage2Assignment(variant, series, edgeWeight, requested = false) {
    if (!variant) return;
    const cells = variant.cells || [];
    const previousWeight = sectionVariantSettings.edgeWeight;
    sectionVariantSettings.edgeWeight = edgeWeight;
    const key = stage2AssignmentKey(variant, cells, series);
    sectionVariantSettings.edgeWeight = previousWeight;
    if (stage2AssignmentVariants.has(key)) return;
    if (stage2WorkerPending.has(key)) {
      if (requested) {
        const queuedIndex = stage2WorkerQueue.findIndex(job => job.key === key);
        if (queuedIndex >= 0) {
          const queuedJob = stage2WorkerQueue.splice(queuedIndex, 1)[0];
          queuedJob.requested = true;
          stage2WorkerQueue.unshift(queuedJob);
        }
      }
      return;
    }
    const job = { key, cells: cells.map(cell => ({ ...cell })), series, method: activeVariantTab, edgeWeight, cellType: readNumber("cellType"), cellGap: readNumber("cellGap"), requested };
    stage2WorkerPending.add(key);
    if (requested) stage2WorkerQueue.unshift(job); else stage2WorkerQueue.push(job);
    runNextStage2WorkerJob();
  }

  function precomputeStage2Aggressiveness(variant, series) {
    if (activeVariantTab !== 0) return;
    for (let weight = 0; weight <= 10; weight++) {
      if (weight !== sectionVariantSettings.edgeWeight) queueStage2Assignment(variant, series, weight, false);
    }
  }

  function reindexStage2Sections(cells) {
    const groups = new Map();
    cells.forEach(cell => {
      if (cell.section === null || cell.section === undefined) { cell.parallelIndex = null; return; }
      if (!groups.has(cell.section)) groups.set(cell.section, []);
      groups.get(cell.section).push(cell);
    });
    groups.forEach(group => {
      group.sort((a, b) => a.x - b.x || a.y - b.y);
      group.forEach((cell, index) => { cell.parallelIndex = index + 1; });
    });
  }

  function hasCompleteAutomaticAssignment(assigned, totalCells, series) {
    const parallel = Math.floor(totalCells / series);
    const expectedAssigned = parallel * series;
    if (assigned.length !== totalCells) return false;
    const counts = Array.from({ length: series }, () => 0);
    let assignedCount = 0;
    for (const cell of assigned) {
      if (!Number.isInteger(cell.section) || cell.section < 0 || cell.section >= series) continue;
      counts[cell.section]++;
      assignedCount++;
    }
    return assignedCount === expectedAssigned && counts.every(count => count === parallel);
  }

  function getStage2Assignment(variant, series, force = false) {
    const cells = variant.cells || [];
    const key = stage2AssignmentKey(variant, cells, series);
    if (!force && stage2AssignmentCache.key === key) {
      if (stage2ManualMode || hasCompleteAutomaticAssignment(stage2AssignmentCache.cells, cells.length, series)) {
        return stage2AssignmentCache.cells;
      }
      stage2AssignmentCache = { key: "", cells: [] };
      stage2AssignmentVariants.delete(key);
    }
    if (!force && stage2AssignmentVariants.has(key)) {
      const cached = stage2AssignmentVariants.get(key);
      if (stage2ManualMode || hasCompleteAutomaticAssignment(cached, cells.length, series)) {
        stage2AssignmentCache = { key, cells: cached };
        return stage2AssignmentCache.cells;
      }
      stage2AssignmentVariants.delete(key);
    }
    // Ręczne pozycjonowanie z etapu 1 określa wyłącznie geometrię pakietu.
    // Podział na sekcje ma nadal zostać wyliczony w etapie 2. Tylko tryb
    // ręcznego malowania sekcji przechowuje przypisania bez automatycznego podziału.
    let assigned = stage2ManualMode
      ? cells.map(cell => ({ ...cell, section: cell.section ?? null, parallelIndex: cell.parallelIndex ?? null }))
      : assignSections(cells, series).map(cell => ({ ...cell }));
    if (!stage2ManualMode) {
      assigned.forEach(cell => {
        const override = cellOverrides[cell.id];
        // W automatycznych metodach puste przypisanie nie jest trwałą decyzją.
        // Dzięki temu stary stan interfejsu nie zamienia pełnych sekcji w "zapasy".
        if (Number.isInteger(override) && override >= 0 && override < series) cell.section = override;
      });
      if (!hasCompleteAutomaticAssignment(assigned, cells.length, series)) {
        assigned = assignSections(cells, series).map(cell => ({ ...cell }));
      }
    }
    reindexStage2Sections(assigned);
    stage2AssignmentCache = { key, cells: assigned };
    if (!stage2ManualMode) stage2AssignmentVariants.set(key, assigned);
    return assigned;
  }

  function invalidateStage2Assignment() {
    stage2AssignmentCache = { key: "", cells: [] };
  }

  function scheduleStage2Recompute() {
    if (stage2RecomputeTimer) clearTimeout(stage2RecomputeTimer);
    stage2RecomputeTimer = setTimeout(() => {
      stage2RecomputeTimer = null;
      invalidateStage2Assignment();
      if (currentStage === 2) renderStage2(true);
    }, 250);
  }

  function stage2SectionCount(cells, section) {
    return cells.reduce((count, cell) => count + (cell.section === section ? 1 : 0), 0);
  }

  function stage2FirstIncompleteSection(cells, series, parallel) {
    for (let section = 0; section < series; section++) {
      if (stage2SectionCount(cells, section) < parallel) return section;
    }
    return null;
  }

  function stage2NeighbourDistance(cells) {
    let nearest = Infinity;
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
      const distance = Math.hypot(cells[i].x - cells[j].x, cells[i].y - cells[j].y);
      if (distance > 0.0001 && distance < nearest) nearest = distance;
    }
    return Number.isFinite(nearest) ? nearest * 1.45 : Infinity;
  }

  function stage2CellsAreConnected(cells, neighbourDistance) {
    if (cells.length < 2) return true;
    const visited = new Set([cells[0].id]);
    const queue = [cells[0]];
    while (queue.length) {
      const current = queue.shift();
      cells.forEach(cell => {
        if (!visited.has(cell.id) && Math.hypot(current.x - cell.x, current.y - cell.y) <= neighbourDistance) {
          visited.add(cell.id);
          queue.push(cell);
        }
      });
    }
    return visited.size === cells.length;
  }

  function syncStage2CellSection(id, section) {
    if (stage2ManualMode) {
      const sourceCell = (manualMode ? manualVariant : variants[activeIndex])?.cells?.find(cell => String(cell.id) === String(id));
      if (sourceCell) sourceCell.section = section;
    } else cellOverrides[id] = section;
  }

  function updateStage2MethodOptions() {
    const method = Number($("stage2Method").value);
    stage2ManualMode = method === 2;
    $("stage2ScsOptions").style.display = method === 0 ? "block" : "none";
    $("stage2EdgeWeight").value = sectionVariantSettings.edgeWeight;
    $("stage2EdgeWeightValue").textContent = sectionVariantSettings.edgeWeight;
  }

  function stage2ConnectionAnalysis(cells, series, radius) {
    const sections = Array.from({ length: series }, () => []);
    cells.forEach(cell => {
      if (Number.isInteger(cell.section) && cell.section >= 0 && cell.section < series) sections[cell.section].push(cell);
    });
    const neighbourDistance = stage2NeighbourDistance(cells);
    const boundaryCounts = Array(Math.max(0, series - 1)).fill(0);
    const connections = [];
    for (let section = 0; section < series - 1; section++) {
      for (const from of sections[section]) for (const to of sections[section + 1]) {
        const distance = Math.hypot(to.x - from.x, to.y - from.y);
        if (distance > 0.0001 && distance <= neighbourDistance) {
          boundaryCounts[section]++;
          connections.push({ section, from, to, distance });
        }
      }
    }
    const connectionSvg = connections.map(({ section, from, to, distance }) => {
      const front = section % 2 === 0;
      const ux = (to.x - from.x) / distance, uy = (to.y - from.y) / distance;
      const x1 = from.x + ux * radius * 1.05, y1 = from.y + uy * radius * 1.05;
      const x2 = to.x - ux * radius * 1.3, y2 = to.y - uy * radius * 1.3;
      const warning = boundaryCounts[section] === 1
        ? `<g transform="translate(${((x1 + x2) / 2).toFixed(1)},${((y1 + y2) / 2).toFixed(1)})" pointer-events="none"><polygon points="0,-6.5 6.5,4.5 -6.5,4.5" fill="#f59e0b" stroke="#0f172a" stroke-width=".8"/><text x="0" y="2.5" font-size="7" font-weight="900" fill="#0f172a" text-anchor="middle">!</text></g>`
        : "";
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${front ? "#dc2626" : "#2563eb"}" stroke-width="1.5" stroke-dasharray="${front ? "none" : "3,3"}" opacity="${front ? ".9" : ".85"}" marker-end="url(#${front ? "stage2-arrow-front" : "stage2-arrow-back"})" pointer-events="none"/>${warning}`;
    }).join("");
    const splitSections = sections.map((sectionCells, index) => !stage2CellsAreConnected(sectionCells, neighbourDistance) ? `S${index + 1}` : null).filter(Boolean);
    const missingConnections = boundaryCounts.map((count, index) => count === 0 ? `S${index + 1}↔S${index + 2}` : null).filter(Boolean);
    const narrowConnections = boundaryCounts.map((count, index) => count === 1 ? `S${index + 1}↔S${index + 2}` : null).filter(Boolean);
    return { connectionSvg, connections, boundaryCounts, splitSections, missingConnections, narrowConnections };
  }

  function flashStage2InvalidSwap(cellIds) {
    const svg = $("stage2Drawing");
    if (!svg) return;
    const circles = cellIds.map(id => Array.from(svg.querySelectorAll(".stage2-cell"))
      .find(group => String(group.dataset.cid) === String(id))?.querySelector("circle:last-of-type")).filter(Boolean);
    circles.forEach(circle => {
      circle.style.transition = "stroke 0s";
      circle.style.stroke = "#ef4444";
      circle.style.strokeWidth = "3";
    });
    setTimeout(() => circles.forEach(circle => {
      if (!circle.isConnected) return;
      circle.style.transition = "stroke .6s, stroke-width .6s";
      circle.style.stroke = "";
      circle.style.strokeWidth = "";
    }), 80);
  }

  function stage2NearestAdjacentSlot(variant, cells, point) {
    if (!cells.length) return null;
    const pitch = (manualMode ? manualCellSize + manualCellGap : readNumber("cellType") + readNumber("cellGap"));
    if (!Number.isFinite(pitch) || pitch <= 0) return null;
    const radius = readNumber("cellType") / 2;
    const layout = manualMode ? manualGridStyle : (variant.layout || "honeycomb");
    const angle = manualMode ? manualGridAngle : ((variant.angle || 0) * Math.PI / 180);
    const rotate = (x, y) => ({ x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) });
    const horizontal = rotate(pitch, 0);
    const vertical = layout === "honeycomb" ? rotate(pitch / 2, pitch * Math.sqrt(3) / 2) : rotate(0, pitch);
    const vectors = layout === "honeycomb"
      ? [horizontal, { x: -horizontal.x, y: -horizontal.y }, vertical, { x: -vertical.x, y: -vertical.y }, { x: vertical.x - horizontal.x, y: vertical.y - horizontal.y }, { x: horizontal.x - vertical.x, y: horizontal.y - vertical.y }]
      : [horizontal, { x: -horizontal.x, y: -horizontal.y }, vertical, { x: -vertical.x, y: -vertical.y }];
    let nearest = null;
    let nearestDistance = pitch * 0.8;
    cells.forEach(cell => vectors.forEach(vector => {
      const candidate = { x: cell.x + vector.x, y: cell.y + vector.y };
      if (cells.some(other => Math.hypot(other.x - candidate.x, other.y - candidate.y) < radius * 1.98)) return;
      if (variant.controller && circleRectOverlap(candidate, radius, variant.controller, 0)) return;
      const distance = Math.hypot(point.x - candidate.x, point.y - candidate.y);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = candidate;
      }
    }));
    return nearest && {
      ...nearest,
      outsideBoundary: Boolean(variant.triInfo && !pointInBoundary(nearest, variant.triInfo, radius))
    };
  }

  function updateStage2Cells(mutator, notice = "", preservedAssignment = null) {
    const variant = manualMode ? manualVariant : variants[activeIndex];
    if (!variant?.cells) return false;
    const changed = mutator(variant.cells);
    if (!changed) return false;
    stage2SelectedCellId = null;
    stage2Notice = notice;
    if (preservedAssignment) {
      // Usunięcie pustego pola nie może przetasować już ustalonych sekcji.
      // Zapisujemy bieżące przypisanie pod nowym kluczem geometrii i pomijamy dobór S/P.
      cellOverrides = {};
      preservedAssignment.forEach(cell => { cellOverrides[cell.id] = cell.section ?? null; });
      reindexStage2Sections(preservedAssignment);
      const key = stage2AssignmentKey(variant, variant.cells, selectedSeries());
      stage2AssignmentCache = { key, cells: preservedAssignment };
      stage2AssignmentVariants.set(key, preservedAssignment);
      renderStage2();
      return true;
    }
    cellOverrides = {};
    invalidateStage2Assignment();
    renderStage2(true);
    return true;
  }

  function renderStage2(forceAssignment = false) {
    const svg = $("stage2Drawing");
    const variant = manualMode ? manualVariant : variants[activeIndex];
    updateSeriesVoltageDisplay();
    if (!svg || !variant) return;
    const cells = variant.cells || [];
    const series = selectedSeries();
    updateStage2MethodOptions();
    const assigned = getStage2Assignment(variant, series, forceAssignment);
    renderStage1PackCharacteristics();
    precomputeStage2Aggressiveness(variant, series);
    const stats = packStats(series, assigned.length);
    const parallel = stats.parallel;
    stage2ActiveSection = Math.max(0, Math.min(stage2ActiveSection, series - 1));
    const tri = variant.triInfo ? boundaryPoints(variant.triInfo) : null;
    const controllerPoints = variant.controller ? rotatedRectCorners(variant.controller) : [];
    const points = [...assigned, ...(tri || []), ...controllerPoints];
    if (!points.length) return;
    const xs = points.map(p => p.x), ys = points.map(p => p.y), pad = 40;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const radius = readNumber("cellType") / 2;
    svg.setAttribute("viewBox", `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
    const frame = tri ? `<polygon points="${tri.map(p => `${p.x},${p.y}`).join(" ")}" fill="transparent" stroke="var(--frame)" stroke-width="2.5"/>` : "";
    const controllerSvg = variant.controller ? renderController(variant.controller) : "";
    const cellSvg = assigned.map(c => {
      const section = c.section === null || c.section === undefined ? null : c.section;
      const fill = section === null ? "#d8dee8" : colors[section % colors.length];
      const selected = String(c.id) === String(stage2SelectedCellId);
      const ring = selected ? `<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(radius + 2.7).toFixed(2)}" fill="none" stroke="#f59e0b" stroke-width="2.6" pointer-events="none"/>` : "";
      const textColor = readableTextColor(fill);
      const labels = section === null ? "" : `<text x="${c.x.toFixed(2)}" y="${(c.y - radius * .08).toFixed(2)}" text-anchor="middle" font-size="${Math.max(4.5, radius * .55).toFixed(1)}" font-weight="750" fill="${textColor}" pointer-events="none">${c.parallelIndex ?? ""}</text><text x="${c.x.toFixed(2)}" y="${(c.y + radius * .48).toFixed(2)}" text-anchor="middle" font-size="${Math.max(3.5, radius * .38).toFixed(1)}" font-weight="750" fill="${textColor}" opacity=".8" pointer-events="none">S${section + 1}</text>`;
      return `<g class="stage2-cell" data-cid="${c.id}" style="cursor:pointer">${ring}<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="${fill}" stroke="var(--cell-stroke)" stroke-width=".9"/>${labels}</g>`;
    }).join("");
    const connectionAnalysis = stage2ConnectionAnalysis(assigned, series, radius);
    svg.innerHTML = `<defs><marker id="stage2-arrow-front" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#dc2626"/></marker><marker id="stage2-arrow-back" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto"><path d="M 0 1 L 10 5 L 0 9 z" fill="#2563eb"/></marker></defs>${frame}${controllerSvg}${cellSvg}${connectionAnalysis.connectionSvg}`;
    const warningElement = $("stage2ConnectionWarnings");
    if (connectionAnalysis.missingConnections.length || connectionAnalysis.narrowConnections.length || connectionAnalysis.splitSections.length) {
      warningElement.style.display = "flex";
      warningElement.innerHTML = `<span style="font-size:13px;font-weight:800;color:#ef4444">⚠ DO SPRAWDZENIA:</span>${connectionAnalysis.missingConnections.map(label => `<span style="background:#2d1515;border:1px solid #ef4444;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:700;color:#fca5a5">brak połączenia ${label}</span>`).join("")}${connectionAnalysis.narrowConnections.map(label => `<span style="background:#2d1515;border:1px solid #f59e0b;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:700;color:#fed7aa">ryzykowne pojedyncze połączenie ${label}</span>`).join("")}${connectionAnalysis.splitSections.map(label => `<span style="background:#2d1515;border:1px solid #f59e0b;border-radius:8px;padding:3px 10px;font-size:12px;font-weight:700;color:#fed7aa">rozbita ${label}</span>`).join("")}`;
    } else {
      warningElement.style.display = "none";
      warningElement.innerHTML = "";
    }
    const sectionButtons = $("stage2SectionButtons");
    sectionButtons.innerHTML = Array.from({ length: series }, (_, s) => {
      const count = stage2SectionCount(assigned, s);
      const full = count >= parallel;
      return `<button type="button" data-stage2-section="${s}" title="Sekcja S${s + 1}: ${count} z ${parallel} ogniw" style="background:${colors[s % colors.length]};color:${readableTextColor(colors[s % colors.length])};opacity:${full ? ".72" : "1"};${stage2ActiveSection === s ? "outline:2px solid #fff;" : ""}">S${s + 1} ${count}/${parallel}${full ? " ✓" : ""}</button>`;
    }).join("");
    sectionButtons.querySelectorAll("[data-stage2-section]").forEach(button => button.addEventListener("click", () => {
      stage2ActiveSection = Number(button.dataset.stage2Section);
      stage2SelectedCellId = null;
      stage2Notice = "";
      renderStage2();
    }));
    const notice = stage2Notice ? `<br><span style="color:#f59e0b">${stage2Notice}</span>` : "";
    $("stage2Stats").innerHTML = `${assigned.length} ogniw · ${series}s${stats.parallel}p · przypisanych: ${assigned.filter(c => c.section !== null && c.section !== undefined).length}${notice}`;
    $("stage2Summary").innerHTML = `<span class="pill">${assigned.length} ogniw</span><span class="pill">${series}s${stats.parallel}p</span>`;
    const stage2PaintGroup = cellId => Array.from(svg.querySelectorAll(".stage2-cell"))
      .find(group => String(group.dataset.cid) === String(cellId));
    const refreshStage2PaintCell = cell => {
      const group = stage2PaintGroup(cell.id);
      if (!group) return;
      const section = Number.isInteger(cell.section) ? cell.section : null;
      const fill = section === null ? "#d8dee8" : colors[section % colors.length];
      const circle = group.querySelector("circle:last-of-type");
      if (circle) circle.setAttribute("fill", fill);
      group.querySelectorAll("text").forEach(text => text.remove());
      if (section === null) return;
      const textColor = readableTextColor(fill);
      const parallelIndex = stage2SectionCount(assigned, section);
      group.insertAdjacentHTML("beforeend", `<text x="${cell.x.toFixed(2)}" y="${(cell.y - radius * .08).toFixed(2)}" text-anchor="middle" font-size="${Math.max(4.5, radius * .55).toFixed(1)}" font-weight="750" fill="${textColor}" pointer-events="none">${parallelIndex}</text><text x="${cell.x.toFixed(2)}" y="${(cell.y + radius * .48).toFixed(2)}" text-anchor="middle" font-size="${Math.max(3.5, radius * .38).toFixed(1)}" font-weight="750" fill="${textColor}" opacity=".8" pointer-events="none">S${section + 1}</text>`);
    };
    const applyStage2PaintCell = cell => {
      const drag = stage2PaintDrag;
      if (!drag || drag.visited.has(String(cell.id))) return;
      drag.visited.add(String(cell.id));
      if (drag.mode === "erase") {
        if (!Number.isInteger(cell.section)) return;
        cell.section = null;
        cell.parallelIndex = null;
        syncStage2CellSection(cell.id, null);
        drag.changed = true;
        refreshStage2PaintCell(cell);
        return;
      }
      if (drag.stopped || Number.isInteger(cell.section)) return;
      const count = stage2SectionCount(assigned, drag.section);
      if (count >= parallel) {
        drag.stopped = true;
        const nextSection = stage2FirstIncompleteSection(assigned, series, parallel);
        if (nextSection !== null) stage2ActiveSection = nextSection;
        stage2Notice = nextSection === null
          ? `Sekcja S${drag.section + 1} jest pełna. Wszystkie sekcje osiągnęły limit.`
          : `Sekcja S${drag.section + 1} jest pełna. Następny pędzel: S${nextSection + 1}.`;
        return;
      }
      cell.section = drag.section;
      cell.parallelIndex = count + 1;
      syncStage2CellSection(cell.id, drag.section);
      drag.changed = true;
      refreshStage2PaintCell(cell);
      if (count + 1 >= parallel) {
        drag.stopped = true;
        const nextSection = stage2FirstIncompleteSection(assigned, series, parallel);
        if (nextSection !== null) stage2ActiveSection = nextSection;
        stage2Notice = nextSection === null
          ? `Sekcja S${drag.section + 1} ukończona. Wszystkie sekcje osiągnęły limit.`
          : `Sekcja S${drag.section + 1} ukończona. Następny pędzel: S${nextSection + 1}.`;
      }
    };
    const paintStage2Path = (start, end) => {
      const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy;
      assigned.map(cell => {
        const t = lengthSquared > 1e-9 ? Math.max(0, Math.min(1, ((cell.x - start.x) * dx + (cell.y - start.y) * dy) / lengthSquared)) : 0;
        const px = start.x + dx * t, py = start.y + dy * t;
        return { cell, t, distance: Math.hypot(cell.x - px, cell.y - py) };
      }).filter(item => item.distance <= radius * .92).sort((a, b) => a.t - b.t).forEach(item => applyStage2PaintCell(item.cell));
    };
    const finishStage2Paint = event => {
      const drag = stage2PaintDrag;
      if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
      if (svg.hasPointerCapture?.(drag.pointerId)) svg.releasePointerCapture(drag.pointerId);
      stage2PaintDrag = null;
      stage2SuppressClick = true;
      reindexStage2Sections(assigned);
      if (drag.mode === "erase" && drag.changed) {
        const nextSection = stage2FirstIncompleteSection(assigned, series, parallel);
        if (nextSection !== null) {
          stage2ActiveSection = nextSection;
          stage2Notice = `Usunięto przypisania. Pędzel wrócił do najniższej niepełnej sekcji S${nextSection + 1}.`;
        } else stage2Notice = "";
      } else if (!drag.stopped) stage2Notice = "";
      setTimeout(() => {
        stage2SuppressClick = false;
        if (currentStage === 2) renderStage2();
      }, 0);
    };
    svg.onpointerdown = event => {
      if (!stage2ManualMode || event.button !== 0) return;
      const group = event.target.closest(".stage2-cell");
      if (!group) return;
      const cell = assigned.find(item => String(item.id) === String(group.dataset.cid));
      if (!cell) return;
      event.preventDefault();
      stage2SelectedCellId = null;
      stage2PaintDrag = {
        pointerId: event.pointerId,
        mode: Number.isInteger(cell.section) ? "erase" : "paint",
        section: stage2ActiveSection,
        visited: new Set(),
        changed: false,
        stopped: false,
        lastPoint: svgPoint(event, svg)
      };
      svg.setPointerCapture?.(event.pointerId);
      applyStage2PaintCell(cell);
    };
    svg.onpointermove = event => {
      const drag = stage2PaintDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const point = svgPoint(event, svg);
      paintStage2Path(drag.lastPoint, point);
      drag.lastPoint = point;
    };
    svg.onpointerup = finishStage2Paint;
    svg.onpointercancel = finishStage2Paint;
    svg.onclick = e => {
      if (stage2SuppressClick) { stage2SuppressClick = false; return; }
      const group = e.target.closest(".stage2-cell");
      if (!group) {
        const point = svgPoint(e, svg);
        const slot = stage2NearestAdjacentSlot(variant, cells, point);
        if (slot) {
          updateStage2Cells(sourceCells => {
            sourceCells.push({
              id: nextCustomCellId(),
              custom: true,
              x: slot.x,
              y: slot.y,
              section: null,
              parallelIndex: null
            });
            return true;
          }, slot.outsideBoundary ? "⚠ Ogniwo wychodzi poza obszar zabudowy. Usuń je PPM albo przesuń układ w etapie 1." : "");
          return;
        }
        stage2SelectedCellId = null;
        stage2Notice = "Nowe ogniwo można dodać w każdym wolnym miejscu stykającym się z pakietem.";
        renderStage2();
        return;
      }
      const id = group.dataset.cid;
      const assignedCell = assigned.find(cell => String(cell.id) === id);
      if (!assignedCell) return;
      if (stage2ManualMode) {
        const currentSection = assignedCell.section;
        if (currentSection !== null && currentSection !== undefined) {
          assignedCell.section = null;
          syncStage2CellSection(id, null);
          stage2SelectedCellId = null;
          reindexStage2Sections(assigned);
          const firstIncomplete = stage2FirstIncompleteSection(assigned, series, parallel);
          if (firstIncomplete !== null) stage2ActiveSection = firstIncomplete;
          stage2Notice = firstIncomplete === null ? "" : `Pędzel wrócił do najniższej niepełnej sekcji S${firstIncomplete + 1}.`;
          renderStage2();
          return;
        }
        let nextSection = stage2ActiveSection;
        if (nextSection === null || stage2SectionCount(assigned, nextSection) >= parallel) {
          nextSection = stage2FirstIncompleteSection(assigned, series, parallel);
        }
        if (nextSection === null) {
          stage2Notice = "Wszystkie sekcje osiągnęły limit ogniw.";
          renderStage2();
          return;
        }
        stage2ActiveSection = nextSection;
        assignedCell.section = nextSection;
        syncStage2CellSection(id, nextSection);
        stage2SelectedCellId = null;
        stage2Notice = "";
        reindexStage2Sections(assigned);
        if (nextSection !== null && stage2SectionCount(assigned, nextSection) >= parallel) {
          const firstIncomplete = stage2FirstIncompleteSection(assigned, series, parallel);
          if (firstIncomplete !== null) stage2ActiveSection = firstIncomplete;
        }
        renderStage2();
        return;
      }
      if (stage2SelectedCellId === null) {
        stage2SelectedCellId = id;
        stage2Notice = "Wybierz drugie ogniwo do zamiany.";
        renderStage2();
        return;
      }
      if (stage2SelectedCellId === id) {
        stage2SelectedCellId = null;
        stage2Notice = "";
        renderStage2();
        return;
      }
      const firstCell = assigned.find(cell => String(cell.id) === String(stage2SelectedCellId));
      const secondCell = assignedCell;
      if (!firstCell) {
        stage2SelectedCellId = null;
        stage2Notice = "Nie znaleziono wcześniej zaznaczonego ogniwa.";
        renderStage2();
        return;
      }
      const firstSection = firstCell.section;
      const secondSection = secondCell.section;
      if (firstSection === secondSection) {
        stage2SelectedCellId = null;
        stage2Notice = "Ogniwa należą do tej samej sekcji — zamiana nie jest potrzebna.";
        renderStage2();
        return;
      }
      const simulated = assigned.map(cell => ({ ...cell }));
      simulated.find(cell => cell.id === firstCell.id).section = secondSection;
      simulated.find(cell => cell.id === secondCell.id).section = firstSection;
      const neighbourDistance = stage2NeighbourDistance(assigned);
      const affectedSections = [firstSection, secondSection].filter(section => section !== null && section !== undefined);
      const legal = affectedSections.every(section => {
        const sectionCells = simulated.filter(cell => cell.section === section);
        return sectionCells.length <= parallel && stage2CellsAreConnected(sectionCells, neighbourDistance);
      });
      stage2SelectedCellId = null;
      if (!legal) {
        stage2Notice = "Zamiana zablokowana: rozdzieliłaby sekcję lub przekroczyła jej limit.";
        renderStage2();
        flashStage2InvalidSwap([firstCell.id, secondCell.id]);
        return;
      }
      firstCell.section = secondSection;
      secondCell.section = firstSection;
      syncStage2CellSection(firstCell.id, secondSection);
      syncStage2CellSection(secondCell.id, firstSection);
      stage2Notice = "";
      reindexStage2Sections(assigned);
      renderStage2();
    };
    svg.oncontextmenu = e => {
      e.preventDefault();
      stage2SelectedCellId = null;
      const group = e.target.closest(".stage2-cell");
      if (!group) return;
      const id = group.dataset.cid;
      const removedAssignment = assigned.find(cell => String(cell.id) === id);
      const preserveAssignment = removedAssignment && (removedAssignment.section === null || removedAssignment.section === undefined)
        ? assigned.filter(cell => String(cell.id) !== id).map(cell => ({ ...cell }))
        : null;
      updateStage2Cells(sourceCells => {
        const index = sourceCells.findIndex(cell => String(cell.id) === id);
        if (index < 0) return false;
        sourceCells.splice(index, 1);
        return true;
      }, "", preserveAssignment);
    };
  }
