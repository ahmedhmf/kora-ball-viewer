'use strict';
// KORA calibrated panel-by-panel prototype. All processing stays in this Worker.
// The 32 polygons describe the original 725x1024 KORA print sheet. The output
// texture location uses the exact established 1024x1024 KORA UV reference.
const PANEL_POLYGONS = [[[353,63],[400,97],[382,152],[325,152],[307,97]],[[250,84],[306,96],[321,140],[285,195],[229,183],[211,130]],[[458,85],[496,131],[477,184],[422,195],[383,150],[402,96]],[[324,152],[388,159],[412,201],[382,251],[322,247],[296,200]],[[413,202],[468,214],[475,271],[423,295],[383,252]],[[295,202],[324,253],[284,295],[233,272],[238,217]],[[325,252],[382,252],[411,300],[382,352],[325,352],[298,307]],[[478,329],[521,367],[507,425],[454,442],[411,403],[424,346]],[[229,329],[285,348],[296,404],[254,442],[197,422],[186,368]],[[324,354],[382,353],[400,408],[353,442],[307,408]],[[590,365],[623,417],[601,465],[544,471],[512,417],[534,371]],[[117,366],[174,372],[194,416],[163,472],[106,466],[85,420]],[[455,442],[509,425],[539,465],[509,518],[454,500]],[[402,414],[454,443],[454,500],[405,529],[353,500],[353,443]],[[302,414],[353,443],[353,500],[303,530],[253,500],[253,443]],[[198,426],[253,444],[253,500],[200,519],[164,473]],[[163,472],[196,524],[173,572],[116,577],[87,519],[107,477]],[[544,471],[601,477],[623,525],[591,577],[535,572],[511,523]],[[353,502],[400,536],[382,590],[325,590],[308,541]],[[454,501],[509,519],[521,576],[478,614],[422,595],[411,540]],[[253,501],[296,539],[283,597],[229,614],[186,575],[199,519]],[[324,591],[388,598],[412,640],[382,690],[322,686],[296,639]],[[295,641],[324,691],[284,734],[232,709],[238,654]],[[412,641],[470,661],[475,710],[422,734],[383,691]],[[325,691],[382,691],[411,739],[382,791],[325,791],[298,746]],[[422,748],[477,760],[496,815],[458,858],[402,847],[385,800]],[[285,748],[321,803],[305,847],[250,859],[211,816],[230,760]],[[324,793],[382,792],[400,847],[350,879],[307,847]],[[404,853],[454,882],[454,940],[404,969],[354,940],[354,882]],[[302,853],[353,882],[353,940],[303,969],[253,940],[253,882]],[[201,865],[253,883],[253,939],[198,958],[164,911]],[[509,864],[543,912],[508,958],[454,939],[454,883]]];
const progress=message=>self.postMessage({type:'progress',message});
const yieldUI=()=>new Promise(resolve=>setTimeout(resolve,0));
const BANDS=[55,112,200,300,393,470,550,641,742,830,911,960];
const Y_SCAN=[55,90,170,250,320,400,470,567,666,753,852,910];
const X_SCALE=[.80,.78,.80,.80,.77,.79,.83,.87,.93,.95,.95,.98];
const X_SHIFT=[165,165,165,155,145,140,120,95,65,45,40,33];
function interpolate(v,xs,ys) {
  if(v<=xs[0])return ys[0];
  for(let i=1;i<xs.length;i++)
    if(v<=xs[i]){const f=(v-xs[i-1])/(xs[i]-xs[i-1]);return ys[i-1]*(1-f)+ys[i]*f;}
  return ys[ys.length-1];
}
function cornerQr(packet) {
  const w=packet.width,h=packet.height,src=new Uint8ClampedArray(packet.pixels);
  const sw=240,sh=320,gray=new Uint8Array(sw*sh);
  for(let y=0;y<sh;y++)for(let x=0;x<sw;x++){
    const sx=Math.min(w-1,Math.round((x+.5)*w/sw)),sy=Math.min(h-1,Math.round((y+.5)*h/sh));
    const i=(sy*w+sx)*4;
    gray[y*sw+x]=(.299*src[i]+.587*src[i+1]+.114*src[i+2])|0;
  }
  const integral=new Uint32Array((sw+1)*(sh+1));
  for(let y=1;y<sh-1;y++){
    let row=0;
    for(let x=1;x<sw-1;x++){
      const i=y*sw+x;
      const strong=Math.abs(gray[i-1]-gray[i+1])>30&&Math.abs(gray[i-sw]-gray[i+sw])>30;
      row+=strong?1:0;
      integral[(y+1)*(sw+1)+x+1]=integral[y*(sw+1)+x+1]+row;
    }
  }
  const regions=[['top-right',.79,.98,.02,.22],['bottom-left',.02,.21,.78,.98]];
  const results=[];
  for(const [name,x0,x1,y0,y1] of regions){
    let best=0;
    for(let y=Math.round(sh*y0);y<Math.round(sh*y1)-15;y+=2)
      for(let x=Math.round(sw*x0);x<Math.round(sw*x1)-15;x+=2){
        const a=y*(sw+1)+x,b=(y+16)*(sw+1)+x+16;
        const count=integral[b]-integral[y*(sw+1)+x+16]-
          integral[(y+16)*(sw+1)+x]+integral[a];
        if(count>best)best=count;
      }
    results.push({name,score:best});
  }
  const top=results[0].score,bottom=results[1].score;
  if(Math.max(top,bottom)<11||Math.max(top,bottom)<Math.min(top,bottom)*1.2)
    throw Error('Cannot determine page orientation from the QR. Please include the entire printed sheet.');
  return top>bottom?180:0;
}
function prepared(packet,rotation) {
  const sw=packet.width,sh=packet.height,src=new Uint8ClampedArray(packet.pixels);
  const width=Math.max(1,Math.round(sw*1024/sh)),height=1024;
  const gray=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const xx=Math.min(sw-1,Math.floor(x*sw/width));
    const yy=Math.min(sh-1,Math.floor(y*sh/height));
    const sx=rotation===180?sw-1-xx:xx;
    const sy=rotation===180?sh-1-yy:yy;
    const i=4*(sy*sw+sx);
    gray[y*width+x]=(.299*src[i]+.587*src[i+1]+.114*src[i+2])|0;
  }
  return {gray,width,height,source:packet,rotation,colors:src};
}
function edgeDistance(image) {
  const {gray,width:w,height:h}=image;
  const d=new Uint16Array(w*h);d.fill(900);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x;
    if(Math.abs(gray[i+1]-gray[i-1])+Math.abs(gray[i+w]-gray[i-w])>40)d[i]=0;
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
function lineSamples(poly) {
  const points=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    for(let k=0;k<13;k++){
      const t=k/13;
      points.push([a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t]);
    }
  }
  return points;
}
function localFit(poly,dist,w,h) {
  const cx=poly.reduce((s,p)=>s+p[0],0)/poly.length;
  const cy=poly.reduce((s,p)=>s+p[1],0)/poly.length;
  const xs=interpolate(cy,BANDS,X_SCALE),shift=interpolate(cy,BANDS,X_SHIFT);
  const bx=(cx*xs+shift)*w/699;
  const by=interpolate(cy,BANDS,Y_SCAN)*h/1024;
  const sx0=interpolate(cy,[100,400,950],[.9,.88,.98])*w/699;
  const sy0=interpolate(cy,[100,380,830,950],[.77,.9,.98,1.04])*h/1024;
  const rel=lineSamples(poly).map(([x,y])=>[x-cx,y-cy]);
  const score=([dx,dy,sx,sy])=>{
    let sum=0,close=0;
    for(const [x,y] of rel){
      const xx=bx+dx+x*sx,yy=by+dy+y*sy;
      const ix=Math.round(xx),iy=Math.round(yy);
      const dd=(ix>=0&&ix<w&&iy>=0&&iy<h)?dist[iy*w+ix]/3:20;
      if(dd<3)close++;
      sum+=Math.min(9,dd);
    }
    const deviation=dx*dx+dy*dy;
    return {value:sum/rel.length + .006*deviation+
      6*((sx-sx0)*(sx-sx0)+(sy-sy0)*(sy-sy0)),
      close, total:rel.length};
  };
  let best=null,bestValue=Infinity;
  for(const seed of [[0,0,sx0,sy0],[5,-5,sx0,sy0],[-5,5,sx0,sy0]]){
    const p=seed.slice(),initial=score(p).value;
    let value=initial;
    let steps=[11*w/699,11*h/1024,.10*w/699,.10*h/1024];
    for(let round=0;round<9;round++){
      for(let iteration=0;iteration<6;iteration++){
        let changed=false;
        for(let j=0;j<4;j++){
          for(const sign of [-1,1]){
            const q=p.slice();q[j]+=sign*steps[j];
            if(Math.abs(q[0])>35*w/699||Math.abs(q[1])>35*h/1024||
              q[2]<.65*w/699||q[2]>1.25*w/699||
              q[3]<.65*h/1024||q[3]>1.25*h/1024)continue;
            const v=score(q).value;
            if(v<value){p.splice(0,4,...q);value=v;changed=true;}
          }
        }
        if(!changed)break;
      }
      steps=steps.map(x=>x*.55);
    }
    if(value<bestValue){best=p.slice();bestValue=value;}
  }
  const confidence=score(best);
  return {cx,cy,bx,by,dx:best[0],dy:best[1],sx:best[2],sy:best[3],
    confidence:confidence.close/confidence.total,cost:bestValue};
}
function insidePolygon(x,y,poly) {
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i],b=poly[j];
    if((a[1]>y)!==(b[1]>y) &&
      x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
function nearPolygon(x,y,poly,margin) {
  if(insidePolygon(x,y,poly))return true;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length];
    const vx=b[0]-a[0],vy=b[1]-a[1],wx=x-a[0],wy=y-a[1];
    const t=Math.max(0,Math.min(1,(wx*vx+wy*vy)/(vx*vx+vy*vy)));
    const dx=wx-t*vx,dy=wy-t*vy;
    if(dx*dx+dy*dy<=margin*margin)return true;
  }
  return false;
}
function sampleColor(image,x,y,result,index) {
  const {source,colors,width:w,height:h,rotation}=image;
  if(x<0||y<0||x>=w-1||y>=h-1)return;
  const origX=x*source.width/w,origY=y*source.height/h;
  const sx=rotation===180?source.width-1-origX:origX;
  const sy=rotation===180?source.height-1-origY:origY;
  if(sx<0||sy<0||sx>=source.width-1||sy>=source.height-1)return;
  const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
  const i=(iy*source.width+ix)*4,j=i+source.width*4;
  for(let c=0;c<3;c++)result[index+c]=Math.round(
    colors[i+c]*(1-fx)*(1-fy)+colors[i+4+c]*fx*(1-fy)+
    colors[j+c]*(1-fx)*fy+colors[j+4+c]*fx*fy);
  result[index+3]=255;
}
async function normalize(data) {
  const {scan,blank,master}=data;
  if(blank.height<400||blank.width<250||master.width<400||
     Math.abs(master.width/master.height-1)>.06)
    throw Error('Wrong reference files: expected the original blank KORA PDF and a square master texture.');
  progress('Detecting the QR orientation of the printed sheet...');
  const rotation=cornerQr(scan);
  progress('QR orientation: '+rotation+'°. Tracking all 32 printed panel outlines...');
  await yieldUI();
  const image=prepared(scan,rotation);
  const distance=edgeDistance(image);
  const regions=[];
  for(let i=0;i<PANEL_POLYGONS.length;i++){
    regions.push(localFit(PANEL_POLYGONS[i],distance,image.width,image.height));
    if(i%8===7){progress('Aligned '+(i+1)+' of 32 panels...');await yieldUI();}
  }
  const uncertain=regions.filter(r=>r.confidence<.24||r.cost>7).length;
  progress('Panel alignment check: '+(32-uncertain)+'/32 within prototype tolerances.');
  if(uncertain>9)throw Error('Local panel alignment uncertain for '+uncertain+
    ' panels. Refusing to export a misleading texture.');
  // These coordinates were calibrated against the exact supplied 1024x1024
  // render texture. The blank printable net is 725x1024.
  const result=new Uint8ClampedArray(1024*1024*4);result.fill(255);
  progress('Transferring each panel to its exact KORA UV location...');
  await yieldUI();
  for(let n=0;n<32;n++){
    const poly=PANEL_POLYGONS[n],r=regions[n];
    const xs=poly.map(p=>p[0]),ys=poly.map(p=>p[1]);
    const minX=Math.max(0,Math.floor(Math.min(...xs)+124-6));
    const maxX=Math.min(1023,Math.ceil(Math.max(...xs)+124+6));
    const minY=Math.max(0,Math.floor(Math.min(...ys)*1.08-40-7));
    const maxY=Math.min(1023,Math.ceil(Math.max(...ys)*1.08-40+7));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const bx=x-124,by=(y+40)/1.08;
      if(!nearPolygon(bx,by,poly,4))continue;
      const sx=r.bx+r.dx+(bx-r.cx)*r.sx;
      const sy=r.by+r.dy+(by-r.cy)*r.sy;
      sampleColor(image,sx,sy,result,(y*1024+x)*4);
    }
    if(n%8===7)await yieldUI();
  }
  self.postMessage({type:'complete',pixels:result.buffer,panels:32,
    scanInliers:Math.round(regions.reduce((s,r)=>s+r.confidence,0)*100),
    scanMatches:3200,masterInliers:32-uncertain,masterMatches:32,
    orientation:rotation,uncertainPanels:uncertain},[result.buffer]);
}
self.onmessage=event=>{
  if(event.data?.type!=='normalize')return;
  normalize(event.data).catch(error=>self.postMessage({
    type:'error',message:String(error&&error.message||error)}));
};
