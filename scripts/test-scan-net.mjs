import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Reproduce a scan with three separated runs of faint grey panel outlines,
// with colored outside graffiti and the QR in the opposite corner.
// The algorithm must draw the SOURCE only once and never mask 32 polygons.
const width=725,height=1024;
const pixels=new Uint8ClampedArray(width*height*4);
pixels.fill(255);
const put=(x,y,r,g,b)=>{
  const i=(y*width+x)*4;
  pixels[i]=r;pixels[i+1]=g;pixels[i+2]=b;
};
for (const [x0,y0,x1,y1] of [[370,65,555,230],[225,258,630,605],[218,673,548,930]]) {
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
    const edge=x<x0+4||x>x1-4||y<y0+4||y>y1-4;
    if(edge)put(x,y,205,205,205);
  }
}
for(let y=170;y<250;y++)for(let x=40;x<130;x++)put(x,y,220,25,28);

const code=readFileSync('src/app/services/kora-scan-net.service.ts','utf8');
const js=ts.transpileModule(code,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true
}}).outputText;
const canvases=[];
const sandbox={exports:{},require:name=>{
  if(name==='@angular/core')return {Injectable:()=>target=>target};
  throw Error('Unexpected dependency '+name);
},document:{createElement:tag=>{
  assert.equal(tag,'canvas');
  const operations=[];
  const canvas={width:0,height:0,operations,getContext:()=>({
    drawImage:(...args)=>operations.push(['draw',...args]),
    getImageData:()=>({data:pixels}),
    set fillStyle(value){operations.push(['fillStyle',value]);},
    set strokeStyle(value){operations.push(['strokeStyle',value]);},
    set lineWidth(value){operations.push(['lineWidth',value]);},
    set lineJoin(value){operations.push(['join',value]);},
    set lineCap(value){operations.push(['cap',value]);},
    set globalCompositeOperation(value){operations.push(['composite',value]);},
    beginPath:()=>operations.push(['beginPath']),
    moveTo:(...args)=>operations.push(['moveTo',...args]),
    lineTo:(...args)=>operations.push(['lineTo',...args]),
    closePath:()=>operations.push(['closePath']),
    fill:()=>operations.push(['fill']),
    stroke:()=>operations.push(['stroke']),
    fillRect:(...args)=>operations.push(['fillRect',...args])
  })};
  canvases.push(canvas);
  return canvas;
}}};
runInNewContext(js,sandbox);
const processor=new sandbox.exports.KoraScanNetService();
const source={width,height};
const result=processor.render(source);
assert.equal(result.width,1024);
assert.equal(result.height,1024);
assert.equal(canvases.length,4,'analysis, source artwork, broad mask, final white atlas');
const [probe,art,mask,atlas]=canvases;
assert.equal(art.operations.filter(op=>op[0]==='draw'&&op[1]===source).length,1,
  'All panels must use a single global image draw');
assert.equal(mask.operations.filter(op=>op[0]==='beginPath').length,3,
  'Protect the three broad scan outline regions, not individual panels');
assert.equal(mask.operations.filter(op=>op[0]==='stroke').length,3);
assert.ok(!mask.operations.some(op=>op[0]==='beginPath'&&op.length>1));
const draw=art.operations.find(op=>op[0]==='draw');
const [,,sx,sy,sw,sh,dx,dy,dw,dh]=draw;
assert.ok(sw>0&&sh>0&&dw>0&&dh>0);
assert.ok(Math.abs(dw/sw-dh/sh)<1e-10,'Never distort a panel');
assert.ok(Math.abs(dx+dw/2-512)<1e-8,'Horizontally centered');
assert.ok(Math.abs(dy+dh/2-512)<1e-8,'Vertically centered');
assert.ok(atlas.operations.some(op=>op[0]==='fillRect'&&op.slice(1).join(',')==='0,0,1024,1024'));
assert.ok(art.operations.some(op=>op[0]==='composite'&&op[1]==='destination-in'));
const blank=pixels.slice();pixels.fill(255);
assert.throws(()=>processor.render(source),/Could not identify all printed football outlines/);
pixels.set(blank);
console.log('PASS: scan-based net uses 3 padded hulls, one undistorted source draw, white 1:1 atlas.');
