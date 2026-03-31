function freezePoint(x, y, z) {
  return Object.freeze({ x, y, z });
}

export const SOLAR_ORIGIN_PC = freezePoint(0, 0, 0);
export const ALCYONE_PC = freezePoint(61.665, 94.489, 50.483);
export const ORION_CENTER_PC = freezePoint(62.775, 602.667, -12.713);
export const ORION_NEBULA_PC = freezePoint(44.371, 409.774, -38.889);
export const GALACTIC_CENTER_PC = freezePoint(-446.986, -7138.118, -3965.748);

export const SCENE_TARGETS_PC = Object.freeze({
  solarOrigin: SOLAR_ORIGIN_PC,
  alcyone: ALCYONE_PC,
  orionCenter: ORION_CENTER_PC,
  orionNebula: ORION_NEBULA_PC,
  galacticCenter: GALACTIC_CENTER_PC,
});
