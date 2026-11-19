import { Injectable } from '@angular/core';

export interface PaperQuad {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

export interface PaperDetection {
  topRight: number;
  bottomRight: number;
  confidence: 'detected' | 'uncertain';
  note: string;
}

/**
 * Local, browser-only paper detection. Unlike the removed net registration,
 * this never interprets football panels or changes any drawn content.
 *
 * The WhatsApp scan photographed a nearly white page on a slightly green
 * tabletop. The page meets the image's left/top/bottom border, while its
 * right edge is a long diagonal. Search for that paper/table chroma seam.
 * When it isn't measurable, keep the WHOLE frame instead of guessing a crop.
 */
@Injectable({ providedIn: 'root' })
export class PaperStraightenerService {
  detect(source: HTMLCanvasElement): PaperDetection {
    const targetWidth = 360;
    const targetHeight = Math.max(120, Math.round(targetWidth * source.height / source.width));
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Cannot read paper image');
    ctx.drawImage(source, 0, 0, targetWidth, targetHeight);
    const rgba = ctx.getImageData(0, 0, targetWidth, targetHeight).data;
    const chroma = new Float32Array(targetWidth * targetHeight);
    for (let y = 0; y < targetHeight; y++) {
      for (let x = 0; x < targetWidth; x++) {
        const p = (y * targetWidth + x) * 4;
        const r = rgba[p], g = rgba[p+1], b = rgba[p+2];
        chroma[y*targetWidth+x] = g - (r+b)*0.5;
      }
    }
    // Measure the same paper/table boundary used to correct the reference PDF.
    // Search for a *continuous slanted line*, not individual dark contours;
    // handwriting and the football net are much stronger than the faint edge.
    const y0=Math.round(targetHeight*.12), y1=Math.round(targetHeight*.90);
    const offset=Math.max(4,Math.round(targetWidth*.026));
    const rows:number[]=[];
    for(let y=y0;y<=y1;y+=4)rows.push(y);
    function scoreLine(top:number,bottom:number):{score:number;support:number}{
      const differences:number[]=[];
      let supported=0;
      for(const y of rows){
        const t=y/(targetHeight-1);
        const x=Math.round((top+(bottom-top)*t)*targetWidth);
        const inner=Math.max(0,Math.min(targetWidth-1,x-offset));
        const outer=Math.max(0,Math.min(targetWidth-1,x+offset));
        const delta=Math.max(-7,Math.min(7,
          chroma[y*targetWidth+outer]-chroma[y*targetWidth+inner]));
        differences.push(delta);
        if(delta>1.0)supported++;
      }
      differences.sort((a,b)=>a-b);
      const lo=Math.floor(differences.length*.2);
      const hi=Math.ceil(differences.length*.8);
      let sum=0;
      for(let j=lo;j<hi;j++)sum+=differences[j];
      return {score:sum/Math.max(1,hi-lo),support:supported/rows.length};
    }
    let best={score:-Infinity,top:1,bottom:1,support:0};
    for(let top=.84;top<=1.02;top+=.012){
      for(let bottom=.53;bottom<=.92;bottom+=.012){
        if(top-bottom<.09)continue;
        const candidate=scoreLine(top,bottom);
        if(candidate.score>best.score)
          best={score:candidate.score,top,bottom,support:candidate.support};
      }
    }
    // Refine both ends to sub-pixel precision on the downscaled scan.
    for(const step of [.006,.003]){
      let refined=best;
      for(const dt of [-2,-1,0,1,2]){
        for(const db of [-2,-1,0,1,2]){
          const top=best.top+dt*step,bottom=best.bottom+db*step;
          if(top<.75||top>1.05||bottom<.4||bottom>.98||top-bottom<.09)continue;
          const candidate=scoreLine(top,bottom);
          if(candidate.score>refined.score)
            refined={score:candidate.score,top,bottom,support:candidate.support};
        }
      }
      best=refined;
    }
    // Require a consistently visible boundary. If the photo is already
    // flattened or the tabletop has the same color, no automatic crop is safe.
    if(best.score>=1.35 && best.support>=.55){
      const top=Math.min(1,best.top),bottom=Math.min(1,best.bottom);
      return {
        topRight:top,
        bottomRight:bottom,
        confidence:'detected',
        note:'Paper edge found automatically: right edge at '+Math.round(top*100)+
          '% (top) and '+Math.round(bottom*100)+'% (bottom).'
      };
    }
    return {
      topRight:1,bottomRight:1,
      confidence:'uncertain',
      note:'Paper/table boundary could not be verified. Please upload the original PDF or a clearer full-page photo.'
    };
  }

  /** On this WhatsApp scan, the left/top/bottom paper edges meet the photo
   * bounds and the right edge is a long diagonal. One projective transform
   * straightens the entire sheet without editing football panels. */
  corners(source: HTMLCanvasElement, topRight: number, bottomRight: number): PaperQuad {
    const w=source.width-1,h=source.height-1;
    return {
      topLeft:{x:0,y:0},
      topRight:{x:w*topRight,y:0},
      bottomRight:{x:w*bottomRight,y:h},
      bottomLeft:{x:0,y:h}
    };
  }


  /**
   * Orient the PRINTED KORA paper using its unique QR marker. Upright KORA
   * prints have the QR at bottom-left, regardless of children's handwriting.
   * Uses native BarcodeDetector when available; otherwise checks QR-like
   * cross-directional edge density in all four page corners.
   */
  async orientPrintedSheet(source: HTMLCanvasElement): Promise<{
    canvas: HTMLCanvasElement;
    angle: 0 | 90 | 180 | 270;
    reliable: boolean;
  }> {
    let angle: 0 | 90 | 180 | 270 = 0;
    let reliable = false;
    const rotateForCorner = (corner: number): 0 | 90 | 180 | 270 =>
      ([270, 180, 0, 90] as const)[corner];
    const Detector = (window as any).BarcodeDetector;
    if (typeof Detector === 'function') {
      try {
        const found: any[] = await new Detector({ formats: ['qr_code'] }).detect(source);
        if (found.length === 1 && found[0].boundingBox) {
          const box = found[0].boundingBox;
          const cx = (box.x + box.width / 2) / source.width;
          const cy = (box.y + box.height / 2) / source.height;
          if ((cx < .35 || cx > .65) && (cy < .35 || cy > .65)) {
            const corner = (cy > .5 ? 2 : 0) + (cx > .5 ? 1 : 0);
            angle = rotateForCorner(corner);
            reliable = true;
          }
        }
      } catch { /* Unsupported browser or unreadable QR. Use pixel fallback. */ }
    }

    if (!reliable) {
      // The A3 WhatsApp scan uses a grey (rather than sharp black) printed QR.
      // Detect a SMALL dense two-axis checkerboard in the physical QR regions,
      // not handwriting anywhere in the entire corner. The previous whole-
      // corner edge count chose red writing or returned "uncertain".
      const w=512,h=Math.max(128,Math.round(w*source.height/source.width));
      const probe=document.createElement('canvas');
      probe.width=w;probe.height=h;
      const ctx=probe.getContext('2d',{willReadFrequently:true});
      if(!ctx)throw new Error('Cannot inspect QR orientation');
      ctx.drawImage(source,0,0,w,h);
      const rgba=ctx.getImageData(0,0,w,h).data;
      const dark=new Uint8Array(w*h);
      for(let i=0;i<dark.length;i++){
        const r=rgba[i*4],g=rgba[i*4+1],b=rgba[i*4+2];
        dark[i]=Math.max(r,g,b)-Math.min(r,g,b)<28 &&
          (r+g+b)/3<235 ? 1 : 0;
      }
      const patchW=Math.round(w*.07),patchH=Math.round(w*.078);
      const scoreRegion=(x0:number,y0:number,x1:number,y1:number):number=>{
        let best=0;
        const left=Math.floor(x0*w),right=Math.ceil(x1*w);
        const top=Math.floor(y0*h),bottom=Math.ceil(y1*h);
        for(let py=top;py+patchH<=bottom;py+=4){
          for(let px=left;px+patchW<=right;px+=4){
            let ink=0,horizontal=0,vertical=0;
            for(let y=py;y<py+patchH;y++){
              for(let x=px;x<px+patchW;x++){
                const i=y*w+x,v=dark[i];
                ink+=v;
                if(x>px && v!==dark[i-1])horizontal++;
                if(y>py && v!==dark[i-w])vertical++;
              }
            }
            const density=ink/(patchW*patchH);
            if(density<.12||density>.82)continue;
            best=Math.max(best,Math.min(
              horizontal/(patchH*(patchW-1)),
              vertical/((patchH-1)*patchW)));
          }
        }
        return best;
      };
      // Printed KORA A3 template: QR bottom-left when correctly oriented.
      // A top-right QR means exactly a 180-degree page rotation.
      if(source.height>source.width){
        const topRight=scoreRegion(.78,.075,.96,.26);
        const bottomLeft=scoreRegion(.04,.74,.24,.95);
        if(topRight>.105 && topRight>1.4*bottomLeft){
          angle=180;reliable=true;
        }else if(bottomLeft>.105 && bottomLeft>1.4*topRight){
          angle=0;reliable=true;
        }
      }
    }
    if (angle === 0) return {canvas:source,angle,reliable};
    const result = document.createElement('canvas');
    const sideways = angle === 90 || angle === 270;
    result.width = sideways ? source.height : source.width;
    result.height = sideways ? source.width : source.height;
    const context = result.getContext('2d');
    if (!context) throw new Error('Cannot rotate corrected paper');
    context.translate(result.width / 2, result.height / 2);
    context.rotate(angle * Math.PI / 180);
    context.drawImage(source,-source.width / 2,-source.height / 2);
    return {canvas:result,angle,reliable};
  }

  straighten(source:HTMLCanvasElement, quad:PaperQuad):Promise<HTMLCanvasElement> {
    const ctx=source.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw new Error('Cannot access scan image');
    const image=ctx.getImageData(0,0,source.width,source.height);
    // The supplied KORA print is A4 portrait. Preserve a good output size
    // but bound GPU/CPU memory for phone-scanned PDFs.
    const width=Math.min(2100,Math.max(900,Math.round(
      source.width*Math.max(
        (quad.topRight.x-quad.topLeft.x)/source.width,
        (quad.bottomRight.x-quad.bottomLeft.x)/source.width
      ))));
    const height=Math.min(2970,Math.round(width*Math.SQRT2));
    return new Promise((resolve,reject)=>{
      const worker=new Worker('/workers/kora-paper-straightener.js?v=1');
      let settled=false;
      let timer:ReturnType<typeof setTimeout>;
      const stop=()=>{clearTimeout(timer);worker.terminate();};
      const fail=(error:Error)=>{
        if(settled)return;settled=true;stop();reject(error);
      };
      const watchdog=()=>{
        clearTimeout(timer);
        timer=setTimeout(()=>fail(new Error('Paper perspective correction timed out')),45000);
      };
      worker.onerror=event=>fail(new Error('Paper worker failed: '+event.message));
      worker.onmessage=(event:MessageEvent)=>{
        const msg=event.data;
        if(msg?.type==='progress'){watchdog();return;}
        if(msg?.type==='error'){fail(new Error(String(msg.message)));return;}
        if(msg?.type!=='complete')return;
        try{
          const target=document.createElement('canvas');
          target.width=width;target.height=height;
          const out=target.getContext('2d');
          if(!out)throw new Error('Cannot draw corrected paper');
          out.putImageData(new ImageData(new Uint8ClampedArray(msg.pixels),width,height),0,0);
          settled=true;stop();resolve(target);
        }catch(error){fail(error instanceof Error?error:new Error(String(error)));}
      };
      watchdog();
      worker.postMessage({
        type:'straighten',width:source.width,height:source.height,
        destinationWidth:width,destinationHeight:height,
        corners:quad,pixels:image.data.buffer
      },[image.data.buffer]);
    });
  }
}
