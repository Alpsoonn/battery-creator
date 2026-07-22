  // ===== Stage navigation =====

  function buildStage4PackageData() {
    const variant = manualMode ? manualVariant : variants[activeIndex];
    if (!variant) return null;
    const series = selectedSeries();
    const cells = getStage2Assignment(variant, series).filter(cell => Number.isInteger(cell.section)).map(cell => ({ id: cell.id, x: cell.x, y: cell.y, section: cell.section, parallelIndex: cell.parallelIndex }));
    const sectionCounts = Array.from({ length: series }, (_, section) => cells.filter(cell => cell.section === section).length);
    return {
      cells,
      boundary: variant.triInfo ? boundaryPoints(variant.triInfo).map(point => ({ x: point.x, y: point.y })) : [],
      series,
      parallel: Math.max(1, ...sectionCounts),
      tapes: stage3NickelSnapshot(),
      polarityReversed: stage3PolarityReversed,
      stripSelection: { ...stage3StripSelection },
      stripMaterial: stage3StripCatalog.materials[stage3StripSelection.materialId] || null,
      cellModel: stage3CellModel ? JSON.parse(JSON.stringify(stage3CellModel)) : null,
      visualCellDiameterMm: Math.max(1, stage3CellModel?.geometry?.diameter_mm || readNumber("cellType") || 21),
      routing: {
        valid: Boolean(stage3LastValidation?.valid),
        settings: stage3RoutingSettings(),
        metrics: stage3LastAnalysis ? { ...stage3LastAnalysis.metrics } : null,
        mainLeads: { negative: [...stage3MainLeads.negative], positive: [...stage3MainLeads.positive] }
      }
    };
  }

  const stage4Simulation = typeof Stage4Simulation === "function" ? new Stage4Simulation(buildStage4PackageData) : null;

  function goToStage(n) {
    currentStage = n;
    [1,2,3,4].forEach(i => {
      const c = $(`stage-${i}`);
      const b = $(`nav-s${i-1}`);
      if (c) c.classList.toggle('active', i === n);
      if (b) b.classList.toggle('active', i === n);
    });
    updateNextBtn();
    if (n === 2) {
      invalidateStage2Assignment();
      renderStage2(true);
    }
    if (n === 3) renderStage3();
    if (n === 4) {
      if (!stage4Simulation) {
        currentStage = 3;
        stage3Notice = "Nie można uruchomić symulacji: brak modułu Stage4Simulation. Odśwież stronę i sprawdź, czy wszystkie pliki JavaScript zostały opublikowane.";
        renderStage3();
        updateNextBtn();
        return;
      }
      stage4Simulation.enter();
    }
  }

  function updateNextBtn() {
    const hasVariants = variants.length > 0 || (manualMode && manualVariant && manualVariant.cells.length > 0);
    $('nav-s1').disabled = !hasVariants;
    $('nav-s2').disabled = !hasVariants;
    $('nav-s3').disabled = !hasVariants || stage3LastValidation?.simulationAllowed !== true || !stage4Simulation;
  }

  function stage3CanEnterSimulation() {
    const report = stage3ValidateNickelLayout();
    stage3LastValidation = report;
    stage3LastAnalysis = report.analysis;
    updateNextBtn();
    if (report.simulationAllowed) return true;
    stage3Notice = `Przejście do symulacji zablokowane: ${report.blockingIssues.slice(0, 3).join(" ")}`;
    goToStage(3);
    return false;
  }

  $('nav-s0').addEventListener('click', () => goToStage(1));
  $('nav-s1').addEventListener('click', () => { if (variants.length || (manualMode && manualVariant?.cells.length)) goToStage(2); });
  $('nav-s2').addEventListener('click', () => { if (variants.length || (manualMode && manualVariant?.cells.length)) goToStage(3); });
  $('nav-s3').addEventListener('click', () => { if ((variants.length || (manualMode && manualVariant?.cells.length)) && stage3CanEnterSimulation()) goToStage(4); });


  // ===== Event listeners =====
  $("solveBtn").addEventListener("click", () => { manualMode = false; cellOverrides = {}; selectedCellId = null; runSolve(); });
  $("btn-auto-mode").addEventListener("click", setAutoMode);
  $("btn-manual-mode").addEventListener("click", setManualModeBtn);
  $("demoBtn").addEventListener("click", () => { manualMode = false; loadDemo(); });
  $("exportBtn").addEventListener("click", () => {
    $("cellLibraryMenu").hidden = true;
    $("cellLibraryButton").setAttribute("aria-expanded", "false");
    exportSvg();
  });
  document.addEventListener("keydown", e => {
    if (!$("cellProfileModal")?.hidden) {
      if (e.key === "Escape") closeCellProfileCreator();
      if (e.key === "Tab") {
        const focusable = [...$("cellProfileModal").querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(element => !element.hidden && element.offsetParent !== null);
        if (focusable.length) {
          const first = focusable[0], last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      return;
    }
    const editingBoundary = currentStage === 1 && stage1Substep === 1 && boundaryType === "manual";
    const editingFormField = /^(INPUT|SELECT|TEXTAREA)$/.test(e.target?.tagName || "") || e.target?.isContentEditable;
    if (editingBoundary && e.key === "Escape") {
      if (cancelBoundaryImageInteraction()) { e.preventDefault(); return; }
      if (boundaryImageCalibration.active) {
        e.preventDefault();
        boundaryImageCalibration = { active: false, points: [] };
        $("boundaryImageCalibrationStatus").textContent = "Kalibracja anulowana.";
        renderBoundaryStage();
        return;
      }
      if (boundaryImageSelected) {
        e.preventDefault();
        boundaryImageSelected = false;
        renderBoundaryStage();
        return;
      }
    }
    if (editingBoundary && boundaryImageSelected && boundaryReferenceImage && !boundaryReferenceImage.locked && !editingFormField && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const before = boundarySnapshot(), step = e.shiftKey ? 10 : 1;
      if (e.key === "ArrowLeft") boundaryReferenceImage.transform.x -= step;
      if (e.key === "ArrowRight") boundaryReferenceImage.transform.x += step;
      if (e.key === "ArrowUp") boundaryReferenceImage.transform.y -= step;
      if (e.key === "ArrowDown") boundaryReferenceImage.transform.y += step;
      commitBoundaryHistory(before);
      updateBoundaryImageDom();
      return;
    }
    if (editingBoundary && boundaryImageSelected && boundaryReferenceImage && !editingFormField && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      removeBoundaryReferenceImage();
      return;
    }
    if (manualMode && e.key === "Escape" && cancelManualTransformInteraction()) {
      e.preventDefault();
      return;
    }
    if (manualMode && !editingFormField && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && (manualSelectedCellIds.size || manualControllerSelected)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      nudgeManualSelection(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
      return;
    }
    if (manualMode && !editingFormField && (e.key === "Delete" || e.key === "Backspace") && (manualSelectedCellIds.size || manualControllerSelected)) {
      e.preventDefault();
      deleteManualSelection();
      return;
    }
    if (e.code === "Space") { spacePressed = true; e.preventDefault(); return; }
    if (currentStage === 3 && e.ctrlKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undoStage3Nickel();
      return;
    }
    if (currentStage === 3 && e.ctrlKey && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      redoStage3Nickel();
      return;
    }
    if (editingBoundary && e.ctrlKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undoBoundaryChange();
      return;
    }
    if (editingBoundary && e.ctrlKey && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      redoBoundaryChange();
      return;
    }
    if (manualMode && e.ctrlKey && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault();
      undoManualChange();
      return;
    }
    if (manualMode && e.ctrlKey && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
      e.preventDefault();
      redoManualChange();
      return;
    }
    if (!manualMode) return;
    if (e.ctrlKey && e.key.toLowerCase() === "a") {
      e.preventDefault();
      selectAllManual();
      return;
    }
  });
  document.addEventListener("keyup", e => { if (e.code === "Space") spacePressed = false; });
  window.addEventListener("pointermove", updateManualGizmoDrag);
  window.addEventListener("pointermove", updateManualCellPaint);
  window.addEventListener("pointerup", e => {
    finishManualCellPaint(e);
    finishManualTransformInteraction(e);
    if (manualSuppressNextClick) setTimeout(() => { manualSuppressNextClick = false; }, 0);
  });
  window.addEventListener("pointercancel", e => {
    finishManualCellPaint(e);
    manualSuppressNextClick = false;
    cancelManualTransformInteraction(e);
  });
  window.addEventListener("pointermove", updateAutomaticControllerDrag);
  window.addEventListener("pointermove", updateWorkspacePan);
  window.addEventListener("pointermove", updateBoundaryDrag);
  window.addEventListener("pointermove", updateBoundaryImageDrag);
  window.addEventListener("pointerup", finishBoundaryDrag);
  window.addEventListener("pointercancel", finishBoundaryDrag);
  window.addEventListener("pointerup", finishAutomaticControllerDrag);
  window.addEventListener("pointercancel", finishAutomaticControllerDrag);
  window.addEventListener("pointerup", finishBoundaryImageDrag);
  window.addEventListener("pointercancel", cancelBoundaryImageInteraction);
  window.addEventListener("pointerup", finishWorkspacePan);
  window.addEventListener("pointercancel", finishWorkspacePan);
  window.addEventListener("mouseup", () => {
    finishWorkspacePan();
  });
  window.addEventListener("blur", () => {
    finishManualCellPaint();
    cancelBoundaryImageInteraction();
    cancelManualTransformInteraction();
    workspacePan = null;
    workspacePanJustMoved = false;
    autoControllerDrag = null;
    if (autoControllerDragFrame !== null) cancelAnimationFrame(autoControllerDragFrame);
    autoControllerDragFrame = null;
  });
  const handleDragOver = e => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const handleDrop = e => {
    e.preventDefault();
    e.stopPropagation();
    if (currentStage === 1 && stage1Substep === 1 && boundaryType === "manual") {
      const file = e.dataTransfer?.files?.[0];
      if (file) loadBoundaryReferenceImage(file);
    }
  };

  window.addEventListener("dragenter", e => e.preventDefault());
  window.addEventListener("dragover", e => e.preventDefault());
  window.addEventListener("drop", e => e.preventDefault());

  const svgElement = $("drawing");
  const shellElement = $("boundaryCanvasShell");
  if (svgElement) {
    svgElement.addEventListener("dragenter", e => e.preventDefault());
    svgElement.addEventListener("dragover", handleDragOver);
    svgElement.addEventListener("drop", handleDrop);
  }
  if (shellElement) {
    shellElement.addEventListener("dragenter", e => e.preventDefault());
    shellElement.addEventListener("dragover", handleDragOver);
    shellElement.addEventListener("drop", handleDrop);
  }
  window.addEventListener("resize", () => {
    if (currentStage === 1 && stage1Substep === 1 && boundaryType === "manual" && boundaryReferenceImage) updateBoundaryImageDom();
  });
  $("manualGridStyle").addEventListener("change", (e) => {
    const before = manualSnapshot();
    manualGridStyle = e.target.value;
    syncManualGridAttachedCells();
    commitManualHistory(before);
    if (manualMode) render();
  });
  $("manualCellGap").addEventListener("input", (e) => {
    const before = manualSnapshot();
    manualCellGap = Math.max(0, Number(e.target.value) || 0);
    if ($("cellGap")) $("cellGap").value = String(manualCellGap);
    syncManualGridAttachedCells();
    commitManualHistory(before);
    if (manualMode) render();
  });
  $("manual-controller-add").addEventListener("click", () => {
    if (!manualVariant) return;
    const before = manualSnapshot();
    const cx = Number($("manualControllerX").value);
    const cy = Number($("manualControllerY").value);
    const w = Math.max(1, Number($("manualControllerW").value) || 90);
    const h = Math.max(1, Number($("manualControllerH").value) || 45);
    const angle = Number($("manualControllerRotation").value);
    const next = {
      cx: Number.isFinite(cx) ? cx : manualGridOrigin.x,
      cy: Number.isFinite(cy) ? cy : manualGridOrigin.y,
      w,
      h,
      angle: Number.isFinite(angle) ? angle : 0
    };
    if (!manualVariant.controller) manualVariant.controller = next;
    else Object.assign(manualVariant.controller, next);
    manualSelectedCellIds.clear();
    manualControllerSelected = true;
    commitManualHistory(before);
    syncManualControllerFields();
    if (currentStage === 2) renderStage2(); else render();
  });
  ["manualControllerX", "manualControllerY", "manualControllerW", "manualControllerH", "manualControllerRotation"].forEach(id => {
    const field = $(id);
    field.addEventListener("focus", beginManualControllerFieldEdit);
    field.addEventListener("pointerdown", beginManualControllerFieldEdit);
    field.addEventListener("input", (e) => applyManualControllerField(id, e.target.value));
    field.addEventListener("change", finishManualControllerFieldEdit);
    field.addEventListener("blur", finishManualControllerFieldEdit);
  });
  $("manualControllerAspectLock").addEventListener("click", () => {
    manualControllerAspectLocked = !manualControllerAspectLocked;
    syncManualControllerFields();
  });
  $("manual-clear").addEventListener("click", () => {
    if (!manualVariant) startManualMode();
    if (!manualVariant) return;
    const before = manualSnapshot();
    manualVariant.cells = [];
    commitManualHistory(before);
    render();
  });
  $("seriesSelect").addEventListener("input", () => {
    updateSeriesVoltageDisplay();
    if (currentStage === 2) {
      stage2ActiveSection = Math.min(stage2ActiveSection, selectedSeries() - 1);
      scheduleStage2Recompute();
    } else if (!manualMode) render();
  });
  $("stage2Method").addEventListener("change", e => {
    activeVariantTab = Number(e.target.value);
    stage2SelectedCellId = null;
    stage2Notice = "";
    updateStage2MethodOptions();
    if (stage2ManualMode) {
      const variant = manualMode ? manualVariant : variants[activeIndex];
      if (variant?.cells) variant.cells.forEach(cell => { cell.section = null; cell.parallelIndex = null; });
    }
    invalidateStage2Assignment();
    if (currentStage === 2) renderStage2(true);
  });
  $("stage3ReversePolarity").addEventListener("change", e => {
    stage3PolarityReversed = e.target.checked;
    ["front", "back"].forEach(side => stage3NickelConnections[side].forEach(connection => { connection.electrical_node = null; }));
    stage3MainLeads = { negative: [], positive: [] };
    stage3ManualPackTarget = null;
    stage3PackLeadDiagnostics = { negative: null, positive: null };
    stage3LastPassagePlan = null;
    if (currentStage === 3) {
      stage3RefreshAnalysis();
      stage3Notice = "Zmieniono polaryzację. Istniejące taśmy zostały ponownie zweryfikowane; w razie zwarć uruchom automatyczne trasowanie.";
      renderStage3();
    }
  });
  $("stage3BackFlipHorizontal").addEventListener("click", () => {
    stage3BackFlipHorizontal = !stage3BackFlipHorizontal;
    if (currentStage === 3) renderStage3();
  });
  $("stage3BackFlipVertical").addEventListener("click", () => {
    stage3BackFlipVertical = !stage3BackFlipVertical;
    if (currentStage === 3) renderStage3();
  });
  ["stage3RouteStrategy", "stage3RouteMaxTemp", "stage3RouteMaxDrop", "stage3RouteMaxDensity", "stage3RouteSafety", "stage3RouteClearance", "stage3RouteLossImprovement", "stage3RouteBalanceImprovement"].forEach(id => {
    const control = $(id);
    if (!control) return;
    control.addEventListener("change", () => {
      stage3LastPassagePlan = null;
      if (currentStage === 3 && (stage3NickelConnections.front.length || stage3NickelConnections.back.length)) {
        stage3RefreshAnalysis();
        stage3Notice = "Zmieniono limity trasowania. Uruchom ponowną optymalizację, aby dobrać przekroje i trasy do nowych wartości.";
        renderStage3();
      }
    });
  });
  $("stage3StripTree").addEventListener("click", event => {
    const option = event.target.closest("[data-strip-material][data-strip-preset]");
    if (!option) return;
    applyStage3StripSelection(option.dataset.stripMaterial, option.dataset.stripPreset);
  });
  $("stage3CellModelCard").addEventListener("input", event => {
    if (event.target.matches("input, textarea")) {
      if (activeSavedCellProfile()) stage3CellProfileDirty = true;
      collectStage3CellModel();
    }
  });
  $("stage3CellModelCard").addEventListener("change", event => {
    if (event.target.id === "stage3CellProfileSelect") {
      const profile = savedCellProfiles.find(item => item.id === event.target.value && item.formatId === selectedCellFormatId()) || null;
      stage3CellProfileDirty = false;
      $("savedCellProfileSelect").value = profile?.id || "";
      if (profile) applySavedCellProfile(profile);
      else {
        renderStage3CellProfileOptions();
        setStage3CellProfileEditorState(null);
        collectStage3CellModel();
      }
      applyStage2CurrentValidity();
      if (currentStage === 3) renderStage3();
      return;
    }
    if (activeSavedCellProfile()) stage3CellProfileDirty = true;
    if (event.target.id === "stage3CellChemistry") {
      applyStage3CellChemistryDefaults(event.target.value);
      return;
    }
    if (event.target.id === "stage3CellOcvMode") {
      $("stage3CellOcvCustomWrap").hidden = event.target.value !== "custom";
    }
    collectStage3CellModel();
  });
  $("stage3ManageCellProfiles").addEventListener("click", () => openCellProfileManager(activeSavedCellProfile()?.id || null));
  $("stage3ClearNickel").addEventListener("click", () => {
    stage3NickelConnections.front = [];
    stage3NickelConnections.back = [];
    stage3LastAnalysis = null;
    stage3LastValidation = null;
    stage3MainLeads = { negative: [], positive: [] };
    stage3ManualPackTarget = null;
    stage3PackLeadDiagnostics = { negative: null, positive: null };
    stage3LastPassagePlan = null;
    commitStage3NickelHistory();
    stage3Notice = "Usunięto wszystkie odcinki taśmy.";
    if (currentStage === 3) renderStage3();
  });
  $("stage3AutoNickel").addEventListener("click", generateStage3NickelLayout);
  $("stage3OptimizeNickel").addEventListener("click", generateStage3NickelLayout);
  ["negative", "positive"].forEach(target => {
    $(target === "negative" ? "stage3ManualPackNegative" : "stage3ManualPackPositive")?.addEventListener("pointerdown", event => {
      event.preventDefault();
      event.stopPropagation();
      if (stage3PackPlacementMode !== "manual") return;
      stage3ManualPackTarget = stage3ManualPackTarget === target ? null : target;
      stage3Notice = stage3ManualPackTarget
        ? `Wybierz ogniwo dla ${target === "negative" ? "−PACK" : "+PACK"}. Dostępne punkty na gotowej magistrali oznaczono żółtym obrysem.`
        : "Anulowano wybór punktu PACK.";
      if (currentStage === 3) renderStage3();
    });
  });
  $("stage3PackPlacement")?.addEventListener("change", event => {
    stage3PackPlacementMode = event.target.value === "manual" ? "manual" : "automatic";
    stage3ManualPackTarget = null;
    const context = stage3AutomationContext();
    if (stage3PackPlacementMode === "automatic" && context && (stage3NickelConnections.front.length || stage3NickelConnections.back.length)) {
      stage3ChooseAutomaticPackLeads(context, stage3NickelConnections);
      stage3RefreshAnalysis();
      stage3Notice = "Ponownie wyznaczono elektrycznie najlepsze punkty +PACK i −PACK.";
    } else if (stage3PackPlacementMode === "manual") {
      stage3MainLeads = { negative: [], positive: [] };
      stage3PackLeadDiagnostics = { negative: null, positive: null };
      stage3Notice = "Tryb ręczny PACK: wybierz kafelek −PACK albo +PACK, a następnie wskaż podświetlone ogniwo.";
    }
    if (currentStage === 3) renderStage3();
  });
  $("stage3ShowNodeLabels")?.addEventListener("change", event => {
    stage3ShowNodeLabels = event.target.checked;
    if (currentStage === 3) renderStage3();
  });
  $("stage3ShowCurrentLabels")?.addEventListener("change", event => {
    stage3ShowCurrentLabels = event.target.checked;
    if (currentStage === 3) renderStage3();
  });
  $("stage3ValidateNickel").addEventListener("click", () => {
    const report = stage3ValidateNickelLayout();
    stage3LastValidation = report;
    stage3LastAnalysis = report.analysis;
    stage3Notice = report.valid ? "Końcowa walidacja zakończona: projekt może przejść do symulacji." : `Projekt zablokowany: ${[...new Set(report.issues)].slice(0, 3).join(" ")}`;
    if (currentStage === 3) renderStage3();
  });
  ["controllerW", "controllerH"].forEach(id => $(id).addEventListener("input", scheduleStage2ControllerSolve));
  ["controllerOn", "controllerRotate"].forEach(id => $(id).addEventListener("change", scheduleStage2ControllerSolve));
  $("stage2EdgeWeight").addEventListener("input", e => {
    sectionVariantSettings.edgeWeight = Number(e.target.value);
    $("stage2EdgeWeightValue").textContent = sectionVariantSettings.edgeWeight;
  });
  $("stage2EdgeWeight").addEventListener("input", () => {
    stage2SelectedCellId = null;
    if (currentStage !== 2 || Number($("stage2Method").value) !== 0) return;
    const variant = manualMode ? manualVariant : variants[activeIndex];
    if (!variant) return;
    const key = stage2AssignmentKey(variant, variant.cells || [], selectedSeries());
    if (stage2AssignmentVariants.has(key)) {
      stage2AssignmentCache = { key, cells: stage2AssignmentVariants.get(key) };
      stage2Notice = "";
      renderStage2();
      return;
    }
    stage2Notice = `Obliczanie agresywności ${sectionVariantSettings.edgeWeight}/10 w tle…`;
    const statsElement = $("stage2Stats");
    if (statsElement) statsElement.innerHTML = `${statsElement.innerHTML.split("<br>")[0]}<br><span style="color:#f59e0b">${stage2Notice}</span>`;
    queueStage2Assignment(variant, selectedSeries(), sectionVariantSettings.edgeWeight, true);
  });
  $("legend").addEventListener("click", (e) => {
    if (!manualMode) return;
    const item = e.target.closest(".legend-item");
    if (!item) return;
    activeDrawSec = Number(item.dataset.sidx);
    render();
  });
  ["cellAh", "cellVoltage", "cellResistance", "cellStandardDischarge", "cellMaxDischarge", "cellStandardCharge", "cellMaxCharge"].forEach(id => $(id).addEventListener("input", () => {
    if (activeSavedCellProfile()) stage3CellProfileDirty = true;
    applyStage2CurrentValidity();
    syncStage3CellElectricalFromPackInputs(id);
    if (currentStage === 2) renderStage2();
    else if (currentStage === 3) renderStage3();
    else render();
  }));
  $("cellType").addEventListener("change", () => {
    stage3CellProfileDirty = false;
    if ($("savedCellProfileSelect")) $("savedCellProfileSelect").value = "";
    renderSavedCellProfileOptions();
    syncStage3CellGeometryFromType(false);
    collectStage3CellModel();
    if ($("editCellType")) $("editCellType").disabled = true;
    if ($("deleteCellType")) $("deleteCellType").disabled = true;
    setCellProfileStatus(`Wybrano rozmiar ${selectedCellFormatId()}. Lista zawiera wyłącznie zgodne profile.`);
    applyStage2CurrentValidity();
    if (stage1Substep === 2 && !manualMode) runSolve();
    else if (currentStage === 2) renderStage2();
    else if (currentStage === 3) renderStage3();
    else render();
  });
  $("savedCellProfileSelect").addEventListener("change", () => {
    const profile = activeSavedCellProfile();
    stage3CellProfileDirty = false;
    if (profile) applySavedCellProfile(profile);
    else {
      renderStage3CellProfileOptions();
      setStage3CellProfileEditorState(null);
      syncStage3CellGeometryFromType(false);
      collectStage3CellModel();
      if ($("editCellType")) $("editCellType").disabled = true;
      if ($("deleteCellType")) $("deleteCellType").disabled = true;
      setCellProfileStatus(`Dostępne profile ${selectedCellFormatId()}: ${Math.max(0, $("savedCellProfileSelect").options.length - 1)}.`);
    }
    applyStage2CurrentValidity();
    if (stage1Substep === 2 && !manualMode) runSolve();
    else if (currentStage === 2) renderStage2();
    else if (currentStage === 3) renderStage3();
    else render();
  });
  $("deleteCellType").addEventListener("click", deleteSelectedCellProfile);
  $("cellLibraryButton").addEventListener("click", event => {
    event.stopPropagation();
    const willOpen = $("cellLibraryMenu").hidden;
    $("cellLibraryMenu").hidden = !willOpen;
    $("cellLibraryButton").setAttribute("aria-expanded", willOpen ? "true" : "false");
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".cell-library")) {
      $("cellLibraryMenu").hidden = true;
      $("cellLibraryButton").setAttribute("aria-expanded", "false");
    }
  });
  $("openCellProfiles").addEventListener("click", () => openCellProfileManager());
  $("exportCellTypes").addEventListener("click", () => {
    exportSavedCellProfiles();
  });
  $("importCellTypes").addEventListener("click", () => {
    $("importCellTypesInput").click();
  });
  $("importCellTypesInput").addEventListener("change", event => {
    importSavedCellProfiles(event.target.files?.[0]);
    event.target.value = "";
  });
  $("addCellTypeProfile").addEventListener("click", () => {
    openCellProfileCreator();
  });
  $("addCellTypeProfileEmpty").addEventListener("click", () => openCellProfileCreator());
  $("cellProfileTypeFilter").addEventListener("change", renderCellProfileManager);
  $("cellProfileSearch").addEventListener("input", renderCellProfileManager);
  $("clearCellProfileFilters").addEventListener("click", () => {
    $("cellProfileTypeFilter").value = "all";
    $("cellProfileSearch").value = "";
    renderCellProfileManager();
  });
  $("selectAllCellProfiles").addEventListener("change", event => {
    filteredCellProfiles().forEach(profile => {
      if (event.target.checked) selectedCellProfileIds.add(profile.id);
      else selectedCellProfileIds.delete(profile.id);
    });
    renderCellProfileManager();
  });
  $("deleteCellProfileFromForm").addEventListener("click", () => {
    if (editingCellProfileId) deleteCellProfilesByIds([editingCellProfileId]);
  });
  $("closeCellProfileModal").addEventListener("click", closeCellProfileCreator);
  $("cancelCellProfile").addEventListener("click", closeCellProfileCreator);
  $("cellProfileModal").addEventListener("pointerdown", event => {
    if (event.target === $("cellProfileModal")) closeCellProfileCreator();
  });
  $("cellProfileForm").addEventListener("submit", saveCellProfileFromForm);
  $("profileCellFormat").addEventListener("change", applyCellProfileFormatDefaults);

  $("stage1-boundary-step").addEventListener("click", () => setStage1Substep(1));
  $("stage1-placement-step").addEventListener("click", () => setStage1Substep(2));
  $("boundaryType").addEventListener("change", updateStage1BoundaryDynamically);
  ["boundaryWidth", "boundaryHeight", "sideA", "sideB", "sideC"].forEach(id => $(id).addEventListener("input", updateStage1BoundaryDynamically));
  ["angleStep", "offsetDensity"].forEach(id => $(id).addEventListener("input", () => {
    if (stage1Substep !== 2 || manualMode) return;
    if (stage1DynamicSolveTimer) clearTimeout(stage1DynamicSolveTimer);
    stage1DynamicSolveTimer = setTimeout(() => { stage1DynamicSolveTimer = null; runSolve(); }, 120);
  }));
  $("boundaryClear").addEventListener("click", () => {
    const before = boundarySnapshot();
    manualBoundaryPoints = [];
    manualBoundaryEdges = [];
    manualBoundaryClosed = false;
    manualBoundaryActiveEndpoint = null;
    commitBoundaryHistory(before);
    renderBoundaryStage();
  });
  $("boundaryImageButton").addEventListener("click", () => $("boundaryImageInput").click());
  $("boundaryImageInput").addEventListener("change", e => {
    loadBoundaryReferenceImage(e.target.files?.[0]);
    e.target.value = "";
  });
  $("boundaryImageLock").addEventListener("click", () => transformBoundaryImage("lock"));
  $("boundaryImageVisibility").addEventListener("click", () => transformBoundaryImage("visibility"));
  $("boundaryImageBackground").addEventListener("click", () => transformBoundaryImage("background"));
  $("boundaryImageFlipX").addEventListener("click", () => transformBoundaryImage("flip-x"));
  $("boundaryImageFlipY").addEventListener("click", () => transformBoundaryImage("flip-y"));
  $("boundaryImageAspectLock").addEventListener("click", () => {
    boundaryImageAspectLocked = !boundaryImageAspectLocked;
    updateBoundaryImageTools(false);
  });
  $("boundaryImageCalibrate").addEventListener("click", beginBoundaryImageCalibration);
  $("boundaryImageClear").addEventListener("click", removeBoundaryReferenceImage);
  ["boundaryImageX", "boundaryImageY", "boundaryImageWidth", "boundaryImageHeight", "boundaryImageRotation", "boundaryImageScale", "boundaryImageOpacity"].forEach(id => {
    const field = $(id);
    field.addEventListener("focus", beginBoundaryImagePropertyEdit);
    field.addEventListener("pointerdown", beginBoundaryImagePropertyEdit);
    field.addEventListener("input", e => applyBoundaryImageProperty(id, e.target.value));
    field.addEventListener("change", finishBoundaryImagePropertyEdit);
    field.addEventListener("blur", finishBoundaryImagePropertyEdit);
  });
  updateBoundaryTypeUI();
  setStage1Substep(1);
  loadStage3StripCatalog();
  loadStage3CellCatalog();
  loadSavedCellProfiles();

  // Pierwsze kosztowne obliczenie uruchamiamy po wyrenderowaniu interfejsu.
  const requiredRuntimeDependencies = [
    ["model prądowy ogniwa", window.BATTERY_CURRENT_MODEL?.validate],
    ["rozmieszczanie sterownika", window.BATTERY_CONTROLLER_PLACEMENT?.findPlacement]
  ];
  const stageRuntimeDependencies = [
    ["katalog taśm", window.BATTERY_STRIP_PHYSICS],
    ["katalog modeli ogniw", window.BATTERY_CELL_MODELS],
    ["symulacja etapu 4", stage4Simulation]
  ];
  const missingRuntimeDependencies = requiredRuntimeDependencies.filter(([, dependency]) => !dependency).map(([name]) => name);
  const missingStageDependencies = stageRuntimeDependencies.filter(([, dependency]) => !dependency).map(([name]) => name);
  if (missingRuntimeDependencies.length || missingStageDependencies.length) {
    console.error(`Brak zależności aplikacji: ${[...missingRuntimeDependencies, ...missingStageDependencies].join(", ")}. Sprawdź kompletność plików i kolejność skryptów w index.html.`);
  }
  if (missingRuntimeDependencies.length) {
    $("solveBtn").disabled = true;
    $("status").className = "status error";
    $("status").textContent = `Nie można uruchomić aplikacji: brak zależności (${missingRuntimeDependencies.join(", ")}). Sprawdź kompletność plików i ich kolejność w index.html.`;
  } else {
    const scheduleInitialSolve = () => runSolve();
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(scheduleInitialSolve, { timeout: 1200 });
    else setTimeout(scheduleInitialSolve, 0);
  }
