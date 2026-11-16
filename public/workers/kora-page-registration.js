'use strict';
// Whole-page KORA template registration. NO panel masks or per-panel warping.
// The original photo is resampled one time into the exact known 1024px target.
const PANEL_POLYGONS = [[[353,63],[400,97],[382,152],[325,152],[307,97]],[[250,84],[306,96],[321,140],[285,195],[229,183],[211,130]],[[458,85],[496,131],[477,184],[422,195],[383,150],[402,96]],[[324,152],[388,159],[412,201],[382,251],[322,247],[296,200]],[[413,202],[468,214],[475,271],[423,295],[383,252]],[[295,202],[324,253],[284,295],[233,272],[238,217]],[[325,252],[382,252],[411,300],[382,352],[325,352],[298,307]],[[478,329],[521,367],[507,425],[454,442],[411,403],[424,346]],[[229,329],[285,348],[296,404],[254,442],[197,422],[186,368]],[[324,354],[382,353],[400,408],[353,442],[307,408]],[[590,365],[623,417],[601,465],[544,471],[512,417],[534,371]],[[117,366],[174,372],[194,416],[163,472],[106,466],[85,420]],[[455,442],[509,425],[539,465],[509,518],[454,500]],[[402,414],[454,443],[454,500],[405,529],[353,500],[353,443]],[[302,414],[353,443],[353,500],[303,530],[253,500],[253,443]],[[198,426],[253,444],[253,500],[200,519],[164,473]],[[163,472],[196,524],[173,572],[116,577],[87,519],[107,477]],[[544,471],[601,477],[623,525],[591,577],[535,572],[511,523]],[[353,502],[400,536],[382,590],[325,590],[308,541]],[[454,501],[509,519],[521,576],[478,614],[422,595],[411,540]],[[253,501],[296,539],[283,597],[229,614],[186,575],[199,519]],[[324,591],[388,598],[412,640],[382,690],[322,686],[296,639]],[[295,641],[324,691],[284,734],[232,709],[238,654]],[[412,641],[470,661],[475,710],[422,734],[383,691]],[[325,691],[382,691],[411,739],[382,791],[325,791],[298,746]],[[422,748],[477,760],[496,815],[458,858],[402,847],[385,800]],[[285,748],[321,803],[305,847],[250,859],[211,816],[230,760]],[[324,793],[382,792],[400,847],[350,879],[307,847]],[[404,853],[454,882],[454,940],[404,969],[354,940],[354,882]],[[302,853],[353,882],[353,940],[303,969],[253,940],[253,882]],[[201,865],[253,883],[253,939],[198,958],[164,911]],[[509,864],[543,912],[508,958],[454,939],[454,883]]];
const referenceWidth=725,referenceHeight=1024;
const progress=message=>self.postMessage({type:'progress',message});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function uprightDimensions(w,h,turn){
  return (turn===90||turn===270)?{width:h,height:w}:{width:w,height:h};
}
function fromUpright(x,y,w,h,turn){
  if(turn===90)return [y,h-1-x];
  if(turn===180)return [w-1-x,h-1-y];
  if(turn===270)return [w-1-y,x];
  return [x,y];
}
function makeGray(data,maxDimension=740){
  const {width:w,height:h,options}=data;
  const dims=uprightDimensions(w,h,options.rotation);
  const factor=Math.min(1,maxDimension/Math.max(dims.width,dims.height));
  const dw=Math.max(2,Math.round(dims.width*factor));
  const dh=Math.max(2,Math.round(dims.height*factor));
  const src=new Uint8ClampedArray(data.pixels);
  const gray=new Uint8Array(dw*dh);
  for(let y=0;y<dh;y++)for(let x=0;x<dw;x++){
    const u=(x+.5)*dims.width/dw-.5,v=(y+.5)*dims.height/dh-.5;
    const [rx,ry]=fromUpright(u,v,w,h,options.rotation);
    const xx=Math.max(0,Math.min(w-1,Math.round(rx)));
    const yy=Math.max(0,Math.min(h-1,Math.round(ry)));
    const idx=4*(yy*w+xx);
    gray[y*dw+x]=Math.round(.299*src[idx]+.587*src[idx+1]+.114*src[idx+2]);
  }
  return {gray,dw,dh,dims,original:src};
}
function distanceTransform(gray,w,h){
  const d=new Uint16Array(w*h);d.fill(900);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;
    if(Math.abs(gray[i+1]-gray[i-1])+Math.abs(gray[i+w]-gray[i-w])>44)d[i]=0;
  }
  for(let y=1;y<h;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;
    d[i]=Math.min(d[i],d[i-1]+3,d[i-w]+3,d[i-w-1]+4,d[i-w+1]+4);
  }
  for(let y=h-2;y>=0;y--)for(let x=w-2;x>=1;x--){
    const i=y*w+x;
    d[i]=Math.min(d[i],d[i+1]+3,d[i+w]+3,d[i+w-1]+4,d[i+w+1]+4);
  }
  return d;
}
function boundarySamples(){
  const points=[];
  for(const polygon of PANEL_POLYGONS)for(let j=0;j<polygon.length;j++){
    const a=polygon[j],b=polygon[(j+1)%polygon.length];
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
    for(let t=0;t<Math.max(2,Math.round(length/9));t++){
      const f=t/Math.max(2,Math.round(length/9));
      points.push([a[0]*(1-f)+b[0]*f-362.5,a[1]*(1-f)+b[1]*f-512]);
    }
  }
  return points;
}
const outlines=boundarySamples();
function align(gray,width,height,dims,manual=false){
  const distance=distanceTransform(gray,width,height);
  const baseX=dims.width/referenceWidth,baseY=dims.height/referenceHeight;
  const ratioX=width/dims.width,ratioY=height/dims.height;
  function evaluate(p,detailed=false){
    const [cx,cy,sx,sy,a,shear]=p,cs=Math.cos(a),sn=Math.sin(a);
    let sum=0,good=0,valid=0,total=0;
    const bands=new Uint16Array(8),counts=new Uint16Array(8);
    for(let i=0;i<outlines.length;i+=(detailed?1:2)){
      const xx=outlines[i][0],yy=outlines[i][1];
      const x=(cx+(sx*xx+shear*yy)*cs-sy*yy*sn)*ratioX;
      const y=(cy+(sx*xx+shear*yy)*sn+sy*yy*cs)*ratioY;
      const ix=Math.round(x),iy=Math.round(y);
      let dist=15;
      if(ix>=1&&ix<width-1&&iy>=1&&iy<height-1){
        valid++;dist=distance[iy*width+ix]/3;
      }
      const band=Math.min(7,Math.max(0,Math.floor((yy+512)/128)));
      counts[band]++;
      if(dist<3){good++;bands[band]++;}
      sum+=Math.min(12,dist);total++;
    }
    const avg=sum/total;
    const dispersion=Array.from(bands).filter((n,i)=>counts[i]>0&&n/counts[i]>.14).length;
    if(detailed)return {avg,good,total,valid,bands:dispersion};
    // Prevent the optimizer from fitting handwriting by collapsing the
    // printed net or drifting onto a repeated pentagon.
    const penalty=.008*(Math.abs(cx-dims.width/2)+Math.abs(cy-dims.height/2))+
      6*(Math.abs(sx/baseX-1)+Math.abs(sy/baseY-1))+
      8*(Math.abs(a)+Math.abs(shear/baseX));
    return avg+penalty;
  }
  let best=[dims.width/2,dims.height/2,baseX,baseY,0,0];
  let bestScore=evaluate(best);
  if(!manual){
    const translations=[[0,0],[-.05,0],[.05,0],[0,-.05],[0,.05]];
    for(const [ox,oy] of translations){
      const seed=[dims.width*(.5+ox),dims.height*(.5+oy),baseX,baseY,0,0];
      const z=evaluate(seed);if(z<bestScore){best=seed;bestScore=z;}
    }
    let step=[dims.width*.025,dims.height*.025,baseX*.045,baseY*.045,.018,baseX*.015];
    for(let round=0;round<9;round++){
      for(let iter=0;iter<6;iter++){
        let improved=false;
        for(let j=0;j<6;j++)for(const direction of [-1,1]){
          const q=best.slice();q[j]+=direction*step[j];
          if(q[2]<baseX*.82||q[2]>baseX*1.18||
            q[3]<baseY*.82||q[3]>baseY*1.18||
            Math.abs(q[4])>.11||Math.abs(q[5])>baseX*.09||
            Math.abs(q[0]-dims.width/2)>dims.width*.16||
            Math.abs(q[1]-dims.height/2)>dims.height*.16)continue;
          const value=evaluate(q);
          if(value<bestScore){best=q;bestScore=value;improved=true;}
        }
        if(!improved)break;
      }
      step=step.map(v=>v*.55);
    }
  }
  return {best,quality:evaluate(best,true)};
}
function bilinear(pixels,w,h,x,y,out,index){
  if(x<0||y<0||x>=w-1||y>=h-1)return;
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const a=(iy*w+ix)*4,b=a+w*4;
  for(let c=0;c<3;c++)out[index+c]=Math.round(
    pixels[a+c]*(1-fx)*(1-fy)+pixels[a+4+c]*fx*(1-fy)+
    pixels[b+c]*(1-fx)*fy+pixels[b+4+c]*fx*fy);
  out[index+3]=255;
}
async function process(data){
  progress('Orienting printed sheet and extracting its continuous outline...');
  await tick();
  const img=makeGray(data),dims=img.dims;
  const manual=data.options.manual===true;
  progress(manual?'Applying full-page adjustments...':'Finding the full-page alignment (no panel cuts)...');
  await tick();
  const fit=align(img.gray,img.dw,img.dh,dims,manual);
  progress('Compositing the complete sheet at the exact master template position...');
  await tick();
  const opts=data.options;
  const cx=fit.best[0]+opts.shiftX*dims.width/1024;
  const cy=fit.best[1]+opts.shiftY*dims.height/1024;
  const sx=fit.best[2]*opts.scaleX,sy=fit.best[3]*opts.scaleY;
  const theta=fit.best[4]+opts.fineRotation*Math.PI/180;
  const cs=Math.cos(theta),sn=Math.sin(theta),shear=fit.best[5];
  const result=new Uint8ClampedArray(1024*1024*4);
  result.fill(255);
  for(let y=0;y<1024;y++){
    if(y%100===0)await tick();
    // Fixed, calibrated printed-sheet position matching the supplied KORA master.
    // Printed reference image is 725 x 1024; the master image is 1024 x 1024.
    const by=(y+54)/1.09-512;
    for(let x=0;x<1024;x++){
      const bx=(x-115)/1.10-362.5;
      const u=cx+(sx*bx+shear*by)*cs-sy*by*sn;
      const v=cy+(sx*bx+shear*by)*sn+sy*by*cs;
      const [rawX,rawY]=fromUpright(u,v,data.width,data.height,opts.rotation);
      bilinear(img.original,data.width,data.height,rawX,rawY,result,(y*1024+x)*4);
    }
  }
  self.postMessage({type:'complete',pixels:result.buffer,score:fit.quality.avg,
    nearEdges:fit.quality.good,samples:fit.quality.total},[result.buffer]);
}
self.onmessage=event=>{
  if(event.data?.type!=='align')return;
  process(event.data).catch(error=>self.postMessage({type:'error',message:String(error?.message||error)}));
};
