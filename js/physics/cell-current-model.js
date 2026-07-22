(function (global) {
  "use strict";

  const positive = (value, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  };

  function normalize(model = {}) {
    const maximumDischargeA = positive(model.max_continuous_discharge_A, 1);
    const maximumChargeA = positive(model.max_charge_A, Math.max(0.1, maximumDischargeA * 0.5));
    const standardDischargeA = Math.min(
      maximumDischargeA,
      positive(model.standard_discharge_A, Math.max(0.1, maximumDischargeA * 0.5))
    );
    const standardChargeA = Math.min(
      maximumChargeA,
      positive(model.standard_charge_A, Math.max(0.1, maximumChargeA * 0.5))
    );
    return {
      ...model,
      standard_discharge_A: standardDischargeA,
      max_continuous_discharge_A: maximumDischargeA,
      standard_charge_A: standardChargeA,
      max_charge_A: maximumChargeA
    };
  }

  function validate(limits = {}) {
    const values = {
      standard_discharge_A: Number(limits.standard_discharge_A),
      max_continuous_discharge_A: Number(limits.max_continuous_discharge_A),
      standard_charge_A: Number(limits.standard_charge_A),
      max_charge_A: Number(limits.max_charge_A)
    };
    const errors = [];
    Object.entries(values).forEach(([name, value]) => {
      if (!Number.isFinite(value) || value <= 0) errors.push({ field: name, code: "positive" });
    });
    if (values.standard_discharge_A > values.max_continuous_discharge_A) {
      errors.push({ field: "standard_discharge_A", code: "standard_above_maximum" });
    }
    if (values.standard_charge_A > values.max_charge_A) {
      errors.push({ field: "standard_charge_A", code: "standard_above_maximum" });
    }
    return { valid: errors.length === 0, errors, values };
  }

  function limitsForMode(model, mode = "discharge") {
    const normalized = normalize(model);
    return mode === "charge"
      ? { standardA: normalized.standard_charge_A, maximumA: normalized.max_charge_A }
      : { standardA: normalized.standard_discharge_A, maximumA: normalized.max_continuous_discharge_A };
  }

  function packLimits(model, mode, parallel = 1) {
    const limits = limitsForMode(model, mode);
    const count = Math.max(1, Math.floor(Number(parallel) || 1));
    return { standardA: limits.standardA * count, maximumA: limits.maximumA * count };
  }

  function classify(currentA, model, mode = "discharge", parallel = 1) {
    const limits = packLimits(model, mode, parallel);
    const current = Math.abs(Number(currentA) || 0);
    const zone = current <= limits.standardA + 1e-9
      ? "standard"
      : current <= limits.maximumA + 1e-9 ? "elevated" : "over_maximum";
    return {
      zone,
      currentA: current,
      standardA: limits.standardA,
      maximumA: limits.maximumA,
      standardRatio: current / Math.max(1e-9, limits.standardA),
      maximumRatio: current / Math.max(1e-9, limits.maximumA)
    };
  }

  global.BATTERY_CURRENT_MODEL = Object.freeze({
    schema_version: "2.0.0",
    normalize,
    validate,
    limitsForMode,
    packLimits,
    classify
  });
})(typeof window !== "undefined" ? window : globalThis);
