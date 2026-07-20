# availability-enjin

Caches your resources' free/busy time in Redis so you can answer "is this slot free?" in one O(1) key read — no database queries.

## Install

```sh
npm install availability-enjin redis
```

`redis` is a peer dependency — the engine reuses your connection, it never creates one.

## How it works

Each day is stored as a 96-character string of `0`s (free) and `1`s (busy), one 15-minute slot per character, under one key per `resource + location + date`:

```
{resource}:availability:{resourceId}:{locationId}:{date}
```

## Setup

```ts
import { createClient, type RedisClientType } from "redis";
import { Availability } from "availability-enjin";

const client = createClient({ url: "redis://localhost:6379" }) as RedisClientType;
await client.connect();

const availability = new Availability({
  connection: client,   // your redis connection
  resource: "employee", // prefixes every key
});
```

## API

| Method | What it does |
| --- | --- |
| [`cacheDisponibility(booking)`](#cachedisponibilitybooking) | compute and save the availability of your resources |
| [`checkSlot(slot)`](#checkslotslot) | is this window free? |
| [`changeSlot(slot, type)`](#changeslotslot-type) | book or release a window |
| [`deleteDisponibility(slots)`](#deletedisponibilityslots) | remove cached days |

All inputs are validated with zod first — a bad input throws a `ZodError` and touches nothing.

### `cacheDisponibility(booking)`

Turns schedules + existing bookings into day bitmaps and writes them all in one `MSET`.

**Input** — per resource, per date, a list of locations:

```ts
await availability.cacheDisponibility({
  "employee-1": {
    "2026-07-15": [
      {
        locationId: "location-1",
        schedules: [
          { start: "09:00", end: "17:00", canDoSchedule: true },  // working hours
          { start: "12:00", end: "13:00", canDoSchedule: false }, // break (optional)
        ],
        bookedIntervals: [
          { start: "09:30", end: "10:15" }, // already taken; [] is fine
        ],
      },
    ],
  },
});
```

Rules: dates are `"YYYY-MM-DD"`, times are `"HH:MM"` and must land on a 15-minute edge (`09:00`, `09:15`, …), `start` before `end`. `schedules` is 1 or 2 entries: the working window (`canDoSchedule: true`), plus optionally a break (`canDoSchedule: false`).

**Output** — `Promise<void>`. Throws `ZodError` on bad input.

### `checkSlot(slot)`

Reads only the slots your window touches and tells you if all of them are free.

**Input** — a window, closed by `end` **or** `duration` (if both, `end` wins). Any minutes are fine here — `09:07` or `duration: 37` get rounded to the slots they occupy:

```ts
await availability.checkSlot({
  resourceId: "employee-1",
  locationId: "location-1",
  date: "2026-07-15",
  start: "10:15",
  end: "11:00",       // or: duration: 45 (minutes)
});
```

**Output** — `Promise<boolean>`:

- `true` — the whole window is free
- `false` — at least one slot is busy (booked, break, or outside working hours — it doesn't say which)

Throws if the day was never cached (`key does not exists`) — an unknown day is an error, not a `false`.

### `changeSlot(slot, type)`

Writes a booking decision back into the bitmap. Same input shape as `checkSlot`, plus a direction:

```ts
await availability.changeSlot(slot, "occupy"); // book the window
await availability.changeSlot(slot, "free");   // release it
```

- `"occupy"` — sets the window to busy. Runs as an atomic Redis script that re-checks the window first, so two racing callers can't double-book: the loser throws instead.
- `"free"` — sets the window back to free, unconditionally. Only free the exact window you occupied — it will also overwrite breaks/off-hours if you ask it to.

**Output** — `Promise<void>`. Throws:

| Error | When |
| --- | --- |
| `Slot got booked in the meantime` / `One or more requested slots are already occupied` | `"occupy"` on a window that is no longer free |
| `key does not exists` | the day was never cached |

### `deleteDisponibility(slots)`

Deletes cached days (past days, a resource that left…) in one `DEL`.

**Input** — a non-empty array of day coordinates:

```ts
await availability.deleteDisponibility([
  { resourceId: "employee-1", locationId: "location-1", date: "2026-07-14" },
  { resourceId: "employee-1", locationId: "location-2", date: "2026-07-14" },
]);
```

**Output** — `Promise<number>`: how many keys actually existed and were deleted. Deleting a never-cached day is a harmless no-op, so a smaller number than you passed is not an error.

## Other exports

```ts
import { SLOT_DURATION, SLOTS_PER_DAY, RedisStore } from "availability-enjin";
// 15 minutes per slot, 96 slots per day, and the Store layer for advanced use.
// All input types (Booking, CheckSlot, DeleteDisponibility, …) are exported too.
```

## Development

```bash
bun install        # install dependencies
bun run ci         # typecheck + tests
```
