'use strict';
// Perspective-correct ONE entire paper rectangle: no panel processing or masks.
// The inverse homography maps every destination pixel to the photographed page.
function transformFromUnitSquare(q){
  const [p0,p1,p2,p3]=q;
  const dx1=p1.x-p2.x,dy1=p1.y-p2.y;
  const dx2=p3.x-p2.x,dy2=p3.y-p2.y;
  const dx3=p0.x-p1.x+p2.x-p3.x;
  const dy3=p0.y-p1.y+p2.y-p3.y;
  let g=0,h=0;
  if(Math.abs(dx3)+Math.abs(dy3)>1e-7){
    const determinant=dx1*dy2-dx2*dy1;
    if(Math.abs(determinant)<1e-6)throw new Error('Invalid paper corners');
    g=(dx3*dy2-dx2*dy3)/determinant;
    h=(dx1*dy3-dx3*dy1)/determinant;
  }
  return {
    a:p1.x-p0.x+g*p1.x,b:p3.x-p0.x+h*p3.x,c:p0.x,
    d:p1.y-p0.y+g*p1.y,e:p3.y-p0.y+h*p3.y,f:p0.y,g,h
  };
}
async function straighten(data){
  const {width:sw,height:sh,destinationWidth:dw,destinationHeight:dh}=data;
  if(sw<10||sh<10||dw<10||dh<10)throw new Error('Image dimensions are invalid');
  const corners=data.corners;
  const q=[corners.topLeft,corners.topRight,corners.bottomRight,corners.bottomLeft];
  const m=transformFromUnitSquare(q);
  const input=new Uint8ClampedArray(data.pixels);
  const output=new Uint8ClampedArray(dw*dh*4);
  output.fill(255);
  for(let y=0;y<dh;y++){
    const v=y/(dh-1);
    for(let x=0;x<dw;x++){
      const u=x/(dw-1);
      const divisor=m.g*u+m.h*v+1;
      if(Math.abs(divisor)<1e-8)continue;
      const sx=(m.a*u+m.b*v+m.c)/divisor;
      const sy=(m.d*u+m.e*v+m.f)/divisor;
      if(sx<0||sy<0||sx>=sw-1||sy>=sh-1)continue;
      const ix=Math.floor(sx),iy=Math.floor(sy);
      const fx=sx-ix,fy=sy-iy;
      const a=(iy*sw+ix)*4,b=a+sw*4,dest=(y*dw+x)*4;
      for(let k=0;k<3;k++){
        output[dest+k]=Math.round(
          input[a+k]*(1-fx)*(1-fy)+input[a+4+k]*fx*(1-fy)+
          input[b+k]*(1-fx)*fy+input[b+4+k]*fx*fy
        );
      }
      output[dest+3]=255;
    }
    if(y%96===0){
      self.postMessage({type:'progress',row:y});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  self.postMessage({type:'complete',pixels:output.buffer},[output.buffer]);
}
self.onmessage=event=>{
  if(event.data?.type!=='straighten')return;
  straighten(event.data).catch(error=>
    self.postMessage({type:'error',message:String(error?.message||error)})
  );
};
