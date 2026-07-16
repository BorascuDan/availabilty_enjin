import { describe, it, expect } from "bun:test";
import {
  BookingSchema,
  CheckSlotSchema,
  SchedulesSchema,
  IntervalSchema,
} from "./types/schemas";

const available = { start: "09:00", end: "17:00", canDoSchedule: true };
const blocked = { start: "12:00", end: "13:00", canDoSchedule: false };

describe("slot alignment", () => {
  it("accepts an interval sitting on slot edges", () => {
    expect(IntervalSchema.safeParse({ start: "09:00", end: "09:15" }).success).toBe(true);
  });

  it("rejects a start off a slot edge", () => {
    expect(IntervalSchema.safeParse({ start: "09:05", end: "09:30" }).success).toBe(false);
  });

  it("rejects an end off a slot edge", () => {
    expect(IntervalSchema.safeParse({ start: "12:00", end: "12:50" }).success).toBe(false);
  });

  it("rejects an interval shorter than a slot even when it straddles an edge", () => {
    expect(IntervalSchema.safeParse({ start: "09:10", end: "09:20" }).success).toBe(false);
  });

  it("rejects an unaligned schedule", () => {
    expect(
      SchedulesSchema.safeParse([{ start: "09:05", end: "17:00", canDoSchedule: true }]).success
    ).toBe(false);
  });

  //alignment guards what gets written, not what gets asked
  it("still lets checkSlot ask about an unaligned end", () => {
    expect(
      CheckSlotSchema.safeParse({
        resourceId: "employee-1",
        locationId: "location-1",
        date: "2026-07-20",
        start: "09:00",
        end: "10:07",
      }).success
    ).toBe(true);
  });
});

describe("SchedulesSchema", () => {
  it("accepts a single available schedule", () => {
    expect(SchedulesSchema.safeParse([available]).success).toBe(true);
  });

  it("accepts one available plus one blocked, in either order", () => {
    expect(SchedulesSchema.safeParse([available, blocked]).success).toBe(true);
    expect(SchedulesSchema.safeParse([blocked, available]).success).toBe(true);
  });

  it("rejects an empty schedules array", () => {
    expect(SchedulesSchema.safeParse([]).success).toBe(false);
  });

  it("rejects a lone blocked schedule", () => {
    expect(SchedulesSchema.safeParse([blocked]).success).toBe(false);
  });

  it("rejects two schedules of the same kind", () => {
    expect(SchedulesSchema.safeParse([available, available]).success).toBe(false);
    expect(SchedulesSchema.safeParse([blocked, blocked]).success).toBe(false);
  });

  it("rejects more than two schedules", () => {
    expect(
      SchedulesSchema.safeParse([available, blocked, available]).success
    ).toBe(false);
  });
});

describe("IntervalSchema", () => {
  it("accepts a well-formed interval", () => {
    expect(IntervalSchema.safeParse({ start: "9:30", end: "10:15" }).success).toBe(true);
  });

  it("accepts 24:00 as an end-of-day bound", () => {
    expect(IntervalSchema.safeParse({ start: "22:00", end: "24:00" }).success).toBe(true);
  });

  it("rejects start at or after end", () => {
    expect(IntervalSchema.safeParse({ start: "15:00", end: "13:00" }).success).toBe(false);
    expect(IntervalSchema.safeParse({ start: "15:00", end: "15:00" }).success).toBe(false);
  });

  it("rejects malformed times", () => {
    expect(IntervalSchema.safeParse({ start: "25:00", end: "26:00" }).success).toBe(false);
    expect(IntervalSchema.safeParse({ start: "09", end: "10:00" }).success).toBe(false);
    expect(IntervalSchema.safeParse({ start: "aa:bb", end: "10:00" }).success).toBe(false);
    expect(IntervalSchema.safeParse({ start: "09:75", end: "10:00" }).success).toBe(false);
  });
});

describe("BookingSchema", () => {
  const validBooking = {
    "resource-1": {
      "2026-07-15": [
        {
          locationId: "location-1",
          schedules: [available, blocked],
          bookedIntervals: [{ start: "09:30", end: "10:15" }],
        },
      ],
    },
  };

  it("accepts a valid booking", () => {
    expect(BookingSchema.safeParse(validBooking).success).toBe(true);
  });

  it("rejects a location without schedules", () => {
    const bad = {
      "resource-1": {
        "2026-07-15": [
          { locationId: "location-1", schedules: [], bookedIntervals: [] },
        ],
      },
    };
    expect(BookingSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects malformed date keys", () => {
    const bad = {
      "resource-1": {
        "15-07-2026": [
          {
            locationId: "location-1",
            schedules: [available],
            bookedIntervals: [],
          },
        ],
      },
    };
    expect(BookingSchema.safeParse(bad).success).toBe(false);
  });

  it("reports the path of the broken entry", () => {
    const bad = {
      "resource-1": {
        "2026-07-15": [
          {
            locationId: "location-1",
            schedules: [available],
            bookedIntervals: [{ start: "15:00", end: "13:00" }],
          },
        ],
      },
    };
    const result = BookingSchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual([
        "resource-1",
        "2026-07-15",
        0,
        "bookedIntervals",
        0,
      ]);
    }
  });
});

describe("CheckSlotSchema", () => {
  const slot = {
    resourceId: "resource-1",
    locationId: "location-1",
    date: "2026-07-15",
    start: "09:00",
  };

  it("accepts a slot bounded by an end", () => {
    expect(CheckSlotSchema.safeParse({ ...slot, end: "10:00" }).success).toBe(true);
  });

  it("accepts a slot bounded by a duration", () => {
    expect(CheckSlotSchema.safeParse({ ...slot, duration: 45 }).success).toBe(true);
  });

  it("accepts both bounds together", () => {
    expect(
      CheckSlotSchema.safeParse({ ...slot, end: "10:00", duration: 45 }).success
    ).toBe(true);
  });

  it("rejects a slot with neither an end nor a duration", () => {
    expect(CheckSlotSchema.safeParse(slot).success).toBe(false);
  });

  it("rejects start at or after end", () => {
    expect(CheckSlotSchema.safeParse({ ...slot, end: "08:00" }).success).toBe(false);
    expect(CheckSlotSchema.safeParse({ ...slot, end: "09:00" }).success).toBe(false);
  });

  it("rejects a duration that is not a positive integer", () => {
    expect(CheckSlotSchema.safeParse({ ...slot, duration: 0 }).success).toBe(false);
    expect(CheckSlotSchema.safeParse({ ...slot, duration: -45 }).success).toBe(false);
    expect(CheckSlotSchema.safeParse({ ...slot, duration: 12.5 }).success).toBe(false);
  });

  it("rejects malformed times", () => {
    expect(CheckSlotSchema.safeParse({ ...slot, start: "25:00", end: "26:00" }).success).toBe(false);
    expect(CheckSlotSchema.safeParse({ ...slot, start: "09", end: "10:00" }).success).toBe(false);
    expect(CheckSlotSchema.safeParse({ ...slot, end: "09:75" }).success).toBe(false);
  });

  it("rejects malformed date keys", () => {
    expect(
      CheckSlotSchema.safeParse({ ...slot, date: "15-07-2026", end: "10:00" }).success
    ).toBe(false);
  });

  it("rejects empty identifiers", () => {
    expect(CheckSlotSchema.safeParse({ ...slot, resourceId: "", end: "10:00" }).success).toBe(false);
    expect(CheckSlotSchema.safeParse({ ...slot, locationId: "", end: "10:00" }).success).toBe(false);
  });

  it("reports the path of the broken field", () => {
    const result = CheckSlotSchema.safeParse({ ...slot, end: "aa:bb" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.path).toEqual(["end"]);
  });
});
