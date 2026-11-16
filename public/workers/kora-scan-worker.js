/* KORA foreground-free scan normalization worker.
 * No user image data is transmitted off-device. All OpenCV processing happens here.
 * The Angular caller enforces a 45-second watchdog and can terminate this worker.
 */
'use strict';
const CV_URL = 'https://docs.opencv.org/4.x/opencv.js';
const report = (message) => self.postMessage({type:'progress',message});
const fail = (error) => self.postMessage({type:'error',message:String(error && error.message || error)});
let cvPromise;
async function loadCV() {
  if (cvPromise) return cvPromise;
  cvPromise = (async () => {
    report('Loading OpenCV in a background worker...');
    if (!self.cv) importScripts(CV_URL);
    let api = self.cv;
    if (api && typeof api.then === 'function') api = await api;
    if (!api || typeof api.imread !== 'function') {
      api = await new Promise((resolve, reject) => {
        const start = Date.now();
        const poll = () => {
          if (self.cv && typeof self.cv.imread === 'function') resolve(self.cv);
          else if (Date.now() - start > 20000) reject(new Error('OpenCV initialization failed in worker'));
          else setTimeout(poll, 100);
        };
        poll();
      });
    }
    return api;
  })();
  return cvPromise;
}
function matFromPacket(cv, p) {
  return cv.matFromImageData(new ImageData(new Uint8ClampedArray(p.pixels),p.width,p.height));
}
function scaledGray(cv, p, limit=1050) {
  const scale = Math.min(1,limit/Math.max(p.width,p.height));
  const w = Math.max(1,Math.round(p.width*scale)),h=Math.max(1,Math.round(p.height*scale));
  const original = matFromPacket(cv,p), resized=new cv.Mat(),gray=new cv.Mat();
  try {
    cv.resize(original,resized,new cv.Size(w,h),0,0,cv.INTER_AREA);
    cv.cvtColor(resized,gray,cv.COLOR_RGBA2GRAY);
    return {gray, sx:p.width/w,sy:p.height/h};
  } finally {original.delete();resized.delete();}
}
function match(cv, a, b) {
  const ref=scaledGray(cv,a), target=scaledGray(cv,b);
  const k1=new cv.KeyPointVector(),k2=new cv.KeyPointVector();
  const d1=new cv.Mat(),d2=new cv.Mat(),empty=new cv.Mat(),pairs=new cv.DMatchVectorVector();
  let orb,matcher;
  try {
    orb=new cv.ORB(1800);
    orb.detectAndCompute(ref.gray,empty,k1,d1);
    orb.detectAndCompute(target.gray,empty,k2,d2);
    if(d1.empty()||d2.empty())throw Error('No matching panel outlines were detected.');
    matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
    matcher.knnMatch(d1,d2,pairs,2);
    const src=[],dst=[];
    for(let i=0;i<pairs.size();i++){
      const row=pairs.get(i);
      try {
        if(row.size()<2)continue;
        const first=row.get(0),second=row.get(1);
        if(first.distance>=.70*second.distance)continue;
        const p=k1.get(first.queryIdx).pt,q=k2.get(first.trainIdx).pt;
        src.push(p.x*ref.sx,p.y*ref.sy);
        dst.push(q.x*target.sx,q.y*target.sy);
      }finally{row.delete();}
    }
    const count=src.length/2;
    if(count<18)throw Error('Too few matching outlines ('+count+'). Check that the original blank print PDF matches the scan.');
    const s=cv.matFromArray(count,1,cv.CV_32FC2,src),d=cv.matFromArray(count,1,cv.CV_32FC2,dst),mask=new cv.Mat();
    try {
      const h=cv.findHomography(s,d,cv.RANSAC,5,mask),inliers=cv.countNonZero(mask);
      if(h.empty()||inliers<12||inliers/count<.24){
        h.delete();throw Error('Low-confidence automatic alignment ('+inliers+'/'+count+').');
      }
      return {h,inliers,matches:count};
    }finally{s.delete();d.delete();mask.delete();}
  }finally{
    ref.gray.delete();target.gray.delete();k1.delete();k2.delete();
    d1.delete();d2.delete();empty.delete();pairs.delete();orb?.delete();matcher?.delete();
  }
}
function panelMask(cv, packet) {
  const blank=matFromPacket(cv,packet),gray=new cv.Mat(),binary=new cv.Mat();
  const contours=new cv.MatVector(),hierarchy=new cv.Mat();
  const mask=cv.Mat.zeros(packet.height,packet.width,cv.CV_8UC1);
  let panels=0;
  try {
    cv.cvtColor(blank,gray,cv.COLOR_RGBA2GRAY);
    cv.threshold(gray,binary,238,255,cv.THRESH_BINARY_INV);
    cv.findContours(binary,contours,hierarchy,cv.RETR_LIST,cv.CHAIN_APPROX_SIMPLE);
    const scale=packet.height/1024;
    for(let i=0;i<contours.size();i++){
      const contour=contours.get(i),poly=new cv.Mat();
      try{
        const area=cv.contourArea(contour);
        cv.approxPolyDP(contour,poly,.025*cv.arcLength(contour,true),true);
        const box=cv.boundingRect(contour);
        if(area<3500*scale*scale||area>12500*scale*scale||
           poly.rows<5||poly.rows>8||
           box.width<50*scale||box.height<55*scale||
           box.x<packet.width*.09||box.x+box.width>packet.width*.94||
           box.y<packet.height*.025||box.y+box.height>packet.height*.97)continue;
        const polys=new cv.MatVector();
        try{
          polys.push_back(poly);
          cv.fillPoly(mask,polys,new cv.Scalar(255));
          panels++;
        }finally{polys.delete();}
      }finally{poly.delete();contour.delete();}
    }
    return {mask,panels};
  }catch(e){mask.delete();throw e;}
  finally{blank.delete();gray.delete();binary.delete();contours.delete();hierarchy.delete();}
}
async function normalize(message) {
  const cv=await loadCV();
  const {scan,blank,master}=message;
  report('Matching blank print to child scan...');
  // Let progress display before CPU-intensive OpenCV calls.
  await new Promise(resolve=>setTimeout(resolve,0));
  const scanMatch=match(cv,blank,scan);
  let masterMatch,inverse,composite,source,warped,blankMask,targetMask,expanded,output,zeroMat,kernel;
  try{
    report('Matching blank print to render texture...');
    await new Promise(resolve=>setTimeout(resolve,0));
    masterMatch=match(cv,blank,master);
    report('Warping scanned artwork to 1024 × 1024...');
    await new Promise(resolve=>setTimeout(resolve,0));
    inverse=new cv.Mat();
    if(cv.invert(scanMatch.h,inverse,cv.DECOMP_LU)===0)throw Error('Could not invert scan transform.');
    composite=new cv.Mat();zeroMat=cv.Mat.zeros(3,3,cv.CV_64FC1);
    cv.gemm(masterMatch.h,inverse,1,zeroMat,0,composite);
    source=matFromPacket(cv,scan);warped=new cv.Mat();
    cv.warpPerspective(source,warped,composite,new cv.Size(1024,1024),
      cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    report('Finding and expanding all panel boundaries...');
    await new Promise(resolve=>setTimeout(resolve,0));
    const panelsResult=panelMask(cv,blank);
    blankMask=panelsResult.mask;
    if(panelsResult.panels<28||panelsResult.panels>35)
      throw Error('Expected 32 football panels, detected '+panelsResult.panels+'.');
    targetMask=new cv.Mat();
    cv.warpPerspective(blankMask,targetMask,masterMatch.h,new cv.Size(1024,1024),
      cv.INTER_NEAREST,cv.BORDER_CONSTANT,new cv.Scalar(0));
    kernel=cv.getStructuringElement(cv.MORPH_ELLIPSE,new cv.Size(7,7));
    expanded=new cv.Mat();
    cv.dilate(targetMask,expanded,kernel);
    output=new cv.Mat(1024,1024,cv.CV_8UC4,new cv.Scalar(255,255,255,255));
    warped.copyTo(output,expanded);
    const pixels=new Uint8ClampedArray(output.data);
    self.postMessage({type:'complete',pixels:pixels.buffer,panels:panelsResult.panels,
      scanInliers:scanMatch.inliers,scanMatches:scanMatch.matches,
      masterInliers:masterMatch.inliers,masterMatches:masterMatch.matches},[pixels.buffer]);
  }finally{
    scanMatch.h.delete();masterMatch?.h.delete();inverse?.delete();composite?.delete();
    source?.delete();warped?.delete();blankMask?.delete();targetMask?.delete();
    expanded?.delete();output?.delete();zeroMat?.delete();kernel?.delete();
  }
}
self.onmessage=(event)=>{
  if(event.data?.type!=='normalize')return;
  normalize(event.data).catch(fail);
};
