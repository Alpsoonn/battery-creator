// Math and Geometry Helpers - Global Script

function triangleFromSides(values) {
  const sides = [...values].sort((a, b) => a - b);
  const shortest = sides[0];
  const top = sides[1];
  const longest = sides[2];
  
  if (shortest + top <= longest) {
    throw new Error("Podane boki nie tworzą trójkąta. Suma dwóch krótszych boków musi być większa od najdłuższego.");
  }
  
  const x = (longest * longest - shortest * shortest + top * top) / (2 * top);
  const y2 = longest * longest - x * x;
  if (y2 <= 0) throw new Error("Nie da się złożyć stabilnego trójkąta z tych wymiarów.");
  
  const y = Math.sqrt(y2);
  return {
    points: [{ x: 0, y: 0 }, { x: top, y: 0 }, { x, y }],
    shortest,
    top,
    longest
  };
}

function edgeDistance(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
  
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function pointInTriangle(p, tri, margin = 0) {
  const [a, b, c] = tri;
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  
  if (hasNeg && hasPos) return false;
  if (margin <= 0) return true;
  
  return edgeDistance(p, a, b) >= margin &&
         edgeDistance(p, b, c) >= margin &&
         edgeDistance(p, c, a) >= margin;
}

function sign(p1, p2, p3) {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

function rotatePoint(p, angleRad) {
  const ca = Math.cos(angleRad);
  const sa = Math.sin(angleRad);
  return {
    x: p.x * ca - p.y * sa,
    y: p.x * sa + p.y * ca
  };
}

function polygonBounds(points) {
  return {
    minX: Math.min(...points.map(p => p.x)),
    maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)),
    maxY: Math.max(...points.map(p => p.y))
  };
}

function rotatedRectCorners(rect) {
  const angleRad = (rect.angle || 0) * Math.PI / 180;
  const halfW = rect.w / 2;
  const halfH = rect.h / 2;
  
  const localCorners = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH }
  ];
  
  return localCorners.map(p => {
    const rotated = rotatePoint(p, angleRad);
    return {
      x: rect.cx + rotated.x,
      y: rect.cy + rotated.y
    };
  });
}

function rectInsideTriangle(rect, tri, margin) {
  const corners = rotatedRectCorners(rect);
  return corners.every(p => pointInTriangle(p, tri, margin));
}

function circleRectOverlap(cell, r, rect, clearance = 0) {
  const angleRad = -(rect.angle || 0) * Math.PI / 180;
  const local = rotatePoint(
    { x: cell.x - rect.cx, y: cell.y - rect.cy },
    angleRad
  );
  
  const dx = Math.max(Math.abs(local.x) - rect.w / 2, 0);
  const dy = Math.max(Math.abs(local.y) - rect.h / 2, 0);
  
  return Math.hypot(dx, dy) < (r + clearance);
}

function controllerCornerFit(rect, tri) {
  const corners = rotatedRectCorners(rect);
  let best = { distance: Infinity, vertexIndex: 0 };
  
  tri.forEach((vertex, vertexIndex) => {
    corners.forEach(corner => {
      const distance = Math.hypot(corner.x - vertex.x, corner.y - vertex.y);
      if (distance < best.distance) {
        best = { distance, vertexIndex };
      }
    });
  });
  
  return best;
}

// Expose functions globally explicitly (for completeness)
window.triangleFromSides = triangleFromSides;
window.edgeDistance = edgeDistance;
window.pointInTriangle = pointInTriangle;
window.sign = sign;
window.rotatePoint = rotatePoint;
window.polygonBounds = polygonBounds;
window.rotatedRectCorners = rotatedRectCorners;
window.rectInsideTriangle = rectInsideTriangle;
window.circleRectOverlap = circleRectOverlap;
window.controllerCornerFit = controllerCornerFit;
