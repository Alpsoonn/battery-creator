"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("../js/physics/cell-current-model.js");

const model = globalThis.BATTERY_CURRENT_MODEL;
const limits = {
  standard_discharge_A: 5,
  max_continuous_discharge_A: 10,
  standard_charge_A: 2,
  max_charge_A: 5
};

assert.equal(model.validate(limits).valid, true);
assert.equal(model.validate({ ...limits, standard_discharge_A: 11 }).valid, false);
assert.equal(model.validate({ ...limits, standard_charge_A: 6 }).valid, false);

const legacy = model.normalize({ max_continuous_discharge_A: 12, max_charge_A: 4 });
assert.equal(legacy.standard_discharge_A, 6);
assert.equal(legacy.standard_charge_A, 2);

assert.deepEqual(model.packLimits(limits, "discharge", 6), { standardA: 30, maximumA: 60 });
assert.deepEqual(model.packLimits(limits, "charge", 6), { standardA: 12, maximumA: 30 });
assert.equal(model.classify(30, limits, "discharge", 6).zone, "standard");
assert.equal(model.classify(45, limits, "discharge", 6).zone, "elevated");
assert.equal(model.classify(61, limits, "discharge", 6).zone, "over_maximum");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const simulation = fs.readFileSync(path.join(root, "js", "stage4-simulation.js"), "utf8");

[
  "cellStandardDischarge",
  "cellMaxDischarge",
  "cellStandardCharge",
  "cellMaxCharge",
  "stage3CellStandardDischargeA",
  "stage3CellMaxDischargeA",
  "stage3CellStandardChargeA",
  "stage3CellMaxChargeA"
].forEach(id => assert.match(html, new RegExp(`id=["']${id}["']`)));

assert.match(simulation, /standardCurrentA/);
assert.match(simulation, /standardChargeCurrentA/);
assert.match(simulation, /secondsAboveStandard/);
assert.match(simulation, /temperatureAdjustedChargeLimitA/);

console.log("cell current model tests: OK");
