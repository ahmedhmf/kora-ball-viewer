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
/**
 * Locate the unique printed QR-code region from its dense two-axis edge pattern.
 * The KORA blank print places it in the bottom-left; unlike the repeated
 * football panels this landmark determines the sheet's actual orientation.
 */
function locateQr(packet) {
  const image=grayImage(packet,1024);
  const {values:g,width:w,height:h}=image;
  // A QR finder region produces many strong horizontal AND vertical changes.
  const dense=new Uint8Array(w*h);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;
    if(Math.abs(g[i+1]-g[i-1])>18&&Math.abs(g[i+w]-g[i-w])>18)
      dense[i]=1;
  }
  const integral=new Uint32Array((w+1)*(h+1));
  for(let y=0;y<h;y++){
    let sum=0;
    for(let x=0;x<w;x++){
      sum+=dense[y*w+x];
      integral[(y+1)*(w+1)+x+1]=integral[y*(w+1)+x+1]+sum;
    }
  }
  const size=Math.max(22,Math.round(Math.min(w,h)*.058));
  const corners=[
    ['top-left', 0,Math.round(w*.17),0,Math.round(h*.22)],
    ['top-right',Math.round(w*.83),w,0,Math.round(h*.22)],
    ['bottom-left',0,Math.round(w*.17),Math.round(h*.78),h],
    ['bottom-right',Math.round(w*.83),w,Math.round(h*.78),h]
  ];
  const results=[];
  for(const [name,x0,x1,y0,y1] of corners){
    let best=-1,position=null;
    for(let y=Math.max(Math.round(y0)+size/2,2)|0;
        y<Math.min(Math.round(y1)-size/2,h-2);y+=3){
      for(let x=Math.max(Math.round(x0)+size/2,2)|0;
          x<Math.min(Math.round(x1)-size/2,w-2);x+=3){
        const left=x-(size>>1),top=y-(size>>1),right=left+size,bottom=top+size;
        const count=integral[bottom*(w+1)+right]-
          integral[top*(w+1)+right]-integral[bottom*(w+1)+left]+
          integral[top*(w+1)+left];
        if(count>best){best=count;position=[x/image.ratioX,y/image.ratioY];}
      }
    }
    results.push({corner:name,score:best,position});
  }
  results.sort((a,b)=>b.score-a.score);
  const winner=results[0],runner=results[1];
  // A QR-like feature must be distinctive; otherwise do not guess 180°.
  if(!winner.position||winner.score<20||winner.score<runner.score*1.45)
    throw Error('Cannot identify the printed QR orientation reliably. '+
      'Use the original full-page scan with the QR code visible.');
  return winner;
}

function fitSheet(blank,target,label) {
  const img=grayImage(target),dist=edgeDistance(img);
  const w=target.width,h=target.height;
  const isTexture=label==='Texture';
  let qr=null;
  let angle=0;
  if(!isTexture){
    qr=locateQr(target);
    angle={
      'bottom-left':0,
      'top-right':Math.PI,
      'top-left':Math.PI/2,
      'bottom-right':-Math.PI/2
    }[qr.corner];
    report('QR anchor found at '+qr.corner+
      '; correcting scan orientation by '+Math.round(angle*180/Math.PI)+'°.');
  }
  const xRef=40-362.5,yRef=928-512;
  const score=(p,detail=false)=>{
    const [cx,cy,sx,sy,a]=p;
    const cs=Math.cos(a),sn=Math.sin(a);
    const stride=detail?1:2;
    const bands=new Uint16Array(8),totals=new Uint16Array(8);
    let sum=0,good=0,valid=0,count=0;
    for(let i=0;i<POINTS.length;i+=stride){
      const [xx,yy]=POINTS[i];
      const x=(cx+sx*(xx*cs-yy*sn))*img.ratioX;
      const y=(cy+sy*(xx*sn+yy*cs))*img.ratioY;
      const ix=Math.round(x),iy=Math.round(y);
      let d=18;
      if(ix>=1&&iy>=1&&ix<img.width-1&&iy<img.height-1){
        valid++;d=dist[iy*img.width+ix]/3;
      }
      const band=Math.max(0,Math.min(7,Math.floor((yy+512)/128)));
      totals[band]++;
      if(d<3){good++;bands[band]++;}
      sum+=Math.min(12,d);count++;
    }
    const qx=cx+sx*(xRef*cs-yRef*sn);
    const qy=cy+sy*(xRef*sn+yRef*cs);
    const qrOffset=qr?Math.hypot(qx-qr.position[0],qy-qr.position[1]):0;
    if(detail)return {
      avg:sum/count,good,valid,count,qrOffset,
      bands:Array.from(bands).filter((n,i)=>totals[i]>0&&n/totals[i]>.16).length
    };
    // Unlike the old fit, don't let repetitive pentagons override the unique
    // page landmark. Fixes valid-looking but mirrored/upside-down outputs.
    return sum/count+qrOffset*.11;
  };
  let best=null,bestValue=Infinity;
  const sxCandidates=isTexture?[1.0,1.1,1.17]:[.66,.8,.95,1.1];
  const syCandidates=isTexture?[1.0,1.1,1.17]:[.75,.9,1.05,1.2];
  for(const xs of sxCandidates)for(const ys of syCandidates){
    const cx=qr?qr.position[0]-xs*(xRef*Math.cos(angle)-yRef*Math.sin(angle)):w*.5;
    const cy=qr?qr.position[1]-ys*(xRef*Math.sin(angle)+yRef*Math.cos(angle)):h*.5;
    const seed=[cx,cy,xs,ys,angle];
    // Scans may be non-uniformly resized by mobile scan apps.
    // Find a constrained local minimum around the QR-anchored seed.
    let candidate=seed.slice(),value=score(candidate);
    let step=[w*.023,h*.023,xs*.075,ys*.075,.025];
    for(let round=0;round<8;round++){
      let changed=true,iterations=0;
      while(changed&&iterations++<4){
        changed=false;
        for(let j=0;j<5;j++)for(const direction of [-1,1]){
          const next=candidate.slice();
          next[j]+=step[j]*direction;
          if(next[2]<.48||next[2]>1.4||
             next[3]<.55||next[3]>1.4||
             Math.abs(next[4]-angle)>.11)continue;
          const v=score(next);
          if(v<value){candidate=next;value=v;changed=true;}
        }
      }
      step=step.map(x=>x*.57);
    }
    if(value<bestValue){best=candidate;bestValue=value;}
  }
  if(!best)throw Error(label+' orientation alignment failed.');
  const quality=score(best,true);
  report(label+': orientation '+Math.round(best[4]*180/Math.PI)+
    '°, outlines '+quality.good+'/'+quality.count+
    ', covered bands '+quality.bands+'/8, QR error '+
    quality.qrOffset.toFixed(1)+'px.');
  if(quality.valid/quality.count<.93||quality.bands<6||
     quality.good/quality.count<.25||
     quality.avg>6.2||(qr&&quality.qrOffset>35)){
    throw Error(label+' alignment rejected: low confidence (only '+
      quality.good+'/'+quality.count+' close outline samples; '+
      quality.bands+'/8 bands; QR error '+quality.qrOffset.toFixed(0)+
      'px). No texture exported.');
  }
  return {params:best,quality,rotation:angle};
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
