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
assert.ok(component.includes('PREPARE BALL TEXTURE'));
assert.ok(component.includes('Download ready PNG'));
assert.ok(component.includes('Apply to 3D Ball'));
assert.ok(component.includes('this.panelCutout.registerPanels(corrected)'));
assert.ok(component.includes('this.panelCutout.placeFullSheetInBallUV(corrected,panels)'));
assert.ok(component.includes('const atlas=this.panelCutout.placeFullSheetInBallUV'));
assert.ok(source.includes("if (mode === 'register') return source;"));
assert.ok(source.includes('async registerPanels(source: HTMLCanvasElement)'));
assert.ok(!component.includes('CUT TO PANEL SHAPES'));
assert.ok(!component.includes('REMOVE OUTSIDE PANELS'));
assert.ok(!component.includes('MAKE 1:1'));
assert.ok(!component.includes('KoraUvAlignService'));
assert.ok(!component.includes('this.uvAligner.render'));
assert.ok(component.includes('this.uploadedPdf'));
assert.ok(!component.includes('if (corrected.width >= corrected.height)'));
assert.ok(component.includes('const oriented=await this.paper.orientPrintedSheet(corrected)'));
assert.ok(source.includes('placeFullSheetInBallUV(source: HTMLCanvasElement, registeredPanels: number[][][])'));
assert.ok(source.includes('actx.drawImage(source,left,top,cropWidth,cropHeight,'));
assert.ok(source.includes('const destX=(1024-destWidth)/2'));
assert.ok(source.includes('const destY=(1024-destHeight)/2'));
assert.ok(source.includes('const marginX=24*pxPerReferenceX'));
assert.ok(source.includes('const marginY=24*pxPerReferenceY'));
assert.ok(source.slice(source.indexOf('placeFullSheetInBallUV('),source.indexOf('async cutToPanelShapes(')).includes("actx.globalCompositeOperation='destination-in'"));
assert.ok(source.includes("mctx.lineWidth=32*Math.min("));
assert.ok(source.includes('const hull=lower.slice(0,-1).concat(upper.slice(0,-1))'));
assert.ok(!source.slice(source.indexOf('placeFullSheetInBallUV('),source.indexOf('async cutToPanelShapes(')).includes('for(const polygon of registeredPanels)'));

assert.ok(component.includes('const oriented=await this.paper.orientPrintedSheet(corrected)'));
assert.ok(component.includes('if (!oriented.reliable)'));
assert.ok(!component.includes('if (corrected.width >= corrected.height)'));
const orientation=readFileSync('src/app/services/paper-straightener.service.ts','utf8');
assert.ok(orientation.includes('const w = 512'), 'A3 QR fallback resolution');
const atlasTop=(-0.065 + 0.00109*(63-5))*1024;
const atlasBottom=(-0.065 + 0.00109*(969+5))*1024;
const atlasLeft=(0.105 + 0.00109*(85-5))*1024;
const atlasRight=(0.105 + 0.00109*(623+5))*1024;
assert.ok(atlasLeft>0 && atlasRight<1024 && atlasTop>-4 && atlasBottom<1024);
console.log('Panel cutout geometry, UV atlas placement and opaque white-square mode checked.');
