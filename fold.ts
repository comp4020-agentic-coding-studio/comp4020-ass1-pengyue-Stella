// Pure fold math, kept separate from main.ts so it's directly testable
// without executing DOM/browser code.

export const INITIAL_THICKNESS_MM = 0.1;

export function thicknessAfterFolds(
  foldCount: number,
  initialThicknessMm: number = INITIAL_THICKNESS_MM,
): number {
  return initialThicknessMm * 2 ** foldCount;
}

export function formatThickness(mm: number): string {
  if (mm < 10) return `${mm.toFixed(3)} mm`;
  if (mm < 1000) return `${(mm / 10).toFixed(2)} cm`;
  const meters = mm / 1000;
  if (meters < 1000) return `${meters.toFixed(2)} m`;
  const km = meters / 1000;
  if (km < 1_000_000) return `${km.toFixed(2)} km`;
  return `${km.toExponential(2)} km`;
}

export type PaperPreset = {
  id: string;
  label: string;
  hint: string;
  thicknessMm: number;
  sheetLengthMm: number;
};

// Thickness/length figures are typical, approximate stand-ins for each kind
// of sheet, not measurements of a specific real product.
export const PAPER_PRESETS: PaperPreset[] = [
  { id: "a4", label: "A4", hint: "the paper on your desk", thicknessMm: 0.1, sheetLengthMm: 297 },
  {
    id: "newspaper",
    label: "Newspaper sheet",
    hint: "thin, wide broadsheet",
    thicknessMm: 0.055,
    sheetLengthMm: 600,
  },
  {
    id: "large",
    label: "Large sheet",
    hint: "poster-weight card",
    thicknessMm: 0.3,
    sheetLengthMm: 900,
  },
  {
    id: "giant",
    label: "Giant sheet",
    hint: "a big banner roll",
    thicknessMm: 0.1,
    sheetLengthMm: 5000,
  },
];

export function getPreset(id: string): PaperPreset {
  return PAPER_PRESETS.find((preset) => preset.id === id) ?? PAPER_PRESETS[0];
}

// Britney Gallivan's minimum strip length needed to fold a sheet of
// thickness t exactly n times in one direction:
// L = (pi*t/6)(2^n + 4)(2^n - 1). Used as a sourced, per-preset trigger for
// "real paper stops here" instead of asserting one universal fold count.
export function minLengthForFolds(thicknessMm: number, folds: number): number {
  const p = 2 ** folds;
  return ((Math.PI * thicknessMm) / 6) * (p + 4) * (p - 1);
}

export function physicalFoldLimit(preset: PaperPreset): number {
  let folds = 0;
  while (minLengthForFolds(preset.thicknessMm, folds + 1) <= preset.sheetLengthMm) {
    folds += 1;
  }
  return folds;
}
