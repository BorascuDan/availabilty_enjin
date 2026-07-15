# availabilty_enjin

**Precomputed resource availability, served from Redis in O(1).**

## The goal

Every booking system ends up solving the same problem: figuring out when a resource is free. And every team loses time on how to solve it or what is the best aproach.
This engine removes that work. You hand it the schedules and the existing bookings, and it precomputes a per-day availability map for every resource, at every location, on every date — and stores it all in Redis in a single round trip.Later i will make it so that you can call it withouth the redis connection so that you can save in memory. This aproach will work only for services runing in single thread and on the same machine. After that:

- Returning or checking a resource's availability for a **specific date and hour is O(1)** — one Redis key read (`resource + location + date`) + checking the specific bit that holds the range, without hitting the database.
- You can even check a **user's disponibility based on a date and the location** where they are — it's the same single-key read.
- Take all location that have available booking for that resource
- Take all dates that have available booking for that resource

## How it works

A day is split into **96 slots of 15 minutes** (`SLOT_DURATION = 15`) -> later if needed i can add it to the class constructor so based on needs you can change the precompute. Every `resource + location + date` combination becomes one Redis key holding a 96-character string:

- `0` — the slot is **free**
- `1` — the slot is **unavailable** (outside working hours, on a break, or already booked)

Keys follow this pattern:

```
{resource}:availability:{resourceId}:{locationId}:{date}
```

For example: `employy:availability:employee-1:location-1:2026-07-15`
This format helps if you save other specific data in it
All keys are written with **one multiplexed `MSET`**, not one insert per key.

## Initializing the class

The `Availability` class reuses your own Redis connection (it never creates one) and takes a `resource` namespace that prefixes every generated key:

```ts
import { createClient, type RedisClientType } from "redis";
import { Availability } from "./enjin";

const client = createClient({ url: "redis://localhost:6379" }) as RedisClientType;
await client.connect();

const availability = new Availability(
  {
    connection: client, //your redis connection
    resource: "employee" //your resource
  }
);
```

## API

This version expose the following APIs.

### `cacheDisponibility(allResourcesDispoibility)`

Saves the availability of your resources. The input is validated with zod (`BookingSchema`), every day is compiled into a slot bitmap, and everything is written to Redis in one call.

```ts
async cacheDisponibility(allResourcesDispoibility: Booking | unknown): Promise<void>
```

#### Input shape (`Booking`)

```ts
type Booking = {
  [resourceId: string]: {                 // who: employee, room, equipment…
    [date: string]: Array<{               // when: "YYYY-MM-DD"
      locationId: string;                 // where
      schedules: Schedules;               // working hours (+ optional break)
      bookedIntervals: Interval[];        // already-taken time, may be empty
    }>;
  };
};

type Interval = { start: string; end: string };  // "HH:MM"
```

`Schedules` accepts **exactly one or two** entries:

```ts
type Schedules =
  | [AvailableSchedule]                    // just the working window
  | [AvailableSchedule, BlockedSchedule]   // working window + a break
  | [BlockedSchedule, AvailableSchedule];  // order doesn't matter

type AvailableSchedule = { start: string; end: string; canDoSchedule: true };
type BlockedSchedule   = { start: string; end: string; canDoSchedule: false };
```

- `canDoSchedule: true` — the working window. Everything **outside** it is marked unavailable.
- `canDoSchedule: false` — a blocked window (a break, typically inside the working hours). Its slots are marked unavailable.
- If there is only one schedule, it **must** be the available one — otherwise the rest of the day would wrongly count as free.

#### Validation rules (zod, checked before anything is written)

| Field | Rule |
| --- | --- |
| `resourceId`, `locationId` | non-empty string |
| date keys | `YYYY-MM-DD` (digit pattern only — calendar validity is not checked) |
| `start`, `end` | `HH:MM`, from `00:00` up to `24:00` (a single-digit hour like `9:30` is also accepted) |
| every interval / schedule | `start` must be before `end` (at 15-minute slot granularity) |
| `schedules` | 1 entry → must be `canDoSchedule: true`; 2 entries → one `true` + one `false`, in any order |
| `bookedIntervals` | array of intervals, empty is fine |

If validation fails, the call throws a `ZodError` and **nothing** is written to Redis.

#### Example call

```ts
await availability.cacheDisponibility({
  "employee-1": {
    "2026-07-15": [
      {
        locationId: "location-1",
        schedules: [
          { start: "09:00", end: "17:00", canDoSchedule: true },  // working hours
          { start: "12:00", end: "13:00", canDoSchedule: false }, // lunch break
        ],
        bookedIntervals: [
          { start: "09:30", end: "10:15" }, // an existing appointment
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
  },
});
```

This single call writes two keys in one `MSET`, each holding a 96-character `0`/`1` string:

```
salon:availability:employee-1:location-1:2026-07-15
salon:availability:employee-1:location-2:2026-07-15
```

For `location-1` the free (`0`) slots end up being exactly `09:00–09:30`, `10:15–12:00` and `13:00–17:00` — the working window minus the break and the existing appointment. For `location-2` it is simply `10:00–14:00`.

## Development

```bash
bun install        # install dependencies
bun test           # run the test suite
bun run typecheck  # tsc --noEmit
bun run ci         # typecheck + tests
```
