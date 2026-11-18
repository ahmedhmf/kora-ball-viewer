import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PdfConverterService } from '../../services/pdf-converter.service';
import { PaperStraightenerService } from '../../services/paper-straightener.service';
import { ModelLoaderService } from '../../services/model-loader.service';

/**
 * Prepare whole scanned sheets without altering any panel, drawing or label.
 * The only geometric operations are paper perspective correction and user
 * selected whole-image rotation. Everything remains local to the browser.
 */
@Component({
  selector:'app-techpack-preparer',
  standalone:true,
  imports:[RouterLink],
  template:`
    <main class="orienter">
      <header>
        <div>
          <h2>STRAIGHTEN KORA PAPER</h2>
          <p>Upload your PDF or photo. The paper is detected and straightened automatically without altering its artwork.</p>
        </div>
        <a routerLink="/">Back to 3D Ball</a>
      </header>
      <div class="workspace">
        <section class="controls">
          <label>Upload scanned PDF or photo
            <input type="file" accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
              [disabled]="busy()" (change)="loadFile($event)" />
          </label>
          <p class="status" role="status" aria-live="polite">{{status()}}</p>
          @if (hasImage()) {
            <p class="file">{{fileName()}}</p>
            <p class="helper">Paper detected and straightened automatically. All artwork, labels and margins on the sheet are preserved.</p>
            <button type="button" class="apply" [disabled]="busy() || !hasPaper()"
              (click)="applyToBall()">
              {{busy() ? 'PROCESSING...' : 'APPLY STRAIGHTENED PAPER TO BALL'}}
            </button>
            <button type="button" [disabled]="busy() || !hasPaper()" (click)="download()">
              Download corrected PNG
            </button>
          }
        </section>
        <section class="preview">
          <h3>Automatically straightened paper</h3>
          <canvas #previewCanvas aria-label="Entire paper with perspective corrected, no table"></canvas>
        </section>
      </div>
    </main>
  `,
  styles:[`
    .orienter{min-height:100vh;background:#0d0f12;color:#e5e7eb;padding:20px;box-sizing:border-box}
    header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}
    h2{font-size:17px;color:#ef4444;margin:0 0 6px}
    h3{font-size:13px;margin:0 0 8px}
    p{font-size:12px;color:#aeb4bd;line-height:1.5}
    a{color:#fca5a5}
    .workspace{display:grid;grid-template-columns:310px minmax(0,1fr);gap:16px}
    .controls,.preview{padding:16px;background:#10151c;border:1px solid #353b44;border-radius:8px}
    label{display:block;font-size:13px;font-weight:600;margin-bottom:16px}
    input[type=file],input[type=range],select{display:block;width:100%;margin-top:8px;box-sizing:border-box}
    input[type=file]{font-size:12px}
    select{padding:8px;color:#fff;background:#202730;border:1px solid #555}
    button{border:1px solid #555;background:#303744;color:white;padding:9px;cursor:pointer;border-radius:5px}
    button:disabled{opacity:.5;cursor:not-allowed}

    .apply{width:100%;background:#b91c1c;border-color:#b91c1c;margin-bottom:10px;font-weight:700}
    .controls>button:not(.apply){width:100%}
    .status{color:#e5e7eb;font-weight:600;overflow-wrap:anywhere}
    .file{overflow-wrap:anywhere}.helper{color:#fcd34d}
    .preview{display:flex;flex-direction:column;min-height:360px;align-items:center}
    .preview h3{align-self:flex-start}
    .preview canvas{display:block;max-width:100%;max-height:76vh;width:auto;height:auto;background:white}
    @media(max-width:800px){.workspace{grid-template-columns:1fr}}
  `]
})
export class TechpackPreparerComponent {
  @ViewChild('previewCanvas',{static:true}) private previewRef!:ElementRef<HTMLCanvasElement>;
  private readonly pdf=inject(PdfConverterService);
  private readonly paper=inject(PaperStraightenerService);
  private readonly model=inject(ModelLoaderService);
  private readonly router=inject(Router);
  private original:HTMLCanvasElement|null=null;
  private straightened:HTMLCanvasElement|null=null;
  readonly hasImage=signal(false);
  readonly hasPaper=signal(false);
  readonly busy=signal(false);
  readonly status=signal('Upload the PDF or photo containing the photographed paper.');
  readonly fileName=signal('');

  async loadFile(event:Event):Promise<void>{
    const input=event.target as HTMLInputElement;
    const file=input.files?.[0];
    input.value='';
    if(!file||this.busy())return;
    this.busy.set(true);
    this.hasImage.set(false);
    this.hasPaper.set(false);
    this.original=null;this.straightened=null;
    this.status.set('Reading scanned page...');
    try{
      const isPdf=file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf');
      if(isPdf){
        const document=await this.pdf.loadPdfDocument(file);
        try{
          const page=await document.getPage(1);
          const viewport=page.getViewport({scale:1});
          const renderScale=Math.min(2.4,2400/Math.max(viewport.width,viewport.height));
          const result=await this.pdf.renderPageToCanvas(document,1,renderScale);
          this.original=result.canvas;
        }finally{await document.destroy();}
      }else if(file.type.startsWith('image/')){
        const bitmap=await createImageBitmap(file);
        try{
          const canvas=document.createElement('canvas');
          canvas.width=bitmap.width;canvas.height=bitmap.height;
          canvas.getContext('2d')!.drawImage(bitmap,0,0);
          this.original=canvas;
        }finally{bitmap.close();}
      }else throw new Error('Please select a PDF, JPG, PNG or WEBP.');
      this.fileName.set(file.name);
      this.hasImage.set(true);
      await this.straightenAutomatically();
    }catch(error){
      this.status.set('Could not process paper: '+String(error));
      console.error('[KORA paper]',error);
    }finally{this.busy.set(false);}
  }

  /** One upload → paper detection → one continuous perspective warp → preview.
   * No alignment controls or separate confirmation step required. */
  private async straightenAutomatically():Promise<void>{
    if(!this.original)return;
    this.status.set('Finding the paper border and straightening its perspective...');
    const guess=this.paper.detect(this.original);
    if(guess.confidence!=='detected'){
      this.hasPaper.set(false);
      throw new Error(guess.note);
    }
    const quad=this.paper.corners(this.original,guess.topRight,guess.bottomRight);
    this.straightened=await this.paper.straighten(this.original,quad);
    const source=this.straightened;
    const preview=this.previewRef.nativeElement;
    preview.width=source.width;preview.height=source.height;
    preview.getContext('2d')!.drawImage(source,0,0);
    this.hasPaper.set(true);
    this.status.set('Paper straightened automatically. The table was excluded; all content on the paper is preserved.');
  }

  private finalCanvas():HTMLCanvasElement|null{
    return this.hasPaper()?this.previewRef.nativeElement:null;
  }
  async download():Promise<void>{
    const canvas=this.finalCanvas();if(!canvas)return;
    try{
      const file=await this.pdf.canvasToFile(canvas,'kora-paper-straightened.png','image/png');
      const url=URL.createObjectURL(file),link=document.createElement('a');
      link.href=url;link.download=file.name;link.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){this.status.set('Download failed: '+String(error));}
  }
  async applyToBall():Promise<void>{
    const canvas=this.finalCanvas();if(!canvas||this.busy())return;
    this.busy.set(true);
    this.status.set('Applying the entire corrected paper to the ball...');
    try{
      // Existing viewer expects a square texture. This contains the entire
      // straightened paper, fitted proportionally with white margins; no crops.
      const square=this.pdf.convertPdfPageTo3DBallTexture(canvas);
      const file=await this.pdf.canvasToFile(square,'kora-corrected-paper.png','image/png');
      await this.router.navigate(['/']);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      await this.model.loadTextureFile(file);
    }catch(error){
      this.status.set('Applying to 3D ball failed: '+String(error));
    }finally{this.busy.set(false);}
  }
}
