const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const catalogContext = { window: {}, console };
catalogContext.globalThis = catalogContext;
vm.createContext(catalogContext);
vm.runInContext(fs.readFileSync(path.join(root, "data/physics/cell-model-catalog.js"), "utf8"), catalogContext);

const context = {
  console,
  window: catalogContext,
  stage3CellCatalog: catalogContext.BATTERY_CELL_MODELS
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, "js/app/cell-profiles.js"), "utf8"), context);

const validFixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/profiles-valid.json"), "utf8")).profiles[0];
const invalidFixture = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/profiles-invalid.json"), "utf8")).profiles[0];

const valid = context.validateSavedCellProfile(validFixture);
assert.equal(valid.valid, true);
assert.equal(valid.profile.name, "QA poprawny profil");
assert.equal(valid.profile.model.ocvPoints, "0:2.8; 50:3.6; 100:4.2");

const invalid = context.validateSavedCellProfile(invalidFixture);
assert.equal(invalid.valid, false);
assert.ok(invalid.errors.length >= 10);
assert.ok(invalid.errors.some(error => error.includes("napięcia")));
assert.ok(invalid.errors.some(error => error.includes("ściśle rosnące")));

const nonFinite = structuredClone(validFixture);
nonFinite.model.capacityAh = "NaN";
assert.equal(context.validateSavedCellProfile(nonFinite).valid, false);

const emptyCustomCurve = structuredClone(validFixture);
emptyCustomCurve.model.ocvPoints = "";
assert.equal(context.validateSavedCellProfile(emptyCustomCurve).valid, false);

console.log("profile validation tests: OK");
