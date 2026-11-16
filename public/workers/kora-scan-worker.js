'use strict';
// Browser-only JSFeat worker. No OpenCV.js or WASM initialization.
const LIB = '/vendor/jsfeat.min.js';
let lib;
function stage(message) { self.postMessage({type:'progress',message}); }
function verify() {
  if (lib) return lib;
  stage('Loading local JavaScript feature matcher (no WebAssembly)...');
  // JSFeat 0.0.8 is a legacy browser bundle whose UMD wrapper references
  // a global `window`. Workers expose `self` instead, so provide that alias
  // *before* evaluating the library. It has no DOM dependency for these APIs.
  self.window = self;
  try {
    importScripts(LIB);
  } catch (error) {
    throw new Error('Could not initialize JSFeat in worker: ' + String(error));
  }
  lib = self.jsfeat || self.window.jsfeat;
  if (!lib || !lib.orb || !lib.motion_estimator)
    throw Error('JSFeat did not initialize. Check /vendor/jsfeat.min.js.');
  return lib;
}
const PANEL_POLYGONS = [[[353,63],[400,97],[382,152],[325,152],[307,97]],[[250,84],[306,96],[321,140],[285,195],[229,183],[211,130]],[[458,85],[496,131],[477,184],[422,195],[383,150],[402,96]],[[324,152],[388,159],[412,201],[382,251],[322,247],[296,200]],[[413,202],[468,214],[475,271],[423,295],[383,252]],[[295,202],[324,253],[284,295],[233,272],[238,217]],[[325,252],[382,252],[411,300],[382,352],[325,352],[298,307]],[[478,329],[521,367],[507,425],[454,442],[411,403],[424,346]],[[229,329],[285,348],[296,404],[254,442],[197,422],[186,368]],[[324,354],[382,353],[400,408],[353,442],[307,408]],[[590,365],[623,417],[601,465],[544,471],[512,417],[534,371]],[[117,366],[174,372],[194,416],[163,472],[106,466],[85,420]],[[455,442],[509,425],[539,465],[509,518],[454,500]],[[402,414],[454,443],[454,500],[405,529],[353,500],[353,443]],[[302,414],[353,443],[353,500],[303,530],[253,500],[253,443]],[[198,426],[253,444],[253,500],[200,519],[164,473]],[[163,472],[196,524],[173,572],[116,577],[87,519],[107,477]],[[544,471],[601,477],[623,525],[591,577],[535,572],[511,523]],[[353,502],[400,536],[382,590],[325,590],[308,541]],[[454,501],[509,519],[521,576],[478,614],[422,595],[411,540]],[[253,501],[296,539],[283,597],[229,614],[186,575],[199,519]],[[324,591],[388,598],[412,640],[382,690],[322,686],[296,639]],[[295,641],[324,691],[284,734],[232,709],[238,654]],[[412,641],[470,661],[475,710],[422,734],[383,691]],[[325,691],[382,691],[411,739],[382,791],[325,791],[298,746]],[[422,748],[477,760],[496,815],[458,858],[402,847],[385,800]],[[285,748],[321,803],[305,847],[250,859],[211,816],[230,760]],[[324,793],[382,792],[400,847],[350,879],[307,847]],[[404,853],[454,882],[454,940],[404,969],[354,940],[354,882]],[[302,853],[353,882],[353,940],[303,969],[253,940],[253,882]],[[201,865],[253,883],[253,939],[198,958],[164,911]],[[509,864],[543,912],[508,958],[454,939],[454,883]]];
function pixelsToGray(js, packet, size=960) {
  const scale = Math.min(1,size / Math.max(packet.width, packet.height));
  const w = Math.max(1,Math.round(packet.width*scale));
  const h = Math.max(1,Math.round(packet.height*scale));
  const matrix = new js.matrix_t(w,h,js.U8_t | js.C1_t);
  const data = new Uint8ClampedArray(packet.pixels);
  for (let y=0;y<h;y++){
    const sy = Math.min(packet.height-1, Math.floor(y*packet.height/h));
    for (let x=0;x<w;x++){
      const sx = Math.min(packet.width-1, Math.floor(x*packet.width/w));
      const pos=4*(sy*packet.width+sx);
      matrix.data[y*w+x]=Math.round(.299*data[pos]+.587*data[pos+1]+.114*data[pos+2]);
    }
  }
  return {gray:matrix,xScale:packet.width/w,yScale:packet.height/h};
}
function detect(js, packet) {
  const res=pixelsToGray(js, packet);
  const gray=res.gray;
  const corners = [];
  // JSFeat writes detected keypoints into caller-allocated slots.
  for(let i=0;i<20000;i++)corners.push(new js.keypoint_t(0,0,0,0));
  js.fast_corners.set_threshold(15);
  let n=js.fast_corners.detect(gray,corners,15);
  if(n<30)throw Error('Could not find enough corners on a print. Check scan quality.');
  corners.length=n;
  corners.sort((a,b)=>b.score-a.score);
  // Spatially distributed keypoints help avoid matches concentrated around the QR code.
  const chosen=[],cellCounts=new Uint8Array(12*12);
  for(const kp of corners){
    const cx=Math.min(11,Math.floor(kp.x*12/gray.cols));
    const cy=Math.min(11,Math.floor(kp.y*12/gray.rows));
    const ci=cy*12+cx;
    if(cellCounts[ci]>=7)continue;
    cellCounts[ci]++;
    chosen.push(kp);
    if(chosen.length>=550)break;
  }
  const desc=new js.matrix_t(32,chosen.length,js.U8_t | js.C1_t);
  js.orb.describe(gray,chosen,chosen.length,desc);
  return {keypoints:chosen,descriptors:desc,xScale:res.xScale,yScale:res.yScale};
}
const bits = new Uint8Array(256);
for(let i=0;i<256;i++){let v=i,c=0;while(v){v&=v-1;c++;}bits[i]=c;}
function hamming(a, ai, b, bi) {
  let count=0;
  const da=a.descriptors.data, db=b.descriptors.data;
  for(let j=0;j<32;j++)count+=bits[da[ai*32+j]^db[bi*32+j]];
  return count;
}
function estimate(js, source, target) {
  const a = detect(js, source), b = detect(js, target);
  const candidates = [];
  // The source and target share the printed net, even if the child's coloring
  // changes most ORB descriptors. Ratio-test matching with a geometric gate
  // retains substantially more real correspondences than mutual-nearest matching.
  // The blank reference is page-shaped; the square master has white side margins.
  const targetIsMaster = target.width / target.height > .90;
  for (let i = 0; i < a.keypoints.length; i++) {
    let best = 999, second = 999, jBest = -1;
    const p = a.keypoints[i];
    const px = p.x * a.xScale, py = p.y * a.yScale;
    const expectedX = targetIsMaster
      ? px * target.height / source.height + (target.width - source.width * target.height / source.height) / 2
      : px * target.width / source.width;
    const expectedY = py * target.height / source.height;
    for (let j = 0; j < b.keypoints.length; j++) {
      const q = b.keypoints[j];
      const qx = q.x * b.xScale, qy = q.y * b.yScale;
      // Reject matches to completely different parts of this highly repetitive net.
      if (Math.abs(qx - expectedX) > target.width * .30 ||
          Math.abs(qy - expectedY) > target.height * .24) continue;
      const d = hamming(a, i, b, j);
      if (d < best) { second = best; best = d; jBest = j; }
      else if (d < second) second = d;
    }
    if (jBest < 0 || best > 125 || best >= .91 * second) continue;
    const q = b.keypoints[jBest];
    candidates.push({ from: {x: px, y: py},
      to: {x: q.x * b.xScale, y: q.y * b.yScale}, score: best });
  }
  candidates.sort((a, b) => a.score - b.score);
  // Keep every unique source and target descriptor at most once.
  const unique = [], destinationBins = new Set();
  for (const item of candidates) {
    const key = Math.round(item.to.x / 4) + ',' + Math.round(item.to.y / 4);
    if (destinationBins.has(key)) continue;
    destinationBins.add(key);
    unique.push(item);
    if (unique.length >= 350) break;
  }
  const count = unique.length;
  stage('Found ' + count + ' candidate outline matches; checking geometric consistency...');
  if (count < 12) throw Error('Only ' + count +
    ' candidate matches even after relaxed matching. The two pages may have different orientations.');
  const src = unique.map(m => m.from), dst = unique.map(m => m.to);
  const H = new js.matrix_t(3, 3, js.F32_t | js.C1_t);
  const mask = new js.matrix_t(count, 1, js.U8_t | js.C1_t);
  const kernel = new js.motion_model.homography2d();
  const ok = js.motion_estimator.ransac(
    new js.ransac_params_t(4, 6, .75, .99),
    kernel, src, dst, count, H, mask, 1200
  );
  const inliers = Array.from(mask.data).slice(0, count).filter(Boolean).length;
  if (!ok || inliers < 10 || inliers / count < .14)
    throw Error('Automatic registration needs more consistent panel matches: ' +
      inliers + ' of ' + count + ' candidates agreed.');
  const matrix = Array.from(H.data.slice(0, 9));
  if (!matrix.every(Number.isFinite))
    throw Error('Registration generated invalid perspective coordinates.');
  // Check mapped page center and four corners against the target bounds.
  const checks = [[0,0],[source.width,0],[source.width,source.height],
    [0,source.height],[source.width/2,source.height/2]];
  const mapped = checks.map(([x,y]) => apply(matrix,x,y));
  for (const [x,y] of mapped) {
    if (!Number.isFinite(x) || !Number.isFinite(y) ||
        x < -target.width * .65 || x > target.width * 1.65 ||
        y < -target.height * .65 || y > target.height * 1.65)
      throw Error('Registration was rejected because the projected page is distorted.');
  }
  stage('Confirmed ' + inliers + ' consistent matches out of ' + count + ' candidates.');
  return {H,matchCount:count,inliers};
}
function apply(M,x,y) {
  const d=M[6]*x+M[7]*y+M[8];
  if(!d||!Number.isFinite(d))return [-1,-1];
  return [(M[0]*x+M[1]*y+M[2])/d,(M[3]*x+M[4]*y+M[5])/d];
}
function makePanelMask() {
  const c=new OffscreenCanvas(725,1024),ctx=c.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='#000';ctx.fillRect(0,0,725,1024);
  ctx.fillStyle='#fff';ctx.strokeStyle='#fff';ctx.lineJoin='round';ctx.lineWidth=12;
  for(const polygon of PANEL_POLYGONS){
    ctx.beginPath();
    ctx.moveTo(polygon[0][0],polygon[0][1]);
    for(let i=1;i<polygon.length;i++)ctx.lineTo(polygon[i][0],polygon[i][1]);
    ctx.closePath();ctx.fill();ctx.stroke();
  }
  const rgba=ctx.getImageData(0,0,725,1024).data,mask=new Uint8Array(725*1024);
  for(let i=0;i<mask.length;i++)mask[i]=rgba[i*4]>100?1:0;
  return mask;
}
function sampleBilinear(scan, sourcePixels, x, y, out, oi) {
  const sw=scan.width,sh=scan.height;
  if(x<0||y<0||x>=sw-1||y>=sh-1)return;
  const px=sourcePixels;
  const a=Math.floor(x),b=Math.floor(y),tx=x-a,ty=y-b;
  const i=(b*sw+a)*4,j=i+sw*4;
  for(let c=0;c<3;c++){
    out[oi+c]=Math.round(
      px[i+c]*(1-tx)*(1-ty)+px[i+4+c]*tx*(1-ty)+
      px[j+c]*(1-tx)*ty+px[j+4+c]*tx*ty);
  }
  out[oi+3]=255;
}
async function process(payload) {
  const js=verify();
  const scan=payload.scan,blank=payload.blank,master=payload.master;
  stage('Matching printed blank to child scan...');
  await new Promise(r=>setTimeout(r,0));
  const scanMatch=estimate(js,blank,scan);
  stage('Matching printed blank to master texture...');
  await new Promise(r=>setTimeout(r,0));
  const masterMatch=estimate(js,blank,master);
  const invertedMaster=new js.matrix_t(3,3,js.F32_t|js.C1_t);
  js.matmath.invert_3x3(masterMatch.H,invertedMaster);
  const blankToScan=scanMatch.H.data;
  const resultMap=new js.matrix_t(3,3,js.F32_t|js.C1_t);
  js.matmath.multiply_3x3(resultMap,scanMatch.H,invertedMaster);
  const outputToScan=Array.from(resultMap.data.slice(0,9));
  const outputToBlank=Array.from(invertedMaster.data.slice(0,9));
  stage('Compositing the 32 panel regions into a 1024px texture...');
  await new Promise(r=>setTimeout(r,0));
  const panelMask=makePanelMask();
  const pixels=new Uint8ClampedArray(1024*1024*4);
  const scanPixels=new Uint8ClampedArray(scan.pixels);
  pixels.fill(255);
  for(let y=0;y<1024;y++){
    if(y%128===0)await new Promise(r=>setTimeout(r,0));
    const my=y*master.height/1024;
    for(let x=0;x<1024;x++){
      const mx=x*master.width/1024;
      const [bx,by]=apply(outputToBlank,mx,my);
      const xx=Math.round(bx*725/blank.width),yy=Math.round(by*1024/blank.height);
      if(xx<0||xx>=725||yy<0||yy>=1024||panelMask[yy*725+xx]===0)continue;
      const [sx,sy]=apply(outputToScan,mx,my);
      sampleBilinear(scan,scanPixels,sx,sy,pixels,(y*1024+x)*4);
    }
  }
  self.postMessage({type:'complete',pixels:pixels.buffer,panels:32,
    scanInliers:scanMatch.inliers,scanMatches:scanMatch.matchCount,
    masterInliers:masterMatch.inliers,masterMatches:masterMatch.matchCount},
    [pixels.buffer]);
}
self.onmessage=event=>{
  if(event.data?.type!=='normalize')return;
  process(event.data).catch(error=>self.postMessage({type:'error',message:String(error?.message||error)}));
};
