import type {  RedisClientType } from "redis";
import { RedisStore } from "./redis";
import type { Store } from "./types/store";
import { BookingSchema, type Booking, type Interval, type Schedules } from "./types/schemas";
import { isNumber, minutesIndexOffset, slotHashing } from "./utils";

export const SLOT_DURATION = 15
export const SLOTS_PER_DAY = 60 * 24 / SLOT_DURATION;

export class Availability {
  private connection: Store;
  private resource: string;
  //user redis connection
  constructor(
    {connection, resource}: {connection: RedisClientType, resource: string}
  ) {
    this.connection = new RedisStore(connection);
    this.resource = resource;
  }

  //set base availability based on schedule
  private setSchedule (availability: number[], schedules: Schedules) {
    for ( let {start, end, canDoSchedule} of schedules ) {
        const [startIndex, endIndex] = this.getIntervalIndex(start, end)
        if (!isNumber(startIndex) || !isNumber(endIndex)) throw new Error("a slot is not the right format")
        if (!canDoSchedule) this.setSlot(startIndex, endIndex, availability)
        else {
          this.setSlot(0, startIndex, availability);
          this.setSlot(endIndex, availability.length, availability);
        }
    }
  }

  //sets a slot status
  private setSlot (start: number, end: number, availability: number[]) {
    for (let i = start; i < end; i++) availability[i] = 1;
  }

  //fieled the bocked spaces
  private setBooked (availability: number[], bookedIntervals: Interval[]) {
    for ( let {start, end} of bookedIntervals ) {
        const [startIndex, endIndex] = this.getIntervalIndex(start, end)
        if (!isNumber(startIndex) || !isNumber(endIndex)) throw new Error("a slot is not the right format")
        this.setSlot(startIndex, endIndex, availability)
    }
  }

  private getIntervalIndex (start: string, end: string): number[] {
    const [startIndex, endIndex] = [start, end].map(slotHashing);
    if (!isNumber(startIndex) || !isNumber(endIndex)) throw new Error("a slot is not the right format")
    if (startIndex >= endIndex) throw new Error("start needs to be smaller then end")
    return [startIndex, endIndex]
  }

  //generate redis key
  private generateKey = (
    resourceId: string,
    locationId: string,
    date: string
  ) => `${this.resource}:availability:${resourceId}:${locationId}:${date}`

  async cacheDisponibility (allResourcesDispoibility: Booking | unknown) {
    //validate constrains
    const booking = BookingSchema.parse(allResourcesDispoibility);
    //object for multiplexing in redis
    let availability: { [key: string]: string } = {};

    //parse data with folowing steps:
    //for a specific resource
    for ( const [resourceId, dateDisponibility] of Object.entries(booking) ) {
      //for a date
      for ( const [date, locationDispoibility] of Object.entries(dateDisponibility) ) {
        //for locations
        for ( const {schedules, bookedIntervals, locationId} of locationDispoibility ) {
            //day slots
            let dayLocationAvailability = new Array(SLOTS_PER_DAY).fill(0);
            if (!schedules.length) continue;
            //concat the schedules
            this.setSchedule(dayLocationAvailability, schedules);
            // add booking if it exists
            if (bookedIntervals.length) this.setBooked(dayLocationAvailability, bookedIntervals);

            availability[
              this.generateKey(resourceId, locationId, date)
            ] = dayLocationAvailability.join("")
        }
      }
    }
    //populate initial keys
    const inserted = await this.connection.multyleSet(availability)
    if (inserted != "OK") throw new Error("Failed to establish connection to redis")
  }

  async checkSlot({
    resourceId,
    locationId,
    date,
    start,
    end,
    duration = 0
  }: {resourceId: string, locationId: string, date: string, start: string, end: string, duration: number}) {
   // hash the start index
    const startIndex = slotHashing(start);
    let endIndex;
    if (end) {
      //when end is provided check if it is within the same slot as start
      const [_, endMinutes] = end.split(":").map(Number) as [number, number]
      //everything that is between n * SLOT_DURATION and (n + 1) * SLOT_DURATION bounds to previos slot
      //while evry n * SLOT_DURATION is within the same slot as (n - 1) * SLOT_DURATION
      const upperBound = endMinutes % SLOT_DURATION
      //hash the end index
      endIndex = !upperBound ? slotHashing(end) - 1 : slotHashing(end);
    } else {
      //check the offset
      endIndex = startIndex + minutesIndexOffset(duration)
   }

   const slotKey = this.generateKey(resourceId, locationId, date)
   const slotsStatus = new Set(await this.connection.getSlots(slotKey, startIndex, endIndex))
   return !slotsStatus.has("1")
  }
}
