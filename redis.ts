import type {  RedisClientType } from "redis";
import type { Store } from "./types/store.js";

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
}
