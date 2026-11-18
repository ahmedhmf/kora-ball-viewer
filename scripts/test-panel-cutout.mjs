import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('src/app/services/kora-panel-cutout.service.ts', 'utf8');
const match = source.match(/private readonly polygons: number\[\]\[\]\[\] = (\[[\s\S]*?\]);/);
assert.ok(match, 'Expected the exact KORA polygon reference');
const panels = JSON.parse(match[1]);
assert.equal(panels.length, 32, 'KORA has exactly 32 printed panels');
for(const polygon of panels){
  assert.ok(polygon.length >= 5);
  assert.ok(polygon.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&x>0&&y>0&&x<725&&y<1024));
}
const inside = (x,y,poly) => {
  let seen=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a[1]>y)!==(b[1]>y) &&
       x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])seen=!seen;
  }
  return seen;
};
assert.ok(panels.some(p=>inside(350,390,p)), 'Center football artwork must be kept');
for(const [x,y] of [[25,910],[25,40],[700,960],[705,300]]){
  assert.ok(!panels.some(p=>inside(x,y,p)),'Outer page content leaked into net mask');
}
console.log('Panel cutout geometry checked: 32 polygons, center kept, margins excluded.');
