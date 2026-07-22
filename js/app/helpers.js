  function boundaryImageSnapshot() {
    return boundaryReferenceImage ? { ...boundaryReferenceImage } : null;
  }

  function boundaryImageMarkup() {
    if (!boundaryReferenceImage) return "";
    const image = boundaryReferenceImage;
    const width = image.width * image.scale;
    const height = image.height * image.scale;
    const handlesActive = boundaryImageSelected && !boundaryImageLocked;
    const rotateHandles = handlesActive ? [
      [-width / 2 - 15, -height / 2 - 15, "nw"], [width / 2 + 15, -height / 2 - 15, "ne"],
      [width / 2 + 15, height / 2 + 15, "se"], [-width / 2 - 15, height / 2 + 15, "sw"]
    ].map(([x, y, position]) => `<circle data-boundary-image-rotate="${position}" cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="7" fill="#fbbf24" stroke="#b45309" stroke-width="1.5" style="cursor:grab"/>`).join("") : "";
    const scaleHandles = handlesActive ? [
      [-width / 2, -height / 2, "nw"], [0, -height / 2, "n"], [width / 2, -height / 2, "ne"],
      [width / 2, 0, "e"], [width / 2, height / 2, "se"], [0, height / 2, "s"],
      [-width / 2, height / 2, "sw"], [-width / 2, 0, "w"]
    ].map(([x, y, position]) => `<rect data-boundary-image-scale="${position}" x="${(x - 5).toFixed(3)}" y="${(y - 5).toFixed(3)}" width="10" height="10" fill="#f8fafc" stroke="#2563eb" stroke-width="1.5" style="cursor:${position === "n" || position === "s" ? "ns" : position === "e" || position === "w" ? "ew" : position === "nw" || position === "se" ? "nwse" : "nesw"}-resize"/>`).join("") : "";
    return `<g data-boundary-image="true" transform="translate(${image.x.toFixed(3)} ${image.y.toFixed(3)}) rotate(${image.rotation.toFixed(3)})" style="${boundaryImageLocked ? "pointer-events:none;" : "cursor:move"}"><image href="${image.src}" x="${(-width / 2).toFixed(3)}" y="${(-height / 2).toFixed(3)}" width="${width.toFixed(3)}" height="${height.toFixed(3)}" preserveAspectRatio="xMidYMid meet" opacity="${boundaryImageLocked ? "0.6" : "1"}"/><rect x="${(-width / 2).toFixed(3)}" y="${(-height / 2).toFixed(3)}" width="${width.toFixed(3)}" height="${height.toFixed(3)}" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="6 4" opacity="${handlesActive ? ".75" : "0"}" pointer-events="none"/>${rotateHandles}${scaleHandles}</g>`;
  }

  function updateBoundaryImageDom() {
    const svg = $("drawing");
    const group = svg?.querySelector("[data-boundary-image]");
    if (!group || !boundaryReferenceImage) return;
    const image = boundaryReferenceImage;
    const width = image.width * image.scale;
    const height = image.height * image.scale;
    group.setAttribute("transform", `translate(${image.x.toFixed(3)} ${image.y.toFixed(3)}) rotate(${image.rotation.toFixed(3)})`);
    const imageElement = group.querySelector("image");
    const rect = group.querySelector("rect");
    imageElement.setAttribute("x", (-width / 2).toFixed(3));
    imageElement.setAttribute("y", (-height / 2).toFixed(3));
    imageElement.setAttribute("width", width.toFixed(3));
    imageElement.setAttribute("height", height.toFixed(3));
    rect.setAttribute("x", (-width / 2).toFixed(3));
    rect.setAttribute("y", (-height / 2).toFixed(3));
    rect.setAttribute("width", width.toFixed(3));
    rect.setAttribute("height", height.toFixed(3));

    const positions = {
      nw: [-width / 2, -height / 2], n: [0, -height / 2], ne: [width / 2, -height / 2],
      e: [width / 2, 0], se: [width / 2, height / 2], s: [0, height / 2],
      sw: [-width / 2, height / 2], w: [-width / 2, 0]
    };
    group.querySelectorAll("[data-boundary-image-scale]").forEach(handle => {
      const pos = handle.getAttribute("data-boundary-image-scale");
      if (positions[pos]) {
        handle.setAttribute("x", (positions[pos][0] - 5).toFixed(3));
        handle.setAttribute("y", (positions[pos][1] - 5).toFixed(3));
      }
    });

    const rotatePositions = {
      nw: [-width / 2 - 15, -height / 2 - 15], ne: [width / 2 + 15, -height / 2 - 15],
      se: [width / 2 + 15, height / 2 + 15], sw: [-width / 2 - 15, height / 2 + 15]
    };
    group.querySelectorAll("[data-boundary-image-rotate]").forEach(handle => {
      const pos = handle.getAttribute("data-boundary-image-rotate");
      if (rotatePositions[pos]) {
        handle.setAttribute("cx", rotatePositions[pos][0].toFixed(3));
        handle.setAttribute("cy", rotatePositions[pos][1].toFixed(3));
      }
    });
  }

  function updateBoundaryImageTools() {
    const tools = $("boundaryImageTools");
    if (tools) tools.hidden = !boundaryReferenceImage;
    if (boundaryReferenceImage) updateBoundaryImageDom();
  }

  function loadBoundaryReferenceImage(file) {
    const extension = file?.name?.toLowerCase().match(/\.(jpg|jpeg|png)$/)?.[1];
    if (!file || (!["image/jpeg", "image/png"].includes(file.type) && !extension)) return;
    const reader = new FileReader();
    reader.onload = event => {
      const imageElement = new Image();
      imageElement.onload = () => {
        const before = boundarySnapshot();
        const points = manualBoundaryPoints.length ? manualBoundaryPoints : [{ x: -220, y: -150 }, { x: 220, y: -150 }, { x: 0, y: 200 }];
        const bounds = polygonBounds(points);
        const targetWidth = Math.max(160, (bounds.maxX - bounds.minX) * .72);
        const targetHeight = Math.max(120, (bounds.maxY - bounds.minY) * .72);
      boundaryReferenceImage = {
          src: event.target.result,
          width: imageElement.naturalWidth,
          height: imageElement.naturalHeight,
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
          scale: Math.min(targetWidth / imageElement.naturalWidth, targetHeight / imageElement.naturalHeight),
          rotation: 0
        };
        boundaryImageSelected = false;
        commitBoundaryHistory(before);
        updateBoundaryImageTools();
        renderBoundaryStage();
      };
      imageElement.src = event.target.result;
    };
    reader.readAsDataURL(file);
  }

  function updateBoundaryImageDrag(e) {
    if (!boundaryImageDrag || !boundaryReferenceImage) return;
    const point = svgPoint(e, $("drawing"));
    if (boundaryImageDrag.mode === "move") {
      boundaryReferenceImage.x = boundaryImageDrag.image.x + point.x - boundaryImageDrag.start.x;
      boundaryReferenceImage.y = boundaryImageDrag.image.y + point.y - boundaryImageDrag.start.y;
    } else if (boundaryImageDrag.mode === "scale") {
      const distance = Math.hypot(point.x - boundaryImageDrag.image.x, point.y - boundaryImageDrag.image.y);
      boundaryReferenceImage.scale = Math.max(.01, Math.min(10, boundaryImageDrag.image.scale * distance / Math.max(0.001, boundaryImageDrag.startDistance)));
    } else if (boundaryImageDrag.mode === "rotate") {
      const angle = Math.atan2(point.y - boundaryImageDrag.image.y, point.x - boundaryImageDrag.image.x);
      boundaryReferenceImage.rotation = boundaryImageDrag.image.rotation + (angle - boundaryImageDrag.startAngle) * 180 / Math.PI;
    }
    updateBoundaryImageDom();
  }

  function finishBoundaryImageDrag() {
    if (!boundaryImageDrag) return;
    const drag = boundaryImageDrag;
    boundaryImageDrag = null;
    if (boundaryReferenceImage && JSON.stringify(boundaryReferenceImage) !== JSON.stringify(drag.image)) {
      commitBoundaryHistory(drag.before);
    }
  }

  function setWorkspaceViewBox(svg) {
    svg.setAttribute("viewBox", `${workspaceView.x} ${workspaceView.y} ${workspaceView.width} ${workspaceView.height}`);
  }

  function workspacePoint(e, svg) {
    const rect = svg.getBoundingClientRect();
    return {
      x: workspaceView.x + ((e.clientX - rect.left) / rect.width) * workspaceView.width,
      y: workspaceView.y + ((e.clientY - rect.top) / rect.height) * workspaceView.height
    };
  }

  function beginWorkspacePan(e, svg) {
    if (e.button !== 1 && !(e.button === 0 && spacePressed)) return false;
    e.preventDefault();
    if (Number.isInteger(e.pointerId) && svg.setPointerCapture) svg.setPointerCapture(e.pointerId);
    workspacePan = { startX: e.clientX, startY: e.clientY, view: { ...workspaceView }, moved: false, pointerId: e.pointerId ?? null };
    return true;
  }

  function updateWorkspacePan(e) {
    if (!workspacePan) return;
    if (workspacePan.pointerId !== null && e.pointerId !== undefined && e.pointerId !== workspacePan.pointerId) return;
    const svg = $("drawing");
    const rect = svg.getBoundingClientRect();
    const dx = (e.clientX - workspacePan.startX) / rect.width * workspacePan.view.width;
    const dy = (e.clientY - workspacePan.startY) / rect.height * workspacePan.view.height;
    workspacePan.moved = workspacePan.moved || Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1;
    workspaceView.x = workspacePan.view.x - dx;
    workspaceView.y = workspacePan.view.y - dy;
    setWorkspaceViewBox(svg);
  }

  function finishWorkspacePan() {
    if (!workspacePan) return;
    workspacePanJustMoved = workspacePan.moved;
    workspacePan = null;
    if (workspacePanJustMoved) setTimeout(() => { workspacePanJustMoved = false; }, 0);
  }

  function zoomWorkspace(e, svg) {
    e.preventDefault();
    const before = workspacePoint(e, svg);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextZoom = Math.max(.2, Math.min(20, workspaceView.zoom * factor));
    workspaceView.zoom = nextZoom;
    workspaceView.width = 800 / nextZoom;
    workspaceView.height = 800 / nextZoom;
    const after = workspacePoint(e, svg);
    workspaceView.x += before.x - after.x;
    workspaceView.y += before.y - after.y;
    setWorkspaceViewBox(svg);
  }

  function manualSnapshot() {
    return JSON.stringify({
      variant: manualVariant,
      gridStyle: manualGridStyle,
      cellSize: manualCellSize,
      cellGap: manualCellGap,
      gridAngle: manualGridAngle,
      gridOrigin: manualGridOrigin
    });
  }

  function resetManualHistory() {
    manualHistory = manualMode ? [manualSnapshot()] : [];
    manualHistoryIndex = manualHistory.length ? 0 : -1;
  }

  function commitManualHistory(before) {
    if (!manualMode || before === manualSnapshot()) return;
    manualHistory = manualHistory.slice(0, manualHistoryIndex + 1);
    manualHistory.push(manualSnapshot());
    manualHistoryIndex++;
  }

  function restoreManualSnapshot(snapshot) {
    const state = JSON.parse(snapshot);
    manualVariant = state.variant;
    manualGridStyle = state.gridStyle;
    manualCellSize = state.cellSize;
    manualCellGap = state.cellGap;
    manualGridAngle = state.gridAngle;
    manualGridOrigin = state.gridOrigin;
    manualSelectedCellIds = new Set();
    manualControllerSelected = false;
    const style = $("manualGridStyle"), size = $("manualCellSize"), gap = $("manualCellGap");
    if (style) style.value = manualGridStyle;
    if (size) size.value = manualCellSize;
    if (gap) gap.value = manualCellGap;
    const controller = manualVariant?.controller;
    if ($("manualControllerW")) $("manualControllerW").value = controller?.w || 90;
    if ($("manualControllerH")) $("manualControllerH").value = controller?.h || 45;
    render();
  }

  function undoManualChange() {
    if (!manualMode || manualHistoryIndex <= 0) return;
    manualHistoryIndex--;
    restoreManualSnapshot(manualHistory[manualHistoryIndex]);
  }

  function redoManualChange() {
    if (!manualMode || manualHistoryIndex >= manualHistory.length - 1) return;
    manualHistoryIndex++;
    restoreManualSnapshot(manualHistory[manualHistoryIndex]);
  }
