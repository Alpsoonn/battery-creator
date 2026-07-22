"use strict";

const assert = require("node:assert/strict");
const placement = require("../js/geometry/controller-placement.js");

const boundaryPoints = [
  { x: 0, y: 0 },
  { x: 500, y: 0 },
  { x: 500, y: 300 },
  { x: 0, y: 300 }
];

const cells = [];
let id = 0;
for (let y = 22; y <= 278; y += 23) {
  for (let x = 22; x <= 478; x += 23) cells.push({ id: id++, x, y });
}

const common = {
  boundaryPoints,
  cells,
  controllerWidth: 90,
  controllerHeight: 45,
  allowRotation: true,
  frameMargin: 8,
  cellRadius: 10.5,
  cellGap: 1.2
};

const automatic = placement.findPlacement({ ...common, mode: "auto" });
assert.ok(automatic, "automatic placement should find a controller position");
assert.equal(automatic.cells.length + automatic.removed, cells.length);
assert.equal(placement.rectInsidePolygon(automatic.rect, boundaryPoints, common.frameMargin), true);
assert.ok(["edge", "corner"].includes(automatic.rect.placementKind));

const topLeft = placement.findPlacement({ ...common, target: { x: 0, y: 0 }, mode: "drag" });
assert.ok(topLeft, "dragging to a corner should find a valid snapped position");
assert.equal(topLeft.rect.placementKind, "corner");
assert.equal(topLeft.rect.cornerIndex, 0);
assert.equal(placement.rectInsidePolygon(topLeft.rect, boundaryPoints, common.frameMargin), true);

const bottomRight = placement.findPlacement({ ...common, target: { x: 500, y: 300 }, previous: topLeft.rect, mode: "drag" });
assert.ok(bottomRight, "dragging to another corner should remain valid");
assert.equal(bottomRight.rect.cornerIndex, 2);
assert.ok(Math.hypot(bottomRight.rect.cx - topLeft.rect.cx, bottomRight.rect.cy - topLeft.rect.cy) > 200);

const fixedAngle = placement.findPlacement({ ...common, allowRotation: false, target: { x: 250, y: 0 }, mode: "drag" });
assert.ok(fixedAngle);
assert.equal(fixedAngle.rect.angle, 0);

console.log("controller placement tests: OK");
