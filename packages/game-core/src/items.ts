export type ItemCategory = "BOOST" | "PROJECTILE" | "TRAP" | "DEFENSE" | "AREA" | "UTILITY";

export type ItemDefinition = {
  id: string;
  name: string;
  shortName: string;
  category: ItemCategory;
  duration: number;
  cooldown: number;
  speed: number;
  power: number;
  weightByPosition: readonly [number, number, number, number];
};

export const ItemDefinitions = Object.freeze({
  tshirtCannon: item("tshirt-cannon", "T-Shirt Cannon", "TSHIRT", "PROJECTILE", 3.2, .8, 34, .72, [16, 15, 14, 12]),
  expressPackage: item("express-package", "Express Package", "EXPRESS", "PROJECTILE", 2.4, .55, 45, .42, [11, 14, 17, 20]),
  hangerBoomerang: item("hanger-boomerang", "Hanger Boomerang", "HANGER", "PROJECTILE", 4.4, 1, 27, .55, [13, 15, 17, 17]),
  stickerMine: item("sticker-mine", "Sticker Mine", "STICKER", "TRAP", 10, .7, 0, .58, [20, 17, 12, 8]),
  inkBlast: item("ink-blast", "Ink Blast", "INK", "PROJECTILE", 3, .9, 31, .5, [12, 15, 17, 17]),
  threadBoost: item("thread-boost", "Thread Boost", "BOOST", "BOOST", 1.35, .2, 0, 1, [7, 12, 19, 27]),
  packageShield: item("package-shield", "Package Shield", "SHIELD", "DEFENSE", 8, .6, 0, 1, [22, 18, 15, 14]),
  dyeCloud: item("dye-cloud", "Dye Cloud", "DYE", "AREA", 9, .8, 0, .45, [18, 16, 12, 9]),
  magneticTag: item("magnetic-tag", "Magnetic Tag", "MAGNET", "UTILITY", 2.6, .85, 0, .44, [7, 12, 20, 25]),
  megaPrint: item("mega-print", "Mega Print", "MEGA", "AREA", 1.2, 1.2, 0, .68, [1, 4, 14, 27]),
  tapeTrap: item("tape-trap", "Tape Trap", "TAPE", "TRAP", 11, .75, 0, .4, [19, 17, 12, 8]),
  sizeTag: item("size-tag", "Size Tag", "SIZE", "DEFENSE", 7, .55, 0, .65, [13, 14, 16, 17]),
  designShuffle: item("design-shuffle", "Design Shuffle", "SHUFFLE", "UTILITY", 3.5, .9, 30, .3, [8, 13, 19, 22]),
} satisfies Record<string, ItemDefinition>);

function item(
  id: string,
  name: string,
  shortName: string,
  category: ItemCategory,
  duration: number,
  cooldown: number,
  speed: number,
  power: number,
  weightByPosition: readonly [number, number, number, number],
): ItemDefinition {
  return { id, name, shortName, category, duration, cooldown, speed, power, weightByPosition };
}

export class SeededRandom {
  constructor(private state: number) { this.state >>>= 0; }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 4_294_967_296;
  }
}

export function pickWeightedItem(position: number, random: SeededRandom, leaderGapSeconds = 0): ItemDefinition {
  const index = Math.max(0, Math.min(3, Math.floor(position) - 1));
  const items = Object.values(ItemDefinitions);
  const gapFactor = Math.max(0, Math.min(1.5, leaderGapSeconds / 8));
  const weighted = items.map((itemDefinition) => {
    const catchUp = index >= 2 && ["BOOST", "PROJECTILE", "UTILITY"].includes(itemDefinition.category) ? 1 + gapFactor * .35 : 1;
    return { itemDefinition, weight: itemDefinition.weightByPosition[index]! * catchUp };
  });
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = random.next() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll <= 0) return entry.itemDefinition;
  }
  return items[0]!;
}
