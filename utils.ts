import { SLOT_DURATION } from "./enjin";

//hashes the time to its index
export const slotHashing = (time: string): number => {
  const [hour, minutes] = time.split(":").map(Number) as [number, number];
  const totalMinutes = hour * 60 + minutes;
  return Math.floor(totalMinutes / SLOT_DURATION)
}

export const minutesIndexOffset = (duration: number): number => {
  const basePosition = Math.floor(duration / SLOT_DURATION);
  if (!(duration % SLOT_DURATION)) return basePosition - 1;
  else return basePosition;
}

export const isNumber = (value: unknown): value is number => {
  return typeof value === "number" && !Number.isNaN(value);
};
