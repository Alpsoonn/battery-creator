  const BOUNDARY_IMAGE_MIN_SIZE = 1;
  const BOUNDARY_IMAGE_MAX_SIZE = 100000;

  function boundaryClamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function cloneBoundaryImage(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function normalizeBoundaryImageObject(value) {
    if (!value) return null;
    if (value.source && value.transform) {
      value.transform.scaleX = Number(value.transform.scaleX) < 0 ? -1 : 1;
      value.transform.scaleY = Number(value.transform.scaleY) < 0 ? -1 : 1;
      value.opacity = boundaryClamp(Number(value.opacity) || 1, .05, 1);
      value.locked = Boolean(value.locked);
      value.visible = value.visible !== false;
      value.backgroundMode = Boolean(value.backgroundMode);
      value.scaleVerified = Boolean(value.scaleVerified);
      value.crop ||= { enabled: false, x: 0, y: 0, width: value.source.naturalWidthPx, height: value.source.naturalHeightPx };
      return value;
    }
    const width = Math.max(BOUNDARY_IMAGE_MIN_SIZE, (Number(value.width) || 1) * (Number(value.scale) || 1));
    const height = Math.max(BOUNDARY_IMAGE_MIN_SIZE, (Number(value.height) || 1) * (Number(value.scale) || 1));
    return {
      id: `boundary-image-${Date.now().toString(36)}`,
      source: {
        fileName: "obraz referencyjny",
        mimeType: "image/*",
        naturalWidthPx: Number(value.width) || width,
        naturalHeightPx: Number(value.height) || height,
        objectUrl: value.src,
        initialWidth: width,
        initialHeight: height
      },
      transform: {
        x: (Number(value.x) || 0) - width / 2,
        y: (Number(value.y) || 0) - height / 2,
        width,
        height,
        rotationDeg: Number(value.rotation) || 0,
        scaleX: 1,
        scaleY: 1
      },
      crop: { enabled: false, x: 0, y: 0, width: Number(value.width) || width, height: Number(value.height) || height },
      opacity: 1,
      locked: false,
      visible: true,
      backgroundMode: false,
      scaleVerified: false
    };
  }

  function boundaryImageSnapshot() {
    return cloneBoundaryImage(boundaryReferenceImage);
  }

  function boundaryImageTransformSnapshot() {
    return boundaryReferenceImage ? { ...boundaryReferenceImage.transform } : null;
  }

  function boundaryImageCenter(transform = boundaryReferenceImage?.transform) {
    if (!transform) return { x: 0, y: 0 };
    return { x: transform.x + transform.width / 2, y: transform.y + transform.height / 2 };
  }

  function boundaryImageScreenUnit() {
    const svg = $("drawing");
    const matrix = svg?.getScreenCTM?.();
    const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 0;
    return scale > 0 ? 1 / scale : 1;
  }

  function boundaryImageCalibrationMarkup() {
    if (!boundaryImageCalibration.active || !boundaryImageCalibration.points.length) return "";
    const unit = boundaryImageScreenUnit();
    const points = boundaryImageCalibration.points;
    const markers = points.map(point => `<g pointer-events="none"><circle cx="${point.x}" cy="${point.y}" r="${5 * unit}" fill="#f59e0b" stroke="#fff" stroke-width="${1.5 * unit}"/><line x1="${point.x - 9 * unit}" y1="${point.y}" x2="${point.x + 9 * unit}" y2="${point.y}" stroke="#f59e0b" stroke-width="${1.5 * unit}"/><line x1="${point.x}" y1="${point.y - 9 * unit}" x2="${point.x}" y2="${point.y + 9 * unit}" stroke="#f59e0b" stroke-width="${1.5 * unit}"/></g>`).join("");
    const line = points.length > 1 ? `<line x1="${points[0].x}" y1="${points[0].y}" x2="${points[1].x}" y2="${points[1].y}" stroke="#f59e0b" stroke-width="${2 * unit}" stroke-dasharray="${6 * unit} ${4 * unit}" pointer-events="none"/>` : "";
    return `<g data-boundary-image-calibration="true">${line}${markers}</g>`;
  }

  function boundaryImageMarkup() {
    if (!boundaryReferenceImage) return "";
    boundaryReferenceImage = normalizeBoundaryImageObject(boundaryReferenceImage);
    const image = boundaryReferenceImage;
    const transform = image.transform;
    if (!image.visible) return `<g data-boundary-image-layer="true"></g>${boundaryImageCalibrationMarkup()}`;
    const width = transform.width, height = transform.height;
    const center = boundaryImageCenter(transform);
    const unit = boundaryImageScreenUnit();
    const handleSize = 9 * unit, hitSize = 22 * unit, rotateOffset = 28 * unit;
    const handlesActive = boundaryImageSelected && !image.locked && !boundaryImageCalibration.active;
    const positions = [
      [-width / 2, -height / 2, "nw"], [0, -height / 2, "n"], [width / 2, -height / 2, "ne"],
      [width / 2, 0, "e"], [width / 2, height / 2, "se"], [0, height / 2, "s"],
      [-width / 2, height / 2, "sw"], [-width / 2, 0, "w"]
    ];
    const cursors = { nw: "nwse-resize", n: "ns-resize", ne: "nesw-resize", e: "ew-resize", se: "nwse-resize", s: "ns-resize", sw: "nesw-resize", w: "ew-resize" };
    const scaleHandles = handlesActive ? positions.map(([x, y, position]) => `<g data-boundary-image-scale="${position}" style="cursor:${cursors[position]}"><circle cx="${x}" cy="${y}" r="${hitSize / 2}" fill="transparent" pointer-events="all"/><rect x="${x - handleSize / 2}" y="${y - handleSize / 2}" width="${handleSize}" height="${handleSize}" rx="${1.5 * unit}" fill="#f8fafc" stroke="#2563eb" stroke-width="${1.5 * unit}" pointer-events="none"/></g>`).join("") : "";
    const rotateHandle = handlesActive ? `<g data-boundary-image-rotate="true" style="cursor:grab"><line x1="0" y1="${-height / 2}" x2="0" y2="${-height / 2 - rotateOffset}" stroke="#60a5fa" stroke-width="${1.5 * unit}" pointer-events="none"/><circle cx="0" cy="${-height / 2 - rotateOffset}" r="${hitSize / 2}" fill="transparent" pointer-events="all"/><circle cx="0" cy="${-height / 2 - rotateOffset}" r="${handleSize / 2}" fill="#f59e0b" stroke="#fff" stroke-width="${1.5 * unit}" pointer-events="none"/></g>` : "";
    const selection = handlesActive ? `<rect x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" fill="none" stroke="#60a5fa" stroke-width="${1.5 * unit}" pointer-events="none"/>${rotateHandle}${scaleHandles}` : "";
    const pointerStyle = image.locked ? "pointer-events:none" : "cursor:move";
    return `<g data-boundary-image-layer="true" pointer-events="${image.locked ? "none" : "auto"}"><g data-boundary-image="true" transform="translate(${center.x.toFixed(4)} ${center.y.toFixed(4)}) rotate(${transform.rotationDeg.toFixed(4)})" style="${pointerStyle}"><image href="${image.source.objectUrl}" x="${(-width / 2).toFixed(4)}" y="${(-height / 2).toFixed(4)}" width="${width.toFixed(4)}" height="${height.toFixed(4)}" transform="scale(${transform.scaleX} ${transform.scaleY})" preserveAspectRatio="none" opacity="${image.opacity.toFixed(3)}" pointer-events="none"/><rect data-boundary-image-body="true" x="${-width / 2}" y="${-height / 2}" width="${width}" height="${height}" fill="transparent" pointer-events="${image.locked ? "none" : "all"}"/>${selection}</g></g>${boundaryImageCalibrationMarkup()}`;
  }

  function updateBoundaryImageDom() {
    const svg = $("drawing");
    if (!svg) return;
    const oldLayer = svg.querySelector("[data-boundary-image-layer]");
    const oldCalibration = svg.querySelector("[data-boundary-image-calibration]");
    oldCalibration?.remove();
    if (oldLayer) oldLayer.outerHTML = boundaryImageMarkup();
    updateBoundaryImageTools(false);
  }

  function setBoundaryFieldValue(id, value) {
    const field = $(id);
    if (!field || document.activeElement === field) return;
    field.value = Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "";
  }

  function updateBoundaryImageTools(updateDom = true) {
    const tools = $("boundaryImageTools");
    if (tools) tools.hidden = !boundaryReferenceImage;
    if (!boundaryReferenceImage) return;
    boundaryReferenceImage = normalizeBoundaryImageObject(boundaryReferenceImage);
    const image = boundaryReferenceImage, transform = image.transform;
    $("boundaryImageProperties").hidden = !boundaryImageSelected || image.locked || !image.visible;
    setBoundaryFieldValue("boundaryImageX", transform.x);
    setBoundaryFieldValue("boundaryImageY", transform.y);
    setBoundaryFieldValue("boundaryImageWidth", transform.width);
    setBoundaryFieldValue("boundaryImageHeight", transform.height);
    setBoundaryFieldValue("boundaryImageRotation", transform.rotationDeg);
    setBoundaryFieldValue("boundaryImageScale", transform.width / Math.max(.001, image.source.initialWidth || transform.width) * 100);
    const opacity = $("boundaryImageOpacity"), opacityValue = $("boundaryImageOpacityValue");
    if (opacity && document.activeElement !== opacity) opacity.value = Math.round(image.opacity * 100);
    if (opacityValue) opacityValue.value = `${Math.round(image.opacity * 100)}%`;
    const lock = $("boundaryImageLock"), visibility = $("boundaryImageVisibility"), background = $("boundaryImageBackground");
    if (lock) { lock.textContent = image.locked ? "Odblokuj" : "Zablokuj"; lock.classList.toggle("active", image.locked); }
    if (visibility) { visibility.textContent = image.visible ? "Ukryj" : "Pokaż"; visibility.classList.toggle("active", !image.visible); }
    if (background) { background.textContent = image.backgroundMode ? "Wyłącz tryb podkładu" : "Ustaw jako podkład"; background.classList.toggle("active", image.backgroundMode); }
    const aspect = $("boundaryImageAspectLock");
    if (aspect) { aspect.textContent = boundaryImageAspectLocked ? "🔒 Proporcje" : "🔓 Proporcje"; aspect.classList.toggle("active", boundaryImageAspectLocked); aspect.setAttribute("aria-pressed", String(boundaryImageAspectLocked)); }
    const scaleStatus = $("boundaryImageScaleStatus");
    if (scaleStatus) { scaleStatus.textContent = image.scaleVerified ? "Skala zweryfikowana" : "Skala nieweryfikowana"; scaleStatus.classList.toggle("verified", image.scaleVerified); }
    const calibrationButton = $("boundaryImageCalibrate");
    if (calibrationButton) { calibrationButton.textContent = boundaryImageCalibration.active ? "Anuluj kalibrację" : "Wskaż 2 punkty skali"; calibrationButton.classList.toggle("active", boundaryImageCalibration.active); }
    if (updateDom) updateBoundaryImageDom();
  }

  function loadBoundaryReferenceImage(file) {
    const extension = file?.name?.toLowerCase().match(/\.(jpg|jpeg|png)$/)?.[1];
    if (!file || (!["image/jpeg", "image/png"].includes(file.type) && !extension)) {
      const status = $("boundaryImageCalibrationStatus");
      if (status) status.textContent = "Obsługiwane są wyłącznie pliki JPG i PNG.";
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const imageElement = new Image();
    imageElement.onload = () => {
        const before = boundarySnapshot();
        const points = manualBoundaryPoints.length ? manualBoundaryPoints : [{ x: -220, y: -150 }, { x: 220, y: -150 }, { x: 0, y: 200 }];
        const bounds = polygonBounds(points);
        const maxWidth = Math.max(160, (bounds.maxX - bounds.minX) * .72);
        const maxHeight = Math.max(120, (bounds.maxY - bounds.minY) * .72);
        const ratio = imageElement.naturalWidth / Math.max(1, imageElement.naturalHeight);
        let width = maxWidth, height = width / ratio;
        if (height > maxHeight) { height = maxHeight; width = height * ratio; }
        const centerX = (bounds.minX + bounds.maxX) / 2, centerY = (bounds.minY + bounds.maxY) / 2;
        boundaryReferenceImage = {
          id: `boundary-image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          source: { fileName: file.name || "obraz", mimeType: file.type || `image/${extension}`, naturalWidthPx: imageElement.naturalWidth, naturalHeightPx: imageElement.naturalHeight, objectUrl, initialWidth: width, initialHeight: height },
          transform: { x: centerX - width / 2, y: centerY - height / 2, width, height, rotationDeg: 0, scaleX: 1, scaleY: 1 },
          crop: { enabled: false, x: 0, y: 0, width: imageElement.naturalWidth, height: imageElement.naturalHeight },
          opacity: .65,
          locked: false,
          visible: true,
          backgroundMode: false,
          scaleVerified: false
        };
        boundaryImageSelected = true;
        boundaryImageCalibration = { active: false, points: [] };
        commitBoundaryHistory(before);
        renderBoundaryStage();
    };
    imageElement.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      const status = $("boundaryImageCalibrationStatus");
      if (status) status.textContent = "Nie udało się odczytać obrazu.";
    };
    imageElement.src = objectUrl;
  }

  function boundaryRotateVector(point, angleDeg) {
    const angle = angleDeg * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
  }

  function boundaryInverseRotateVector(point, angleDeg) {
    return boundaryRotateVector(point, -angleDeg);
  }

  function beginBoundaryImageInteraction(event, svg) {
    if (!boundaryReferenceImage || boundaryReferenceImage.locked || !boundaryReferenceImage.visible || event.button !== 0) return false;
    const imageTarget = event.target.closest("[data-boundary-image]");
    if (!imageTarget) return false;
    const rotateHandle = event.target.closest("[data-boundary-image-rotate]");
    const scaleHandle = event.target.closest("[data-boundary-image-scale]");
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture?.(event.pointerId);
    const point = svgPoint(event, svg), transform = boundaryImageTransformSnapshot(), center = boundaryImageCenter(transform);
    boundaryImageSelected = true;
    boundaryImageDrag = {
      mode: rotateHandle ? "rotating" : scaleHandle ? "scaling" : "pending-move",
      pointerId: event.pointerId,
      activeHandle: scaleHandle?.dataset.boundaryImageScale || null,
      startPointer: point,
      startClient: { x: event.clientX, y: event.clientY },
      startTransform: transform,
      center,
      startPointerAngle: Math.atan2(point.y - center.y, point.x - center.x),
      before: boundarySnapshot(),
      moved: false
    };
    updateBoundaryImageDom();
    return true;
  }

  function applyBoundaryImageScaling(drag, point, shiftKey, altKey) {
    const start = drag.startTransform, handle = drag.activeHandle || "se";
    const signX = handle.includes("e") ? 1 : handle.includes("w") ? -1 : 0;
    const signY = handle.includes("s") ? 1 : handle.includes("n") ? -1 : 0;
    const angle = start.rotationDeg;
    let width = start.width, height = start.height, center = { ...drag.center };
    if (altKey) {
      const local = boundaryInverseRotateVector({ x: point.x - center.x, y: point.y - center.y }, angle);
      if (signX) width = signX * local.x * 2;
      if (signY) height = signY * local.y * 2;
    } else {
      const anchorLocal = { x: signX ? -signX * start.width / 2 : 0, y: signY ? -signY * start.height / 2 : 0 };
      const anchorOffset = boundaryRotateVector(anchorLocal, angle);
      const anchor = { x: drag.center.x + anchorOffset.x, y: drag.center.y + anchorOffset.y };
      const local = boundaryInverseRotateVector({ x: point.x - anchor.x, y: point.y - anchor.y }, angle);
      if (signX) width = signX * local.x;
      if (signY) height = signY * local.y;
    }
    width = boundaryClamp(width, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
    height = boundaryClamp(height, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
    const corner = Boolean(signX && signY);
    const preserveAspect = boundaryImageAspectLocked ? !shiftKey : shiftKey;
    if (preserveAspect) {
      let scale = 1;
      if (corner) {
        const widthScale = width / start.width, heightScale = height / start.height;
        scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
      } else if (signX) {
        scale = width / start.width;
      } else if (signY) {
        scale = height / start.height;
      }
      width = boundaryClamp(start.width * scale, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
      height = boundaryClamp(start.height * scale, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
    }
    if (!altKey) {
      const anchorLocal = { x: signX ? -signX * start.width / 2 : 0, y: signY ? -signY * start.height / 2 : 0 };
      const anchorOffset = boundaryRotateVector(anchorLocal, angle);
      const anchor = { x: drag.center.x + anchorOffset.x, y: drag.center.y + anchorOffset.y };
      const centerFromAnchor = boundaryRotateVector({ x: signX ? signX * width / 2 : 0, y: signY ? signY * height / 2 : 0 }, angle);
      center = { x: anchor.x + centerFromAnchor.x, y: anchor.y + centerFromAnchor.y };
    }
    boundaryReferenceImage.transform = { ...boundaryReferenceImage.transform, x: center.x - width / 2, y: center.y - height / 2, width, height };
  }

  function applyBoundaryImagePointer(pointer) {
    const drag = boundaryImageDrag;
    if (!drag || !boundaryReferenceImage || drag.pointerId !== pointer.pointerId) return;
    const svg = $("drawing"), point = svgPoint(pointer, svg);
    if (drag.mode === "pending-move") {
      if (Math.hypot(pointer.clientX - drag.startClient.x, pointer.clientY - drag.startClient.y) < 4) return;
      drag.mode = "moving";
    }
    if (drag.mode === "moving") {
      boundaryReferenceImage.transform.x = drag.startTransform.x + point.x - drag.startPointer.x;
      boundaryReferenceImage.transform.y = drag.startTransform.y + point.y - drag.startPointer.y;
      drag.moved = true;
    } else if (drag.mode === "scaling") {
      applyBoundaryImageScaling(drag, point, pointer.shiftKey, pointer.altKey);
      drag.moved = true;
    } else if (drag.mode === "rotating") {
      const currentAngle = Math.atan2(point.y - drag.center.y, point.x - drag.center.x);
      let rotation = drag.startTransform.rotationDeg + (currentAngle - drag.startPointerAngle) * 180 / Math.PI;
      if (pointer.shiftKey) rotation = Math.round(rotation / 15) * 15;
      boundaryReferenceImage.transform.rotationDeg = rotation;
      drag.moved = true;
    }
    updateBoundaryImageDom();
  }

  function updateBoundaryImageDrag(event) {
    if (!boundaryImageDrag || event.pointerId !== boundaryImageDrag.pointerId) return;
    boundaryImagePendingPointer = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey, altKey: event.altKey };
    if (boundaryImagePointerFrame !== null) return;
    boundaryImagePointerFrame = requestAnimationFrame(() => {
      boundaryImagePointerFrame = null;
      const pointer = boundaryImagePendingPointer;
      boundaryImagePendingPointer = null;
      if (pointer) applyBoundaryImagePointer(pointer);
    });
  }

  function finishBoundaryImageDrag(event) {
    if (!boundaryImageDrag || (event?.pointerId !== undefined && event.pointerId !== boundaryImageDrag.pointerId)) return;
    const drag = boundaryImageDrag;
    if (boundaryImagePointerFrame !== null) cancelAnimationFrame(boundaryImagePointerFrame);
    boundaryImagePointerFrame = null;
    if (boundaryImagePendingPointer) applyBoundaryImagePointer(boundaryImagePendingPointer);
    boundaryImagePendingPointer = null;
    const svg = $("drawing");
    if (event?.pointerId !== undefined && svg?.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    boundaryImageDrag = null;
    if (drag.moved && boundaryReferenceImage && JSON.stringify(boundaryReferenceImage.transform) !== JSON.stringify(drag.startTransform)) commitBoundaryHistory(drag.before);
    updateBoundaryImageDom();
  }

  function cancelBoundaryImageInteraction() {
    if (!boundaryImageDrag || !boundaryReferenceImage) return false;
    const pointerId = boundaryImageDrag.pointerId, svg = $("drawing");
    boundaryReferenceImage.transform = { ...boundaryImageDrag.startTransform };
    if (boundaryImagePointerFrame !== null) cancelAnimationFrame(boundaryImagePointerFrame);
    boundaryImagePointerFrame = null;
    boundaryImagePendingPointer = null;
    boundaryImageDrag = null;
    if (svg?.hasPointerCapture?.(pointerId)) svg.releasePointerCapture(pointerId);
    updateBoundaryImageDom();
    return true;
  }

  function boundaryImagePointInside(point) {
    if (!boundaryReferenceImage) return false;
    const transform = boundaryReferenceImage.transform, center = boundaryImageCenter(transform);
    const local = boundaryInverseRotateVector({ x: point.x - center.x, y: point.y - center.y }, transform.rotationDeg);
    return Math.abs(local.x) <= transform.width / 2 && Math.abs(local.y) <= transform.height / 2;
  }

  function beginBoundaryImageCalibration() {
    if (!boundaryReferenceImage || !boundaryReferenceImage.visible) return;
    if (boundaryImageCalibration.active) {
      boundaryImageCalibration = { active: false, points: [] };
      $("boundaryImageCalibrationStatus").textContent = "Kalibracja anulowana.";
    } else {
      boundaryImageCalibration = { active: true, points: [], before: boundarySnapshot() };
      boundaryImageSelected = true;
      $("boundaryImageCalibrationStatus").textContent = "Kliknij pierwszy punkt na zdjęciu.";
    }
    renderBoundaryStage();
  }

  function addBoundaryImageCalibrationPoint(point) {
    if (!boundaryImageCalibration.active || !boundaryReferenceImage) return false;
    if (!boundaryImagePointInside(point)) {
      $("boundaryImageCalibrationStatus").textContent = "Punkt musi znajdować się na zdjęciu.";
      return true;
    }
    boundaryImageCalibration.points.push(point);
    if (boundaryImageCalibration.points.length === 1) {
      $("boundaryImageCalibrationStatus").textContent = "Kliknij drugi punkt na zdjęciu.";
      renderBoundaryStage();
      return true;
    }
    const [a, b] = boundaryImageCalibration.points;
    const measured = Math.hypot(b.x - a.x, b.y - a.y);
    const real = Number($("boundaryImageCalibrationDistance").value);
    if (!(measured > .001) || !(real > 0)) {
      boundaryImageCalibration.points = [];
      $("boundaryImageCalibrationStatus").textContent = "Podaj dodatnią odległość i wskaż dwa różne punkty.";
      renderBoundaryStage();
      return true;
    }
    const before = boundaryImageCalibration.before || boundarySnapshot(), transform = boundaryReferenceImage.transform;
    const center = boundaryImageCenter(transform), factor = real / measured;
    const width = boundaryClamp(transform.width * factor, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
    const height = boundaryClamp(transform.height * factor, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
    boundaryReferenceImage.transform = { ...transform, x: center.x - width / 2, y: center.y - height / 2, width, height };
    boundaryReferenceImage.scaleVerified = true;
    boundaryImageCalibration = { active: false, points: [] };
    commitBoundaryHistory(before);
    $("boundaryImageCalibrationStatus").textContent = `Skala ustawiona na podstawie odcinka ${real.toFixed(2)} mm.`;
    renderBoundaryStage();
    return true;
  }

  function beginBoundaryImagePropertyEdit() {
    if (boundaryReferenceImage && !boundaryImageFieldBefore) boundaryImageFieldBefore = boundarySnapshot();
  }

  function applyBoundaryImageProperty(id, rawValue) {
    if (!boundaryReferenceImage) return;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const transform = boundaryReferenceImage.transform, center = boundaryImageCenter(transform);
    if (id === "boundaryImageX") transform.x = value;
    else if (id === "boundaryImageY") transform.y = value;
    else if (id === "boundaryImageRotation") transform.rotationDeg = value;
    else if (id === "boundaryImageWidth") {
      transform.width = boundaryClamp(value, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
      if (boundaryImageAspectLocked) transform.height = transform.width / (boundaryReferenceImage.source.naturalWidthPx / boundaryReferenceImage.source.naturalHeightPx);
    } else if (id === "boundaryImageHeight") {
      transform.height = boundaryClamp(value, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
      if (boundaryImageAspectLocked) transform.width = transform.height * (boundaryReferenceImage.source.naturalWidthPx / boundaryReferenceImage.source.naturalHeightPx);
    } else if (id === "boundaryImageScale") {
      const factor = Math.max(.001, value / 100);
      transform.width = boundaryClamp(boundaryReferenceImage.source.initialWidth * factor, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
      transform.height = boundaryClamp(boundaryReferenceImage.source.initialHeight * factor, BOUNDARY_IMAGE_MIN_SIZE, BOUNDARY_IMAGE_MAX_SIZE);
      transform.x = center.x - transform.width / 2;
      transform.y = center.y - transform.height / 2;
    } else if (id === "boundaryImageOpacity") boundaryReferenceImage.opacity = boundaryClamp(value / 100, .05, 1);
    updateBoundaryImageDom();
  }

  function finishBoundaryImagePropertyEdit() {
    if (!boundaryImageFieldBefore) return;
    const before = boundaryImageFieldBefore;
    boundaryImageFieldBefore = null;
    commitBoundaryHistory(before);
  }

  function transformBoundaryImage(command) {
    if (!boundaryReferenceImage) return;
    const before = boundarySnapshot();
    if (command === "flip-x") boundaryReferenceImage.transform.scaleX *= -1;
    else if (command === "flip-y") boundaryReferenceImage.transform.scaleY *= -1;
    else if (command === "lock") {
      boundaryReferenceImage.locked = !boundaryReferenceImage.locked;
      if (!boundaryReferenceImage.locked) boundaryReferenceImage.backgroundMode = false;
      if (boundaryReferenceImage.locked) boundaryImageSelected = false;
    }
    else if (command === "visibility") { boundaryReferenceImage.visible = !boundaryReferenceImage.visible; if (!boundaryReferenceImage.visible) boundaryImageSelected = false; }
    else if (command === "background") {
      boundaryReferenceImage.backgroundMode = !boundaryReferenceImage.backgroundMode;
      boundaryReferenceImage.locked = boundaryReferenceImage.backgroundMode;
      if (boundaryReferenceImage.backgroundMode) { boundaryReferenceImage.opacity = Math.min(boundaryReferenceImage.opacity, .5); boundaryImageSelected = false; }
    }
    commitBoundaryHistory(before);
    renderBoundaryStage();
  }

  function removeBoundaryReferenceImage() {
    if (!boundaryReferenceImage) return;
    const before = boundarySnapshot();
    boundaryReferenceImage = null;
    boundaryImageSelected = false;
    boundaryImageCalibration = { active: false, points: [] };
    commitBoundaryHistory(before);
    updateBoundaryImageTools();
    renderBoundaryStage();
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
    if (currentStage === 1 && stage1Substep === 1 && boundaryType === "manual" && boundaryReferenceImage) updateBoundaryImageDom();
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

  function nextCustomCellId() {
    const existingCells = [
      ...variants.flatMap(variant => Array.isArray(variant?.cells) ? variant.cells : []),
      ...(Array.isArray(manualVariant?.cells) ? manualVariant.cells : [])
    ];
    let highestUsed = customCellIdSequence;
    existingCells.forEach(cell => {
      const match = /^C(\d+)$/i.exec(String(cell?.id ?? ""));
      if (match) highestUsed = Math.max(highestUsed, Number(match[1]) || 0);
    });
    customCellIdSequence = highestUsed + 1;
    return `C${String(customCellIdSequence).padStart(3, "0")}`;
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
    manualCellSize = readNumber("cellType") || state.cellSize;
    manualCellGap = state.cellGap;
    manualGridAngle = state.gridAngle;
    manualGridOrigin = state.gridOrigin;
    manualSelectedCellIds = new Set();
    manualControllerSelected = false;
    manualControllerFieldBefore = null;
    const style = $("manualGridStyle"), size = $("manualCellSize"), gap = $("manualCellGap");
    if (style) style.value = manualGridStyle;
    if (size) size.value = manualCellSize;
    if (gap) gap.value = manualCellGap;
    syncManualCellGeometryFromProfile();
    syncManualControllerFields();
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
