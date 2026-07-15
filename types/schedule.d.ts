import type { DateKey, ResourceId, LocationId } from "./store"

export interface Interval {
    start: string,
    end: string
}

//true available time
export interface AvailableSchedule extends Interval {
  canDoSchedule: true;
}

//false unavailable time
export interface BlockedSchedule extends Interval {
  canDoSchedule: false;
}

export type Schedule = AvailableSchedule | BlockedSchedule;

export type Schedules =
  | [AvailableSchedule]
  | [AvailableSchedule, BlockedSchedule]
  | [BlockedSchedule, AvailableSchedule];  

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