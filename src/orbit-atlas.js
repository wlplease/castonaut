const ORBIT_LIMIT = 24;
const ORBIT_RINGS = [
  { x: 24, y: 22 },
  { x: 37, y: 35 },
  { x: 48, y: 45 },
];

/** Deterministic positions for the Desk's symbolic, non-geographic constellation. */
export function orbitAtlasLayout(fids) {
  return fids.slice(0, ORBIT_LIMIT).map((fid, index) => {
    const ring = Math.floor(index / 8);
    const slot = index % 8;
    const angle = -Math.PI / 2 + (slot / 8) * Math.PI * 2 + ring * 0.19;
    const radius = ORBIT_RINGS[ring];
    return {
      fid: Number(fid),
      x: 50 + Math.cos(angle) * radius.x,
      y: 50 + Math.sin(angle) * radius.y,
      ring,
    };
  });
}
