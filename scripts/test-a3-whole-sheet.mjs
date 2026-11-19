import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Regression for the incident where clipping against 32 approximate print
// polygons deleted entire sides of real handwriting.
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
    const canvas={width:0,height:0,ops,getContext:()=>({
      set fillStyle(value){ops.push(['fillStyle',value]);},
      set strokeStyle(value){ops.push(['strokeStyle',value]);},
      set lineJoin(value){ops.push(['lineJoin',value]);},
      set lineCap(value){ops.push(['lineCap',value]);},
      set lineWidth(value){ops.push(['lineWidth',value]);},
      beginPath:()=>ops.push(['beginPath']),
      moveTo:(...args)=>ops.push(['moveTo',...args]),
      lineTo:(...args)=>ops.push(['lineTo',...args]),
      closePath:()=>ops.push(['closePath']),
      fill:()=>ops.push(['fill']),
      stroke:()=>ops.push(['stroke']),
      fillRect:(...args)=>ops.push(['fillRect',...args]),
      drawImage:(...args)=>ops.push(['drawImage',...args]),
      set globalCompositeOperation(value){ops.push(['composite',value]);}
    })};
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
assert.equal(canvases.length,3,'One broad mask, one unchanged artwork draw, one white result');
const [mask,artwork,output]=canvases;
const maskOps=mask.ops;
assert.equal(maskOps.filter(op=>op[0]==='beginPath').length,1,'One safe outer boundary, never 32 panel masks');
assert.equal(maskOps.filter(op=>op[0]==='stroke').length,1,'One padded envelope protects all interior ink');
const lineWidth=maskOps.find(op=>op[0]==='lineWidth')?.[1];
assert.ok(lineWidth>20,'Conservative bleed must protect artwork over printed borders');
const ops=artwork.ops;
const draws=ops.filter(op=>op[0]==='drawImage' && op[1]===paper);
assert.equal(draws.length,1,'One uniform full-design crop: no per-panel warping');
const [name,src,sx,sy,sw,sh,dx,dy,dw,dh]=draws[0];
assert.equal(src,paper);
assert.ok(sx>=0&&sy>=0&&sx+sw<=paper.width&&sy+sh<=paper.height);
assert.ok(dw>0&&dh>0&&sw>0&&sh>0);
assert.ok(Math.abs(dw/sw-dh/sh)<1e-12,'Never distort panel proportions');
assert.ok(Math.abs(dx+dw/2-512)<1e-9,'Center horizontally');
assert.ok(Math.abs(dy+dh/2-512)<1e-9,'Center vertically');
assert.ok(Math.max(dw,dh)<=976.001 && Math.max(dw,dh)>=975.999);
const points=panels.flat();
const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0]));
const minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
assert.ok(sx<minX&&sx+sw>maxX,'Padded crop preserves all horizontal borders');
assert.ok(sy<minY&&sy+sh>maxY,'Padded crop preserves all vertical borders');
assert.ok(artwork.ops.some(op=>op[0]==='composite'&&op[1]==='destination-in'),
  'Protective combined mask excludes distant A3 content');
assert.ok(output.ops.some(op=>op[0]==='fillRect'&&op.slice(1).join(',')==='0,0,1024,1024'),
  'Opaque white background');
assert.ok(output.ops.some(op=>op[0]==='drawImage'&&op[1]===artwork),
  'Overlay complete protected artwork without individual panel transforms');
assert.throws(()=>service.placeFullSheetInBallUV(paper,[]),/32 registered panels/);
const component=readFileSync('src/app/components/techpack-preparer/techpack-preparer.component.ts','utf8');
assert.ok(component.includes('this.scanNet.render(corrected)'));
assert.ok(component.includes('const detected=this.paper.detect(input)'));
assert.ok(!component.includes('if (!this.uploadedPdf)'));
assert.ok(!component.includes('this.uvAligner.render('));
console.log('PASS: A3 centered, single outer-envelope mask, all 32 panel interiors untouched.');
