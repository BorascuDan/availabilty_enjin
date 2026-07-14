import type {  RedisClientType } from "redis";
import type {
  Store,
  Slots,
} from "./types/store";

export class RedisStore implements Store {
  #client: RedisClientType;
  resource: string
  
  constructor(client: RedisClientType, resource: string) {
    this.#client = client;
    this.resource = resource
  }

  async set(
    resourceId: string,
    locationId: string,
    date: string,
    slots: Slots
  ): Promise<void> {
    await this.#client.set(
      `${this.resource}:availability:${resourceId}:${locationId}:${date}`,
      slots.join("")
    );
  }

}
