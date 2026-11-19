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
const component=readFileSync('src/app/components/techpack-preparer/techpack-preparer.component.ts','utf8');
assert.ok(component.includes('PREPARE BALL TEXTURE'));
assert.ok(component.includes('Download ready PNG'));
assert.ok(component.includes('Apply to 3D Ball'));
assert.ok(component.includes('KoraPanelCutoutService'));
assert.ok(component.includes('KoraUvAlignService'));
assert.ok(component.includes('const panels=await this.panelCutout.registerPanels(corrected)'));
assert.ok(component.includes('const atlas=this.uvAligner.renderContinuous(corrected,panels)'));
assert.ok(component.includes('const panels=await this.panelCutout.registerPanels(rotated)'));
assert.ok(component.includes('const atlas=this.uvAligner.renderContinuous(rotated,panels)'));
assert.ok(!component.includes('this.scanNet.render('),'Do not feed square previews into the OBJ UV renderer');
assert.ok(!component.includes('CUT TO PANEL SHAPES'));
assert.ok(!component.includes('REMOVE OUTSIDE PANELS'));
assert.ok(!component.includes('MAKE 1:1'));
assert.ok(component.includes('const detected=this.paper.detect(input)'),
  'Detect photographed paper even when uploaded as PDF');
assert.ok(component.includes('const oriented=await this.paper.orientPrintedSheet(corrected)'));
assert.ok(component.includes('const orientationUncertain=!oriented.reliable'));
assert.ok(component.includes('async flipWholeSheet()'));
assert.ok(!component.includes("throw new Error('Cannot verify page orientation"));
assert.ok(source.includes("if (mode === 'register') return source;"));
assert.ok(source.includes('async registerPanels(source: HTMLCanvasElement)'));
const renderer=readFileSync('src/app/services/kora-uv-align.service.ts','utf8');
assert.ok(renderer.includes('KORA_UV_PANEL_CORNERS'));
assert.ok(renderer.includes('output.fill(255)'),'All UV gutters must remain opaque white');
console.log('PASS: 32-panel geometry, direct corrected-scan OBJ UV pipeline and one-click UI.');
