(function (global) {
  "use strict";

  const EPSILON = 1e-9;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function normalizeAngle(angle) {
    const value = Number(angle) || 0;
    return ((value % 180) + 180) % 180;
  }

  function angleDifference(a, b) {
    const delta = Math.abs(normalizeAngle(a) - normalizeAngle(b));
    return Math.min(delta, 180 - delta);
  }

  function uniqueAngles(angles) {
    const result = [];
    angles.forEach(angle => {
      const normalized = normalizeAngle(angle);
      if (!result.some(existing => angleDifference(existing, normalized) < 0.1)) result.push(normalized);
    });
    return result;
  }

  function averageRectangleAngle(a, b) {
    const ar = normalizeAngle(a) * Math.PI / 90;
    const br = normalizeAngle(b) * Math.PI / 90;
    return normalizeAngle(Math.atan2(Math.sin(ar) + Math.sin(br), Math.cos(ar) + Math.cos(br)) * 45 / Math.PI);
  }

  function pointInPolygon(point, points) {
    let inside = false;
    for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
      const a = points[index], b = points[previous];
      if ((a.y > point.y) !== (b.y > point.y)
        && point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || EPSILON) + a.x) inside = !inside;
    }
    return inside;
  }

  function distanceToSegment(point, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const lengthSquared = vx * vx + vy * vy;
    if (lengthSquared < EPSILON) return distance(point, a);
    const t = clamp(((point.x - a.x) * vx + (point.y - a.y) * vy) / lengthSquared, 0, 1);
    return Math.hypot(point.x - (a.x + vx * t), point.y - (a.y + vy * t));
  }

  function projectToSegment(point, edge) {
    const along = clamp((point.x - edge.a.x) * edge.ux + (point.y - edge.a.y) * edge.uy, 0, edge.length);
    const projected = { x: edge.a.x + edge.ux * along, y: edge.a.y + edge.uy * along };
    return { along, point: projected, distance: distance(point, projected) };
  }

  function rectCorners(rect) {
    const angle = normalizeAngle(rect.angle) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    return [
      [-rect.w / 2, -rect.h / 2], [rect.w / 2, -rect.h / 2],
      [rect.w / 2, rect.h / 2], [-rect.w / 2, rect.h / 2]
    ].map(([x, y]) => ({ x: rect.cx + x * cos - y * sin, y: rect.cy + x * sin + y * cos }));
  }

  function rectSamplePoints(rect) {
    const corners = rectCorners(rect);
    return corners.concat(corners.map((corner, index) => {
      const next = corners[(index + 1) % corners.length];
      return { x: (corner.x + next.x) / 2, y: (corner.y + next.y) / 2 };
    }), [{ x: rect.cx, y: rect.cy }]);
  }

  function rectInsidePolygon(rect, points, margin) {
    const samples = rectSamplePoints(rect);
    return samples.every(point => pointInPolygon(point, points)
      && points.every((boundaryPoint, index) => distanceToSegment(point, boundaryPoint, points[(index + 1) % points.length]) + 1e-6 >= margin));
  }

  function circleRectOverlap(cell, radius, rect, clearance) {
    const angle = -normalizeAngle(rect.angle) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const dx = cell.x - rect.cx, dy = cell.y - rect.cy;
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;
    const outsideX = Math.max(Math.abs(localX) - rect.w / 2, 0);
    const outsideY = Math.max(Math.abs(localY) - rect.h / 2, 0);
    return Math.hypot(outsideX, outsideY) < radius + clearance;
  }

  function normalSupport(rect, nx, ny) {
    const angle = normalizeAngle(rect.angle) * Math.PI / 180;
    const ux = Math.cos(angle), uy = Math.sin(angle);
    const vx = -uy, vy = ux;
    return Math.abs(nx * ux + ny * uy) * rect.w / 2 + Math.abs(nx * vx + ny * vy) * rect.h / 2;
  }

  function significantCornerIndices(points) {
    if (points.length <= 4) return points.map((_, index) => index);
    return points.map((point, index) => {
      const previous = points[(index - 1 + points.length) % points.length];
      const next = points[(index + 1) % points.length];
      const previousLength = Math.max(EPSILON, distance(point, previous));
      const nextLength = Math.max(EPSILON, distance(point, next));
      const dot = ((previous.x - point.x) / previousLength) * ((next.x - point.x) / nextLength)
        + ((previous.y - point.y) / previousLength) * ((next.y - point.y) / nextLength);
      return dot > -0.978 ? index : -1;
    }).filter(index => index >= 0);
  }

  function polygonEdges(points, frameMargin) {
    const centroid = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }), { x: 0, y: 0 });
    return points.map((a, index) => {
      const b = points[(index + 1) % points.length];
      const dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < EPSILON) return null;
      const ux = dx / length, uy = dy / length;
      let nx = -uy, ny = ux;
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const probe = Math.max(0.5, Math.min(3, frameMargin + 1));
      if (!pointInPolygon({ x: midpoint.x + nx * probe, y: midpoint.y + ny * probe }, points)) {
        nx = -nx;
        ny = -ny;
      }
      if (!pointInPolygon({ x: midpoint.x + nx * probe, y: midpoint.y + ny * probe }, points)
        && (centroid.x - midpoint.x) * nx + (centroid.y - midpoint.y) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }
      return { index, a, b, length, ux, uy, nx, ny, angle: Math.atan2(dy, dx) * 180 / Math.PI };
    }).filter(Boolean);
  }

  function solveCornerCenter(vertex, firstNormal, firstDistance, secondNormal, secondDistance) {
    const determinant = firstNormal.x * secondNormal.y - firstNormal.y * secondNormal.x;
    if (Math.abs(determinant) < 0.08) return null;
    return {
      x: vertex.x + (firstDistance * secondNormal.y - firstNormal.y * secondDistance) / determinant,
      y: vertex.y + (firstNormal.x * secondDistance - firstDistance * secondNormal.x) / determinant
    };
  }

  function findPlacement(configuration) {
    const points = (configuration.boundaryPoints || []).map(point => ({ x: Number(point.x), y: Number(point.y) }));
    const cells = Array.isArray(configuration.cells) ? configuration.cells : [];
    const width = Math.max(1, Number(configuration.controllerWidth) || 1);
    const height = Math.max(1, Number(configuration.controllerHeight) || 1);
    const frameMargin = Math.max(0, Number(configuration.frameMargin) || 0);
    const cellRadius = Math.max(0, Number(configuration.cellRadius) || 0);
    const cellGap = Math.max(0, Number(configuration.cellGap) || 0);
    const target = configuration.target && Number.isFinite(configuration.target.x) && Number.isFinite(configuration.target.y)
      ? { x: Number(configuration.target.x), y: Number(configuration.target.y) }
      : null;
    const previous = configuration.previous || null;
    const guided = Boolean(target) || configuration.mode === "drag" || configuration.mode === "preferred";
    if (points.length < 3) return null;

    const edges = polygonEdges(points, frameMargin);
    const cornerIndices = significantCornerIndices(points);
    const clearance = cellGap + 1;
    const candidateKeys = new Set();
    const candidates = [];

    function evaluate(rect, metadata) {
      rect.angle = normalizeAngle(rect.angle);
      const key = `${rect.cx.toFixed(2)}:${rect.cy.toFixed(2)}:${rect.angle.toFixed(2)}:${metadata.kind || "edge"}`;
      if (candidateKeys.has(key) || !rectInsidePolygon(rect, points, frameMargin)) return;
      candidateKeys.add(key);
      const kept = [];
      let removed = 0, adjacentCells = 0;
      cells.forEach(cell => {
        if (circleRectOverlap(cell, cellRadius, rect, clearance)) removed++;
        else {
          kept.push(cell);
          if (circleRectOverlap(cell, cellRadius, rect, clearance + Math.max(3, cellGap + 2))) adjacentCells++;
        }
      });
      let cornerDistance = Infinity, cornerIndex = -1;
      const corners = rectCorners(rect);
      cornerIndices.forEach(index => corners.forEach(corner => {
        const value = distance(corner, points[index]);
        if (value < cornerDistance) {
          cornerDistance = value;
          cornerIndex = index;
        }
      }));
      if (!Number.isFinite(cornerDistance)) cornerDistance = 0;
      const pointerDistance = target ? Math.hypot(rect.cx - target.x, rect.cy - target.y) : 0;
      const anglePenalty = previous ? angleDifference(rect.angle, previous.angle) : 0;
      const sameEdgeBonus = previous && Number.isInteger(previous.edgeIndex) && previous.edgeIndex === metadata.edgeIndex ? 120 : 0;
      const sameCornerBonus = previous && Number.isInteger(previous.cornerIndex) && previous.cornerIndex === metadata.cornerIndex ? 180 : 0;
      const cornerSnapBonus = guided && metadata.kind === "corner" ? 240 : 0;
      const score = guided
        ? -removed * 7500 - pointerDistance * 320 - cornerDistance * 14 + adjacentCells * 28 - anglePenalty * 3 + sameEdgeBonus + sameCornerBonus + cornerSnapBonus
        : kept.length * 1e9 - cornerDistance * 100000 + adjacentCells * 2000 - (metadata.insetExtra || 0) * 100;
      const decoratedRect = {
        ...rect,
        edgeIndex: Number.isInteger(metadata.edgeIndex) ? metadata.edgeIndex : null,
        edgeT: Number.isFinite(metadata.edgeT) ? metadata.edgeT : null,
        cornerIndex: metadata.kind === "corner" && Number.isInteger(metadata.cornerIndex) ? metadata.cornerIndex : cornerIndex,
        cornerDistance,
        placementKind: metadata.kind || "edge"
      };
      candidates.push({ rect: decoratedRect, cells: kept, removed, adjacentCells, pointerDistance, score });
    }

    const projections = target ? edges.map(edge => ({ edge, projection: projectToSegment(target, edge) })).sort((a, b) => a.projection.distance - b.projection.distance) : [];
    const snapBand = Math.max(14, cellRadius * 1.6, Math.min(width, height) * 0.2);
    const selectedEdges = target
      ? projections.filter(item => item.projection.distance <= projections[0].projection.distance + snapBand).slice(0, 3).map(item => item.edge)
      : edges;

    selectedEdges.forEach(edge => {
      const projection = target ? projectToSegment(target, edge) : null;
      const angles = configuration.allowRotation === false
        ? [0]
        : uniqueAngles([edge.angle, edge.angle + 90]);
      const alongPositions = [];
      if (projection) {
        const offsets = [0, -0.75, 0.75, -2, 2, -4, 4, -8, 8, -cellRadius, cellRadius, -cellRadius * 2, cellRadius * 2];
        offsets.forEach(offset => alongPositions.push(clamp(projection.along + offset, 0, edge.length)));
      } else {
        const step = Math.max(2.5, Math.min(5, Math.max(2.5, cellRadius / 2)));
        for (let along = 0; along <= edge.length + EPSILON; along += step) alongPositions.push(Math.min(along, edge.length));
        alongPositions.push(edge.length);
      }
      angles.forEach(angle => {
        const prototype = { w: width, h: height, angle };
        const support = normalSupport(prototype, edge.nx, edge.ny);
        const insetExtras = guided ? [0.35, 1.5, 4, 8] : [0.35, 2, 6, Math.max(10, cellRadius)];
        insetExtras.forEach(insetExtra => alongPositions.forEach(along => {
          const inset = frameMargin + support + insetExtra;
          evaluate({
            cx: edge.a.x + edge.ux * along + edge.nx * inset,
            cy: edge.a.y + edge.uy * along + edge.ny * inset,
            w: width,
            h: height,
            angle
          }, { kind: "edge", edgeIndex: edge.index, edgeT: edge.length ? along / edge.length : 0, insetExtra });
        }));
      });
    });

    let selectedCorners = cornerIndices;
    if (target && selectedCorners.length) {
      const sorted = selectedCorners.map(index => ({ index, distance: distance(points[index], target) })).sort((a, b) => a.distance - b.distance);
      selectedCorners = sorted.filter(item => item.distance <= sorted[0].distance + snapBand * 1.8).slice(0, 2).map(item => item.index);
    }
    selectedCorners.forEach(cornerIndex => {
      const previousEdge = edges.find(edge => edge.index === (cornerIndex - 1 + points.length) % points.length);
      const nextEdge = edges.find(edge => edge.index === cornerIndex);
      if (!previousEdge || !nextEdge) return;
      const baseAngles = configuration.allowRotation === false
        ? [0]
        : [previousEdge.angle, nextEdge.angle, averageRectangleAngle(previousEdge.angle, nextEdge.angle), previous?.angle];
      const angles = configuration.allowRotation === false ? [0] : uniqueAngles(baseAngles.filter(Number.isFinite).flatMap(angle => [angle, angle + 90]));
      angles.forEach(angle => {
        const prototype = { w: width, h: height, angle };
        const firstDistance = frameMargin + normalSupport(prototype, previousEdge.nx, previousEdge.ny) + 0.45;
        const secondDistance = frameMargin + normalSupport(prototype, nextEdge.nx, nextEdge.ny) + 0.45;
        const center = solveCornerCenter(points[cornerIndex], { x: previousEdge.nx, y: previousEdge.ny }, firstDistance, { x: nextEdge.nx, y: nextEdge.ny }, secondDistance);
        if (!center) return;
        evaluate({ cx: center.x, cy: center.y, w: width, h: height, angle }, {
          kind: "corner",
          cornerIndex,
          edgeIndex: distance(center, previousEdge.a) < distance(center, nextEdge.b) ? previousEdge.index : nextEdge.index,
          edgeT: cornerIndex === nextEdge.index ? 0 : 1,
          insetExtra: 0
        });
      });
    });

    if (!candidates.length) {
      const xs = points.map(point => point.x), ys = points.map(point => point.y);
      const step = Math.max(5, Math.min(width, height) / 4);
      const angles = configuration.allowRotation === false ? [0] : [0, 45, 90, 135];
      for (let cy = Math.min(...ys); cy <= Math.max(...ys); cy += step) {
        for (let cx = Math.min(...xs); cx <= Math.max(...xs); cx += step) {
          angles.forEach(angle => evaluate({ cx, cy, w: width, h: height, angle }, { kind: "interior", insetExtra: 0 }));
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score || b.cells.length - a.cells.length || a.pointerDistance - b.pointerDistance);
    return candidates[0] || null;
  }

  const api = { version: "1.0.0", findPlacement, rectCorners, rectInsidePolygon };
  global.BATTERY_CONTROLLER_PLACEMENT = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
