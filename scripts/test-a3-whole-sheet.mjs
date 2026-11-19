import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const sourceCode=readFileSync('src/app/services/kora-panel-cutout.service.ts','utf8');
const matched=sourceCode.match(/private readonly polygons: number\[\]\[\]\[\] = (\[[\s\S]*?\]);/);
assert.ok(matched,'Printed KORA A3 panel outline reference');
const polygons=JSON.parse(matched[1]);
assert.equal(polygons.length,32);

const js=ts.transpileModule(sourceCode,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true
}}).outputText;
let drawCalls=[],fills=[],created=[];
const sandbox={
  exports:{},
  require:name=>{
    if(name==='@angular/core')return {Injectable:()=>target=>target};
    throw new Error('Unexpected dependency '+name);
  },
  document:{createElement:tag=>{
    assert.equal(tag,'canvas');
    const canvas={width:0,height:0,getContext:()=>({
      set fillStyle(value){this.color=value;},
      fillRect:(...args)=>fills.push(args),
      drawImage:(...args)=>drawCalls.push(args)
    })};
    created.push(canvas);
    return canvas;
  }}
};
runInNewContext(js,sandbox);
const preparer=new sandbox.exports.KoraPanelCutoutService();
// A3 portrait scan: 1485×2100 px (same sqrt(2) paper aspect as A4).
const paper={width:1485,height:2100};
const registered=polygons.map(poly=>poly.map(([x,y])=>[
  x*paper.width/725,y*paper.height/1024
]));
const atlas=preparer.placeFullSheetInBallUV(paper,registered);
assert.equal(atlas.width,1024);
assert.equal(atlas.height,1024);
assert.equal(drawCalls.length,1,'Exactly one whole-sheet drawImage, no panel cutting');
assert.equal(drawCalls[0][0],paper,'Must draw the full original sheet');
assert.deepEqual(fills[0],[0,0,1024,1024],'Opaque white square background');
const [,,dx,dy,dw,dh]=drawCalls[0];
assert.ok(Number.isFinite(dx)&&Number.isFinite(dy));
assert.ok(dw>0 && dh>0);
const map=(x,y)=>[dx+x*dw/paper.width,dy+y*dh/paper.height];
for(const poly of polygons){
  for(const [x,y] of poly){
    const [u,v]=map(x*paper.width/725,y*paper.height/1024);
    assert.ok(Math.abs(u-(1024*(.105+.00109*x)))<.001);
    assert.ok(Math.abs(v-(1024*(-.065+.00109*y)))<.001);
  }
}
assert.throws(()=>preparer.placeFullSheetInBallUV(paper,[]),/32 registered panels/);
const component=readFileSync('src/app/components/techpack-preparer/techpack-preparer.component.ts','utf8');
assert.ok(component.includes('if (!this.uploadedPdf)'),
  'Digitally-flat A3 PDFs must skip photo perspective correction');
assert.ok(!component.includes('this.uvAligner.render('),
  'One-click A3 path cannot apply per-panel UV warps');
console.log('A3 whole-sheet test passed: one draw, white 1:1 atlas, all 180 corners preserve global placement.');
