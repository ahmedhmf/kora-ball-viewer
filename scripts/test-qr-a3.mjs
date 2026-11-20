import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const code=readFileSync('src/app/services/paper-straightener.service.ts','utf8');
const js=ts.transpileModule(code,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true
}}).outputText;

const width=512,height=724;
let rgba;
function build(qx,qy){
  rgba=new Uint8ClampedArray(width*height*4);
  rgba.fill(255);
  // 36x40 gray printed checkerboard, like a low-resolution A3 QR.
  if(qx>=0)for(let y=qy;y<qy+40;y++)for(let x=qx;x<qx+36;x++){
    const dark=((Math.floor((x-qx)/3)+Math.floor((y-qy)/3))%2)===0;
    const value=dark?160:255;
    const i=(y*width+x)*4;
    rgba[i]=value;rgba[i+1]=value;rgba[i+2]=value;
  }
  // Dense red handwriting must never count as the QR.
  for(let y=560;y<610;y++)for(let x=80;x<115;x++){
    if((x+y)%3!==0)continue;
    const i=(y*width+x)*4;
    rgba[i]=220;rgba[i+1]=25;rgba[i+2]=35;
  }
}
const sandbox={exports:{},window:{},require:name=>{
  if(name==='@angular/core')return {Injectable:()=>target=>target};
  throw Error('Unexpected dependency '+name);
},document:{createElement:()=>({
  width:0,height:0,getContext:()=>({
    drawImage:()=>{},getImageData:()=>({data:rgba}),
    translate:()=>{},rotate:()=>{}
  })
})}};
runInNewContext(js,sandbox);
const paper=new sandbox.exports.PaperStraightenerService();
const input={width,height};
build(425,90);
const topRight=await paper.orientPrintedSheet(input);
assert.equal(topRight.angle,180,'Top-right grey QR rotates portrait A3 180 degrees');
assert.equal(topRight.reliable,true);
build(50,590);
const bottomLeft=await paper.orientPrintedSheet(input);
assert.equal(bottomLeft.angle,0,'Bottom-left QR is already aligned');
assert.equal(bottomLeft.reliable,true);
build(-1,-1);
const unknown=await paper.orientPrintedSheet(input);
assert.equal(unknown.reliable,false,'Do not invent orientation without QR evidence');
console.log('PASS: A3 QR detects 180, 0, and uncertain; ignores colored handwriting.');
