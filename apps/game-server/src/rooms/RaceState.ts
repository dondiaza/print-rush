import { MapSchema, Schema, type } from "@colyseus/schema";
import { RacePhase } from "@print-rush/game-core";

export class KartStateSchema extends Schema {
  @type("number") x = 0;
  @type("number") y = 0.75;
  @type("number") z = 0;
  @type("number") rotation = 0;
  @type("number") speed = 0;
  @type("number") boostRemaining = 0;
}

export class PlayerStateSchema extends Schema {
  @type("string") id = "";
  @type("string") nickname = "Rider";
  @type("boolean") connected = true;
  @type("boolean") ready = false;
  @type("uint8") lap = 1;
  @type("uint8") checkpoint = 0;
  @type("uint8") racePosition = 1;
  @type("uint32") lastProcessedInput = 0;
  @type("string") characterDefinition = "";
  @type("string") kartDefinition = "";
  @type("string") characterHash = "";
  @type("string") kartHash = "";
  @type(KartStateSchema) kart = new KartStateSchema();
}

export class RaceStateSchema extends Schema {
  @type("string") roomId = "";
  @type("string") phase = RacePhase.LOBBY;
  @type("string") trackId = "flagship-store";
  @type("uint8") lapsRequired = 3;
  @type("number") serverTime = 0;
  @type("number") countdown = 3;
  @type({ map: PlayerStateSchema }) players = new MapSchema<PlayerStateSchema>();
}
