import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PdfConverterService } from '../../services/pdf-converter.service';
import { PaperStraightenerService, PaperDetection } from '../../services/paper-straightener.service';
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
          <p>Detect the photographed paper, remove the table outside it, and keep every mark on the sheet.</p>
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
            <p class="helper">Paper boundary: {{detection()?.confidence === 'detected' ? 'detected' : 'uncertain'}}.
              Only the paper is straightened; no panel or handwriting is removed.</p>
            <div class="edge-controls">
              <label>Top-right paper edge: {{(topRight()*100).toFixed(0)}}%
                <input type="range" min="60" max="100" step="1"
                  [value]="topRight()*100" (input)="setEdge('top',$event)">
              </label>
              <label>Bottom-right paper edge: {{(bottomRight()*100).toFixed(0)}}%
                <input type="range" min="45" max="100" step="1"
                  [value]="bottomRight()*100" (input)="setEdge('bottom',$event)">
              </label>
              <div class="buttons">
                <button type="button" [disabled]="busy()" (click)="straighten()">STRAIGHTEN PAPER</button>
                <button type="button" [disabled]="busy()" (click)="redetect()">Detect edges again</button>
              </div>
            </div>
            <label>Rotate complete paper
              <select [value]="quarterTurn()" (change)="changeQuarterTurn($event)">
                <option value="0">0° — keep paper direction</option>
                <option value="90">90° clockwise</option>
                <option value="180">180°</option>
                <option value="270">90° counterclockwise</option>
              </select>
            </label>
            <label>Fine rotation: {{fineAngle().toFixed(1)}}°
              <input type="range" min="-7" max="7" step="0.1"
                [value]="fineAngle()" (input)="changeFineAngle($event)" />
            </label>
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
          <h3>Paper-only preview</h3>
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
    .buttons{display:flex;gap:7px;margin-bottom:16px}.buttons button{flex:1;font-size:11px}
    .edge-controls{padding:10px 8px;border:1px solid #424851;border-radius:6px;margin:12px 0}
    .edge-controls label{font-size:11px}
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
  readonly detection=signal<PaperDetection|null>(null);
  readonly topRight=signal(1);
  readonly bottomRight=signal(1);
  readonly quarterTurn=signal<0|90|180|270>(0);
  readonly fineAngle=signal(0);

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
      this.quarterTurn.set(0);
      this.fineAngle.set(0);
      this.detectEdges();
      await this.straighten(true);
    }catch(error){
      this.status.set('Could not process paper: '+String(error));
      console.error('[KORA paper]',error);
    }finally{this.busy.set(false);}
  }

  private detectEdges():void{
    if(!this.original)return;
    const guess=this.paper.detect(this.original);
    this.detection.set(guess);
    this.topRight.set(guess.topRight);
    this.bottomRight.set(guess.bottomRight);
    this.status.set(guess.note);
  }
  async redetect():Promise<void>{
    if(!this.original||this.busy())return;
    this.detectEdges();
    await this.straighten();
  }
  setEdge(which:'top'|'bottom',event:Event):void{
    const fraction=Number((event.target as HTMLInputElement).value)/100;
    if(which==='top')this.topRight.set(fraction);
    else this.bottomRight.set(fraction);
    this.status.set('Paper edge adjusted. Click STRAIGHTEN PAPER to update the preview.');
  }
  async straighten(alreadyBusy=false):Promise<void>{
    if(!this.original||(!alreadyBusy&&this.busy()))return;
    this.busy.set(true);
    this.status.set('Correcting the perspective of the entire paper...');
    try{
      const quad=this.paper.corners(this.original,this.topRight(),this.bottomRight());
      const result=await this.paper.straighten(this.original,quad);
      this.straightened=result;
      this.hasPaper.set(true);
      this.updatePreview();
      this.status.set('Paper straightened. Table excluded; all content on the paper preserved.');
    }catch(error){
      this.status.set('Paper correction failed: '+String(error));
      console.error('[KORA paper]',error);
    }finally{this.busy.set(false);}
  }

  private rotateCanvas(source:HTMLCanvasElement,angle:number):HTMLCanvasElement{
    const rad=angle*Math.PI/180,co=Math.abs(Math.cos(rad)),si=Math.abs(Math.sin(rad));
    const w=Math.ceil(source.width*co+source.height*si)+2;
    const h=Math.ceil(source.width*si+source.height*co)+2;
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    const ctx=canvas.getContext('2d')!;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);
    ctx.translate(w/2,h/2);ctx.rotate(rad);
    ctx.drawImage(source,-source.width/2,-source.height/2);
    return canvas;
  }
  private updatePreview():void{
    if(!this.straightened)return;
    const image=this.rotateCanvas(this.straightened,this.quarterTurn()+this.fineAngle());
    const preview=this.previewRef.nativeElement;
    preview.width=image.width;preview.height=image.height;
    preview.getContext('2d')!.drawImage(image,0,0);
  }
  changeQuarterTurn(event:Event):void{
    this.quarterTurn.set(Number((event.target as HTMLSelectElement).value) as 0|90|180|270);
    this.updatePreview();
  }
  changeFineAngle(event:Event):void{
    this.fineAngle.set(Number((event.target as HTMLInputElement).value));
    this.updatePreview();
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
