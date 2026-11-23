// One global zoom band (tech §10.12, GDD §8.3): near < 35 m <= mid < 60 m <= far over the 18-90 m camera
// range, with 10 % hysteresis so a resting zoom never flickers. A band change is rare and triggers one-off
// work (culling mode, tuft density, badge aggregation). Owned by the render-world lane.
//
//   LOD = { near: 35, far: 60, hysteresis: 0.1 }
//   bandFor(dist, prev?) -> 'near' | 'mid' | 'far'      pure (tested)
//   createLod() -> { update(dist) -> band | null (null = unchanged), band }
export const LOD = Object.freeze({ near: 35, far: 60, hysteresis: 0.1 });

export function bandFor(dist, prev = null) {
  const h = LOD.hysteresis;
  const raw = dist < LOD.near ? 'near' : dist < LOD.far ? 'mid' : 'far';
  if (!prev || prev === raw) return raw;
  // Leave the previous band only once the distance is 10 % past its edge.
  if (prev === 'near') return dist < LOD.near * (1 + h) ? 'near' : (dist < LOD.far ? 'mid' : 'far');
  if (prev === 'far') return dist >= LOD.far * (1 - h) ? 'far' : (dist < LOD.near ? 'near' : 'mid');
  if (raw === 'near') return dist < LOD.near * (1 - h) ? 'near' : 'mid';
  return dist >= LOD.far * (1 + h) ? 'far' : 'mid';
}

export function createLod() {
  let band = null;
  return {
    get band() { return band; },
    update(dist) {
      const b = bandFor(dist, band);
      if (b === band) return null;
      band = b;
      return b;
    },
  };
}
