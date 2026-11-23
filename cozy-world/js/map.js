// The village map (port of scripts/village_map.gd): the thirteen places, their paths, the ones you have visited, and
// where you are. A click on a place pins it on the compass. No fast travel; enjoy the little paths.
import { REGIONS, EDGES } from './data.js';

const point = (p) => [105 + (p[0] + 40) * 7.2, 55 + (p[1] + 35) * 4.5];

export function mapCanvas(state, here, onPin) {
  const wrap = document.createElement('div');
  wrap.className = 'map-wrap';
  const c = document.createElement('canvas');
  c.width = 800; c.height = 480;
  c.className = 'map';
  wrap.append(c);
  const g = c.getContext('2d');
  g.fillStyle = '#e7e8d4'; g.fillRect(15, 10, 785, 460);
  g.strokeStyle = '#c3b99a'; g.lineWidth = 4; g.lineCap = 'round';
  for (const [a, b] of EDGES.slice(0, 17)) {
    const A = point(REGIONS[a].p); const B = point(REGIONS[b].p);
    g.beginPath(); g.moveTo(...A); g.lineTo(...B); g.stroke();
  }
  for (const r of REGIONS) {
    const [x, y] = point(r.p);
    g.fillStyle = r.color; g.beginPath(); g.arc(x, y, 23, 0, Math.PI * 2); g.fill();
    if (state.data.visited.includes(r.id)) { g.strokeStyle = '#7c8d6b'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 26, 0, Math.PI * 2); g.stroke(); }
  }
  const [px, py] = point(here);
  g.fillStyle = '#c4624b'; g.beginPath(); g.arc(px, py + 24, 6, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fff8e8'; g.lineWidth = 2; g.beginPath(); g.arc(px, py + 24, 8, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#586a52'; g.font = '14px "Open Sans", sans-serif';
  g.fillText('N ↑   TREE VILLAGE', 31, 38);
  g.font = '13px "Open Sans", sans-serif';
  g.fillText('● You     ·     Click a place to pin your compass. No fast travel; enjoy the little paths.', 31, 452);
  for (const r of REGIONS) {
    const [x, y] = point(r.p);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'map-place';
    b.textContent = r.name;
    b.title = `${r.subtitle} · click to pin on your compass`;
    b.style.left = `${((x - 65) / 800) * 100}%`;
    b.style.top = `${((y - 16) / 480) * 100}%`;
    b.addEventListener('click', () => onPin(r));
    wrap.append(b);
  }
  return wrap;
}
