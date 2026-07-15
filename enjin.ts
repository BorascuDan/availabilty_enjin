import type {  RedisClientType } from "redis";
import { RedisStore } from "./redis";
import type { Store } from "./types/store";
import { BookingSchema, type Booking, type Interval, type Schedules } from "./types/schemas";
import { isNumber, slotHashing } from "./utils";

export const SLOT_DURATION = 15 
export const SLOTS_PER_DAY = 60 * 24 / SLOT_DURATION;

export class Availability {
  private connection: Store;
  //user redis connection
  constructor(connection: RedisClientType, resource: string) {
    this.connection = new RedisStore(connection, resource);
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

  async cacheDisponibility (allResourcesDispoibility: Booking | unknown) {
    const booking = BookingSchema.parse(allResourcesDispoibility);
    for ( const [resourceId, dateDisponibility] of Object.entries(booking) ) {
      for ( const [date, locationDispoibility] of Object.entries(dateDisponibility) ) {
        for ( const {schedules, bookedIntervals, locationId} of locationDispoibility ) {
            let availability = new Array(SLOTS_PER_DAY).fill(0);
            if (!schedules.length) continue;
            this.setSchedule(availability, schedules);
            if (bookedIntervals.length) this.setBooked(availability, bookedIntervals);
            await this.connection.set(resourceId, locationId, date, availability);
        }
      }
    }
  }
}
