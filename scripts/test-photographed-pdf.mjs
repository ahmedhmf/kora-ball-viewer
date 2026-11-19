import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const width=360,height=510;
let rgba;
const make=(skewed)=>{
  rgba=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++){
    const edge=Math.round(width*(.97-(.97-.68)*y/(height-1)));
    for(let x=0;x<width;x++){
      const p=(y*width+x)*4;
      const outside=skewed && x>=edge;
      rgba[p]=outside?220:252;
      rgba[p+1]=outside?239:252;
      rgba[p+2]=outside?211:252;
      rgba[p+3]=255;
    }
  }
};
const code=readFileSync('src/app/services/paper-straightener.service.ts','utf8');
const js=ts.transpileModule(code,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true
}}).outputText;
const sandbox={exports:{},window:{},require:name=>{
  if(name==='@angular/core')return {Injectable:()=>target=>target};
  throw Error('Unexpected dependency '+name);
},document:{createElement:()=>({
  width:0,height:0,getContext:()=>({
    drawImage:()=>{},getImageData:()=>({data:rgba})
  })
})}};
runInNewContext(js,sandbox);
const service=new sandbox.exports.PaperStraightenerService();
make(true);
const photo=service.detect({width,height});
assert.equal(photo.confidence,'detected','A3 photographed PDF must be rectified');
assert.ok(Math.abs(photo.topRight-.97)<.05,'Find top right paper edge');
assert.ok(Math.abs(photo.bottomRight-.68)<.06,'Find skewed bottom paper edge');
make(false);
const flat=service.detect({width,height});
assert.equal(flat.confidence,'uncertain','Already-flat page should not be warped');
const component=readFileSync('src/app/components/techpack-preparer/techpack-preparer.component.ts','utf8');
assert.ok(component.includes('const detected=this.paper.detect(input)'));
assert.ok(!component.includes('if (!this.uploadedPdf)'));
console.log('PASS: photograph embedded in PDF is straightened; flat PDF remains untouched.');
