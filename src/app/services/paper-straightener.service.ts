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
    // Score a continuous diagonal by comparing the tabletop's green tint
    // outside the page with the nearly neutral paper just inside its edge.
    const y0=Math.round(targetHeight*.12), y1=Math.round(targetHeight*.90);
    const offset=Math.round(targetWidth*.026);
    let best={score:-Infinity,top:1,bottom:1};
    for(let top=0.86;top<=1.041;top+=.02){
      for(let bottom=.56;bottom<=.881;bottom+=.02){
        if(top-bottom<.10)continue;
        const differences:number[]=[];
        for(let y=y0;y<=y1;y+=5){
          const position=top+(bottom-top)*y/(targetHeight-1);
          const x=Math.round(position*targetWidth);
          const inner=Math.max(0,Math.min(targetWidth-1,x-offset));
          const outer=Math.max(0,Math.min(targetWidth-1,x+offset));
          differences.push(Math.max(-7,Math.min(7,
            chroma[y*targetWidth+outer]-chroma[y*targetWidth+inner])));
        }
        differences.sort((a,b)=>a-b);
        const lo=Math.floor(differences.length*.2),hi=Math.ceil(differences.length*.8);
        let sum=0;
        for(let j=lo;j<hi;j++)sum+=differences[j];
        const score=sum/Math.max(1,hi-lo);
        if(score>best.score)best={score,top,bottom};
      }
    }
    if(best.score>=1.35){
      return {
        topRight:Math.min(1,best.top),
        bottomRight:best.bottom,
        confidence:'detected',
        note:'Paper/table boundary detected. Review the straightened page before applying.'
      };
    }
    return {
      topRight:1,bottomRight:1,
      confidence:'uncertain',
      note:'Paper boundary is too faint to detect reliably. Showing the complete image; adjust the paper-edge controls if the table is visible.'
    };
  }

  /** The left/top/bottom corners meet the photograph's bounds for this scan.
   * The right edge is adjustable, and the entire quadrilateral is corrected
   * with a single projective transform rather than cutting individual panels. */
  corners(source: HTMLCanvasElement, topRight: number, bottomRight: number): PaperQuad {
    const w=source.width-1,h=source.height-1;
    return {
      topLeft:{x:0,y:0},
      topRight:{x:w*topRight,y:0},
      bottomRight:{x:w*bottomRight,y:h},
      bottomLeft:{x:0,y:h}
    };
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
