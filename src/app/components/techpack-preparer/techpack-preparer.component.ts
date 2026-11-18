import { Component, ElementRef, ViewChild, inject, signal, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PdfConverterService } from '../../services/pdf-converter.service';
import { PaperStraightenerService } from '../../services/paper-straightener.service';
import { KoraPanelCutoutService } from '../../services/kora-panel-cutout.service';
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
            <button type="button" class="cutout" [disabled]="busy() || !hasPaper()"
              (click)="toggleOutsidePanels()">
              {{outsideRemoved() ? 'SHOW FULL PAPER' : 'REMOVE OUTSIDE PANELS'}}
            </button>
            <p class="helper">Optional preview: removes markings around the 32 panels without changing the original straightened page. You can switch back at any time.</p>
            @if (outsideRemoved()) {
              <button type="button" class="cut-shapes" [disabled]="busy() || !hasPaper()"
                (click)="toggleCutPanelShapes()">
                {{shapesCut() ? 'SHOW UNCROPPED PANELS' : 'CUT TO PANEL SHAPES'}}
              </button>
              <p class="helper">Cut mode keeps only the panel-shaped artwork, removes the empty margins and uses transparency outside the shapes. This is a preview until you choose to download or apply it.</p>
            }
            @if (shapesCut()) {
              <button type="button" class="square" [disabled]="busy() || !hasPaper()"
                (click)="toggleSquareMode()">
                {{squareMode() ? 'SHOW ORIGINAL ASPECT RATIO' : 'MAKE 1:1'}}
              </button>
              <p class="helper">Fit the complete panel cutout into a square without cropping or stretching. The added space stays transparent.</p>
            }
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
          <h3>{{squareMode() ? 'Square 1:1 panel texture' : shapesCut() ? 'Cropped panel shapes' : outsideRemoved() ? 'Panel-only preview' : 'Automatically straightened paper'}}</h3>
          <p class="coordinate-help">X and Y are pixel coordinates of the corrected page. Rulers are preview-only.</p>
          <div class="ruler-layout">
            <div class="ruler-origin">0,0</div>
            <div class="ruler-x">
              @for (tick of xTicks(); track tick) {
                <div class="x-tick" [style.left.%]="tick * 100 / pageWidth()">
                  <span>{{tick}}</span>
                </div>
              }
              <span class="axis-name">X (px)</span>
            </div>
            <div class="ruler-y">
              @for (tick of yTicks(); track tick) {
                <div class="y-tick" [style.top.%]="tick * 100 / pageHeight()">
                  <span>{{tick}}</span>
                </div>
              }
              <span class="axis-name-y">Y (px)</span>
            </div>
            <canvas #previewCanvas aria-label="Entire paper with perspective corrected, X/Y rulers outside the image"></canvas>
          </div>
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

    .square{display:block;width:100%;background:#613d91;border-color:#a786d9;margin:6px 0 10px;font-weight:700}
    .cut-shapes{display:block;width:100%;background:#314a77;border-color:#7898e0;margin:6px 0 10px;font-weight:700}
    .cutout{display:block;width:100%;background:#13584c;border-color:#1c9d80;margin:6px 0 10px;font-weight:700}
    .apply{width:100%;background:#b91c1c;border-color:#b91c1c;margin-bottom:10px;font-weight:700}
    .controls>button:not(.apply){width:100%}
    .status{color:#e5e7eb;font-weight:600;overflow-wrap:anywhere}
    .file{overflow-wrap:anywhere}.helper{color:#fcd34d}
    .preview{display:flex;flex-direction:column;min-height:360px;min-width:0;overflow:auto;max-height:87vh}
    .preview h3{align-self:flex-start}
    .coordinate-help{margin:0 0 12px}
    .ruler-layout{display:grid;grid-template-columns:48px minmax(0,1fr);
      grid-template-rows:30px auto;align-items:stretch;width:100%;max-width:820px;margin:0 auto}
    .ruler-origin{background:#28313d;color:#e5e7eb;text-align:center;
      line-height:30px;font-size:11px;border-right:1px solid #636d7a;border-bottom:1px solid #636d7a}
    .ruler-x,.ruler-y{background:#202a35;position:relative;color:#d2d7df;overflow:hidden}
    .ruler-x{border-bottom:1px solid #718096}
    .ruler-y{border-right:1px solid #718096}
    .x-tick{position:absolute;bottom:0;height:11px;border-left:1px solid #a5b4c7}
    .x-tick span{position:absolute;bottom:12px;left:3px;font-size:10px;white-space:nowrap}
    .y-tick{position:absolute;right:0;width:11px;border-top:1px solid #a5b4c7}
    .y-tick span{position:absolute;right:14px;top:-7px;font-size:10px;white-space:nowrap}
    .axis-name{position:absolute;right:5px;top:3px;font-size:10px;color:#91a1b4}
    .axis-name-y{position:absolute;left:4px;bottom:5px;font-size:10px;color:#91a1b4}
    .preview canvas{display:block;width:100%;height:auto;max-width:none;max-height:none;
      background-color:#fff;background-image:linear-gradient(45deg,#e9edf2 25%,transparent 25%),
      linear-gradient(-45deg,#e9edf2 25%,transparent 25%),
      linear-gradient(45deg,transparent 75%,#e9edf2 75%),
      linear-gradient(-45deg,transparent 75%,#e9edf2 75%);
      background-position:0 0,0 10px,10px -10px,-10px 0;background-size:20px 20px}
    @media(max-width:800px){.workspace{grid-template-columns:1fr}}
  `]
})
export class TechpackPreparerComponent {
  @ViewChild('previewCanvas',{static:true}) private previewRef!:ElementRef<HTMLCanvasElement>;
  private readonly pdf=inject(PdfConverterService);
  private readonly paper=inject(PaperStraightenerService);
  private readonly panelCutout=inject(KoraPanelCutoutService);
  private readonly model=inject(ModelLoaderService);
  private readonly router=inject(Router);
  private original:HTMLCanvasElement|null=null;
  private straightened:HTMLCanvasElement|null=null;
  private panelOnly:HTMLCanvasElement|null=null;
  private shapesOnly:HTMLCanvasElement|null=null;
  private squareVersion:HTMLCanvasElement|null=null;
  readonly squareMode=signal(false);
  readonly outsideRemoved=signal(false);
  readonly shapesCut=signal(false);
  readonly hasImage=signal(false);
  readonly hasPaper=signal(false);
  readonly busy=signal(false);
  readonly status=signal('Upload the PDF or photo containing the photographed paper.');
  readonly fileName=signal('');
  readonly pageWidth=signal(1);
  readonly pageHeight=signal(1);
  readonly xTicks=computed(()=>this.makeTicks(this.pageWidth()));
  readonly yTicks=computed(()=>this.makeTicks(this.pageHeight()));

  async loadFile(event:Event):Promise<void>{
    const input=event.target as HTMLInputElement;
    const file=input.files?.[0];
    input.value='';
    if(!file||this.busy())return;
    this.busy.set(true);
    this.hasImage.set(false);
    this.hasPaper.set(false);
    this.original=null;this.straightened=null;this.panelOnly=null;this.shapesOnly=null;
    this.squareVersion=null;
    this.squareMode.set(false);
    this.outsideRemoved.set(false);
    this.shapesCut.set(false);
    this.pageWidth.set(1);this.pageHeight.set(1);
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
  private makeTicks(length:number):number[]{
    if(length<=1)return [];
    // Keep the axis readable on small screens: labels every ~15% of the page.
    const interval=Math.max(50,Math.ceil(length/6/50)*50);
    const ticks:number[]=[];
    for(let n=0;n<length;n+=interval)ticks.push(n);
    return ticks;
  }

  private async straightenAutomatically():Promise<void>{
    if(!this.original)return;
    this.status.set('Finding the paper border and straightening its perspective...');
    const guess=this.paper.detect(this.original);
    if(guess.confidence!=='detected'){
      this.hasPaper.set(false);
      throw new Error(guess.note);
    }
    const quad=this.paper.corners(this.original,guess.topRight,guess.bottomRight);
    const corrected=await this.paper.straighten(this.original,quad);
    this.status.set('Paper straightened. Checking QR marker for page orientation...');
    const orientation=await this.paper.orientPrintedSheet(corrected);
    this.straightened=orientation.canvas;
    this.panelOnly=null;
    this.shapesOnly=null;
    this.squareVersion=null;
    this.squareMode.set(false);
    this.outsideRemoved.set(false);
    this.shapesCut.set(false);
    this.showCanvas(this.straightened);
    this.hasPaper.set(true);
    this.status.set(orientation.reliable
      ? 'Paper straightened and rotated '+orientation.angle+'° automatically. The printed QR is at bottom-left.'
      : 'Paper straightened; printed orientation was uncertain, so no rotation was guessed.');
  }

  private showCanvas(source: HTMLCanvasElement): void {
    const preview=this.previewRef.nativeElement;
    preview.width=source.width;
    preview.height=source.height;
    this.pageWidth.set(source.width);
    this.pageHeight.set(source.height);
    preview.getContext('2d')!.drawImage(source,0,0);
  }

  /** Button-only, reversible cleanup. Original corrected page is untouched. */
  async toggleOutsidePanels(): Promise<void> {
    if (!this.straightened || this.busy()) return;
    if (this.outsideRemoved()) {
      this.squareMode.set(false);
      this.squareVersion=null;
      this.shapesCut.set(false);
      this.outsideRemoved.set(false);
      this.showCanvas(this.straightened);
      this.status.set('Showing the full straightened paper again. No data was lost.');
      return;
    }
    this.busy.set(true);
    this.status.set('Finding KORA panels and clearing marks outside them...');
    try {
      this.panelOnly ??= await this.panelCutout.removeOutside(this.straightened);
      this.outsideRemoved.set(true);
      this.shapesCut.set(false);
      this.squareMode.set(false);
      this.squareVersion=null;
      this.showCanvas(this.panelOnly);
      this.status.set('Outside-panel marks hidden. Review the panel edges; click Show Full Paper to undo.');
    } catch (error) {
      this.status.set('Outside-panel cleanup failed: '+String(error));
      console.error('[KORA panel cutout]',error);
    } finally { this.busy.set(false); }
  }

  /** Third, optional step: tightly trim all 32 panel shapes while preserving
   * their original positions relative to one another and transparency. */
  async toggleCutPanelShapes(): Promise<void> {
    if (!this.straightened || !this.outsideRemoved() || this.busy()) return;
    if (this.shapesCut()) {
      this.squareMode.set(false);
      this.squareVersion=null;
      this.shapesCut.set(false);
      if (this.panelOnly) this.showCanvas(this.panelOnly);
      this.status.set('Back to the full-size panel-only preview.');
      return;
    }
    this.busy.set(true);
    this.status.set('Trimming surrounding margins to the 32 panel shapes...');
    try {
      this.shapesOnly ??= await this.panelCutout.cutToPanelShapes(this.straightened);
      this.squareMode.set(false);
      this.squareVersion=null;
      this.shapesCut.set(true);
      this.showCanvas(this.shapesOnly);
      this.status.set('Panel shapes cropped. Areas outside the outlines are transparent; click Show Uncropped Panels to go back.');
    } catch (error) {
      this.status.set('Could not cut panel shapes: '+String(error));
      console.error('[KORA panel shape crop]',error);
    } finally { this.busy.set(false); }
  }

  /**
   * Square padding is applied only after the tight panel-shape crop. Every
   * original pixel remains at its original size and the panel arrangement is
   * preserved. The transparent outside area is never filled with white.
   */
  private makeSquareCanvas(source:HTMLCanvasElement):HTMLCanvasElement {
    const size=Math.max(source.width,source.height);
    const square=document.createElement('canvas');
    square.width=size;
    square.height=size;
    const ctx=square.getContext('2d');
    if(!ctx)throw new Error('Cannot create square panel texture');
    ctx.clearRect(0,0,size,size);
    const x=Math.floor((size-source.width)/2);
    const y=Math.floor((size-source.height)/2);
    ctx.drawImage(source,x,y);
    return square;
  }

  toggleSquareMode():void {
    if(this.busy() || !this.hasPaper() || !this.shapesCut() || !this.shapesOnly)return;
    if(this.squareMode()){
      this.squareMode.set(false);
      this.squareVersion=null;
      this.showCanvas(this.shapesOnly);
      this.status.set('Returned to the original cropped aspect ratio.');
      return;
    }
    this.squareVersion=this.makeSquareCanvas(this.shapesOnly);
    this.squareMode.set(true);
    this.showCanvas(this.squareVersion);
    this.status.set('Created a 1:1 square PNG with transparent padding. No panels were cropped or stretched.');
  }

  private finalCanvas():HTMLCanvasElement|null{
    return this.hasPaper()?this.previewRef.nativeElement:null;
  }
  async download():Promise<void>{
    const canvas=this.finalCanvas();if(!canvas)return;
    try{
      const file=await this.pdf.canvasToFile(canvas,
        this.squareMode() ? 'kora-panel-shapes-square.png' :
        this.shapesCut() ? 'kora-panel-shapes-transparent.png' : 'kora-paper-straightened.png','image/png');
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
      // Babylon expects a 1024px square texture. In 1:1 mode, use the full
      // square without reintroducing white margins. Otherwise keep the
      // original viewer mapping and transparency rules.
      const square=this.pdf.convertPdfPageTo3DBallTexture(canvas);
      if (this.shapesCut()) {
        const ctx=square.getContext('2d');
        if (!ctx) throw new Error('Cannot create transparent ball texture');
        ctx.clearRect(0,0,square.width,square.height);
        const fit=this.squareMode() ? 1024 : 920;
        const scale=Math.min(fit/canvas.width,fit/canvas.height);
        const width=canvas.width*scale,height=canvas.height*scale;
        ctx.drawImage(canvas,(1024-width)/2,(1024-height)/2,width,height);
      }
      const file=await this.pdf.canvasToFile(square,'kora-corrected-paper.png','image/png');
      await this.router.navigate(['/']);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      await this.model.loadTextureFile(file);
    }catch(error){
      this.status.set('Applying to 3D ball failed: '+String(error));
    }finally{this.busy.set(false);}
  }
}
