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
assert.equal(canvases.length,1,'Do not create any panel clipping mask');
const ops=canvases[0].ops;
const draws=ops.filter(op=>op[0]==='drawImage');
assert.equal(draws.length,1,'One uniform crop of the entire football print');
const [name,src,sx,sy,sw,sh,dx,dy,dw,dh]=draws[0];
assert.equal(src,paper);
assert.ok(sx>=0&&sy>=0&&sx+sw<=paper.width&&sy+sh<=paper.height);
assert.ok(dw>0&&dh>0&&sw>0&&sh>0);
assert.ok(Math.abs(dw/sw-dh/sh)<1e-12,'Never distort panel proportions');
assert.ok(Math.abs(dx+dw/2-512)<1e-9,'Center design horizontally');
assert.ok(Math.abs(dy+dh/2-512)<1e-9,'Center design vertically');
assert.ok(Math.max(dw,dh)<=976.001);
assert.ok(Math.max(dw,dh)>=975.999);
const points=panels.flat();
const minX=Math.min(...points.map(p=>p[0])),maxX=Math.max(...points.map(p=>p[0]));
const minY=Math.min(...points.map(p=>p[1])),maxY=Math.max(...points.map(p=>p[1]));
assert.ok(sx<minX&&sx+sw>maxX,'All panels inside padded horizontal crop');
assert.ok(sy<minY&&sy+sh>maxY,'All panels inside padded vertical crop');
assert.ok(ops.some(op=>op[0]==='fillRect'&&op.slice(1).join(',')==='0,0,1024,1024'),
  'White opaque 1:1 background');
assert.ok(!ops.some(op=>op[0]==='composite'),
  'Masking/compositing must never delete panel artwork');
assert.throws(()=>service.placeFullSheetInBallUV(paper,[]),/32 registered panels/);
const component=readFileSync('src/app/components/techpack-preparer/techpack-preparer.component.ts','utf8');
assert.ok(component.includes('this.panelCutout.placeFullSheetInBallUV(corrected,panels)'));
assert.ok(!component.includes('this.uvAligner.render('));
console.log('PASS: 32-panel A3 net safely centered and uniformly scaled, no destructive mask.');
