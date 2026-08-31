export type ItemDefinition = {
  id: string;
  name: string;
  category: "BOOST" | "PROJECTILE" | "TRAP" | "DEFENSE";
  duration: number;
  cooldown: number;
  weightByPosition: readonly [number, number, number, number];
};

export const ItemDefinitions = Object.freeze({
  threadBoost: {
    id: "thread-boost",
    name: "Thread Boost",
    category: "BOOST",
    duration: 1.25,
    cooldown: 0.25,
    weightByPosition: [12, 15, 18, 22],
  },
  tshirtCannon: {
    id: "tshirt-cannon",
    name: "T-Shirt Cannon",
    category: "PROJECTILE",
    duration: 2,
    cooldown: 0.8,
    weightByPosition: [15, 16, 16, 14],
  },
  stickerMine: {
    id: "sticker-mine",
    name: "Sticker Mine",
    category: "TRAP",
    duration: 8,
    cooldown: 0.8,
    weightByPosition: [18, 14, 10, 8],
  },
  packageShield: {
    id: "package-shield",
    name: "Package Shield",
    category: "DEFENSE",
    duration: 4,
    cooldown: 1,
    weightByPosition: [8, 12, 16, 20],
  },
  inkSlick: {
    id: "ink-slick", name: "Ink Slick", category: "TRAP", duration: 6, cooldown: .7,
    weightByPosition: [17, 15, 11, 8],
  },
  expressLabel: {
    id: "express-label", name: "Express Label", category: "BOOST", duration: 1.7, cooldown: .25,
    weightByPosition: [7, 11, 18, 25],
  },
  tapeSnare: {
    id: "tape-snare", name: "Tape Snare", category: "PROJECTILE", duration: 1.4, cooldown: .9,
    weightByPosition: [13, 16, 17, 15],
  },
  bubbleWrap: {
    id: "bubble-wrap", name: "Bubble Wrap", category: "DEFENSE", duration: 5, cooldown: 1,
    weightByPosition: [8, 11, 15, 19],
  },
  flashDryer: {
    id: "flash-dryer", name: "Flash Dryer", category: "PROJECTILE", duration: 1.2, cooldown: 1,
    weightByPosition: [12, 16, 18, 16],
  },
  threadHook: {
    id: "thread-hook", name: "Thread Hook", category: "PROJECTILE", duration: 1, cooldown: .7,
    weightByPosition: [6, 12, 19, 26],
  },
} satisfies Record<string, ItemDefinition>);

export class SeededRandom {
  constructor(private state: number) { this.state >>>= 0; }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 4_294_967_296;
  }
}

export function pickWeightedItem(position: number, random: SeededRandom): ItemDefinition {
  const index = Math.max(0, Math.min(3, Math.floor(position) - 1));
  const items = Object.values(ItemDefinitions);
  const total = items.reduce((sum, item) => sum + item.weightByPosition[index]!, 0);
  let roll = random.next() * total;
  for (const item of items) {
    roll -= item.weightByPosition[index]!;
    if (roll <= 0) return item;
  }
  return items[0]!;
}
