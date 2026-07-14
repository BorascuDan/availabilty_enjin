import type { DateKey, ResourceId, LocationId } from "./store"

export interface Interval {
    start: string,
    end: string
}

//false unavailable time
//true available time
export interface Schedule extends Interval {
    canDoSchedule: boolean 
}

export interface LocationDispoibility {
    schedules: Schedule[],
    bookedIntervals: Interval[],
    locationId: LocationId, 
}

export interface Booking {
  [resourceId: ResourceId]: {
    [date: DateKey]: LocationDispoibility[]
  }
}