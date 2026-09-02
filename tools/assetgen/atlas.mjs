/**
 * Texture atlases.
 *
 * Twenty-two icons as twenty-two files is twenty-two requests and twenty-two GPU textures, and the
 * brief asks for atlases by name. Packing them into one sheet with a frame map costs one request and
 * one texture, and — for the HUD specifically — lets a CSS `background-position` select an icon with
 * no JavaScript at all.
 *
 * The packer is a shelf packer: sort by height, lay rows left to right, start a new row when the
 * current one is full. Not optimal — a MaxRects packer wastes less — but it is a dozen lines, it is
 * deterministic, and for content that is either uniform (icons) or near-uniform (sprites) it comes
 * within a few percent of optimal. Determinism matters more than the last few percent here: the
 * bake must produce byte-identical files on a rebuild or the repo churns on every run.
 *
 * Every frame gets a one-pixel transparent gutter. Without it, bilinear filtering samples across a
 * frame boundary and every sprite picks up a sliver of its neighbour — the classic atlas halo, and
 * exactly the "sprites con halo" defect the brief lists.
 */

const GUTTER = 1;

/**
 * No power-of-two rounding.
 *
 * The first version rounded both dimensions up, which turned eight 512x768 posters into a
 * 2048x4096 sheet — eight megapixels to hold six. WebGL2, which is what the renderer targets, has
 * no NPOT restriction, and these atlases sample with clamped addressing and no wrapping, which is
 * the case where even WebGL1 was happy. The sheet is now exactly as large as its content.
 */

/**
 * Packs images into one sheet.
 *
 * `entries` is `[{ id, image }]` where each image is `{ width, height, channels, pixels }` with four
 * channels. Returns the sheet plus a frame map in pixels and in normalised UV, because the HUD wants
 * pixels for `background-position` and the 3D scene wants UVs.
 */
export function packAtlas(entries, { maxWidth = 1024 } = {}) {
  if (entries.length === 0) throw new Error("cannot pack an empty atlas");
  for (const entry of entries) {
    if (entry.image.channels !== 4) throw new Error(`${entry.id} must be RGBA to be packed`);
  }

  // Tallest first, so rows stay tightly packed rather than being set by a late tall entry.
  const sorted = [...entries].sort(
    (a, b) => b.image.height - a.image.height || a.id.localeCompare(b.id),
  );

  const placements = [];
  let penX = GUTTER;
  let penY = GUTTER;
  let rowHeight = 0;
  let usedWidth = 0;

  for (const entry of sorted) {
    const { width, height } = entry.image;
    if (penX + width + GUTTER > maxWidth && rowHeight > 0) {
      penX = GUTTER;
      penY += rowHeight + GUTTER;
      rowHeight = 0;
    }
    placements.push({ id: entry.id, image: entry.image, x: penX, y: penY });
    penX += width + GUTTER;
    rowHeight = Math.max(rowHeight, height);
    usedWidth = Math.max(usedWidth, penX);
  }

  const sheetWidth = Math.min(maxWidth, usedWidth + GUTTER);
  const sheetHeight = penY + rowHeight + GUTTER;
  // Zeroed, so every gutter and every unused corner is fully transparent black. A sheet initialised
  // to opaque white would put a white rectangle behind every sprite's soft edge.
  const pixels = Buffer.alloc(sheetWidth * sheetHeight * 4);

  const frames = {};
  for (const placement of placements) {
    const { image, x, y, id } = placement;
    for (let row = 0; row < image.height; row += 1) {
      const from = row * image.width * 4;
      const to = ((y + row) * sheetWidth + x) * 4;
      image.pixels.copy(pixels, to, from, from + image.width * 4);
    }
    frames[id] = {
      x,
      y,
      width: image.width,
      height: image.height,
      // Half-texel inset, so a UV lookup never reaches the gutter under bilinear filtering.
      u0: (x + 0.5) / sheetWidth,
      v0: (y + 0.5) / sheetHeight,
      u1: (x + image.width - 0.5) / sheetWidth,
      v1: (y + image.height - 0.5) / sheetHeight,
    };
  }

  return {
    image: { width: sheetWidth, height: sheetHeight, channels: 4, pixels },
    frames,
    /** How much of the sheet carries content. Reported so a wasteful pack is visible. */
    occupancy:
      placements.reduce((total, p) => total + p.image.width * p.image.height, 0) /
      (sheetWidth * sheetHeight),
  };
}

/**
 * Packs equal-sized images into a uniform grid.
 *
 * A second packer, because the consumer is different. Babylon's `SpriteManager` draws thousands of
 * billboarded sprites in one draw call and selects a frame by *cell index*, which requires a regular
 * grid — it cannot read a shelf pack's frame map. That one draw call is the whole reason a convention
 * hall can be crowded, so the atlas format follows the renderer rather than the other way round.
 *
 * No gutter here, deliberately. A gutter would break the cell arithmetic, and it is not needed:
 * every sprite in these families already carries a transparent margin inside its own cell, which is
 * asserted by the border-alpha test. The margin is the gutter.
 */
export function packGrid(entries, { columns = 8 } = {}) {
  if (entries.length === 0) throw new Error("cannot pack an empty grid");
  const cellWidth = entries[0].image.width;
  const cellHeight = entries[0].image.height;
  for (const entry of entries) {
    if (entry.image.channels !== 4) throw new Error(`${entry.id} must be RGBA`);
    if (entry.image.width !== cellWidth || entry.image.height !== cellHeight) {
      throw new Error(`${entry.id} is ${entry.image.width}x${entry.image.height}, grid cell is ${cellWidth}x${cellHeight}`);
    }
  }

  const rows = Math.ceil(entries.length / columns);
  const width = cellWidth * Math.min(columns, entries.length);
  const height = cellHeight * rows;
  const pixels = Buffer.alloc(width * height * 4);

  const frames = {};
  entries.forEach((entry, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    for (let line = 0; line < cellHeight; line += 1) {
      const from = line * cellWidth * 4;
      const to = ((y + line) * width + x) * 4;
      entry.image.pixels.copy(pixels, to, from, from + cellWidth * 4);
    }
    frames[entry.id] = { x, y, width: cellWidth, height: cellHeight, cell: index };
  });

  return {
    image: { width, height, channels: 4, pixels },
    frames,
    grid: { cellWidth, cellHeight, columns: Math.min(columns, entries.length), rows, count: entries.length },
  };
}
