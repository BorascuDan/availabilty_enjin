import { describe, it, expect } from "bun:test";
import {
  BookingSchema,
  SchedulesSchema,
  IntervalSchema,
} from "./types/schemas";

const available = { start: "09:00", end: "17:00", canDoSchedule: true };
const blocked = { start: "12:00", end: "13:00", canDoSchedule: false };

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
