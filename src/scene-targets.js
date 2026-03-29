function freezePoint(x, y, z) {
  return Object.freeze({ x, y, z });
}

export const SOLAR_ORIGIN_PC = freezePoint(0, 0, 0);
export const ORION_CENTER_PC = freezePoint(62.775, 602.667, -12.713);
export const GALACTIC_CENTER_PC = freezePoint(-446.986, -7138.118, -3965.748);

export const SCENE_TARGETS_PC = Object.freeze({
  solarOrigin: SOLAR_ORIGIN_PC,
  orionCenter: ORION_CENTER_PC,
  galacticCenter: GALACTIC_CENTER_PC,
});
