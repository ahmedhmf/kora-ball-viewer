import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Test the actual source function with synthetic faint grey print lines and
// misleading marker ink. No browser or external fixtures required.
const source = readFileSync('src/app/services/kora-panel-edge-refiner.ts', 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{
  module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022
}}).outputText;
const sandbox = {exports:{}};
runInNewContext(compiled, sandbox);
const refine = sandbox.exports.refineKoraPanelCorners;
assert.equal(typeof refine, 'function');

const width=200,height=200;
const template=[[75,42],[115,65],[101,116],[50,116],[40,68]];
const shifted=template.map(([x,y])=>[x+4,y+3]);
const blank=new Uint8Array(width*height);
blank.fill(255);

function paintEdge(gray,a,b,value){
  const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
  for(let n=0;n<=length*5;n++){
    const t=n/(length*5);
    const x=Math.round(a[0]*(1-t)+b[0]*t);
    const y=Math.round(a[1]*(1-t)+b[1]*t);
    gray[y*width+x]=value;
  }
}
const actual=blank.slice();
shifted.forEach((p,i)=>paintEdge(actual,p,shifted[(i+1)%5],195));
// Thick dark writing inside the panel is *not* a consistent border.
for(let y=75;y<85;y++)for(let x=62;x<92;x++)actual[y*width+x]=55;

const detected=refine(actual,width,height,[template])[0];
for(let i=0;i<5;i++){
  assert.ok(Math.hypot(detected[i][0]-shifted[i][0],
    detected[i][1]-shifted[i][1]) < 1.5,
    'Faint printed edge should override globally registered template corner '+i);
}
const unchanged=refine(blank,width,height,[template])[0];
assert.deepEqual(JSON.parse(JSON.stringify(unchanged)),template,
  'Blank/ambiguous scan must preserve global registration');

assert.throws(()=>refine(new Uint8Array(20),width,height,[template]),/Invalid registered scan/);
console.log('Local panel-edge finder: 5 corners recovered within 1.5px and ambiguous scans unchanged.');
