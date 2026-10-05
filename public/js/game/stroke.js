// Drag-paint geometry (GDD §7.1, tech §10.7, visual-ux-juice §4.12): the pointer path between two frames is
// rasterised over the tile grid so a fast swipe never skips a plot, and every tile is stretched to the tool's
// brush footprint. Pure and DOM-free (test/sync.input.test.js). Owned by the client-core lane.
//
//   lineTiles(x0, z0, x1, z1) -> [[x, z], ...]     every tile a straight segment crosses, endpoints included,
//                                                  4-connected (no diagonal corner-cutting: a diagonal swipe
//                                                  between two plots touches one of the corner tiles)
//   brushTiles(x, z, [w, d]) -> [[x, z], ...]      the footprint centred on (x, z) (even sizes lean +x/+z)
//   createStroke({ brush }) -> stroke              stroke.to(x, z) -> NEW tiles since the last call (each tile
//                                                  is reported once per stroke); stroke.tiles -> Set of 'x,z'

/** Tiles crossed by the segment from tile (x0, z0) to tile (x1, z1), 4-connected, in order. */
export function lineTiles(x0, z0, x1, z1) {
  const out = [[x0, z0]];
  let x = x0;
  let z = z0;
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x1 > x0 ? 1 : -1;
  const sz = z1 > z0 ? 1 : -1;
  // Walk the grid cell by cell along the line through the tile centres: step in x or z, whichever boundary the
  // line reaches first (Amanatides-Woo with integer arithmetic); ties step x first, so the path stays connected.
  let err = dx - dz;
  for (let n = dx + dz; n > 0; n--) {
    if (err > 0 || (err === 0 && dx >= dz)) { x += sx; err -= 2 * dz; }
    else { z += sz; err += 2 * dx; }
    out.push([x, z]);
  }
  return out;
}

/** The brush footprint around tile (x, z): 1x1, 2x2 (leans +x/+z), 3x3 (centred). */
export function brushTiles(x, z, [w, d] = [1, 1]) {
  const out = [];
  const x0 = x - Math.floor((w - 1) / 2);
  const z0 = z - Math.floor((d - 1) / 2);
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) out.push([x0 + dx, z0 + dz]);
  return out;
}

/** A stroke that reports each tile under the brush once. */
export function createStroke({ brush = [1, 1] } = {}) {
  const tiles = new Set();
  let last = null;
  return {
    tiles,
    get last() { return last; },
    /** Move the stroke to tile (x, z); returns the tiles this step newly covered, in path order. */
    to(x, z) {
      const path = last ? lineTiles(last[0], last[1], x, z) : [[x, z]];
      last = [x, z];
      const fresh = [];
      for (const [px, pz] of path) {
        for (const [bx, bz] of brushTiles(px, pz, brush)) {
          const k = `${bx},${bz}`;
          if (tiles.has(k)) continue;
          tiles.add(k);
          fresh.push([bx, bz]);
        }
      }
      return fresh;
    },
  };
}
