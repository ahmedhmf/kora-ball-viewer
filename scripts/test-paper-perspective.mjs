// Smoke-test the real browser worker with a synthetic trapezoid scan.
// Uses Node's VM, no OpenCV or browser dependencies.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const sw=160, sh=220, dw=120, dh=170;
const input=new Uint8ClampedArray(sw*sh*4);
for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
  const isPaper=x<=150-40*y/(sh-1);
  const red=isPaper&&x>=35&&x<=55&&y>=80&&y<=120;
  const pos=(y*sw+x)*4;
  input[pos]=red?210:isPaper?255:220;
  input[pos+1]=red?45:isPaper?255:239;
  input[pos+2]=red?50:isPaper?255:210;
  input[pos+3]=255;
}
const response=new Promise((resolve,reject)=>{
  const sandbox={
    Uint8ClampedArray,Float32Array,Math,setTimeout,clearTimeout,Promise,Error,
    self:{postMessage(message){
      if(message.type==='error')reject(new Error(message.message));
      if(message.type==='complete')resolve(message);
    }}
  };
  runInNewContext(readFileSync('public/workers/kora-paper-straightener.js','utf8'),sandbox);
  sandbox.self.onmessage({data:{
    type:'straighten',width:sw,height:sh,destinationWidth:dw,destinationHeight:dh,
    pixels:input.buffer,
    corners:{
      topLeft:{x:0,y:0},topRight:{x:150,y:0},
      bottomRight:{x:110,y:sh-1},bottomLeft:{x:0,y:sh-1}
    }
  }});
});
const message=await response;
const result=new Uint8ClampedArray(message.pixels);
assert.equal(result.length,dw*dh*4);
const sample=(x,y)=>[...result.slice((y*dw+x)*4,(y*dw+x)*4+3)];
// The red drawing remains inside the paper at the expected approximate area.
const centralPixels=[];
for(let y=55;y<115;y++)for(let x=18;x<65;x++)centralPixels.push(sample(x,y));
assert.ok(centralPixels.some(rgb=>rgb[0]>170&&rgb[1]<100&&rgb[2]<100),
  'The original artwork was lost in perspective correction');
// A table-colored pixel should not occupy the center of the corrected page.
const white=sample(80,45);
assert.ok(white.every(ch=>ch>247), 'Table background leaked into the paper interior');
console.log('Perspective worker passed: complete paper preserved, table excluded.');
