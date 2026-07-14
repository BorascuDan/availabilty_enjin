import type {  RedisClientType } from "redis";
import { RedisStore } from "./redis";
import type { Store } from "./types/store";
import type { Booking, Interval, Schedule } from "./types/schedule";
import { isNumber, slotHashing } from "./utils";

export class Availability {
  private connection: Store;

  constructor(connection: RedisClientType, resource: string) {
    this.connection = new RedisStore(connection, resource);
  }

  private setSchedule (availability: number[], schedules: Schedule[]) {
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

  private setSlot (start: number, end: number, availability: number[]) {
    for (let i = start; i < end; i++) availability[i] = 1;
  }

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

  async cacheDisponibility (allResourcesDispoibility: Booking) {
    for ( const [resourceId, dateDisponibility] of Object.entries(allResourcesDispoibility) ) {
      for ( const [date, locationDispoibility] of Object.entries(dateDisponibility) ) {
        for ( const {schedules, bookedIntervals, locationId} of locationDispoibility ) {
            let availability = new Array(4 * 24).fill(0);
            if (schedules.length) this.setSchedule(availability, schedules);
            if (bookedIntervals.length) this.setBooked(availability, bookedIntervals);
            this.connection.set(resourceId, locationId, date, availability).catch((e) => console.error('Failed to save in redis'));
        }
      }
    }
  }
}
