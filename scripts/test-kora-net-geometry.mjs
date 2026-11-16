import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const svg = readFileSync('public/templates/kora-guides.svg', 'utf8');
const polys = [...svg.matchAll(/<polygon points="([^"]+)"/g)]
  .map(match => match[1].trim().split(/\s+/).map(point => point.split(',').map(Number)));
assert.equal(polys.length, 32, 'The canonical KORA net must have exactly 32 panels');
assert.ok(polys.every(p => p.length >= 5 && p.every(v => v.length === 2 && v.every(Number.isFinite))),
  'Every panel has a well-formed 2D polygon');

const xs = polys.flatMap(p => p.map(v => v[0]));
const ys = polys.flatMap(p => p.map(v => v[1]));
const bounds = { left: Math.min(...xs), right: Math.max(...xs),
  top: Math.min(...ys), bottom: Math.max(...ys) };
assert.ok(bounds.left > 180 && bounds.left < 260, 'Left net boundary moved');
assert.ok(bounds.right > 770 && bounds.right < 860, 'Right net boundary moved');
assert.ok(bounds.top >= 0 && bounds.top < 35, 'Top net boundary moved');
assert.ok(bounds.bottom > 980 && bounds.bottom <= 1024, 'Bottom net boundary moved');

// The QR code on the blank PDF is bottom-left, outside the football net.
// Any connected union silhouette must exclude that corner.
const inside = (x, y, polygon) => {
  let found = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > y) !== (b[1] > y) &&
      x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) found = !found;
  }
  return found;
};
for (const outside of [[150, 920], [80, 800], [100, 100], [925, 900]]) {
  assert.ok(!polys.some(p => inside(outside[0], outside[1], p)),
    'Page margins or QR area overlapped printable net: ' + outside);
}
console.log('KORA geometry regression passed:', polys.length, 'panels;', JSON.stringify(bounds));
