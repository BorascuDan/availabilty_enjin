import type {  RedisClientType } from "redis";
import type { Store } from "./types/store.js";
import { SLOTS_PER_DAY } from "./enjin.js";

export class RedisStore implements Store {
  #client: RedisClientType;

  constructor(client: RedisClientType) {
    this.#client = client;
  }

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

  async setSlots(key: string, start: number, end: number, value: 0 | 1): Promise<void> {
    await this.checkSlotExistance(key);
    const elements = new Array(end - start + 1).fill(value).join("")
    const length = await this.#client.setRange(key, start, elements);
    if (length !== SLOTS_PER_DAY) throw new Error("Something went wrong, your data may be corrupted");
  }

  async deleteSlot(keys: Array<string>): Promise<number> {
    return this.#client.del(keys)
  }
}
