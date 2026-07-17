import { describe, it, expect, mock } from "bun:test";
import type { RedisClientType } from "redis";
import { ZodError } from "zod";
import { Availability, SLOTS_PER_DAY } from "./enjin.js";
import type { Booking } from "./types/schemas.js";
import { slotHashing } from "./utils.js";

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

describe("Availability.checkSlot", () => {
  const key = "salon:availability:resource-1:location-1:2026-07-15";
  const slot = { resourceId: "resource-1", locationId: "location-1", date: "2026-07-15" };

  //mocks a redis connection whose getRange slices a day bitmap the way redis does, inclusive on both ends
  const clientFor = (bitmap: string) => {
    const getRange = mock(async (_key: string, start: number, end: number) =>
      bitmap.slice(start, end + 1)
    );
    const STRLEN = mock(async (_key: string) => bitmap.length);
    return { getRange, client: { getRange, STRLEN } as unknown as RedisClientType };
  };

  const freeDay = day(0, []);

  //getRange is inclusive on both ends, so the end index is the last slot the booking touches
  describe("end bounds", () => {
    it("bounds an end inside a slot to that slot", async () => {
      const { getRange, client } = clientFor(freeDay);
      const availability = new Availability({connection: client, resource: "salon"});

      // 10:07 falls between 10:00 and 10:15 → last touched slot is the one 10:00 opens
      await availability.checkSlot({ ...slot, start: "09:00", end: "10:07" });

      expect(getRange).toHaveBeenCalledWith(key, slotHashing("09:00"), slotHashing("10:00"));
    });

    it("bounds an end landing on a slot edge to the previous slot", async () => {
      const { getRange, client } = clientFor(freeDay);
      const availability = new Availability({connection: client, resource: "salon"});

      // 10:15 opens a slot the booking never occupies → it stops at the 10:00 slot
      await availability.checkSlot({ ...slot, start: "09:00", end: "10:15" });

      expect(getRange).toHaveBeenCalledWith(key, slotHashing("09:00"), slotHashing("10:00"));
    });
  });

  describe("duration bounds", () => {
    it("bounds a duration inside a slot to that slot", async () => {
      const { getRange, client } = clientFor(freeDay);
      const availability = new Availability({connection: client, resource: "salon"});

      // 37 minutes from 09:00 ends at 09:37, between 09:30 and 09:45 → last touched slot is 09:30
      await availability.checkSlot({ ...slot, start: "09:00", duration: 37 });

      expect(getRange).toHaveBeenCalledWith(key, slotHashing("09:00"), slotHashing("09:30"));
    });

    it("bounds a duration landing on a slot edge to the previous slot", async () => {
      const { getRange, client } = clientFor(freeDay);
      const availability = new Availability({connection: client, resource: "salon"});

      // 45 minutes from 09:00 ends at 09:45, which opens a slot the booking never occupies
      await availability.checkSlot({ ...slot, start: "09:00", duration: 45 });

      expect(getRange).toHaveBeenCalledWith(key, slotHashing("09:00"), slotHashing("09:30"));
    });

    it("bounds a duration overflowing past midnight to the last slot of the day", async () => {
      const { getRange, client } = clientFor(freeDay);
      const availability = new Availability({connection: client, resource: "salon"});

      // 90 minutes from 23:00 ends at 00:30 the next day → clamped to the 23:45 slot,
      // the last index of the day
      await availability.checkSlot({ ...slot, start: "23:00", duration: 90 });

      expect(getRange).toHaveBeenCalledWith(key, slotHashing("23:00"), SLOTS_PER_DAY - 1);
      expect(SLOTS_PER_DAY - 1).toBe(slotHashing("23:45"));
    });
  });

  //the existence guard runs before any range is read, so a bad STRLEN must
  //reject the call and keep getRange untouched
  describe("existence guard", () => {
    const guardedClientFor = (valueLength: number) => {
      const getRange = mock(async () => "");
      const STRLEN = mock(async (_key: string) => valueLength);
      return { getRange, client: { getRange, STRLEN } as unknown as RedisClientType };
    };

    it("rejects when the key does not exist", async () => {
      const { getRange, client } = guardedClientFor(0);
      const availability = new Availability({connection: client, resource: "salon"});

      expect(availability.checkSlot({ ...slot, start: "09:00", end: "10:15" }))
        .rejects.toThrow("key does not exists");
      expect(getRange).not.toHaveBeenCalled();
    });

    it("rejects when the stored day holds the wrong number of slots", async () => {
      const { getRange, client } = guardedClientFor(SLOTS_PER_DAY + 1);
      const availability = new Availability({connection: client, resource: "salon"});

      expect(availability.checkSlot({ ...slot, start: "09:00", end: "10:15" }))
        .rejects.toThrow("There are more then wanted slots, data might be corrupted");
      expect(getRange).not.toHaveBeenCalled();
    });
  });

  // a 09:00-10:15 booking occupies the 09:00, 09:15, 09:30, 09:45 and 10:00 slots
  describe("verdict", () => {
    const asked = { ...slot, start: "09:00", end: "10:15" };

    it("is free when the day holds no taken slot", async () => {
      const { client } = clientFor(freeDay);
      const availability = new Availability({connection: client, resource: "salon"});

      expect(await availability.checkSlot(asked)).toBe(true);
    });

    it("is taken when a single slot in the range is taken", async () => {
      const { client } = clientFor(day(0, [["09:30", "09:45"]]));
      const availability = new Availability({connection: client, resource: "salon"});

      expect(await availability.checkSlot(asked)).toBe(false);
    });

    it("is taken when several slots in the range are taken", async () => {
      const { client } = clientFor(day(0, [["09:15", "09:30"], ["10:00", "10:15"]]));
      const availability = new Availability({connection: client, resource: "salon"});

      expect(await availability.checkSlot(asked)).toBe(false);
    });

    it("is free when the taken slots sit outside the range", async () => {
      // 10:15 is taken but only opens the slot after the booking, so it must not leak in
      const { client } = clientFor(day(0, [["08:00", "09:00"], ["10:15", "11:00"]]));
      const availability = new Availability({connection: client, resource: "salon"});

      expect(await availability.checkSlot(asked)).toBe(true);
    });
  });
});
