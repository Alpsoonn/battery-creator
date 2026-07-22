  function formatNumber(value, decimals = 1) {
    if (!Number.isFinite(value)) return "0";
    return value.toFixed(decimals).replace(/\.0$/, "");
  }

  function renderPlacementBoundary(svg, boundary) {
    const points = boundaryPoints(boundary);
    setWorkspaceViewBox(svg);
    svg.innerHTML = points.length >= 3
      ? `<polygon points="${points.map(point => `${point.x},${point.y}`).join(" ")}" fill="rgba(20,184,166,.05)" stroke="var(--accent)" stroke-width="3"/>`
      : "";
    svg.onwheel = e => zoomWorkspace(e, svg);
    svg.onpointerdown = e => beginWorkspacePan(e, svg);
  }

  function render(options = {}) {
    renderStage1PackCharacteristics();
    if (stage1Substep === 1) {
      renderBoundaryStage();
      return;
    }
    if (manualMode) {
      renderManualBoard($("drawing"));
      return;
    }
    $("manualTransformTools").hidden = true;
    const { refreshVariants = true } = options;

    function findFirstIncompleteSec() {
      for (let s = 0; s <= activeDrawSec; s++) {
        const count = manualVariant ? manualVariant.cells.filter(c => c.section === s).length : 0;
        if (count < manualP) return s;
      }
      return null;
    }

    const svg = $("drawing");
    const variant = variants[activeIndex];
    if (!variant) {
      renderPlacementBoundary(svg, placementBoundary);
      $("summary").innerHTML = placementBoundary ? `<span class="pill">Granica gotowa — rozmieszczanie ogniw</span>` : "";
      return;
    }

    const series = selectedSeries();
    const cells = variant.cells.map(c => ({ ...c, section: null, parallelIndex: null }));
    const boundary = variant.triInfo;
    const tri = boundaryPoints(boundary);
    const bounds = polygonBounds(tri);
    const pad = 40;
    const minX = bounds.minX - pad;
    const minY = bounds.minY - pad;
    const width = bounds.maxX - bounds.minX + pad * 2;
    const height = bounds.maxY - bounds.minY + pad * 2;
    const r = readNumber("cellType") / 2;
    setWorkspaceViewBox(svg);

    const poly = tri.map(p => `${p.x},${p.y}`).join(" ");
    const labels = boundary.type === "triangle" ? sideLabels(boundary) : "";

    const overriddenCells = cells.map(c => ({ ...c }));
    if (!manualMode) {
      for (const c of overriddenCells) {
        if (cellOverrides[c.id] !== undefined) {
          c.section = cellOverrides[c.id];
          if (c.section === null) c.parallelIndex = null;
        }
      }
    }

    const secGroups = {};
    for (const c of overriddenCells) {
      if (c.section !== null) {
        if (!secGroups[c.section]) secGroups[c.section] = [];
        secGroups[c.section].push(c);
      }
    }
    for (const s of Object.keys(secGroups)) {
      secGroups[s].sort((a, b) => a.x - b.x || a.y - b.y);
      secGroups[s].forEach((c, i) => { c.parallelIndex = i + 1; });
    }

    let selectedCellSvg = "";
    const cellSvg = overriddenCells.map(c => {
      const fill = c.section === null ? "#d8dee8" : colors[c.section % colors.length];
      const text = c.section === null || c.parallelIndex === null ? "" : c.parallelIndex;
      const textColor = readableTextColor(fill);
      const isSelected = c.id === selectedCellId;
      const ring = isSelected ? `<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${(r + 2.5).toFixed(2)}" fill="none" stroke="#f59e0b" stroke-width="2.5"></circle>` : "";

      let textSvg = "";
      if (c.section !== null && c.parallelIndex !== null) {
        textSvg = `
          <text x="${c.x.toFixed(2)}" y="${(c.y - r * 0.08).toFixed(2)}" text-anchor="middle" font-size="${Math.max(4.5, r * .55).toFixed(1)}" font-weight="750" fill="${textColor}" style="pointer-events:none">${text}</text>
          <text x="${c.x.toFixed(2)}" y="${(c.y + r * 0.48).toFixed(2)}" text-anchor="middle" font-size="${Math.max(3.5, r * .38).toFixed(1)}" font-weight="750" fill="${textColor}" opacity="0.8" style="pointer-events:none">S${c.section + 1}</text>
        `;
      }

      const gContent = `<g class="cell-g" data-cid="${c.id}" data-sec="${c.section}" style="cursor:pointer">${ring}<circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${r.toFixed(2)}" fill="${fill}" stroke="var(--cell-stroke)" stroke-width="0.9"></circle>${textSvg}</g>`;
      if (isSelected) { selectedCellSvg = gContent; return ""; }
      return gContent;
    }).join("");

    const controllerGuide = autoControllerDrag && variant.controller ? renderAutomaticControllerGuide(boundary, variant.controller) : "";
    const controller = variant.controller ? renderController(variant.controller, true) : "";

    const connectionsSvg = [];
    const pitch = readNumber("cellType") + readNumber("cellGap");

    const secs = Array.from({ length: series }, () => []);
    for (const c of overriddenCells) { if (c.section !== null) secs[c.section].push(c); }

    const boundaryCounts = Array(series - 1).fill(0);
    for (let s = 0; s < series - 1; s++) {
      for (const c1 of secs[s]) for (const c2 of secs[s + 1]) {
        if (Math.hypot(c1.x - c2.x, c1.y - c2.y) <= pitch * 1.35) boundaryCounts[s]++;
      }
    }

    for (let s = 0; s < series - 1; s++) {
      const isFront = (s % 2 === 0);
      const marker = isFront ? "url(#arrow-front)" : "url(#arrow-back)";
      const stroke = isFront ? "#dc2626" : "#2563eb";
      const width = "1.5";
      const opacity = isFront ? "0.9" : "0.85";
      const dash = isFront ? "none" : "3,3";
      const isWarning = boundaryCounts[s] === 1;

      for (const c1 of secs[s]) {
        for (const c2 of secs[s + 1]) {
          const d = Math.hypot(c1.x - c2.x, c1.y - c2.y);
          if (d <= pitch * 1.35) {
            const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d;
            const x1 = c1.x + ux * (r * 1.05), y1 = c1.y + uy * (r * 1.05);
            const x2 = c2.x - ux * (r * 1.3), y2 = c2.y - uy * (r * 1.3);
            connectionsSvg.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="${width}" stroke-dasharray="${dash}" opacity="${opacity}" marker-end="${marker}"></line>`);
            if (isWarning) {
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
              connectionsSvg.push(`<g transform="translate(${mx.toFixed(1)}, ${my.toFixed(1)})" style="pointer-events:none"><polygon points="0,-6.5 6.5,4.5 -6.5,4.5" fill="#f59e0b" stroke="#0f172a" stroke-width="0.8"></polygon><text x="0" y="2.5" font-size="7" font-weight="900" fill="#0f172a" text-anchor="middle">!</text></g>`);
            }
          }
        }
      }
    }

    svg.innerHTML = `
      <defs>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#111827" flood-opacity=".18"/>
        </filter>
        <marker id="arrow-front" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#dc2626" />
        </marker>
        <marker id="arrow-back" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="3.5" markerHeight="3.5" orient="auto">
          <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563eb" />
        </marker>
      </defs>
      <polygon points="${poly}" fill="transparent" stroke="var(--frame)" stroke-width="2.5" filter="url(#softShadow)"></polygon>
      ${controllerGuide}
      ${controller}
      ${cellSvg}
      ${connectionsSvg.join("")}
      ${selectedCellSvg}
      ${labels}
    `;

    svg.onwheel = e => zoomWorkspace(e, svg);
    svg.onpointerdown = e => {
      if (beginWorkspacePan(e, svg)) return;
      beginAutomaticControllerDrag(e, svg, variant);
    };

    if (manualMode) {
      const currentCount = overriddenCells.filter(c => c.section === activeDrawSec).length;
      const totalAssigned = overriddenCells.filter(c => c.section !== null).length;
      const totalRequired = manualS * manualP;
      const pct = Math.min(100, (totalAssigned / totalRequired) * 100);
      $("status").className = "status";
      $("status").innerHTML = `<strong style="color:var(--accent)">Tryb Ręczny:</strong> Rysowanie celi <strong>S${activeDrawSec + 1}</strong> (${currentCount}/${manualP} ogniw).<br/><span style="font-size:11px;opacity:0.85">LPM - maluj/zmaż | PPM - zmaż | Kliknij kafelki legendy poniżej, aby przełączyć aktywny cel.</span>`;
      $("progressBar").style.width = `${pct.toFixed(1)}%`;
    }

    // Cell click delegation
    svg.onclick = (e) => {
      if (workspacePan?.moved || workspacePanJustMoved) { workspacePan = null; workspacePanJustMoved = false; return; }
      if (autoControllerClickSuppressed || e.target.closest(".auto-controller")) return;
      const g = e.target.closest(".cell-g");
      if (!g) { if (!manualMode) selectedCellId = null; render(); return; }
      const clickedId = Number(g.dataset.cid);

      if (manualMode) {
        const cell = manualVariant.cells.find(c => c.id === clickedId);
        if (cell) {
          if (cell.section === activeDrawSec) {
            cell.section = null; cell.parallelIndex = null;
          } else if (cell.section !== null) {
            cell.section = null; cell.parallelIndex = null;
          } else {
            const count = manualVariant.cells.filter(c => c.section === activeDrawSec).length;
            if (count < manualP) {
              cell.section = activeDrawSec;
              const newCount = count + 1;
              if (newCount === manualP) {
                const firstIncomplete = findFirstIncompleteSec();
                if (firstIncomplete !== null) activeDrawSec = firstIncomplete;
                else if (activeDrawSec < manualS - 1) activeDrawSec++;
              }
            } else {
              const firstIncomplete = findFirstIncompleteSec();
              if (firstIncomplete !== null) activeDrawSec = firstIncomplete;
            }
          }
          const firstIncomplete = findFirstIncompleteSec();
          if (firstIncomplete !== null && firstIncomplete < activeDrawSec) activeDrawSec = firstIncomplete;
          render();
        }
        return;
      }

      if (selectedCellId === null) {
        selectedCellId = clickedId; render();
      } else if (selectedCellId === clickedId) {
        selectedCellId = null; render();
      } else {
        const cellA = overriddenCells.find(c => c.id === selectedCellId);
        const cellB = overriddenCells.find(c => c.id === clickedId);
        if (cellA && cellB) {
          const secA = cellA.section, secB = cellB.section;
          if (secA === secB) { selectedCellId = null; render(); return; }
          const testCells = overriddenCells.map(c => ({ ...c }));
          testCells.find(c => c.id === cellA.id).section = secB;
          testCells.find(c => c.id === cellB.id).section = secA;
          const pitchCheck = readNumber("cellType") + readNumber("cellGap");
          function checkContiguous(sectionCells) {
            if (sectionCells.length <= 1) return true;
            const visited = new Set();
            const queue = [sectionCells[0]];
            visited.add(sectionCells[0].id);
            let count = 1;
            while (queue.length > 0) {
              const curr = queue.shift();
              for (const other of sectionCells) {
                if (!visited.has(other.id) && Math.hypot(curr.x - other.x, curr.y - other.y) <= pitchCheck * 1.35) {
                  visited.add(other.id); queue.push(other); count++;
                }
              }
            }
            return count === sectionCells.length;
          }
          const newSecA = testCells.filter(c => c.section === secA && c.section !== null);
          const newSecB = testCells.filter(c => c.section === secB && c.section !== null);
          const isValid = checkContiguous(newSecA) && checkContiguous(newSecB);
          if (isValid) {
            cellOverrides[cellA.id] = secB; cellOverrides[cellB.id] = secA;
            selectedCellId = null; render();
          } else {
            selectedCellId = null; render();
            const svgEl = $("drawing");
            const flashA = svgEl.querySelector(`[data-cid="${cellA.id}"] circle`);
            const flashB = svgEl.querySelector(`[data-cid="${cellB.id}"] circle`);
            [flashA, flashB].forEach(el => {
              if (!el) return;
              el.style.transition = "stroke 0s"; el.style.stroke = "#ef4444"; el.style.strokeWidth = "3";
              setTimeout(() => { el.style.transition = "stroke 0.6s, stroke-width 0.6s"; el.style.stroke = ""; el.style.strokeWidth = ""; }, 80);
            });
          }
        } else { selectedCellId = null; render(); }
      }
    };

    svg.oncontextmenu = (e) => {
      if (!manualMode) return;
      e.preventDefault();
      const g = e.target.closest(".cell-g");
      if (!g) return;
      const clickedId = Number(g.dataset.cid);
      const cell = manualVariant.cells.find(c => c.id === clickedId);
      if (cell && cell.section !== null) {
        cell.section = null; cell.parallelIndex = null;
        const firstIncomplete = findFirstIncompleteSec();
        if (firstIncomplete !== null && firstIncomplete <= activeDrawSec) activeDrawSec = firstIncomplete;
        render();
      }
    };

    renderSummary(variant, cells);
    if (refreshVariants) renderVariants();
    $("configs").innerHTML = "";
    $("legend").innerHTML = "";
    updateNextBtn();
  }

  function renderController(rect, interactive = false) {
    const points = rotatedRectCorners(rect).map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const labelAngle = rect.angle || 0;
    const dragging = interactive && Boolean(autoControllerDrag);
    const groupClass = interactive ? "auto-controller" : "controller-static";
    const interactionAttributes = interactive ? `data-auto-controller="true" style="cursor:${dragging ? "grabbing" : "grab"};touch-action:none"` : "";
    const hitArea = interactive ? `<polygon points="${points}" fill="transparent" stroke="transparent" stroke-width="12"></polygon>` : "";
    const title = interactive ? "<title>Przeciągnij sterownik LPM wzdłuż granicy pakietu</title>" : "";
    return `<g class="${groupClass}" ${interactionAttributes}>${title}${hitArea}<polygon points="${points}" fill="#ffe8b3" stroke="${dragging ? "#14b8a6" : "#9a6700"}" stroke-width="${dragging ? "3" : "2"}"></polygon><text x="${rect.cx.toFixed(2)}" y="${(rect.cy + 4).toFixed(2)}" text-anchor="middle" font-size="11" font-weight="800" fill="#694600" pointer-events="none" transform="rotate(${labelAngle.toFixed(2)} ${rect.cx.toFixed(2)} ${rect.cy.toFixed(2)})">sterownik</text></g>`;
  }

  function renderAutomaticControllerGuide(boundary, rect) {
    const points = boundaryPoints(boundary);
    if (rect.placementKind === "corner" && Number.isInteger(rect.cornerIndex) && points[rect.cornerIndex]) {
      const corner = points[rect.cornerIndex];
      return `<line x1="${corner.x.toFixed(2)}" y1="${corner.y.toFixed(2)}" x2="${rect.cx.toFixed(2)}" y2="${rect.cy.toFixed(2)}" stroke="#14b8a6" stroke-width="1.5" stroke-dasharray="5 4" opacity=".9" pointer-events="none"/><circle cx="${corner.x.toFixed(2)}" cy="${corner.y.toFixed(2)}" r="6" fill="rgba(20,184,166,.2)" stroke="#14b8a6" stroke-width="2" pointer-events="none"/>`;
    }
    if (Number.isInteger(rect.edgeIndex) && points[rect.edgeIndex]) {
      const start = points[rect.edgeIndex], end = points[(rect.edgeIndex + 1) % points.length];
      return `<line x1="${start.x.toFixed(2)}" y1="${start.y.toFixed(2)}" x2="${end.x.toFixed(2)}" y2="${end.y.toFixed(2)}" stroke="#14b8a6" stroke-width="5" opacity=".45" stroke-linecap="round" pointer-events="none"/>`;
    }
    return "";
  }

  function automaticControllerBaseCells(variant) {
    const source = Array.isArray(variant?.baseCells) && variant.baseCells.length ? variant.baseCells : (variant?.cells || []);
    return source.map(cell => ({ ...cell, section: null, parallelIndex: null }));
  }

  function automaticControllerPlacementOptions() {
    return {
      controllerWidth: Math.max(1, readNumber("controllerW")),
      controllerHeight: Math.max(1, readNumber("controllerH")),
      allowRotation: $("controllerRotate").checked,
      frameMargin: Math.max(0, readNumber("frameMargin")),
      cellRadius: Math.max(0, readNumber("cellType") / 2),
      cellGap: Math.max(0, readNumber("cellGap"))
    };
  }

  function beginAutomaticControllerDrag(event, svg, variant) {
    const target = event.target.closest(".auto-controller");
    if (!target || event.button !== 0 || manualMode || currentStage !== 1 || stage1Substep !== 2 || !$("controllerOn").checked || !variant?.controller) return false;
    event.preventDefault();
    event.stopPropagation();
    const point = svgPoint(event, svg);
    if (Number.isInteger(event.pointerId) && svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
    autoControllerDrag = {
      pointerId: event.pointerId,
      variant,
      startPoint: point,
      pendingPoint: point,
      grabOffset: { x: variant.controller.cx - point.x, y: variant.controller.cy - point.y },
      baseCells: automaticControllerBaseCells(variant),
      startCellCount: variant.cells.length,
      moved: false
    };
    autoControllerClickSuppressed = false;
    return true;
  }

  function applyAutomaticControllerDragPoint(point) {
    const drag = autoControllerDrag;
    if (!drag?.variant?.controller) return false;
    const desired = { x: point.x + drag.grabOffset.x, y: point.y + drag.grabOffset.y };
    const placement = window.BATTERY_CONTROLLER_PLACEMENT?.findPlacement({
      boundaryPoints: boundaryPoints(drag.variant.triInfo),
      cells: drag.baseCells,
      ...automaticControllerPlacementOptions(),
      target: desired,
      previous: drag.variant.controller,
      mode: "drag"
    });
    if (!placement) return false;
    drag.variant.controller = { ...placement.rect };
    drag.variant.cells = placement.cells.map(cell => ({ ...cell, section: null, parallelIndex: null }));
    drag.variant.baseCells = drag.baseCells.map(cell => ({ ...cell, section: null, parallelIndex: null }));
    drag.variant.rawCount = drag.baseCells.length;
    drag.variant.removedByController = placement.removed;
    drag.variant.score = placement.score;
    render({ refreshVariants: false });
    const placementName = placement.rect.placementKind === "corner" ? "narożnik" : "krawędź";
    $("status").className = "status";
    $("status").textContent = `Sterownik przyciągnięty: ${placementName} · ${drag.variant.cells.length} ogniw · usunięte spod sterownika: ${placement.removed}.`;
    return true;
  }

  function updateAutomaticControllerDrag(event) {
    const drag = autoControllerDrag;
    if (!drag || (event.pointerId !== undefined && drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    const point = svgPoint(event, $("drawing"));
    drag.pendingPoint = point;
    if (!drag.moved && Math.hypot(point.x - drag.startPoint.x, point.y - drag.startPoint.y) >= 1.2) drag.moved = true;
    if (!drag.moved || autoControllerDragFrame !== null) return;
    autoControllerDragFrame = requestAnimationFrame(() => {
      autoControllerDragFrame = null;
      if (autoControllerDrag?.pendingPoint) applyAutomaticControllerDragPoint(autoControllerDrag.pendingPoint);
    });
  }

  function finishAutomaticControllerDrag(event) {
    const drag = autoControllerDrag;
    if (!drag || (event?.pointerId !== undefined && drag.pointerId !== undefined && event.pointerId !== drag.pointerId)) return;
    if (autoControllerDragFrame !== null) {
      cancelAnimationFrame(autoControllerDragFrame);
      autoControllerDragFrame = null;
    }
    if (drag.moved && drag.pendingPoint) applyAutomaticControllerDragPoint(drag.pendingPoint);
    const finalController = drag.variant.controller ? { ...drag.variant.controller } : null;
    autoControllerDrag = null;
    if (drag.moved && finalController) {
      autoControllerPreference = { x: finalController.cx, y: finalController.cy, angle: finalController.angle || 0 };
      cellOverrides = {};
      selectedCellId = null;
      invalidateStage2Assignment();
      render({ refreshVariants: false });
      const placementName = finalController.placementKind === "corner" ? "narożniku" : "krawędzi";
      $("status").className = "status";
      $("status").textContent = `Sterownik osadzony przy ${placementName}. Pakiet zawiera ${drag.variant.cells.length} ogniw.`;
      autoControllerClickSuppressed = true;
      setTimeout(() => { autoControllerClickSuppressed = false; }, 0);
    }
    const svg = $("drawing");
    if (svg?.releasePointerCapture && Number.isInteger(drag.pointerId) && svg.hasPointerCapture?.(drag.pointerId)) svg.releasePointerCapture(drag.pointerId);
  }

  function sideLabels(info) {
    const [a, b, c] = info.points;
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
    const offset = 22;
    const items = [
      { p1: a, p2: b, text: `górny ${info.top.toFixed(0)} mm` },
      { p1: b, p2: c, text: `prawy ${info.shortest.toFixed(0)} mm` },
      { p1: c, p2: a, text: `lewy ${info.longest.toFixed(0)} mm` }
    ];
    return items.map(item => {
      const mx = (item.p1.x + item.p2.x) / 2, my = (item.p1.y + item.p2.y) / 2;
      const nx = mx - cx, ny = my - cy;
      const len = Math.hypot(nx, ny) || 1;
      const x = mx + (nx / len) * offset, y = my + (ny / len) * offset;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="9.5" font-weight="700" fill="rgba(255,255,255,0.75)" letter-spacing="0.03em">${item.text}</text>`;
    }).join("");
  }


  function renderVariants() {
    if (!$("variants")) return;
    if (!variants.length) { $("variants").innerHTML = ""; return; }
    $("variants").innerHTML = variants.slice(0, 4).map((v, i) => `
        <button type="button" class="variant ${!manualMode && i === activeVariantTab ? "active" : ""}" data-tab="${i}">
          <div class="variant-head">
            <div>
              <strong>Wariant ${i + 1}</strong>
              <span>${v.cells.length} ogniw · ${v.layout === "honeycomb" ? "Honeycomb" : "Kwadrat"}, ${v.angle.toFixed(0)}°</span>
            </div>
          </div>
        </button>`).join("");

    document.querySelectorAll("[data-tab]").forEach(btn => {
      btn.addEventListener("click", (e) => {
        applyVariantTab(Number(btn.dataset.tab));
        renderVariants();
      });
    });
  }

  function validatePlacementSearchParameters() {
    const angleStep = Number($("angleStep")?.value);
    const offsetDensity = Number($("offsetDensity")?.value);
    if (!Number.isFinite(angleStep) || angleStep < 1 || angleStep > 15) {
      $("status").className = "status error";
      $("status").textContent = "Krok kąta musi być liczbą od 1 do 15°.";
      $("angleStep")?.focus();
      return false;
    }
    if (!Number.isFinite(offsetDensity) || offsetDensity < 0.1 || offsetDensity > 5) {
      $("status").className = "status error";
      $("status").textContent = "Gęstość przesunięć musi być liczbą od 0,1 do 5.";
      $("offsetDensity")?.focus();
      return false;
    }
    return true;
  }

  async function runSolve() {
    if (!validateCellElectricalParameters()) return;
    if (!validatePlacementSearchParameters()) return;
    const runId = ++solveRunId;
    const btn = $("solveBtn");
    btn.disabled = true;
    $("status").className = "status";
    setProgress(0, "Start obliczeń...");
    await new Promise(requestAnimationFrame);
    try {
      variants = await solve(setProgress, runId);
      if (runId !== solveRunId) return;
      activeIndex = 0;
      if (!variants.length) {
        throw new Error($("controllerOn").checked
          ? "Nie znaleziono wariantu mieszczącego wymagany sterownik. Zmniejsz jego wymiary, margines ramy lub odstęp ogniw albo powiększ obrys."
          : "Nie znaleziono wariantu. Zmniejsz margines lub odstępy między ogniwami albo powiększ obrys.");
      }
      setProgress(100, `Znaleziono ${variants.length} najlepsze warianty. Parametry elektryczne pakietu:`);
      if (currentStage === 2) {
        invalidateStage2Assignment();
        renderStage2(true);
      } else render();
      if (typeof updateNextBtn === "function") updateNextBtn();
    } catch (err) {
      if (runId !== solveRunId) return;
      $("status").className = "status error";
      $("status").textContent = err.message;
      $("progressBar").style.width = "0";
    } finally {
      if (runId === solveRunId) btn.disabled = false;
    }
  }

  function loadDemo() {
    autoControllerPreference = null;
    $("sideA").value = 525; $("sideB").value = 455; $("sideC").value = 620;
    $("cellType").value = "21";
    if ($("savedCellProfileSelect")) $("savedCellProfileSelect").value = "";
    renderSavedCellProfileOptions();
    $("frameMargin").value = 9; $("cellGap").value = 1.5;
    $("controllerOn").checked = true; $("controllerW").value = 92; $("controllerH").value = 42;
    $("cellAh").value = 5000; $("cellVoltage").value = 3.6;
    $("cellStandardDischarge").value = 5; $("cellMaxDischarge").value = 10;
    $("cellStandardCharge").value = 2; $("cellMaxCharge").value = 5;
    $("seriesSelect").value = "13"; $("layoutMode").value = "both";
    syncStage3CellGeometryFromType();
    runSolve();
  }

  function startManualMode() {
    if (!validateCellElectricalParameters()) return;
    const variant = variants[activeIndex] || null;
    const sourceCells = variant && Array.isArray(variant.cells) ? variant.cells : [];
    manualMode = true;
    cellOverrides = {};
    manualS = selectedSeries();
    manualP = sourceCells.length ? Math.max(1, Math.floor(sourceCells.length / Math.max(1, manualS))) : 0;
    activeDrawSec = 0; selectedCellId = null;
    manualSelectedCellIds = new Set();
    manualControllerSelected = false;
    manualVariant = variant ? {
      ...variant,
      cells: sourceCells.map(c => ({ ...c, section: null, parallelIndex: null }))
    } : { triInfo: cloneBoundary(placementBoundary), controller: null, cells: [] };
    manualGridStyle = variant?.layout || manualGridStyle;
    manualCellSize = readNumber("cellType") || manualCellSize;
    manualCellGap = readNumber("cellGap");
    manualGridAngle = variant?.angle ? variant.angle * Math.PI / 180 : 0;
    if (variant?.triInfo && Number.isFinite(variant.ox) && Number.isFinite(variant.oy)) {
      const bounds = polygonBounds(boundaryPoints(variant.triInfo));
      const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
      const cos = Math.cos(manualGridAngle), sin = Math.sin(manualGridAngle);
      manualGridOrigin = {
        x: center.x + variant.ox * cos - variant.oy * sin,
        y: center.y + variant.ox * sin + variant.oy * cos
      };
    } else {
      manualGridOrigin = { x: 0, y: 0 };
    }
    const style = $("manualGridStyle");
    const size = $("manualCellSize");
    const gap = $("manualCellGap");
    const controllerW = $("manualControllerW");
    const controllerH = $("manualControllerH");
    if (style) style.value = manualGridStyle;
    if (size) size.value = manualCellSize;
    if (gap) gap.value = manualCellGap;
    if (controllerW) controllerW.value = manualVariant.controller?.w || 90;
    if (controllerH) controllerH.value = manualVariant.controller?.h || 45;
    $("manualTransformTools").hidden = false;
    resetManualHistory();
    updateNextBtn();
    render();
  }

  function manualGridPoint(row, col) {
    const pitch = manualCellSize + manualCellGap;
    const stagger = manualGridStyle === "honeycomb" && row % 2 !== 0 ? pitch / 2 : 0;
    const localX = col * pitch + stagger;
    const localY = row * (manualGridStyle === "honeycomb" ? pitch * Math.sqrt(3) / 2 : pitch);
    const cos = Math.cos(manualGridAngle), sin = Math.sin(manualGridAngle);
    return {
      x: manualGridOrigin.x + localX * cos - localY * sin,
      y: manualGridOrigin.y + localX * sin + localY * cos
    };
  }

  function manualLocalPoint(x, y) {
    const dx = x - manualGridOrigin.x, dy = y - manualGridOrigin.y;
    const cos = Math.cos(manualGridAngle), sin = Math.sin(manualGridAngle);
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  }

  function manualGridRowStep() {
    const pitch = manualCellSize + manualCellGap;
    return manualGridStyle === "honeycomb" ? pitch * Math.sqrt(3) / 2 : pitch;
  }

  function nearestManualSlot(x, y) {
    const pitch = manualCellSize + manualCellGap;
    const local = manualLocalPoint(x, y);
    const rowStep = manualGridRowStep();
    const rowEstimate = Math.round(local.y / rowStep);
    const colEstimate = Math.round(local.x / pitch);
    let best = null;
    let distance = pitch * 0.72;
    for (let row = rowEstimate - 2; row <= rowEstimate + 2; row++) {
      for (let col = colEstimate - 2; col <= colEstimate + 2; col++) {
        const point = manualGridPoint(row, col);
        const d = Math.hypot(x - point.x, y - point.y);
        if (d < distance) { distance = d; best = { row, col, ...point }; }
      }
    }
    return best;
  }

  function manualGizmoSvg() {
    const cells = manualSelectionCells();
    const controller = manualControllerSelected && manualVariant ? manualVariant.controller : null;
    const pivot = manualSelectionPivot(cells, controller);
    if (!pivot) return "";
    const size = Math.max(18, (manualCellSize + manualCellGap) * 2.2);
    const rotateRadius = size * .78;
    return `<defs>
      <marker id="manualGizmoArrowX" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#f87171"/></marker>
      <marker id="manualGizmoArrowY" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#60a5fa"/></marker>
    </defs>
    <g class="manual-gizmo" data-manual-gizmo="true">
      <line class="manual-gizmo-hit" data-gizmo-action="move-x" x1="${pivot.x}" y1="${pivot.y}" x2="${pivot.x + size}" y2="${pivot.y}" stroke="#f87171" stroke-width="3" marker-end="url(#manualGizmoArrowX)"/>
      <line class="manual-gizmo-hit" data-gizmo-action="move-y" x1="${pivot.x}" y1="${pivot.y}" x2="${pivot.x}" y2="${pivot.y - size}" stroke="#60a5fa" stroke-width="3" marker-end="url(#manualGizmoArrowY)"/>
      <circle class="manual-gizmo-hit" data-gizmo-action="rotate" cx="${pivot.x}" cy="${pivot.y}" r="${rotateRadius}" fill="none" stroke="#fbbf24" stroke-width="3" stroke-dasharray="5 3"/>
      <text class="manual-gizmo-label" x="${pivot.x + size + 4}" y="${pivot.y + 3}" fill="#f87171">X</text>
      <text class="manual-gizmo-label" x="${pivot.x + 3}" y="${pivot.y - size - 4}" fill="#60a5fa">Y</text>
      <text class="manual-gizmo-label" x="${pivot.x + rotateRadius + 4}" y="${pivot.y - 4}" fill="#fbbf24">obrót</text>
    </g>`;
  }

  function renderManualBoard(svg) {
    const cells = manualVariant ? manualVariant.cells : [];
    const tri = manualVariant && manualVariant.triInfo ? boundaryPoints(manualVariant.triInfo) : null;
    const controller = manualVariant && manualVariant.controller ? manualVariant.controller : null;
    const pitch = manualCellSize + manualCellGap;
    const radius = manualCellSize / 2;
    const sourcePoints = tri || (cells.length ? cells : [{ x: -220, y: -180 }, { x: 220, y: -180 }, { x: 0, y: 220 }]);
    const boundsPoints = controller ? sourcePoints.concat(rotatedRectCorners(controller)) : sourcePoints;
    const gridBoundsPoints = cells.length ? cells.concat(boundsPoints) : boundsPoints;
    const xs = gridBoundsPoints.map(p => p.x), ys = gridBoundsPoints.map(p => p.y);
    const pad = Math.max(80, pitch * 6);
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    const width = maxX - minX, height = maxY - minY;
    setWorkspaceViewBox(svg);
    const gridRadius = Math.ceil(Math.max(width, height) / pitch) + 8;
    const gridStartRow = -gridRadius, gridEndRow = gridRadius;
    const gridStartCol = -gridRadius, gridEndCol = gridRadius;
    let grid = "";
    for (let row = gridStartRow; row <= gridEndRow; row++) {
      for (let col = gridStartCol; col <= gridEndCol; col++) {
        const p = manualGridPoint(row, col);
        if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
        const nearestCellDistance = cells.length ? Math.min(...cells.map(cell => Math.hypot(cell.x - p.x, cell.y - p.y))) : Infinity;
        const proximity = Math.max(0, 1 - nearestCellDistance / (pitch * 4));
        const strokeAlpha = (0.25 + proximity * 0.65).toFixed(2);
        const stroke = `rgba(226,232,240,${strokeAlpha})`;
        const strokeWidth = (0.8 + proximity * 0.7).toFixed(2);
        grid += manualGridStyle === "honeycomb"
          ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(radius * .88).toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`
          : `<rect x="${(p.x - radius * .88).toFixed(1)}" y="${(p.y - radius * .88).toFixed(1)}" width="${(radius * 1.76).toFixed(1)}" height="${(radius * 1.76).toFixed(1)}" rx="2" fill="none" stroke="${stroke}" stroke-width="${strokeWidth}"/>`;
      }
    }
    const frame = tri ? `<polygon points="${tri.map(p => `${p.x},${p.y}`).join(" ")}" fill="rgba(20,184,166,.025)" stroke="var(--frame)" stroke-width="2.5"/>` : "";
    const cellSvg = cells.map(c => {
      const selected = manualSelectedCellIds.has(c.id);
      return `<g class="manual-cell" data-cid="${c.id}" style="cursor:pointer"><circle cx="${c.x.toFixed(2)}" cy="${c.y.toFixed(2)}" r="${radius.toFixed(2)}" fill="#d8dee8" stroke="${selected ? "#f59e0b" : "var(--cell-stroke)"}" stroke-width="${selected ? "2.2" : ".9"}"/></g>`;
    }).join("");
    const controllerSvg = controller ? `<g class="manual-controller" data-controller="true" style="cursor:pointer"><polygon points="${rotatedRectCorners(controller).map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ")}" fill="${manualControllerSelected ? "rgba(245,158,11,.32)" : "#ffe8b3"}" stroke="${manualControllerSelected ? "#f59e0b" : "#9a6700"}" stroke-width="${manualControllerSelected ? "3" : "2"}"/><text x="${controller.cx.toFixed(2)}" y="${(controller.cy + 4).toFixed(2)}" text-anchor="middle" font-size="11" font-weight="800" fill="#694600" transform="rotate(${(controller.angle || 0).toFixed(2)} ${controller.cx.toFixed(2)} ${controller.cy.toFixed(2)})">sterownik</text></g>` : "";
    svg.innerHTML = `<defs><radialGradient id="manualGridFade"><stop offset="0" stop-color="#cbd5e1" stop-opacity=".78"/><stop offset=".52" stop-color="#94a3b8" stop-opacity=".42"/><stop offset=".82" stop-color="#64748b" stop-opacity=".16"/><stop offset="1" stop-color="#475569" stop-opacity="0"/></radialGradient><mask id="manualGridMask" maskUnits="userSpaceOnUse" x="${minX}" y="${minY}" width="${width}" height="${height}"><rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="url(#manualGridFade)"/></mask></defs><g mask="url(#manualGridMask)">${grid}</g>${frame}${controllerSvg}${cellSvg}${manualGizmoSvg()}`;
    svg.onwheel = e => zoomWorkspace(e, svg);
    svg.onpointerdown = e => { if (!beginWorkspacePan(e, svg)) beginManualGizmoDrag(e, svg); };
    $("status").className = "status";
    $("status").innerHTML = `<strong style="color:var(--accent)">Tryb ręcznego malowania</strong><br/><span style="font-size:11px;opacity:.85">LPM – dodaj ogniwo · PPM – usuń ogniwo · ${cells.length} ogniw na planszy</span>`;
    $("progressBar").style.width = "0";
    svg.onclick = e => {
      if (e.button === 2) return;
      if (workspacePan?.moved || workspacePanJustMoved) { workspacePan = null; workspacePanJustMoved = false; return; }
      if (e.target.closest("[data-manual-gizmo]")) return;
      const target = e.target.closest(".manual-cell, .manual-controller");
      if (e.ctrlKey && target) {
        if (target.dataset.controller) manualControllerSelected = !manualControllerSelected;
        else {
          const id = Number(target.dataset.cid);
          if (manualSelectedCellIds.has(id)) manualSelectedCellIds.delete(id); else manualSelectedCellIds.add(id);
        }
        render();
        return;
      }
      if (!target && (manualSelectedCellIds.size > 0 || manualControllerSelected)) {
        manualSelectedCellIds.clear();
        manualControllerSelected = false;
        render();
        return;
      }
      if (target && target.classList.contains("manual-cell")) return;
      if (target && target.classList.contains("manual-controller")) return;
      const point = svgPoint(e, svg), slot = nearestManualSlot(point.x, point.y);
      if (!slot) return;
      const exists = cells.findIndex(c => c.row === slot.row && c.col === slot.col);
      if (exists >= 0) return;
      const before = manualSnapshot();
      cells.push({ id: Date.now() + Math.random(), row: slot.row, col: slot.col, x: slot.x, y: slot.y, section: null, parallelIndex: null });
      commitManualHistory(before);
      render();
    };
    svg.oncontextmenu = e => {
      e.preventDefault();
      if (e.target.closest("[data-manual-gizmo]")) return;
      if (e.target.closest(".manual-controller")) return;
      const point = svgPoint(e, svg);
      let index = cells.findIndex(c => Math.hypot(c.x - point.x, c.y - point.y) <= radius * 1.3);
      if (index < 0) { const slot = nearestManualSlot(point.x, point.y); if (slot) index = cells.findIndex(c => c.row === slot.row && c.col === slot.col); }
      if (index >= 0) {
        const before = manualSnapshot();
        const removed = cells[index];
        cells.splice(index, 1);
        manualSelectedCellIds.delete(removed.id);
        commitManualHistory(before);
        render();
      }
    };
  }

  function svgPoint(e, svg) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const local = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: local.x, y: local.y };
  }

  function roundManualMillimetres(value) {
    return Math.round(value * 1000) / 1000;
  }

  function beginManualGizmoDrag(e, svg) {
    const handle = e.target.closest("[data-gizmo-action]");
    if (!handle || !manualMode || !manualVariant) return;
    e.preventDefault();
    e.stopPropagation();
    const cells = manualSelectionCells();
    const controller = manualControllerSelected && manualVariant.controller ? { ...manualVariant.controller } : null;
    const pivot = manualSelectionPivot(cells, controller);
    if (!pivot) return;
    const point = svgPoint(e, svg);
    manualDrag = {
      before: manualSnapshot(),
      action: handle.dataset.gizmoAction,
      pivot,
      startPoint: point,
      startAngle: Math.atan2(point.y - pivot.y, point.x - pivot.x),
      cells: cells.map(c => ({ id: c.id, x: c.x, y: c.y, row: c.row, col: c.col })),
      controller,
      origin: { ...manualGridOrigin },
      gridAngle: manualGridAngle,
      allCellsSelected: cells.length === manualVariant.cells.length && cells.length > 0
    };
  }

  function updateManualGizmoDrag(e) {
    if (!manualDrag || !manualVariant) return;
    const drag = manualDrag;
    const svg = $("drawing");
    const point = svgPoint(e, svg);
    let dx = point.x - drag.startPoint.x;
    let dy = point.y - drag.startPoint.y;
    const cellsById = new Map(manualVariant.cells.map(c => [c.id, c]));
    if (drag.action === "move-x" || drag.action === "move-y") {
      if (drag.action === "move-x") dy = 0; else dx = 0;
      dx = roundManualMillimetres(dx); dy = roundManualMillimetres(dy);
      drag.cells.forEach(snapshot => {
        const cell = cellsById.get(snapshot.id);
        if (!cell) return;
        cell.x = snapshot.x + dx; cell.y = snapshot.y + dy;
        if (!drag.allCellsSelected) { cell.row = null; cell.col = null; }
      });
      if (drag.controller && manualVariant.controller) {
        manualVariant.controller.cx = drag.controller.cx + dx;
        manualVariant.controller.cy = drag.controller.cy + dy;
      }
      if (drag.allCellsSelected) {
        manualGridOrigin.x = drag.origin.x + dx;
        manualGridOrigin.y = drag.origin.y + dy;
      }
    } else if (drag.action === "rotate") {
      const currentAngle = Math.atan2(point.y - drag.pivot.y, point.x - drag.pivot.x);
      const degrees = roundManualMillimetres((currentAngle - drag.startAngle) * 180 / Math.PI);
      const angle = degrees * Math.PI / 180;
      drag.cells.forEach(snapshot => {
        const cell = cellsById.get(snapshot.id);
        if (!cell) return;
        const rotated = rotateManualPoint(snapshot, drag.pivot, angle);
        cell.x = roundManualMillimetres(rotated.x); cell.y = roundManualMillimetres(rotated.y);
        if (!drag.allCellsSelected) { cell.row = null; cell.col = null; }
      });
      if (drag.controller && manualVariant.controller) {
        const rotated = rotateManualPoint({ x: drag.controller.cx, y: drag.controller.cy }, drag.pivot, angle);
        manualVariant.controller.cx = roundManualMillimetres(rotated.x);
        manualVariant.controller.cy = roundManualMillimetres(rotated.y);
        manualVariant.controller.angle = roundManualMillimetres((drag.controller.angle || 0) + degrees);
      }
      if (drag.allCellsSelected) {
        const rotatedOrigin = rotateManualPoint(drag.origin, drag.pivot, angle);
        manualGridOrigin = { x: roundManualMillimetres(rotatedOrigin.x), y: roundManualMillimetres(rotatedOrigin.y) };
        manualGridAngle = drag.gridAngle + angle;
      }
    }
    render();
  }

  function manualSelectionCells() {
    const cells = manualVariant ? manualVariant.cells : [];
    return cells.filter(c => manualSelectedCellIds.has(c.id));
  }

  function manualSelectionPivot(cells, controller) {
    const points = cells.map(c => ({ x: c.x, y: c.y }));
    if (controller) points.push({ x: controller.cx, y: controller.cy });
    if (!points.length) return null;
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
      y: points.reduce((sum, p) => sum + p.y, 0) / points.length
    };
  }

  function rotateManualPoint(point, pivot, angle) {
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = point.x - pivot.x, dy = point.y - pivot.y;
    return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
  }

  function selectAllManual() {
    if (!manualMode || !manualVariant) return;
    manualSelectedCellIds = new Set(manualVariant.cells.map(c => c.id));
    manualControllerSelected = Boolean(manualVariant.controller);
    render();
  }

  function exportSvg() {
    const svg = $("drawing").cloneNode(true);
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const blob = new Blob([svg.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pakiet-baterii-rower.svg"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function scheduleStage2ControllerSolve() {
    if (manualMode || (currentStage !== 1 && currentStage !== 2) || (currentStage === 1 && stage1Substep !== 2)) return;
    if (stage2ControllerSolveTimer) clearTimeout(stage2ControllerSolveTimer);
    stage2ControllerSolveTimer = setTimeout(() => {
      stage2ControllerSolveTimer = null;
      cellOverrides = {};
      runSolve();
    }, 120);
  }
