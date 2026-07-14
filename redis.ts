import type {  RedisClientType } from "redis";
import type {
  Store,
  Slots,
} from "./types/store";

export class RedisStore implements Store {
  #client: RedisClientType;

  constructor(client: RedisClientType) {
    this.#client = client;
  }

  async set(
    employeeId: string,
    locationId: string,
    date: string,
    slots: Slots
  ): Promise<void> {
    await this.#client.set(
      `availability:${employeeId}:${locationId}:${date}`,
      slots.join("")
    );
  }

}
