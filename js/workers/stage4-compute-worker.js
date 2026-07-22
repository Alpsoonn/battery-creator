"use strict";

const interpolate = (points, x) => {
  if (!points?.length) return 1;
  if (x <= points[0].x) return points[0].y;
  for (let index = 1; index < points.length; index++) {
    if (x <= points[index].x) {
      const left = points[index - 1], right = points[index];
      return left.y + (right.y - left.y) * (x - left.x) / (right.x - left.x || 1);
    }
  }
  return points[points.length - 1].y;
};

const prepareElectrical = payload => {
  const model = payload.model;
  const cells = payload.cells.map(cell => {
    const ocvV = interpolate(model.ocvSoc, cell.referenceSocPercent);
    const temperatureFactor = interpolate(model.resistanceTemperatureFactor, cell.tempC);
    const socFactor = interpolate(model.resistanceSocFactor, cell.soc);
    const r0Ohm = Math.max(1e-6, cell.baseDcirMohm * 1e-3 * temperatureFactor * socFactor);
    return {
      index: cell.index,
      ocvV,
      r0Ohm,
      r1Ohm: Math.max(1e-6, r0Ohm * cell.r1ToR0Ratio)
    };
  });
  const segments = payload.segments.map(segment => ({
    index: segment.index,
    resistanceOhm: Math.max(1e-7, segment.resistivity * (1 + segment.tcr * (segment.tempC - 20)) * segment.lengthMm * 1e-3 / segment.areaM2)
  }));
  return { cells, segments };
};

self.addEventListener("message", event => {
  const { id, type, payload } = event.data || {};
  try {
    const handlers = { "prepare-electrical": prepareElectrical };
    if (!handlers[type]) throw new Error(`Nieznany typ zadania: ${type}`);
    self.postMessage({ id, ok: true, result: handlers[type](payload) });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
});
