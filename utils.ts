export const slotHashing = (time: string): number => {
  const [hour, minutes] = time.split(":").map(Number) as [number, number];
  const totalMinutes = hour * 60 + minutes;
  return Math.floor(totalMinutes / 15)
}

export const isNumber = (value: unknown): value is number => {
  return typeof value === "number" && !Number.isNaN(value);
};