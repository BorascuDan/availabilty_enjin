type DateKey = string;
type LocationId = string;
type EmployeeId = string;


export type Slots = Array<0 | 1>;

export type DateAvailability = {
  [date: DateKey]: Slots;
};

export type LocationAvailability = {
  [locationId: LocationId]: DateAvailability;
};

export type AvailabilityMap = {
  [employeeId: EmployeeId]: LocationAvailability;
};

export interface Store {
  set(
    employeeId: EmployeeId,
    locationId: LocationId,
    date: DateKey,
    slots: Slots
  ): Promise<void>;
}