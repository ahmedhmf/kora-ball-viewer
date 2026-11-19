import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Test the actual TypeScript renderer with a recording Canvas implementation.
// The essential regression is ONE source draw: the old 32 independently
// clipped polygon renders repeatedly removed children's handwritten letters.
const printed=JSON.parse(readFileSync('src/app/services/kora-panel-cutout.service.ts','utf8')
  .match(/private readonly polygons: number\[\]\[\]\[\] = (\[[\s\S]*?\]);/)[1]);
const uv=JSON.parse(readFileSync('src/app/services/kora-uv-panel-corners.ts','utf8')
  .match(/export const KORA_UV_PANEL_CORNERS: number\[\]\[\]\[\] = (\[[\s\S]*?\]);/)[1]);
assert.equal(printed.length,32);
assert.equal(uv.length,32);
const canvases=[];
const pixelData=new Uint8ClampedArray(1024*1024*4);
pixelData.fill(255);
const sandbox={
  exports:{},
  ImageData:class {constructor(data,width,height){this.data=data;this.width=width;this.height=height;}},
  require:name=>{
    if(name==='@angular/core')return {Injectable:()=>target=>target};
    if(name==='./kora-uv-panel-corners')return {KORA_UV_PANEL_CORNERS:uv};
    throw Error('Unexpected dependency '+name);
  },
  document:{createElement:tag=>{
    assert.equal(tag,'canvas');
    const ops=[];
    const canvas={width:0,height:0,ops,getContext:()=>({
      save:()=>ops.push(['save']),
      restore:()=>ops.push(['restore']),
      setTransform:(...args)=>ops.push(['setTransform',...args]),
      drawImage:(...args)=>ops.push(['drawImage',...args]),
      getImageData:()=>({data:pixelData}),
      putImageData:(...args)=>ops.push(['putImageData',...args]),
      fillRect:(...args)=>ops.push(['fillRect',...args]),
      beginPath:()=>ops.push(['beginPath']),
      moveTo:(...args)=>ops.push(['moveTo',...args]),
      lineTo:(...args)=>ops.push(['lineTo',...args]),
      closePath:()=>ops.push(['closePath']),
      fill:()=>ops.push(['fill']),
      stroke:()=>ops.push(['stroke']),
      set fillStyle(value){ops.push(['fillStyle',value]);},
      set strokeStyle(value){ops.push(['strokeStyle',value]);},
      set lineWidth(value){ops.push(['lineWidth',value]);},
      set lineCap(value){ops.push(['lineCap',value]);},
      set lineJoin(value){ops.push(['lineJoin',value]);},
      set globalCompositeOperation(value){ops.push(['composite',value]);}
    })};
    canvases.push(canvas);
    return canvas;
  }}
};
const code=readFileSync('src/app/services/kora-uv-align.service.ts','utf8');
const js=ts.transpileModule(code,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true
}}).outputText;
runInNewContext(js,sandbox);
const renderer=new sandbox.exports.KoraUvAlignService();
// Simulated registered full-resolution portrait scan, not a cropped/white image.
const source={width:1450,height:2048};
const from=printed.map(poly=>poly.map(([x,y])=>[x*2,y*2]));
const atlas=renderer.renderContinuous(source,from);
assert.equal(atlas.width,1024);
assert.equal(atlas.height,1024);
assert.equal(canvases.length,3,'One source canvas, one UV mask, one finished atlas');
const [art,mask,output]=canvases;
assert.equal(art.ops.filter(op=>op[0]==='drawImage'&&op[1]===source).length,1,
  'Draw original full source exactly once; never crop each printed panel');
assert.equal(art.ops.filter(op=>op[0]==='putImageData').length,1,
  'Apply exactly one smoothly varying residual correction across all panel seams');
const correctedPixels=art.ops.find(op=>op[0]==='putImageData')[1];
assert.equal(correctedPixels.width,1024);
assert.equal(correctedPixels.height,1024);
assert.ok(code.includes('gridStep=4'),'Use an interpolated continuous correction field');
assert.ok(code.includes('radiusSquared=96*96'),'Keep corrections local to each region');

assert.equal(mask.ops.filter(op=>op[0]==='beginPath').length,32,
  'Keep the precise 32 OBJ UV islands, not the centered A3 rectangle');
assert.equal(mask.ops.filter(op=>op[0]==='stroke').length,32);
assert.ok(mask.ops.some(op=>op[0]==='lineWidth'&&op[1]===24),
  'Protect handwriting near printed panel edges');
assert.ok(art.ops.some(op=>op[0]==='composite'&&op[1]==='destination-in'));
assert.ok(output.ops.some(op=>op[0]==='fillRect'&&op.slice(1).join(',')==='0,0,1024,1024'),
  'Opaque white UV texture');
assert.ok(output.ops.some(op=>op[0]==='drawImage'&&op[1]===art));
const transform=art.ops.find(op=>op[0]==='setTransform');
assert.ok(transform,'Real affine alignment to OBJ UV layout');
const [,a,c,b,d,tx,ty]=transform;
assert.ok(a*d-b*c>0,'No reflection');
let distance=0,maxDistance=0,count=0;
for(let panel=0;panel<32;panel++){
  for(let j=0;j<from[panel].length;j++){
    const [x,y]=from[panel][j],[u,v]=uv[panel][j];
    const error=Math.hypot(a*x+b*y+tx-u,c*x+d*y+ty-v);
    distance+=error;
    maxDistance=Math.max(maxDistance,error);
    count++;
  }
}
assert.equal(count,180);
assert.ok(distance/count<5,'Fit must match all 32 OBJ UV islands to reference print');
assert.ok(maxDistance<15,'No mapped source corner should be far from the intended island');
assert.throws(()=>renderer.renderContinuous(source,[]),/32 OBJ panels/);
const wrong=from.map(p=>p.map(v=>v.slice()));
wrong[1][0][0]=NaN;
assert.throws(()=>renderer.renderContinuous(source,wrong),/Invalid printed\/UV corner/);
console.log('PASS: one uncut A3 draw, smooth local seam correction, 32 OBJ UV islands, 180 corners, mean global fit '+(distance/count).toFixed(2)+'px.');
