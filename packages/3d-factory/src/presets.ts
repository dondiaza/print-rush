import type { CharacterDefinition, KartDefinition } from "./types.js";
import { randomCharacter } from "./character.js";
import { randomKart } from "./kart.js";

export const CharacterPresets: readonly CharacterDefinition[] = [
  randomCharacter(101, "Mika"), randomCharacter(204, "Dani"), randomCharacter(309, "Lola"), randomCharacter(418, "Toni"),
  randomCharacter(527, "Vera"), randomCharacter(636, "Nico"), randomCharacter(745, "Noa"), randomCharacter(854, "Alex"),
];

export const KartPresets: readonly KartDefinition[] = [
  randomKart(90, "Press Runner"), randomKart(181, "Parcel Pop"), randomKart(272, "Ink Tank"), randomKart(363, "Roller Flash"), randomKart(454, "Thread Sprint"),
];
