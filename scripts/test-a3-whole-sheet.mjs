import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code=readFileSync('src/app/services/kora-panel-cutout.service.ts','utf8');
const reference=code.match(/private readonly polygons: number\[\]\[\]\[\] = (\[[\s\S]*?\]);/);
assert.ok(reference,'Printed panel reference');
const polygons=JSON.parse(reference[1]);
assert.equal(polygons.length,32);
const js=ts.transpileModule(code,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true
}}).outputText;

const canvases=[];
const sandbox={
  exports:{},
  require:name=>{
    if(name==='@angular/core')return {Injectable:()=>target=>target};
    throw new Error('Unexpected dependency: '+name);
  },
  document:{createElement:tag=>{
    assert.equal(tag,'canvas');
    const ops=[];
    const context={
      set fillStyle(color){ops.push(['fillStyle',color]);},
      set strokeStyle(color){ops.push(['strokeStyle',color]);},
      set lineJoin(value){ops.push(['lineJoin',value]);},
      set lineCap(value){ops.push(['lineCap',value]);},
      set lineWidth(value){ops.push(['lineWidth',value]);},
      set globalCompositeOperation(value){ops.push(['composite',value]);},
      drawImage:(...args)=>ops.push(['drawImage',...args]),
      fillRect:(...args)=>ops.push(['fillRect',...args]),
      beginPath:()=>ops.push(['beginPath']),
      moveTo:(...args)=>ops.push(['moveTo',...args]),
      lineTo:(...args)=>ops.push(['lineTo',...args]),
      closePath:()=>ops.push(['closePath']),
      fill:()=>ops.push(['fill']),
      stroke:()=>ops.push(['stroke'])
    };
    const canvas={width:0,height:0,ops,getContext:()=>context};
    canvases.push(canvas);
    return canvas;
  }}
};
runInNewContext(js,sandbox);
const service=new sandbox.exports.KoraPanelCutoutService();
const paper={width:1485,height:2100};
const panels=polygons.map(p=>p.map(([x,y])=>[x*paper.width/725,y*paper.height/1024]));
const atlas=service.placeFullSheetInBallUV(paper,panels);
assert.equal(atlas.width,1024);
assert.equal(atlas.height,1024);
assert.equal(canvases.length,3,'Artwork, mask, and white result canvases');
const [art,mask,output]=canvases;
const originalDraws=art.ops.filter(op=>op[0]==='drawImage' && op[1]===paper);
assert.equal(originalDraws.length,1,'Source image must be drawn exactly once');
const [,src,dx,dy,dw,dh]=originalDraws[0];
assert.equal(src,paper);
assert.ok(Math.abs(dw/paper.width - dh/paper.height)<1e-10,'Uniform image scale');
const points=panels.flat();
const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0]));
const minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
const scale=dw/paper.width;
assert.ok(Math.abs((dx+(minX+maxX)*scale/2)-512)<1e-8,'Panels horizontally centered');
assert.ok(Math.abs((dy+(minY+maxY)*scale/2)-512)<1e-8,'Panels vertically centered');
assert.ok(Math.abs((maxY-minY)*scale-980)<1e-8,'Target print height is 980px');
assert.equal(mask.ops.filter(op=>op[0]==='beginPath').length,32,'Mask only 32 panels');
assert.equal(mask.ops.filter(op=>op[0]==='fill').length,32);
assert.equal(mask.ops.filter(op=>op[0]==='stroke').length,32,'Protect panel borders');
assert.ok(mask.ops.some(op=>op[0]==='lineWidth'&&op[1]===16),'Protect artwork beyond faint panel lines');
assert.ok(art.ops.some(op=>op[0]==='composite'&&op[1]==='destination-in'),
  'Remove page background outside the union of the 32 panels');
assert.ok(output.ops.some(op=>op[0]==='fillRect'&&op.slice(1).join(',')==='0,0,1024,1024'),
  'White opaque 1:1 background');
assert.ok(output.ops.some(op=>op[0]==='drawImage'&&op[1]===art),
  'Composite masked artwork on white canvas');
assert.throws(()=>service.placeFullSheetInBallUV(paper,[]),/32 registered panels/);
const component=readFileSync('src/app/components/techpack-preparer/techpack-preparer.component.ts','utf8');
assert.ok(component.includes('this.panelCutout.placeFullSheetInBallUV(corrected,panels)'));
assert.ok(!component.includes('this.uvAligner.render('));
console.log('A3 panel-only 1:1 preparation: 32 masked regions, centered, uniform scale, protective bleed.');
