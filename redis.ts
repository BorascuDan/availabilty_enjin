import type { RedisClientType } from "redis";
import type { Store } from "./types/store.js";
import { SLOTS_PER_DAY } from "./enjin.js";

export class RedisStore implements Store {
  #client: RedisClientType;

  constructor(client: RedisClientType) {
    this.#client = client;
  }

  private set_slot_script = `
    -- map arguments with wich is called
    local startIndex = tonumber(ARGV[1])
    local endIndex = tonumber(ARGV[2])
    local value = ARGV[3]
    local expectedLength = tonumber(ARGV[4])

    -- get curent key length
    local currentLength = redis.call("STRLEN", KEYS[1])

    -- key is empty or it does not exists
    if currentLength ~= expectedLength then
        return -1
    end

    -- how many slots there are
    local slotsCount = endIndex - startIndex + 1

    -- get curent keys
    local currentSlots = redis.call(
        "GETRANGE",
        KEYS[1],
        startIndex,
        endIndex
    )

    -- you can t ocupie an alredy ocupied slot
    if value == "1" then
        local availableSlots = string.rep("0", slotsCount)

        if currentSlots ~= availableSlots then
            return 0
        end
    end

    -- new slots
    local newSlots = string.rep(value, slotsCount)

    -- flip old slots
    local resultingLength = redis.call(
        "SETRANGE",
        KEYS[1],
        startIndex,
        newSlots
    )

    -- disponibility length differ migth be broken
    if resultingLength ~= expectedLength then
        return -4
    end

    return 1
  `;

  async multyleSet(availability: { [key: string]: string }): Promise<string> {
    return this.#client.mSet(availability);
  }

  private async checkSlotExistance(key: string) {
    const valueLength = await this.#client.STRLEN(key);
    switch (true) {
      case valueLength === -1:
        throw new Error('Key exists but has no availability saved');
      case valueLength === 0:
        throw new Error('key does not exists');
      case valueLength !== SLOTS_PER_DAY:
        throw new Error("There are more then wanted slots, data might be corrupted")
      default:
        break;
    }
  }

  async getSlots(key: string, start: number, end: number): Promise<string> {
    await this.checkSlotExistance(key);
    const slots = await this.#client.getRange(key, start, end);
    if (!slots) throw new Error("Requested key does not exists");
    return slots;
  }

  async setSlots(
    key: string,
    start: number,
    end: number,
    value: 0 | 1,
  ): Promise<void> {
    
    const result = Number(
      await this.#client.eval(this.set_slot_script, {
        keys: [key],
        arguments: [
          start.toString(),
          end.toString(),
          value.toString(),
          SLOTS_PER_DAY.toString(),
        ],
      }),
    );

    switch (result) {
      case 1:
        return;

      case 0:
        throw new Error("One or more requested slots are already occupied");

      case -1:
        throw new Error(
          "Availability is missing or has an invalid number of slots",
        );

      case -4:
        throw new Error(
          "Something went wrong while updating the slots; data may be corrupted",
        );

      default:
        throw new Error(`Unexpected Redis result: ${result}`);
    }
  }

  async deleteSlot(keys: Array<string>): Promise<number> {
    return this.#client.del(keys)
  }
}
