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

  async getSlots(key: string, start: number, end: number): Promise<string> {
    const slots = await this.#client.getRange(key, start, end);
    if (!slots) throw new Error("Requested key does not exists");
    return slots;
  }

  async setSlots(key: string, start: number, end: number, value: 0 | 1): Promise<void> {
    const elements = new Array(end - start + 1).fill(value).join("")
    const length = await this.#client.setRange(key, start, elements);
    if (length !== SLOTS_PER_DAY) throw new Error("Something went wrong, your data may be corrupted");
  }
}
