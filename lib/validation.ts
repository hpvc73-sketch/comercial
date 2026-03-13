export const clampPercent = (value: number, max = 100): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), max);
};

export const sanitizeNumber = (value: number): number => (Number.isFinite(value) ? value : 0);
