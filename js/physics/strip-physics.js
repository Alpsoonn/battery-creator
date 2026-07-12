const MATERIALS_URL = new URL('../../data/physics/strip-materials.json', import.meta.url);
const PRESETS_URL = new URL('../../data/physics/strip-size-presets.json', import.meta.url);

export async function loadStripPhysicsData() {
  const [materialsResponse, presetsResponse] = await Promise.all([
    fetch(MATERIALS_URL),
    fetch(PRESETS_URL)
  ]);

  if (!materialsResponse.ok || !presetsResponse.ok) {
    throw new Error('Nie udało się wczytać danych fizycznych taśm.');
  }

  const [materials, presets] = await Promise.all([
    materialsResponse.json(),
    presetsResponse.json()
  ]);

  return { materials, presets };
}

export function stripResistanceOhm({
  material,
  length_mm,
  width_mm,
  thickness_mm,
  temperature_C = 20,
  layers = 1,
  measured_resistance_mohm_per_100mm = null
}) {
  assertPositive('length_mm', length_mm);
  assertPositive('width_mm', width_mm);
  assertPositive('thickness_mm', thickness_mm);
  assertPositive('layers', layers);

  const measured = Number(measured_resistance_mohm_per_100mm);
  const hasMeasurement = measured_resistance_mohm_per_100mm !== null
    && measured_resistance_mohm_per_100mm !== ''
    && Number.isFinite(measured)
    && measured > 0;

  const resistanceAt20C = hasMeasurement
    ? measured * (length_mm / 100) * 1e-3
    : material.electrical_resistivity_ohm_m.nominal
      * (length_mm * 1e-3)
      / (width_mm * thickness_mm * 1e-6);

  const temperatureMultiplier = 1
    + material.temperature_coefficient_1_K * (temperature_C - 20);

  if (temperatureMultiplier <= 0) {
    throw new RangeError('Model liniowy TCR daje niefizyczną rezystancję dla podanej temperatury.');
  }

  return resistanceAt20C * temperatureMultiplier / layers;
}

export function stripMassKg({ material, length_mm, width_mm, thickness_mm, layers = 1 }) {
  assertPositive('length_mm', length_mm);
  assertPositive('width_mm', width_mm);
  assertPositive('thickness_mm', thickness_mm);
  assertPositive('layers', layers);

  return length_mm * width_mm * thickness_mm * material.density_kg_m3 * 1e-9 * layers;
}

export function stripHeatCapacityJK(geometry) {
  return stripMassKg(geometry) * geometry.material.specific_heat_J_kgK;
}

export function joulePowerW(current_A, resistance_ohm) {
  if (!Number.isFinite(current_A)) throw new TypeError('current_A musi być liczbą.');
  assertPositive('resistance_ohm', resistance_ohm);
  return current_A ** 2 * resistance_ohm;
}

function assertPositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} musi być dodatnią liczbą.`);
  }
}
