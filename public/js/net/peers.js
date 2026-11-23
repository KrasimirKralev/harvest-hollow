// The partner's presence tool, as the controller needs it to count riders (DOM-free so node tests drive it).
// Owned by the client-core lane.
//
// A presence row carries the sender's tool (row[8]; 'horse' while riding). The last row of a partner who leaves
// stays the last row: before CL-01 (qa2) the map kept 'horse' forever, so the remaining farmer heard "Every horse
// has a rider right now." for the rest of the evening. A tool counts only while its farmer is online.
//
//   createPeerTools() -> {
//     presence(rows)        `pr` rows [pid, x, z, f, a, cx, cz, rts, tool, hop]: tool (or null) per pid
//     online(pid, on)       `peer` join / leave: a farmer who left holds nothing
//     welcome(peers)        welcome.peers [{ pid, online, pose }]: only an online peer's pose counts
//     get(pid) -> string | null
//   }

export function createPeerTools() {
  const tools = new Map();
  const off = new Set();          // pids known to be offline: a late presence row must not bring a tool back
  const toolOf = (row) => (typeof row[8] === 'string' && row[8] ? row[8] : null);
  return {
    presence(rows) {
      for (const row of rows || []) {
        if (!Array.isArray(row) || typeof row[0] !== 'string' || off.has(row[0])) continue;
        tools.set(row[0], toolOf(row));
      }
    },
    online(pid, on) {
      if (on) { off.delete(pid); return; }
      off.add(pid);
      tools.delete(pid);
    },
    welcome(peers) {
      tools.clear();
      off.clear();
      for (const p of peers || []) {
        if (!p || typeof p.pid !== 'string') continue;
        if (!p.online) { off.add(p.pid); continue; }
        if (Array.isArray(p.pose)) tools.set(p.pid, toolOf(p.pose));
      }
    },
    get(pid) { return tools.get(pid) ?? null; },
  };
}
