import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Raster-level regression: exercise the actual Angular service with a minimal
// Canvas API, not just the precomputed polygon metadata.
const uvSource=readFileSync('src/app/services/kora-uv-panel-corners.ts','utf8');
const uv=JSON.parse(uvSource.match(/export const KORA_UV_PANEL_CORNERS: number\[\]\[\]\[\] = (\[[\s\S]*?\]);/)[1]);
const cutout=readFileSync('src/app/services/kora-panel-cutout.service.ts','utf8');
const printed=JSON.parse(cutout.match(/private readonly polygons: number\[\]\[\]\[\] = (\[[\s\S]*?\]);/)[1]);
assert.equal(printed.length,32);
assert.equal(uv.length,32);

const width=725,height=1024;
const pixels=new Uint8ClampedArray(width*height*4);
pixels.fill(255);
const colors=printed.map((_,i)=>[32+(i*37)%190,25+(i*53)%190,30+(i*71)%190]);
function inside(x,y,p){
  let hit=false;
  for(let i=0,j=p.length-1;i<p.length;j=i++){
    const a=p[i],b=p[j];
    if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
}
for(let index=0;index<32;index++){
  const polygon=printed[index], color=colors[index];
  const xs=polygon.map(p=>p[0]),ys=polygon.map(p=>p[1]);
  for(let y=Math.floor(Math.min(...ys));y<=Math.ceil(Math.max(...ys));y++)
    for(let x=Math.floor(Math.min(...xs));x<=Math.ceil(Math.max(...xs));x++)
      if(inside(x+.5,y+.5,polygon)){
        const p=(y*width+x)*4;
        pixels[p]=color[0];pixels[p+1]=color[1];pixels[p+2]=color[2];
      }
}

let rendered;
const context={
  exports:{},
  require:(name)=>{
    if(name==='@angular/core')return {Injectable:()=>target=>target};
    if(name==='./kora-uv-panel-corners')return {KORA_UV_PANEL_CORNERS:uv};
    throw Error('Unexpected dependency '+name);
  },
  ImageData:class { constructor(data,width,height){this.data=data;this.width=width;this.height=height;} },
  document:{createElement:tag=>{
    assert.equal(tag,'canvas');
    return {width:0,height:0,getContext:()=>({putImageData:data=>{rendered=data;}})};
  }}
};
const serviceCode=readFileSync('src/app/services/kora-uv-align.service.ts','utf8');
const js=ts.transpileModule(serviceCode,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true
}}).outputText;
runInNewContext(js,context);
const aligner=new context.exports.KoraUvAlignService();
const source={width,height,getContext:()=>({getImageData:()=>({data:pixels})})};
// Polygon edges must interpolate to their matching print edges; the new
// smooth warp must not introduce a pivot or rotate an individual panel.
for (let panel=0; panel<32; panel++) {
  const from=printed[panel],to=uv[panel];
  for (let i=0; i<to.length; i++) {
    const j=(i+1)%to.length;
    const mid=[(to[i][0]+to[j][0])/2,(to[i][1]+to[j][1])/2];
    const mapped=aligner.mapPoint(mid[0],mid[1],from,to);
    const expected=[(from[i][0]+from[j][0])/2,(from[i][1]+from[j][1])/2];
    assert.ok(Math.hypot(mapped[0]-expected[0],mapped[1]-expected[1])<.01,
      'Mapped panel '+(panel+1)+' edge '+i+' must preserve UV corner correspondence');
  }
}
const result=aligner.render(source,printed);
assert.equal(result.width,1024);
assert.equal(result.height,1024);
assert.ok(rendered,'Expected 1024-square texture output');
const atlas=rendered.data;
let colored=0;
for(let p=0;p<atlas.length;p+=4){
  assert.equal(atlas[p+3],255,'Texture must remain opaque');
  if(atlas[p]!==255 || atlas[p+1]!==255 || atlas[p+2]!==255)colored++;
}
assert.ok(colored>140000,'Expected all 32 UV islands to be painted, not an empty atlas');
for(let i=0;i<32;i++){
  const center=uv[i].reduce((s,p)=>[s[0]+p[0]/uv[i].length,s[1]+p[1]/uv[i].length],[0,0]);
  const x=Math.floor(center[0]),y=Math.floor(center[1]),p=(y*1024+x)*4;
  const actual=Array.from(atlas.slice(p,p+3));
  assert.deepEqual(actual,colors[i],'Incorrect printed artwork at OBJ UV island '+(i+1));
}
assert.deepEqual(Array.from(atlas.slice(0,4)),[255,255,255,255],'Atlas gutter is white');
const reversed=printed.map(p=>p.map(v=>v.slice()));
reversed[0].reverse();
assert.throws(()=>aligner.render(source,reversed),/Degenerate or mirrored panel 1/);
const wrong=printed.map(p=>p.map(v=>v.slice()));
wrong[1][0][0]=NaN;
assert.throws(()=>aligner.render(source,wrong),/Non-finite panel corner on panel 2/);
console.log('Raster verified: 32 uniquely colored OBJ UV islands, exact polygon edge mapping, opaque white gutters and input validation.');
