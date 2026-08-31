import type { FactoryAsset } from "./types.js";
import { hashDefinition } from "./utils.js";

export class AssetRegistry {
  private readonly assets = new Map<string, FactoryAsset>();
  register(input: Omit<FactoryAsset, "hash" | "updatedAt"> & { definition: unknown }): FactoryAsset {
    const asset: FactoryAsset = { id: input.id, type: input.type, name: input.name, version: input.version, published: input.published, hash: hashDefinition(input.definition), updatedAt: new Date().toISOString() };
    this.assets.set(asset.id, asset);
    return asset;
  }
  get(id: string): FactoryAsset | undefined { return this.assets.get(id); }
  list(type?: FactoryAsset["type"]): FactoryAsset[] { return [...this.assets.values()].filter((asset) => !type || asset.type === type); }
  remove(id: string): boolean { return this.assets.delete(id); }
}
