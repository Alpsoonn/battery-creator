(function (global) {
  "use strict";

  const curve = (points) => Object.freeze(points.map(([x, y]) => Object.freeze({ x, y })));

  global.BATTERY_CELL_MODELS = Object.freeze({
    schema_version: "1.0.0",
    description_pl: "Uproszczone charakterystyki ogniw do modelu OCV(SOC), R(SOC,T) i Q(T).",
    chemistries: Object.freeze({
      NMC_NCA: Object.freeze({
        name_pl: "NMC",
        defaults: Object.freeze({ voltage_max_V: 4.2, voltage_min_V: 2.8, voltage_nominal_V: 3.6, dcir_mohm: 20, specific_heat_J_kgK: 1000, heat_transfer_W_m2K: 8 }),
        ocv_soc: curve([[0, 2.80], [5, 3.20], [10, 3.38], [20, 3.55], [40, 3.68], [60, 3.78], [80, 3.92], [90, 4.05], [100, 4.20]]),
        resistance_temperature_factor: curve([[-20, 4.0], [-10, 2.5], [0, 1.65], [10, 1.25], [25, 1.0], [40, 0.90], [60, 1.05]]),
        resistance_soc_factor: curve([[0, 1.80], [10, 1.35], [20, 1.15], [50, 1.0], [80, 1.0], [100, 1.10]]),
        capacity_temperature_factor: curve([[-20, 0.55], [-10, 0.70], [0, 0.82], [10, 0.92], [25, 1.0], [40, 1.02], [60, 0.98]]),
        charge_current_temperature_factor: curve([[-20, 0], [-1, 0], [0, 0.10], [5, 0.35], [10, 0.65], [25, 1.0], [45, 0.80], [60, 0]]),
        dynamic_model: Object.freeze({ r1_fraction_of_dcir: 0.35, tau1_s: 18 })
      }),
      NCA: Object.freeze({
        name_pl: "NCA",
        defaults: Object.freeze({ voltage_max_V: 4.2, voltage_min_V: 2.8, voltage_nominal_V: 3.6, dcir_mohm: 20, specific_heat_J_kgK: 1000, heat_transfer_W_m2K: 8 }),
        ocv_soc: curve([[0, 2.80], [5, 3.18], [10, 3.36], [20, 3.54], [40, 3.67], [60, 3.77], [80, 3.91], [90, 4.04], [100, 4.20]]),
        resistance_temperature_factor: curve([[-20, 4.2], [-10, 2.6], [0, 1.68], [10, 1.26], [25, 1.0], [40, 0.90], [60, 1.06]]),
        resistance_soc_factor: curve([[0, 1.85], [10, 1.38], [20, 1.16], [50, 1.0], [80, 1.0], [100, 1.12]]),
        capacity_temperature_factor: curve([[-20, 0.54], [-10, 0.69], [0, 0.81], [10, 0.92], [25, 1.0], [40, 1.02], [60, 0.98]]),
        charge_current_temperature_factor: curve([[-20, 0], [-1, 0], [0, 0.10], [5, 0.35], [10, 0.65], [25, 1.0], [45, 0.80], [60, 0]]),
        dynamic_model: Object.freeze({ r1_fraction_of_dcir: 0.36, tau1_s: 17 })
      }),
      LFP: Object.freeze({
        name_pl: "LFP",
        defaults: Object.freeze({ voltage_max_V: 3.65, voltage_min_V: 2.5, voltage_nominal_V: 3.2, dcir_mohm: 25, specific_heat_J_kgK: 1000, heat_transfer_W_m2K: 8 }),
        ocv_soc: curve([[0, 2.50], [5, 3.00], [10, 3.18], [20, 3.25], [40, 3.28], [60, 3.30], [80, 3.33], [90, 3.40], [100, 3.65]]),
        resistance_temperature_factor: curve([[-20, 5.0], [-10, 3.0], [0, 1.85], [10, 1.30], [25, 1.0], [40, 0.92], [60, 1.08]]),
        resistance_soc_factor: curve([[0, 2.0], [10, 1.45], [20, 1.18], [50, 1.0], [80, 1.0], [100, 1.12]]),
        capacity_temperature_factor: curve([[-20, 0.50], [-10, 0.68], [0, 0.80], [10, 0.91], [25, 1.0], [40, 1.02], [60, 0.98]]),
        charge_current_temperature_factor: curve([[-20, 0], [-1, 0], [0, 0.05], [5, 0.25], [10, 0.55], [25, 1.0], [45, 0.75], [60, 0]]),
        dynamic_model: Object.freeze({ r1_fraction_of_dcir: 0.30, tau1_s: 25 })
      }),
      LCO: Object.freeze({
        name_pl: "LCO",
        defaults: Object.freeze({ voltage_max_V: 4.2, voltage_min_V: 3.0, voltage_nominal_V: 3.7, dcir_mohm: 30, specific_heat_J_kgK: 1000, heat_transfer_W_m2K: 8 }),
        ocv_soc: curve([[0, 3.00], [5, 3.30], [10, 3.45], [20, 3.58], [40, 3.72], [60, 3.84], [80, 3.98], [90, 4.08], [100, 4.20]]),
        resistance_temperature_factor: curve([[-20, 4.5], [-10, 2.8], [0, 1.75], [10, 1.28], [25, 1.0], [40, 0.92], [60, 1.08]]),
        resistance_soc_factor: curve([[0, 1.90], [10, 1.40], [20, 1.16], [50, 1.0], [80, 1.02], [100, 1.15]]),
        capacity_temperature_factor: curve([[-20, 0.52], [-10, 0.68], [0, 0.80], [10, 0.91], [25, 1.0], [40, 1.01], [60, 0.97]]),
        charge_current_temperature_factor: curve([[-20, 0], [-1, 0], [0, 0.08], [5, 0.30], [10, 0.60], [25, 1.0], [45, 0.75], [60, 0]]),
        dynamic_model: Object.freeze({ r1_fraction_of_dcir: 0.38, tau1_s: 15 })
      })
    }),
    default_spread_percent: Object.freeze({ capacity: 2, dcir: 5, initial_soc: 0.5 }),
    dcir_acir_estimation: Object.freeze({
      multiplier: 1.75,
      note_pl: "ACIR 1 kHz opisuje impedancję dla małego sygnału. Do modelu długiego impulsu i nagrzewania przyjmowane jest DCIR = ACIR × 1,75; dynamiczna gałąź R1-C1 pozostaje liczona osobno."
    })
  });
})(window);
