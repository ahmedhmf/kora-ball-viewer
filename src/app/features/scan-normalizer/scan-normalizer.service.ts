import { Injectable } from '@angular/core';

export type QuarterTurn = 0 | 90 | 180 | 270;
export interface RegistrationOptions {
  rotation: QuarterTurn;
  shiftX: number;
  shiftY: number;
  scaleX: number;
  scaleY: number;
  fineRotation: number;
}
export interface NormalizedPage {
  blob: Blob;
  previewUrl: string;
  imageData: ImageData;
  score: number;
  nearEdges: number;
  samples: number;
  maskPixels: number;
  regionBands: number;
}

/** Whole-sheet registration: no masks, panel crops or individual polygon transforms. */
@Injectable({ providedIn: 'root' })
export class ScanNormalizerService {
  private pdfPromise?: Promise<any>;
  private readonly pdfUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  private readonly pdfWorkerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  private script(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const element = document.createElement('script');
      const timeout = setTimeout(() => reject(new Error('PDF.js could not load within 25 seconds')), 25000);
      element.src = url;
      element.async = true;
      element.onload = () => { clearTimeout(timeout); resolve(); };
      element.onerror = () => { clearTimeout(timeout); reject(new Error('PDF.js download failed')); };
      document.head.append(element);
    });
  }

  private async pdf(): Promise<any> {
    return this.pdfPromise ??= (async () => {
      if (!(window as any).pdfjsLib) await this.script(this.pdfUrl);
      const api = (window as any).pdfjsLib;
      api.GlobalWorkerOptions.workerSrc = this.pdfWorkerUrl;
      return api;
    })().catch((error: unknown) => { this.pdfPromise = undefined; throw error; });
  }

  async readFile(file: File): Promise<HTMLCanvasElement> {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const api = await this.pdf();
      const doc = await api.getDocument({data: new Uint8Array(await file.arrayBuffer())}).promise;
      try {
        const page = await doc.getPage(1);
        const base = page.getViewport({scale: 1});
        const scale = Math.min(2, 2000 / Math.max(base.width, base.height));
        const viewport = page.getViewport({scale});
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({canvasContext: canvas.getContext('2d')!, viewport}).promise;
        return canvas;
      } finally { await doc.destroy(); }
    }
    if (!file.type.startsWith('image/')) throw new Error('Upload a PDF or an image.');
    const image = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = image.width; canvas.height = image.height;
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      return canvas;
    } finally { image.close(); }
  }

  /**
   * The printed sheet's QR is bottom-left when upright. The density fallback
   * deliberately returns low confidence; users can correct a wrong guess.
   */
  async guessRotation(canvas: HTMLCanvasElement): Promise<{rotation: QuarterTurn; certain: boolean}> {
    const BarcodeDetector = (window as any).BarcodeDetector;
    if (typeof BarcodeDetector === 'function') {
      try {
        const detector = new BarcodeDetector({formats:['qr_code']});
        const found: any[] = await detector.detect(canvas);
        if (found.length === 1) {
          const p = found[0].boundingBox;
          const x = (p.x + p.width/2)/canvas.width;
          const y = (p.y + p.height/2)/canvas.height;
          if (x < .35 && y > .65) return {rotation:0,certain:true};
          if (x > .65 && y < .35) return {rotation:180,certain:true};
          if (x < .35 && y < .35) return {rotation:270,certain:true};
          if (x > .65 && y > .65) return {rotation:90,certain:true};
        }
      } catch { /* Some browsers do not support QR decoding. */ }
    }
    // QR density check in page corners, not a semantic QR decoder.
    const w = 240, h = Math.round(w*canvas.height/canvas.width);
    const small = document.createElement('canvas');
    small.width = w; small.height = h;
    const ctx = small.getContext('2d',{willReadFrequently:true})!;
    ctx.drawImage(canvas,0,0,w,h);
    const rgba=ctx.getImageData(0,0,w,h).data;
    const gray=new Uint8Array(w*h);
    for(let i=0;i<gray.length;i++)
      gray[i]=(.299*rgba[4*i]+.587*rgba[4*i+1]+.114*rgba[4*i+2])|0;
    const corners=[{r:270,x0:0,y0:0},{r:180,x0:.75,y0:0},
      {r:0,x0:0,y0:.75},{r:90,x0:.75,y0:.75}];
    const scores=corners.map(c=>{
      let sum=0;
      for(let y=Math.max(2,Math.floor(c.y0*h));y<Math.min(h-2,Math.ceil((c.y0+.25)*h));y++)
        for(let x=Math.max(2,Math.floor(c.x0*w));x<Math.min(w-2,Math.ceil((c.x0+.25)*w));x++){
          const i=y*w+x;
          if (Math.abs(gray[i-1]-gray[i+1])>24 &&
              Math.abs(gray[i-w]-gray[i+w])>24)sum++;
        }
      return {rotation:c.r as QuarterTurn,score:sum};
    }).sort((a,b)=>b.score-a.score);
    if(scores[0].score>=14 && scores[0].score>scores[1].score*1.3)
      return {rotation:scores[0].rotation,certain:false};
    return {rotation:0,certain:false};
  }

  async normalize(
    original: HTMLCanvasElement,
    options: RegistrationOptions,
    progress: (status:string)=>void=()=>{},
  ): Promise<NormalizedPage> {
    const rgba=original.getContext('2d',{willReadFrequently:true})!.getImageData(
      0,0,original.width,original.height);
    const worker=new Worker('/workers/kora-page-registration.js?v=2');
    return new Promise((resolve,reject)=>{
      let finished=false;
      let stage='Starting registration';
      let timer:ReturnType<typeof setTimeout>;
      const cleanup=()=>{clearTimeout(timer);worker.terminate();};
      const fail=(error:Error)=>{
        if(finished)return;finished=true;cleanup();reject(error);
      };
      const reset=()=>{
        clearTimeout(timer);
        timer=setTimeout(()=>fail(new Error('Whole-page alignment timed out at: '+stage)),45000);
      };
      worker.onerror=(event)=>fail(new Error('Alignment worker: '+event.message));
      worker.onmessage=(event:MessageEvent)=>{
        const msg=event.data;
        if(msg?.type==='progress'){stage=String(msg.message);progress(stage);reset();}
        else if(msg?.type==='error')fail(new Error(msg.message||'Alignment failed'));
        else if(msg?.type==='complete'){
          try {
            const data=new ImageData(new Uint8ClampedArray(msg.pixels),1024,1024);
            const canvas=document.createElement('canvas');
            canvas.width=1024;canvas.height=1024;
            canvas.getContext('2d')!.putImageData(data,0,0);
            canvas.toBlob(blob=>{
              if(!blob)return fail(new Error('Could not export 1024px PNG'));
              if(finished)return;
              finished=true;cleanup();
              resolve({blob,previewUrl:URL.createObjectURL(blob),imageData:data,
                score:msg.score,nearEdges:msg.nearEdges,samples:msg.samples,
                maskPixels:msg.maskPixels,regionBands:msg.regionBands});
            },'image/png');
          }catch(e){fail(e instanceof Error?e:new Error(String(e)));}
        }
      };
      reset();
      worker.postMessage({type:'align',width:rgba.width,height:rgba.height,
        pixels:rgba.data.buffer,options},[rgba.data.buffer]);
    });
  }
}
