// The paper and PDF share these measurements in points; Paper converts them to pixels at 96 px per inch.
// Keep this module independent of react-pdf, which loads only when the first PDF is made.
export const LAYOUT = {
  /** Sl No., description (the remaining width), HSN/SAC, Quantity, Rate, per, Amount. */
  cols: [26, 0, 50, 62, 58, 30, 80],
  infoWidth: 240,
  titleSide: 80,
  bankLabel: 82,
  padding: { pageVertical: 14, pageHorizontal: 20, cell: 3, block: 5, noteLeft: 8 },
} as const;
