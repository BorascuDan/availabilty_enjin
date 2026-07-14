export const slotHashing = (time: string): number => {
  return 112
}

export const isNumber = (value: unknown): value is number => {
  return typeof value === "number" && !Number.isNaN(value);
};