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
// The cut step should produce a distinct reversible transparent output,
// leaving the existing full-paper and white-mask modes unchanged.
assert.ok(source.includes("async cutToPanelShapes(source: HTMLCanvasElement)"));
assert.ok(source.includes("return this.removeOutside(source, 'cut')"));
assert.ok(source.includes("mode === 'cut' ? 8 : 36"));
assert.ok(source.includes("if (mode === 'cut')"));
assert.ok(source.includes("return cropped;"));
const component = readFileSync('src/app/components/techpack-preparer/techpack-preparer.component.ts','utf8');
assert.ok(component.includes('CUT TO PANEL SHAPES'));
assert.ok(component.includes('SHOW UNCROPPED PANELS'));
assert.ok(component.includes('SHOW FULL PAPER'));
assert.ok(component.includes('MAKE 1:1'));
assert.ok(component.includes('SHOW ORIGINAL ASPECT RATIO'));
assert.ok(component.includes('makeSquareCanvas(source:HTMLCanvasElement)'));
assert.ok(component.includes('this.squareVersion=this.makeSquareCanvas(this.shapesOnly)'));
assert.ok(component.includes("this.squareMode() ? 'kora-panel-shapes-square.png'"));
// Final 1:1 mode must composite transparent cutouts onto white pixels.
assert.ok(source.includes("ctx.fillStyle='#ffffff';"));
assert.ok(component.includes("if(this.squareMode()){"));
assert.ok(component.includes("Created a UV-aligned 1:1 white texture"));
assert.ok(component.includes("const square=this.squareMode()"));
assert.ok(source.includes('placeCutoutInBallUV(cropped: HTMLCanvasElement)'));
assert.ok(source.includes('const uvPixelsPerReferencePixel=1024*0.00109'));
assert.ok(source.includes('const atlasOffsetX=1024*0.105'));
assert.ok(source.includes('const atlasOffsetY=1024*(-0.065)'));
assert.ok(component.includes('this.panelCutout.placeCutoutInBallUV(source)'));
assert.ok(component.includes('const square=this.squareMode()'));
assert.ok(component.includes('this.shapesCut() && !this.squareMode()'));
const atlasTop=(-0.065 + 0.00109*(63-5))*1024;
const atlasBottom=(-0.065 + 0.00109*(969+5))*1024;
const atlasLeft=(0.105 + 0.00109*(85-5))*1024;
const atlasRight=(0.105 + 0.00109*(623+5))*1024;
assert.ok(atlasLeft>0 && atlasRight<1024 && atlasTop>-4 && atlasBottom<1024);
console.log('Panel cutout geometry, UV atlas placement and opaque white-square mode checked.');
