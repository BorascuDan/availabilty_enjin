# availability-enjin

**Precomputed resource availability, served from Redis in O(1).**

## Install

```sh
npm install availability-enjin redis
# or
bun add availability-enjin redis
```

`redis` is a peer dependency — the engine never creates a connection, it reuses yours.

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
import { Availability } from "availability-enjin";

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
| `start`, `end` | must land on a slot edge — the minutes have to be a multiple of `SLOT_DURATION = 15`, so `09:00`, `09:15`, `09:30`, `09:45` |
| every interval / schedule | `start` must be before `end` |
| `schedules` | 1 entry → must be `canDoSchedule: true`; 2 entries → one `true` + one `false`, in any order |
| `bookedIntervals` | array of intervals, empty is fine |

If validation fails, the call throws a `ZodError` and **nothing** is written to Redis.

#### Why caching needs the times on a slot edge

A day is 96 slots of `SLOT_DURATION = 15` minutes, so the bitmap has nowhere to put a remainder. Caching `12:00`–`12:50` would fill the slots for `12:00`, `12:15` and `12:30`, then quietly drop the last 5 minutes — leaving `12:45`–`13:00` marked free while the resource is actually busy, and handing that slot to the next booking. Rather than round and guess, `cacheDisponibility` rejects it:

```ts
// throws a ZodError — 50 minutes does not land on a slot edge
await availability.cacheDisponibility({
  "employee-1": { "2026-07-20": [{
    locationId: "location-1",
    schedules: [{ start: "09:00", end: "17:00", canDoSchedule: true }],
    bookedIntervals: [{ start: "12:00", end: "12:50" }],  // <- 12:45 or 13:00
  }]},
});
```

**This applies to writing only.** `checkSlot` takes any minutes you like — see below.

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

### `checkSlot(slot)`

Answers one question: **is this window free?** It reads the precomputed bitmap of `resource + location + date` and looks only at the slots the window actually occupies — one `GETRANGE`, no scan of the day, no database.

```ts
async checkSlot(slot: CheckSlot | unknown): Promise<boolean>
```

#### Input shape (`CheckSlot`)

```ts
type CheckSlot = {
  resourceId: string;   // who
  locationId: string;   // where
  date: string;         // "YYYY-MM-DD"
  start: string;        // "HH:MM"
  end?: string;         // "HH:MM"
  duration?: number;    // minutes
};
```

`start` is always required, plus **exactly one** way to close the window: `end` or `duration`. If both are passed, **`end` wins** and `duration` is ignored.

#### Validation rules (zod, checked before Redis is touched)

| Field | Rule |
| --- | --- |
| `resourceId`, `locationId` | non-empty string |
| `date` | `YYYY-MM-DD` (digit pattern only — calendar validity is not checked) |
| `start`, `end` | `HH:MM`, from `00:00` up to `24:00` (a single-digit hour like `9:30` is also accepted) |
| `start`, `end` | **any** minutes — unlike caching, they do not have to sit on a slot edge |
| `duration` | positive integer, in minutes — any value, `37` is as valid as `45` |
| `end` / `duration` | at least one of the two must be present |
| `end` (when present) | `start` must be before `end` **at 15-minute slot granularity** |

If validation fails, the call throws a `ZodError` and **nothing** is read from Redis.

#### Checking is not caching: any minutes work here

Caching writes to the bitmap, so it insists on slot edges. Checking only **reads** it, so it takes whatever you ask and rounds to the slots your window touches:

```ts
// all fine — none of these have to land on 09:15, 09:30, 09:45…
await availability.checkSlot({ ...who, start: "09:00", end: "09:12" });   // reads the 09:00 slot
await availability.checkSlot({ ...who, start: "09:07", end: "09:52" });   // reads 09:00 → 09:45
await availability.checkSlot({ ...who, start: "09:00", duration: 37 });   // reads 09:00 → 09:30
```

Asking *"is 09:00–09:12 free?"* is answered by the `09:00` slot, because that is the slot those 12 minutes live in.

#### How a window becomes a slot range

The day is stored in 15-minute slots, so a window is checked as the slots it **occupies**. A window that ends exactly on a slot edge does not occupy the slot that edge opens — a `09:00–10:15` booking leaves the `10:15` slot free for the next one.

With an explicit `end`:

| `start` | `end` | slots checked | why |
| --- | --- | --- | --- |
| `09:00` | `10:15` | `09:00` → `10:00` | `10:15` lands on an edge, so it only opens the next slot |
| `09:00` | `10:07` | `09:00` → `10:00` | `10:07` sits inside the `10:00` slot, which is therefore occupied |

With a `duration`:

| `start` | `duration` | slots checked | why |
| --- | --- | --- | --- |
| `09:00` | `45` | `09:00` → `09:30` | ends at `09:45`, on an edge |
| `09:00` | `37` | `09:00` → `09:30` | ends at `09:37`, inside the `09:30` slot |
| `09:00` | `15` | `09:00` only | fills exactly one slot |
| `09:00` | `10` | `09:00` only | anything under a slot still occupies that slot |

#### Answers

| Returns | Meaning |
| --- | --- |
| `true` | every slot in the window is `0` — the window is **free** |
| `false` | at least one slot in the window is `1` — the window is **taken** |

`false` is a single verdict, not a reason: a slot is `1` whether it is outside working hours, inside a break, or already booked. `checkSlot` does not tell you which of the three, and does not tell you *which* slot caused it.

It throws instead of returning a verdict in these cases:

| Throws | When |
| --- | --- |
| `ZodError` | the input broke a validation rule above |
| `Error: Requested key does not exists` | there is no key for that `resource + location + date` |
| whatever your Redis client throws | the connection itself failed |

A day that was never cached is therefore an **error, not a `false`** — the engine refuses to guess whether an unknown day is closed or simply not computed yet.
#### Example calls

Against the `employee-1` / `location-1` day cached above — open `09:00–17:00`, lunch `12:00–13:00`, booked `09:30–10:15`, so free at `09:00–09:30`, `10:15–12:00` and `13:00–17:00`:

```ts
// free: 10:15-11:00 sits in the gap after the existing appointment
await availability.checkSlot({
  resourceId: "employee-1",
  locationId: "location-1",
  date: "2026-07-15",
  start: "10:15",
  end: "11:00",
}); // → true

// taken: 45 minutes from 09:00 runs into the 09:30 appointment
await availability.checkSlot({
  resourceId: "employee-1",
  locationId: "location-1",
  date: "2026-07-15",
  start: "09:00",
  duration: 45,
}); // → false

// taken: the window crosses the lunch break
await availability.checkSlot({
  resourceId: "employee-1",
  locationId: "location-1",
  date: "2026-07-15",
  start: "11:30",
  end: "12:30",
}); // → false

// taken: 08:00 is outside the working window — same `false`, no reason attached
await availability.checkSlot({
  resourceId: "employee-1",
  locationId: "location-1",
  date: "2026-07-15",
  start: "08:00",
  duration: 30,
}); // → false

// throws: this day was never cached for location-3
await availability.checkSlot({
  resourceId: "employee-1",
  locationId: "location-3",
  date: "2026-07-15",
  start: "10:00",
  duration: 30,
}); // → Error: Requested key does not exists
```

### `changeSlot(slot, type)`

Writes a verdict back into the bitmap: marks a window as **booked** (`"occupy"`) or **released** (`"free"`). Use it after a booking is confirmed or cancelled to keep the cache in sync without recomputing the whole day.

```ts
async changeSlot(slot: CheckSlot, type: "occupy" | "free"): Promise<void>
```

The `slot` argument is the exact same shape as `checkSlot` — same `CheckSlot` type, same zod validation, same `end`-or-`duration` rule, same *any-minutes-welcome* rounding. Whatever slots `checkSlot` would read for a window, `changeSlot` writes.

#### The two directions

| `type` | What it does |
| --- | --- |
| `"occupy"` | first re-checks the window with `checkSlot`; if any slot is already `1`, it throws `Error: Slot got booked in the meantime` and writes **nothing**. Otherwise every slot in the window becomes `1`. |
| `"free"` | every slot in the window becomes `0` — no check first. Freeing an already-free window is a harmless no-op. |

The `"occupy"` pre-check is a **best-effort guard, not a transaction**: the check and the write are two Redis commands, so two callers racing for the same window can still, in a narrow window, both pass the check. For a single-writer setup (one API instance confirming bookings) it is exactly the double-check you want; for heavy concurrency, serialize confirmations on your side.

Note that `"free"` writes `0` unconditionally — including slots that are `1` because they sit outside working hours or inside a break, not because of a booking. Free exactly the window you previously occupied, not a larger one.

#### Errors

| Throws | When |
| --- | --- |
| `ZodError` | the input broke a `CheckSlot` validation rule |
| `Error: Slot got booked in the meantime` | `type: "occupy"` and the window is no longer fully free |
| `Error: key does not exists` | there is no cached day for that `resource + location + date` — cache it first with `cacheDisponibility` |
| whatever your Redis client throws | the connection itself failed |

#### Example calls

Against the same `employee-1` / `location-1` day — free at `09:00–09:30`, `10:15–12:00` and `13:00–17:00`:

```ts
const slot = {
  resourceId: "employee-1",
  locationId: "location-1",
  date: "2026-07-15",
  start: "10:15",
  end: "11:00",
};

// the customer confirmed — take the window
await availability.changeSlot(slot, "occupy");
await availability.checkSlot(slot); // → false, it is booked now

// trying to take it again fails loudly instead of double-booking
await availability.changeSlot(slot, "occupy");
// → Error: Slot got booked in the meantime

// the customer cancelled — give the window back
await availability.changeSlot(slot, "free");
await availability.checkSlot(slot); // → true again
```

## Other exports

Beyond the `Availability` class, the package exports:

### Constants

```ts
import { SLOT_DURATION, SLOTS_PER_DAY } from "availability-enjin";

SLOT_DURATION // 15  — minutes per slot
SLOTS_PER_DAY // 96  — slots in a day (60 * 24 / SLOT_DURATION)
```

Useful when you build inputs programmatically — e.g. snapping user-picked times to `SLOT_DURATION` before caching.

### `RedisStore` and the `Store` interface

`Availability` talks to Redis through a small `Store` interface, and `RedisStore` is the implementation it wraps your client in:

```ts
interface Store {
  multyleSet(availability: { [key: string]: string }): Promise<string>;
  getSlots(key: string, start: number, end: number): Promise<string>;
  setSlots(key: string, start: number, end: number, value: 0 | 1): Promise<void>;
}
```

Both are exported for advanced use (reading a bitmap directly, or as the seam for the planned in-memory store), but for normal usage you never touch them — the constructor takes your raw Redis client.

### Types

All input/output types are exported for your own signatures:

```ts
import type {
  Booking, CheckSlot, Interval,            // API inputs
  Schedule, Schedules,
  AvailableSchedule, BlockedSchedule,
  LocationDispoibility,                    // one entry of a date's location array
  Store, Slots,                            // store layer
  ResourceId, LocationId, DateKey,
  DateAvailability, LocationAvailability, AvailabilityMap,
} from "availability-enjin";
```

## Development

```bash
bun install        # install dependencies
bun test           # run the test suite
bun run typecheck  # tsc --noEmit
bun run ci         # typecheck + tests
```
