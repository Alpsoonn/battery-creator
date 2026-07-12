(function (global) {
  "use strict";

  global.BATTERY_STRIP_PHYSICS = Object.freeze({
    schema_version: "1.0.0",
    reference_temperature_C: 20,
    materials: Object.freeze({
      pure_nickel_Ni200: Object.freeze({
        name_pl: "Czysty nikiel Ni200",
        display_color_hex: "#cbd5e1",
        base_material: "nickel",
        electrical_resistivity_ohm_m: Object.freeze({ nominal: 9.0e-8, min: 7.0e-8, max: 9.6e-8 }),
        temperature_coefficient_1_K: 0.005,
        thermal_conductivity_W_mK: 71,
        specific_heat_J_kgK: 456,
        density_kg_m3: 8900,
        melting_temperature_C: Object.freeze({ min: 1435, max: 1446, approximate: false })
      }),
      nickel_plated_low_carbon_steel: Object.freeze({
        name_pl: "Stal niskowęglowa niklowana",
        display_color_hex: "#94a3b8",
        base_material: "low_carbon_steel",
        coating: "nickel",
        electrical_resistivity_ohm_m: Object.freeze({ nominal: 1.8e-7, min: 1.6e-7, max: 2.9e-7 }),
        temperature_coefficient_1_K: 0.004,
        thermal_conductivity_W_mK: 52,
        specific_heat_J_kgK: 486,
        density_kg_m3: 7870,
        melting_temperature_C: Object.freeze({ min: 1450, max: 1450, approximate: true })
      }),
      copper_C110: Object.freeze({
        name_pl: "Miedź C110",
        display_color_hex: "#d97706",
        base_material: "copper",
        electrical_resistivity_ohm_m: Object.freeze({ nominal: 1.72e-8, min: 1.68e-8, max: 1.75e-8 }),
        temperature_coefficient_1_K: 0.00393,
        thermal_conductivity_W_mK: 390,
        specific_heat_J_kgK: 385,
        density_kg_m3: 8910,
        melting_temperature_C: Object.freeze({ min: 1085, max: 1085, approximate: false })
      }),
      stainless_steel_304: Object.freeze({
        name_pl: "Stal nierdzewna 304",
        display_color_hex: "#a7b0bf",
        base_material: "stainless_steel_304",
        electrical_resistivity_ohm_m: Object.freeze({ nominal: 7.2e-7, min: 6.9e-7, max: 7.5e-7 }),
        temperature_coefficient_1_K: 0.00094,
        thermal_conductivity_W_mK: 16,
        specific_heat_J_kgK: 500,
        density_kg_m3: 8000,
        melting_temperature_C: Object.freeze({ min: 1400, max: 1450, approximate: true })
      })
    }),
    presets: Object.freeze([
      { id: "strip_0_10x6", thickness_mm: 0.10, width_mm: 6, cross_section_mm2: 0.60, resistance_mohm_per_100mm: { pure_nickel_Ni200: 15.00, nickel_plated_low_carbon_steel: 30.00, copper_C110: 2.87 } },
      { id: "strip_0_10x8", thickness_mm: 0.10, width_mm: 8, cross_section_mm2: 0.80, resistance_mohm_per_100mm: { pure_nickel_Ni200: 11.25, nickel_plated_low_carbon_steel: 22.50, copper_C110: 2.15 } },
      { id: "strip_0_15x6", thickness_mm: 0.15, width_mm: 6, cross_section_mm2: 0.90, resistance_mohm_per_100mm: { pure_nickel_Ni200: 10.00, nickel_plated_low_carbon_steel: 20.00, copper_C110: 1.91 } },
      { id: "strip_0_15x8", thickness_mm: 0.15, width_mm: 8, cross_section_mm2: 1.20, resistance_mohm_per_100mm: { pure_nickel_Ni200: 7.50, nickel_plated_low_carbon_steel: 15.00, copper_C110: 1.43 } },
      { id: "strip_0_15x10", thickness_mm: 0.15, width_mm: 10, cross_section_mm2: 1.50, resistance_mohm_per_100mm: { pure_nickel_Ni200: 6.00, nickel_plated_low_carbon_steel: 12.00, copper_C110: 1.15 } },
      { id: "strip_0_20x8", thickness_mm: 0.20, width_mm: 8, cross_section_mm2: 1.60, resistance_mohm_per_100mm: { pure_nickel_Ni200: 5.63, nickel_plated_low_carbon_steel: 11.25, copper_C110: 1.08 } },
      { id: "strip_0_20x10", thickness_mm: 0.20, width_mm: 10, cross_section_mm2: 2.00, resistance_mohm_per_100mm: { pure_nickel_Ni200: 4.50, nickel_plated_low_carbon_steel: 9.00, copper_C110: 0.86 } },
      { id: "strip_0_20x12", thickness_mm: 0.20, width_mm: 12, cross_section_mm2: 2.40, resistance_mohm_per_100mm: { pure_nickel_Ni200: 3.75, nickel_plated_low_carbon_steel: 7.50, copper_C110: 0.72 } },
      { id: "strip_0_20x15", thickness_mm: 0.20, width_mm: 15, cross_section_mm2: 3.00, resistance_mohm_per_100mm: { pure_nickel_Ni200: 3.00, nickel_plated_low_carbon_steel: 6.00, copper_C110: 0.57 } },
      { id: "strip_0_30x10", thickness_mm: 0.30, width_mm: 10, cross_section_mm2: 3.00, resistance_mohm_per_100mm: { pure_nickel_Ni200: 3.00, nickel_plated_low_carbon_steel: 6.00, copper_C110: 0.57 } },
      { id: "strip_0_30x15", thickness_mm: 0.30, width_mm: 15, cross_section_mm2: 4.50, resistance_mohm_per_100mm: { pure_nickel_Ni200: 2.00, nickel_plated_low_carbon_steel: 4.00, copper_C110: 0.38 } },
      { id: "strip_0_30x20", thickness_mm: 0.30, width_mm: 20, cross_section_mm2: 6.00, resistance_mohm_per_100mm: { pure_nickel_Ni200: 1.50, nickel_plated_low_carbon_steel: 3.00, copper_C110: 0.29 } }
    ])
  });
})(window);
