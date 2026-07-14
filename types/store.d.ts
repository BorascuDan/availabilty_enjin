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
  set(
    resourceId: ResourceId,
    locationId: LocationId,
    date: DateKey,
    slots: Slots
  ): Promise<void>;
}