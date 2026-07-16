import { SLOT_DURATION } from "./enjin.js";

//converts "HH:MM" to minutes since midnight
export const toMinutes = (time: string): number => {
  const [hour, minutes] = time.split(":").map(Number) as [number, number];
  return hour * 60 + minutes;
}

//hashes the time to its index
export const slotHashing = (time: string): number => {
  return Math.floor(toMinutes(time) / SLOT_DURATION)
}

export const minutesIndexOffset = (duration: number): number => {
  const basePosition = Math.floor(duration / SLOT_DURATION);
  if (!(duration % SLOT_DURATION)) return basePosition - 1;
  else return basePosition;
}

export const isNumber = (value: unknown): value is number => {
  return typeof value === "number" && !Number.isNaN(value);
};
