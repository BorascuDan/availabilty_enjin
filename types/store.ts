export type DateKey = string;
export type LocationId = string;
export type ResourceId = string;

export type Slots = Array<0 | 1>;

export type DateAvailability = {
  [date: DateKey]: Slots;
};

export type LocationAvailability = {
  [locationId: LocationId]: DateAvailability;
};

export type AvailabilityMap = {
  [resourceId: ResourceId]: LocationAvailability;
};

export interface Store {
  multyleSet(availability: { [key: string]: string }): Promise<string>;
  getSlots(key: string, start: number, end: number): Promise<string>;
  setSlots(key: string, start: number, end: number, value: 0 | 1): Promise<void>;
}
