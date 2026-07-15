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

  async multyleSet(availability: { [key: string]: string }): Promise<void> {
    await this.#client.mSet(availability);
  }

}
