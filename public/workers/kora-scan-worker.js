'use strict';
// KORA scan normalization: pure JavaScript, no WASM, network libraries or keypoint matching.
// Each worker receives the original pixels, aligns the printed 32-panel net as a whole,
// and is terminated by the caller on timeout.
const PANEL_POLYGONS = [[[353,63],[400,97],[382,152],[325,152],[307,97]],[[250,84],[306,96],[321,140],[285,195],[229,183],[211,130]],[[458,85],[496,131],[477,184],[422,195],[383,150],[402,96]],[[324,152],[388,159],[412,201],[382,251],[322,247],[296,200]],[[413,202],[468,214],[475,271],[423,295],[383,252]],[[295,202],[324,253],[284,295],[233,272],[238,217]],[[325,252],[382,252],[411,300],[382,352],[325,352],[298,307]],[[478,329],[521,367],[507,425],[454,442],[411,403],[424,346]],[[229,329],[285,348],[296,404],[254,442],[197,422],[186,368]],[[324,354],[382,353],[400,408],[353,442],[307,408]],[[590,365],[623,417],[601,465],[544,471],[512,417],[534,371]],[[117,366],[174,372],[194,416],[163,472],[106,466],[85,420]],[[455,442],[509,425],[539,465],[509,518],[454,500]],[[402,414],[454,443],[454,500],[405,529],[353,500],[353,443]],[[302,414],[353,443],[353,500],[303,530],[253,500],[253,443]],[[198,426],[253,444],[253,500],[200,519],[164,473]],[[163,472],[196,524],[173,572],[116,577],[87,519],[107,477]],[[544,471],[601,477],[623,525],[591,577],[535,572],[511,523]],[[353,502],[400,536],[382,590],[325,590],[308,541]],[[454,501],[509,519],[521,576],[478,614],[422,595],[411,540]],[[253,501],[296,539],[283,597],[229,614],[186,575],[199,519]],[[324,591],[388,598],[412,640],[382,690],[322,686],[296,639]],[[295,641],[324,691],[284,734],[232,709],[238,654]],[[412,641],[470,661],[475,710],[422,734],[383,691]],[[325,691],[382,691],[411,739],[382,791],[325,791],[298,746]],[[422,748],[477,760],[496,815],[458,858],[402,847],[385,800]],[[285,748],[321,803],[305,847],[250,859],[211,816],[230,760]],[[324,793],[382,792],[400,847],[350,879],[307,847]],[[404,853],[454,882],[454,940],[404,969],[354,940],[354,882]],[[302,853],[353,882],[353,940],[303,969],[253,940],[253,882]],[[201,865],[253,883],[253,939],[198,958],[164,911]],[[509,864],[543,912],[508,958],[454,939],[454,883]]];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const report = message => self.postMessage({type:'progress',message});
function grayImage(packet, maxDimension=680) {
  const factor = Math.min(1,maxDimension/Math.max(packet.width,packet.height));
  const width=Math.max(1,Math.round(packet.width*factor));
  const height=Math.max(1,Math.round(packet.height*factor));
  const values=new Uint8Array(width*height);
  const src=new Uint8ClampedArray(packet.pixels);
  for(let y=0;y<height;y++){
    const sy=Math.min(packet.height-1,Math.round((y+.5)*packet.height/height-.5));
    for(let x=0;x<width;x++){
      const sx=Math.min(packet.width-1,Math.round((x+.5)*packet.width/width-.5));
      const k=4*(sy*packet.width+sx);
      values[y*width+x]=Math.round(.299*src[k]+.587*src[k+1]+.114*src[k+2]);
    }
  }
  return {values,width,height,ratioX:width/packet.width,ratioY:height/packet.height};
}
function edgeDistance(image) {
  const {values,width:w,height:h}=image;
  const inf=900;
  const distance=new Uint16Array(w*h);
  distance.fill(inf);
  for(let y=1;y<h-1;y++)
    for(let x=1;x<w-1;x++){
      const i=y*w+x;
      const horizontal=Math.abs(values[i+1]-values[i-1]);
      const vertical=Math.abs(values[i+w]-values[i-w]);
      if(horizontal+vertical>38)distance[i]=0;
    }
  // 3-4 chamfer transform, two sweeps. Costs are in thirds of a pixel.
  for(let y=1;y<h;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;
    distance[i]=Math.min(distance[i],distance[i-1]+3,
      distance[i-w]+3,distance[i-w-1]+4,distance[i-w+1]+4);
  }
  for(let y=h-2;y>=0;y--)for(let x=w-2;x>=1;x--){
    const i=y*w+x;
    distance[i]=Math.min(distance[i],distance[i+1]+3,
      distance[i+w]+3,distance[i+w-1]+4,distance[i+w+1]+4);
  }
  return distance;
}
function boundarySamples() {
  const points=[];
  // The reference coordinates originate from the original blank KORA sheet (725x1024).
  // Sample across the complete net, not just repeated ORB descriptors.
  for(const poly of PANEL_POLYGONS)for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    const count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/5));
    for(let k=0;k<count;k++) {
      const t=k/count;
      points.push([(a[0]*(1-t)+b[0]*t)-362.5,(a[1]*(1-t)+b[1]*t)-512]);
    }
  }
  return points;
}
const POINTS=boundarySamples();
function fitSheet(blank,target,label) {
  const img=grayImage(target),dist=edgeDistance(img);
  const w=target.width,h=target.height;
  const isTexture=label==='Texture';
  // The 32 panel polygons are defined in a *fixed 725x1024 coordinate system*.
  // Never divide scale by the uploaded blank PDF raster height: PDF.js may render
  // it at any device resolution, producing an incorrect fitted zoom.
  //
  // Scan input can be rotated by 0/90/180/270 degrees by WhatsApp scanners.
  // The canonical texture has one fixed upright orientation and is never rotated.
  const angles=isTexture?[0]:[0,Math.PI/2,Math.PI,-Math.PI/2];
  const score=(p,detailed=false)=>{
    const [cx,cy,sx,sy,angle]=p;
    const cs=Math.cos(angle),sn=Math.sin(angle);
    const stride=detailed?1:2;
    const bands=new Uint16Array(8);
    const totals=new Uint16Array(8);
    let error=0,good=0,valid=0,total=0;
    for(let i=0;i<POINTS.length;i+=stride){
      const xx=POINTS[i][0],yy=POINTS[i][1];
      const x=(cx+sx*(xx*cs-yy*sn))*img.ratioX;
      const y=(cy+sy*(xx*sn+yy*cs))*img.ratioY;
      const ix=Math.round(x),iy=Math.round(y);
      let d=20;
      if(ix>=1&&iy>=1&&ix<img.width-1&&iy<img.height-1){
        valid++;
        d=dist[iy*img.width+ix]/3;
      }
      const band=Math.min(7,Math.max(0,Math.floor((yy+512)/128)));
      totals[band]++;
      if(d<2.8){good++;bands[band]++;}
      error+=Math.min(12,d);
      total++;
    }
    if(detailed){
      const covered=Array.from(bands).filter((n,i)=>totals[i]>0&&n/totals[i]>.16).length;
      return {avg:error/total,good,valid,count:total,bands:covered};
    }
    return error/total;
  };
  let best=null,bestScore=Infinity;
  // Allow translation and small per-axis scaling variation for scanner crops.
  // For 90-degree rotations, calculate the starting scale from the swapped net bounds.
  for(const angle of angles){
    const rotated=Math.abs(Math.sin(angle))>.8;
    const netWidth=rotated?920:620,netHeight=rotated?620:920;
    const baseScale=Math.min(w/netWidth,h/netHeight);
    const positions=[
      [w*.5,h*.5],
      [w*.48,h*.5],[w*.52,h*.5],
      [w*.5,h*.48],[w*.5,h*.52]
    ];
    for(const [cx,cy] of positions){
      let candidate=[cx,cy,baseScale,baseScale,angle];
      let value=score(candidate);
      let step=[Math.max(2,w*.035),Math.max(2,h*.035),
        baseScale*.065,baseScale*.065,.04];
      for(let round=0;round<8;round++){
        let changed=true,iteration=0;
        while(changed&&iteration++<5){
          changed=false;
          for(let j=0;j<5;j++)for(const dir of [-1,1]){
            const q=candidate.slice();
            q[j]+=dir*step[j];
            if(q[2]<baseScale*.82||q[2]>baseScale*1.18||
               q[3]<baseScale*.82||q[3]>baseScale*1.18||
               Math.abs(q[4]-angle)>.10)continue;
            const v=score(q);
            if(v<value){candidate=q;value=v;changed=true;}
          }
        }
        step=step.map(v=>v*.55);
      }
      if(value<bestScore){bestScore=value;best=candidate;}
    }
  }
  if(!best)throw Error(label+' could not find a plausible page orientation.');
  const quality=score(best,true);
  const rotation=Math.round(best[4]*180/Math.PI);
  report(label+': rotation '+rotation+'°, outline score '+quality.avg.toFixed(2)+
    ', '+quality.good+'/'+quality.count+' close points, '+quality.bands+'/8 page bands.');
  if(quality.valid/quality.count<.92||quality.avg>4.0||
     quality.good/quality.count<.30||quality.bands<6){
    throw Error(label+' outline alignment failed validation (rotation '+rotation+
      '°, '+quality.good+'/'+quality.count+' close points across '+quality.bands+
      '/8 regions). Refusing to export a damaged texture.');
  }
  return {params:best,quality};
}
function toTemplate(x,y,params) {
  const [cx,cy,sx,sy,angle]=params,cs=Math.cos(angle),sn=Math.sin(angle);
  const u=(x-cx)/sx,v=(y-cy)/sy;
  return [u*cs+v*sn+362.5,-u*sn+v*cs+512];
}
function fromTemplate(x,y,params) {
  const [cx,cy,sx,sy,angle]=params,cs=Math.cos(angle),sn=Math.sin(angle);
  const dx=x-362.5,dy=y-512;
  return [cx+sx*(dx*cs-dy*sn),cy+sy*(dx*sn+dy*cs)];
}
function mask() {
  const canvas=new OffscreenCanvas(725,1024),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#000';ctx.fillRect(0,0,725,1024);
  ctx.fillStyle='#fff';ctx.strokeStyle='#fff';ctx.lineJoin='round';ctx.lineWidth=9;
  for(const polygon of PANEL_POLYGONS){
    ctx.beginPath();ctx.moveTo(polygon[0][0],polygon[0][1]);
    for(let i=1;i<polygon.length;i++)ctx.lineTo(polygon[i][0],polygon[i][1]);
    ctx.closePath();ctx.fill();ctx.stroke();
  }
  const data=ctx.getImageData(0,0,725,1024).data,mask=new Uint8Array(725*1024);
  for(let i=0;i<mask.length;i++)mask[i]=data[i*4]>127?1:0;
  return mask;
}
function colorAt(source,pixels,x,y,out,index) {
  const w=source.width,h=source.height;
  if(x<0||y<0||x>=w-1||y>=h-1)return;
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  const a=(iy*w+ix)*4,b=a+w*4;
  for(let k=0;k<3;k++)
    out[index+k]=Math.round(
      pixels[a+k]*(1-fx)*(1-fy)+pixels[a+4+k]*fx*(1-fy)+
      pixels[b+k]*(1-fx)*fy+pixels[b+4+k]*fx*fy);
  out[index+3]=255;
}
async function normalize({scan,blank,master}) {
  report('Analyzing printed panel outlines on child scan...');
  await tick();
  const scanFit=fitSheet(blank,scan,'Scan');
  report('Locating the canonical layout in the texture...');
  await tick();
  const masterFit=fitSheet(blank,master,'Texture');
  const valid=mask(),original=new Uint8ClampedArray(scan.pixels);
  const result=new Uint8ClampedArray(1024*1024*4);
  result.fill(255);
  report('Warping child artwork into the exact 1024×1024 template...');
  await tick();
  for(let y=0;y<1024;y++){
    if(y%128===0)await tick();
    for(let x=0;x<1024;x++){
      const [bx,by]=toTemplate(x*master.width/1024,y*master.height/1024,masterFit.params);
      const xi=Math.round(bx),yi=Math.round(by);
      if(xi<0||yi<0||xi>=725||yi>=1024||!valid[yi*725+xi])continue;
      const [sx,sy]=fromTemplate(bx,by,scanFit.params);
      colorAt(scan,original,sx,sy,result,(y*1024+x)*4);
    }
  }
  self.postMessage({type:'complete',pixels:result.buffer,panels:32,
    scanInliers:scanFit.quality.good,scanMatches:scanFit.quality.count,
    masterInliers:masterFit.quality.good,masterMatches:masterFit.quality.count},
    [result.buffer]);
}
self.onmessage=event=>{
  if(event.data?.type!=='normalize')return;
  normalize(event.data).catch(error=>{
    self.postMessage({type:'error',message:String(error?.message||error)});
  });
};
