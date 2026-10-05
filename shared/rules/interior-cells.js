// The cells a farmhouse-interior piece covers (actions/interior.js, state.js validation). A leaf module with no
// imports: state.js and the interior actions both need it, and state.js must not import an action module (goals.js
// -> restoration.js -> interior.js -> state.js -> goals.js would close a cycle). Owned by rules-economy.

/**
 * The cells a placed furniture piece covers, by layer: [['floor' | 'object', [[x, z], ...]]] for floor pieces, or
 * [['wall', [[slot, wall], ...]]] for wall pieces (wall = 'back' | 'left').
 */
export function interiorCells(def, it) {
  if (def.layer === 'wall') {
    const out = [];
    for (let i = 0; i < def.size[0]; i++) out.push([it.at + i, it.wall]);
    return [['wall', out]];
  }
  const [w, d] = (it.rot ?? 0) % 2 ? [def.size[1], def.size[0]] : def.size;
  const out = [];
  for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) out.push([it.x + dx, it.z + dz]);
  return [[def.layer, out]];
}
