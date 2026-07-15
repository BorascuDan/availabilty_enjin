import { describe, it, expect, mock } from "bun:test";
import type { RedisClientType } from "redis";
import { ZodError } from "zod";
import { Availability, SLOTS_PER_DAY } from "./enjin";
import type { Booking } from "./types/schemas";
import { slotHashing } from "./utils";

const day = (base: 0 | 1, flipped: Array<[string, string]>): string => {
  const slots: number[] = new Array(SLOTS_PER_DAY).fill(base);
  for (const [start, end] of flipped)
    for (let i = slotHashing(start); i < slotHashing(end); i++) slots[i] = base ? 0 : 1;
  return slots.join("");
};

const booking: Booking = {
  "resource-1": {
    "2026-07-15": [
      {
        locationId: "location-1",
        schedules: [
          { start: "09:00", end: "17:00", canDoSchedule: true },
          { start: "12:00", end: "13:00", canDoSchedule: false },
        ],
        bookedIntervals: [
          { start: "09:30", end: "10:15" },
          { start: "15:00", end: "16:00" },
        ],
      },
      {
        locationId: "location-2",
        schedules: [
          { start: "10:00", end: "14:00", canDoSchedule: true },
        ],
        bookedIntervals: [],
      },
    ],
    "2026-07-16": [
      {
        locationId: "location-1",
        schedules: [
          { start: "08:00", end: "12:00", canDoSchedule: true },
        ],
        bookedIntervals: [
          { start: "13:00", end: "13:45" },
        ],
      },
    ],
  },
  "resource-2": {
    "2026-07-15": [
      {
        locationId: "location-2",
        schedules: [
          { start: "11:00", end: "19:00", canDoSchedule: true },
          { start: "14:30", end: "15:30", canDoSchedule: false },
        ],
        bookedIntervals: [
          { start: "11:00", end: "12:00" },
        ],
      },
      {
        locationId: "location-4",
        schedules: [
          { start: "09:00", end: "20:00", canDoSchedule: true },
        ],
        bookedIntervals: [
          { start: "09:00", end: "15:00" },
          { start: "15:30", end: "20:00" },
        ],
      },
    ],
  },
};

describe("Availability.cacheDisponibility", () => {
  it("batches every resource/location/date bitmap into a single mSet", async () => {
    //mocks a redis connection
    const mSet = mock(async () => "OK");
    const client = { mSet } as unknown as RedisClientType;
    const availability = new Availability({connection: client, resource: "salon"});

    await availability.cacheDisponibility(booking);

    //all keys are written in one multiplexed call
    expect(mSet).toHaveBeenCalledTimes(1);

    expect(mSet).toHaveBeenCalledWith({
      // open 09:00-17:00, break 12:00-13:00, booked 09:30-10:15 and 15:00-16:00
      // → free 09:00-09:30, 10:15-12:00, 13:00-15:00, 16:00-17:00
      "salon:availability:resource-1:location-1:2026-07-15":
        day(1, [["09:00", "09:30"], ["10:15", "12:00"], ["13:00", "15:00"], ["16:00", "17:00"]]),

      // open 10:00-14:00, nothing booked → free 10:00-14:00
      "salon:availability:resource-1:location-2:2026-07-15":
        day(1, [["10:00", "14:00"]]),

      // open 08:00-12:00, booked 13:00-13:45 (outside working hours, no effect)
      // → free 08:00-12:00
      "salon:availability:resource-1:location-1:2026-07-16":
        day(1, [["08:00", "12:00"]]),

      // open 11:00-19:00, break 14:30-15:30, booked 11:00-12:00
      // → free 12:00-14:30, 15:30-19:00
      "salon:availability:resource-2:location-2:2026-07-15":
        day(1, [["12:00", "14:30"], ["15:30", "19:00"]]),

      // open 09:00-20:00, booked 09:00-15:00 and 15:30-20:00
      // → free 15:00-15:30
      "salon:availability:resource-2:location-4:2026-07-15":
        day(1, [["15:00", "15:30"]]),
    });
  });

  it("rejects a malformed booking with a ZodError before writing anything", async () => {
    const mSet = mock(async () => "OK");
    const client = { mSet } as unknown as RedisClientType;
    const availability = new Availability({connection: client, resource: "salon"});

    const bad = {
      "resource-1": {
        "2026-07-15": [
          { locationId: "location-1", schedules: [], bookedIntervals: [] },
        ],
      },
    };

    expect(availability.cacheDisponibility(bad)).rejects.toThrow(ZodError);
    expect(mSet).not.toHaveBeenCalled();
  });
});
