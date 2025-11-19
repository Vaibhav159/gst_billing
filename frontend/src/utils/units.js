export const UNIT_DISPLAY = {
  gm: 'g',
  kg: 'kg',
  pcs: 'pc',
};

export const displayUnit = (unit) => UNIT_DISPLAY[unit] || UNIT_DISPLAY.gm;

export const rateSuffix = (unit) => displayUnit(unit);
