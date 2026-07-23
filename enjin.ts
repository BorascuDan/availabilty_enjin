import type {  RedisClientType } from "redis";
import { RedisStore } from "./redis.js";
import type { Store } from "./types/store.js";
import { BookingSchema, CheckSlotSchema, DeleteDisponibilitySchema, type Booking, type CheckSlot, type DeleteDisponibility, type Interval, type Schedules } from "./types/schemas.js";
import { isNumber, minutesIndexOffset, slotHashing } from "./utils.js";

export { RedisStore } from "./redis.js";
export type {
  Booking,
  CheckSlot,
  DeleteDisponibility,
  Interval,
  Schedule,
  Schedules,
  AvailableSchedule,
  BlockedSchedule,
  LocationDispoibility,
} from "./types/schemas.js";
export type {
  Store,
  Slots,
  DateKey,
  LocationId,
  ResourceId,
  DateAvailability,
  LocationAvailability,
  AvailabilityMap,
} from "./types/store.js";

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

  private getSlotKeyAndIndex (slot: CheckSlot | unknown): { slotKey: string; startIndex: number; endIndex: number } {
    //validate constrains
    const { resourceId, locationId, date, start, end, duration } = CheckSlotSchema.parse(slot);

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
    } else if (isNumber(duration)) {
      //check the offset
      endIndex = startIndex + minutesIndexOffset(duration)
      //upper bound last index to last element
      if (endIndex >= SLOTS_PER_DAY) endIndex = SLOTS_PER_DAY - 1;
    } else throw new Error("either end or duration must be provided")

    const slotKey = this.generateKey(resourceId, locationId, date)

    return { slotKey, startIndex, endIndex }
  }

	private generateKeysPattern({
		resourceIds,
		locationId = "*",
		date = "*"
	}: {resourceIds: Array<string|number>, locationId: string, date: string}) {
		return resourceIds.reduce((keys, resource) => keys.add(this.generateKey(String(resource), locationId, date)), new Set());
	}

	private mergeSlots(keys: Array<string>, values: Array<string | null>) {
		return keys.reduce((slotsPer, key, index) => {
			if (!values[index] || values[index].length != SLOTS_PER_DAY) return slotsPer;
			const [_resource, _name, resourceId, locationId, _date] = key.split(":");
			if (locationId === undefined || resourceId === undefined) return slotsPer;
			if (!slotsPer.has(locationId)) {
				let resources = new Map();
				resources.set(resourceId, values[index]);
				slotsPer.set(locationId, resources);
			} else {
				let resources = slotsPer.get(locationId);
				if (!resources.has(resourceId)) resources.set(resourceId, values[index])
				else {
					resources
									.set(
									 resourceId,
										(
											BigInt(`0b${resources.get(resourceId)}`) &
											BigInt(`0b${values[index]}`))
											.toString(2)
											.padStart(SLOTS_PER_DAY, "0")
									);
				}
			}
			return slotsPer;
		}, new Map())
	}

	private getMergeSlotsAvailableKeys(mergeSlot: Map<string, Map<string, string>>, offset: number) {
		let keys = [];
		for (let [key, values] of mergeSlot) {
			for (let [_, availability] of values) {
				let consecutiveZeros = 0;
				for (const value of availability) {
					if (value === "0") {
						consecutiveZeros += 1;
						if (consecutiveZeros === offset) {
							keys.push(key);
							break;
						}
					} else {
						consecutiveZeros = 0;
					}
				}
				break;
			}
		}

		return keys;
	}

  async checkSlot (slot: CheckSlot | unknown) {
    const { slotKey: key, startIndex: start, endIndex: end } = this.getSlotKeyAndIndex(slot)
    const slotsStatus = new Set(await this.connection.getSlots(key, start, end))
    return !slotsStatus.has("1")
  }

  async changeSlot (slot: CheckSlot, type: "occupy" | "free") {
    const { slotKey: key, startIndex: start, endIndex: end } = this.getSlotKeyAndIndex(slot)
    if (type === "occupy") {
      const isFree = await this.checkSlot(slot);
      if (!isFree) throw new Error('Slot got booked in the meantime')
    }
    await this.connection.setSlots(key, start, end, type === "occupy" ? 1 : 0)
  }

  async deleteDisponibility (slots: DeleteDisponibility | unknown) {
    //validate constrains
    const keys = DeleteDisponibilitySchema.parse(slots).map(
      ({resourceId, locationId, date}) => this.generateKey(resourceId, locationId, date)
    )
    return this.connection.deleteSlot(keys)
	}

	async getAvailableLocations ( resourceIds: Array<string>, duration: number ) {
		const resourceKeys = await this.connection.getKeysBasedOnResource(this.resource, new Set(resourceIds), { locationId: "*", date: "*" });
		const resourceValues = await this.connection.getSlotsByKeys(resourceKeys);
		const locationDisponibility = this.mergeSlots(resourceKeys, resourceValues);
		const indexOffset = minutesIndexOffset(duration);
		const availableLocationsIds = this.getMergeSlotsAvailableKeys(locationDisponibility, indexOffset)
		return availableLocationsIds;
	}
}
