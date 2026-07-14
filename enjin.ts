import type {  RedisClientType } from "redis";
import { RedisStore } from "./redis";
import type { Store } from "./types/store";

export class Availability {
  private connection: Store;

  constructor(connection: RedisClientType) {
    this.connection = new RedisStore(connection);
  }

  
}
