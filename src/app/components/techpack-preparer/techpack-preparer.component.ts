import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PdfConverterService } from '../../services/pdf-converter.service';
import { ModelLoaderService } from '../../services/model-loader.service';

/**
 * Orientation only: no masks, cropping, recoloring, UV registration, or panel edits.
 * The corrected whole page can be downloaded or fitted intact into the ball texture.
 */
@Component({
  selector: 'app-techpack-preparer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="orienter">
      <header>
        <div>
          <h2>STRAIGHTEN SCANNED PAGE</h2>
          <p>Keep everything on the page. Only correct its rotation.</p>
        </div>
        <a routerLink="/">Back to 3D Ball</a>
      </header>

      <section class="workspace">
        <div class="controls">
          <label class="upload">Upload a PDF or photo
            <input type="file" accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
              [disabled]="busy()" (change)="loadFile($event)" />
          </label>
          <p role="status" aria-live="polite" class="status">{{status()}}</p>
          @if (hasImage()) {
            <p class="file">{{fileName()}}</p>
            <label>Page orientation
              <select [value]="quarterTurn()" (change)="changeQuarterTurn($event)">
                <option value="0">0° — unchanged</option>
                <option value="90">90° clockwise</option>
                <option value="180">180°</option>
                <option value="270">90° counterclockwise</option>
              </select>
            </label>
            <label>Fine straightening: {{fineAngle().toFixed(1)}}°
              <input type="range" min="-7" max="7" step="0.1"
                [value]="fineAngle()" (input)="changeFineAngle($event)" />
            </label>
            <div class="buttons">
              <button type="button" (click)="reset()">Reset rotation</button>
              <button type="button" (click)="detectAgain()">Detect automatically</button>
            </div>
            <p class="help">The whole page is kept, including the QR code, writing and margins.
              If automatic orientation is uncertain, select the correct angle here.</p>
            <button type="button" class="apply" [disabled]="busy()" (click)="applyToBall()">
              {{busy() ? 'PROCESSING...' : 'APPLY WHOLE PAGE TO BALL'}}
            </button>
            <button type="button" [disabled]="busy()" (click)="download()">Download straightened PNG</button>
          }
        </div>
        <div class="preview">
          <h3>Whole-page preview</h3>
          <canvas #previewCanvas aria-label="Entire scanned page with its orientation corrected"></canvas>
        </div>
      </section>
    </main>
  `,
  styles: [`
    .orienter{min-height:100vh;background:#0d0f12;color:#e5e7eb;padding:20px;box-sizing:border-box}
    header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:20px}
    h2{font-size:17px;color:#ef4444;margin:0 0 6px}h3{font-size:13px;margin:0 0 8px}
    p{font-size:12px;color:#aeb4bd;line-height:1.5}a{color:#fca5a5}
    .workspace{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px}
    .controls,.preview{padding:16px;background:#10151c;border:1px solid #353b44;border-radius:8px}
    label{display:block;font-size:13px;font-weight:600;margin-bottom:16px}
    input[type=file],input[type=range],select{display:block;width:100%;margin-top:8px;box-sizing:border-box}
    input[type=file]{font-size:12px}select{padding:8px;color:#fff;background:#202730;border:1px solid #555}
    button{border:1px solid #555;background:#303744;color:white;padding:9px;cursor:pointer;border-radius:5px}
    button:disabled{opacity:.5;cursor:not-allowed}.buttons{display:flex;gap:8px;margin-bottom:16px}
    .buttons button{flex:1}.apply{width:100%;background:#b91c1c;border-color:#b91c1c;margin-bottom:10px;font-weight:700}
    .controls>button:not(.apply){width:100%}
    .status{color:#e5e7eb;font-weight:600}.file{overflow-wrap:anywhere}
    .preview{display:flex;flex-direction:column;min-height:360px;align-items:center}
    .preview h3{align-self:flex-start}.preview canvas{display:block;max-width:100%;max-height:75vh;width:auto;height:auto;background:white}
    @media(max-width:800px){.workspace{grid-template-columns:1fr}}
  `]
})
export class TechpackPreparerComponent {
  @ViewChild('previewCanvas', { static: true }) private previewRef!: ElementRef<HTMLCanvasElement>;
  private readonly pdf = inject(PdfConverterService);
  private readonly loader = inject(ModelLoaderService);
  private readonly router = inject(Router);
  private source: HTMLCanvasElement | null = null;
  readonly hasImage = signal(false);
  readonly busy = signal(false);
  readonly status = signal('Upload a WhatsApp PDF, JPG or PNG to straighten the entire page.');
  readonly fileName = signal('');
  readonly quarterTurn = signal<0 | 90 | 180 | 270>(0);
  readonly fineAngle = signal(0);

  async loadFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.hasImage.set(false);
    this.source = null;
    this.status.set('Loading original page...');
    try {
      const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (pdf) {
        const doc = await this.pdf.loadPdfDocument(file);
        try {
          const page = await doc.getPage(1);
          const viewport = page.getViewport({ scale: 1 });
          const renderScale = Math.min(2, 2200 / Math.max(viewport.width, viewport.height));
          const result = await this.pdf.renderPageToCanvas(doc, 1, renderScale);
          this.source = result.canvas;
        } finally {
          await doc.destroy();
        }
      } else if (file.type.startsWith('image/')) {
        const bitmap = await createImageBitmap(file);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
          this.source = canvas;
        } finally { bitmap.close(); }
      } else throw new Error('Please upload a PDF or image.');
      this.fileName.set(file.name);
      this.hasImage.set(true);
      await this.detectOrientation();
    } catch (error) {
      this.status.set('Could not read scan: ' + String(error));
    } finally { this.busy.set(false); }
  }

  private async detectOrientation(): Promise<void> {
    const canvas = this.source;
    if (!canvas) return;
    const detection = await this.detectQrCorner(canvas);
    this.quarterTurn.set(detection.rotation);
    // Estimate the small printed-edge tilt after bringing the page upright.
    this.fineAngle.set(this.estimateSkew(canvas, detection.rotation));
    this.updatePreview();
    this.status.set(detection.verified
      ? 'QR recognized; orientation corrected. Review the preview before applying.'
      : 'Orientation estimated. Please confirm the printed sheet is upright before applying.');
  }

  async detectAgain(): Promise<void> {
    if (!this.source || this.busy()) return;
    this.busy.set(true);
    try { await this.detectOrientation(); }
    catch (e) { this.status.set('Orientation detection failed: ' + String(e)); }
    finally { this.busy.set(false); }
  }

  private async detectQrCorner(canvas: HTMLCanvasElement):
      Promise<{ rotation: 0 | 90 | 180 | 270; verified: boolean }> {
    const Constructor = (window as any).BarcodeDetector;
    if (typeof Constructor === 'function') {
      try {
        const codes: any[] = await new Constructor({formats:['qr_code']}).detect(canvas);
        if (codes.length === 1) {
          const box = codes[0].boundingBox;
          const x = (box.x + box.width / 2) / canvas.width;
          const y = (box.y + box.height / 2) / canvas.height;
          if (x < .34 && y > .66) return {rotation:0,verified:true};
          if (x > .66 && y < .34) return {rotation:180,verified:true};
          if (x < .34 && y < .34) return {rotation:270,verified:true};
          if (x > .66 && y > .66) return {rotation:90,verified:true};
        }
      } catch { /* Fall back when BarcodeDetector is unsupported. */ }
    }
    // Distinctive QR-like edge density in the four outside corners. This is an
    // estimate, never a guarantee; the UI always offers an angle override.
    const w = 256, h = Math.max(16, Math.round(256 * canvas.height / canvas.width));
    const probe = document.createElement('canvas');
    probe.width = w; probe.height = h;
    const ctx = probe.getContext('2d', { willReadFrequently:true })!;
    ctx.drawImage(canvas,0,0,w,h);
    const data = ctx.getImageData(0,0,w,h).data;
    const g = new Uint8Array(w*h);
    for (let i=0;i<g.length;i++)g[i]=(.299*data[4*i]+.587*data[4*i+1]+.114*data[4*i+2])|0;
    const configurations = [
      {angle:270 as const,x0:0,y0:0}, {angle:180 as const,x0:.75,y0:0},
      {angle:0 as const,x0:0,y0:.75}, {angle:90 as const,x0:.75,y0:.75}
    ];
    const scores = configurations.map(c=>{
      let score=0;
      for(let y=Math.max(2,Math.floor(c.y0*h));y<Math.min(h-2,Math.ceil((c.y0+.25)*h));y++)
        for(let x=Math.max(2,Math.floor(c.x0*w));x<Math.min(w-2,Math.ceil((c.x0+.25)*w));x++){
          const i=y*w+x;
          if(Math.abs(g[i-1]-g[i+1])>28 && Math.abs(g[i-w]-g[i+w])>28)score++;
        }
      return {rotation:c.angle,score};
    }).sort((a,b)=>b.score-a.score);
    return {rotation:scores[0].score>=12 && scores[0].score>scores[1].score*1.4
      ? scores[0].rotation : 0,verified:false};
  }

  /** Weak but useful orientation estimate from printed horizontal/vertical line edges.
   * Reject a noisy estimate instead of applying an arbitrary rotation. */
  private estimateSkew(source: HTMLCanvasElement, quarterTurn: number): number {
    const oriented = this.rotateCanvas(source, quarterTurn);
    const w = Math.max(1, Math.round(500 * oriented.width / Math.max(oriented.width, oriented.height)));
    const h = Math.max(1, Math.round(500 * oriented.height / Math.max(oriented.width, oriented.height)));
    const probe = document.createElement('canvas');
    probe.width=w;probe.height=h;
    const ctx=probe.getContext('2d',{willReadFrequently:true})!;
    ctx.drawImage(oriented,0,0,w,h);
    const rgba=ctx.getImageData(0,0,w,h).data, gray=new Uint8Array(w*h);
    for(let i=0;i<gray.length;i++)gray[i]=(.299*rgba[4*i]+.587*rgba[4*i+1]+.114*rgba[4*i+2])|0;
    const bins=new Float64Array(57); // -7° to +7° in 0.25° increments
    let count=0;
    for(let y=2;y<h-2;y+=2)for(let x=2;x<w-2;x+=2){
      const i=y*w+x;
      const gx=gray[i+1]-gray[i-1],gy=gray[i+w]-gray[i-w];
      const strength=Math.hypot(gx,gy);
      if(strength<40)continue;
      const degrees=Math.atan2(gy,gx)*180/Math.PI;
      const deviation=((degrees+135)%90+90)%90-45;
      if(Math.abs(deviation)>7)continue;
      const bin=Math.round((deviation+7)*4);
      bins[bin]+=Math.min(100,strength);
      count++;
    }
    if(count<60)return 0;
    let best=0,max=0,second=0;
    for(let i=0;i<bins.length;i++){
      const score=bins[Math.max(0,i-1)]+bins[i]+bins[Math.min(bins.length-1,i+1)];
      if(score>max){second=max;max=score;best=i;}else if(score>second)second=score;
    }
    const deviation=best/4-7;
    if(max<1200 || max<second*1.04 || Math.abs(deviation)<.4)return 0;
    return Math.round(-deviation*10)/10;
  }

  private rotateCanvas(source:HTMLCanvasElement,angle:number):HTMLCanvasElement{
    const rad=angle*Math.PI/180,co=Math.abs(Math.cos(rad)),si=Math.abs(Math.sin(rad));
    const w=Math.ceil(source.width*co+source.height*si)+2;
    const h=Math.ceil(source.width*si+source.height*co)+2;
    const canvas=document.createElement('canvas');
    canvas.width=w;canvas.height=h;
    const context=canvas.getContext('2d')!;
    context.fillStyle='#fff';context.fillRect(0,0,w,h);
    context.translate(w/2,h/2);
    context.rotate(rad);
    context.drawImage(source,-source.width/2,-source.height/2);
    return canvas;
  }

  private updatePreview(): void {
    if (!this.source)return;
    const oriented=this.rotateCanvas(this.source,this.quarterTurn()+this.fineAngle());
    const canvas=this.previewRef.nativeElement;
    canvas.width=oriented.width;canvas.height=oriented.height;
    canvas.getContext('2d')!.drawImage(oriented,0,0);
  }
  changeQuarterTurn(event:Event):void{
    this.quarterTurn.set(Number((event.target as HTMLSelectElement).value) as 0|90|180|270);
    this.updatePreview();
  }
  changeFineAngle(event:Event):void{
    this.fineAngle.set(Number((event.target as HTMLInputElement).value));
    this.updatePreview();
  }
  reset():void{
    this.quarterTurn.set(0);this.fineAngle.set(0);this.updatePreview();
    this.status.set('Original orientation restored. Nothing on the page has been removed.');
  }
  private getPreview():HTMLCanvasElement|null {
    return this.source ? this.previewRef.nativeElement : null;
  }
  async download():Promise<void>{
    const canvas=this.getPreview();
    if(!canvas)return;
    try{
      const file=await this.pdf.canvasToFile(canvas,'kora-straightened.png','image/png');
      const url=URL.createObjectURL(file),a=document.createElement('a');
      a.href=url;a.download=file.name;a.click();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){this.status.set('Download failed: '+String(error));}
  }
  async applyToBall():Promise<void>{
    const canvas=this.getPreview();
    if(!canvas||this.busy())return;
    this.busy.set(true);
    this.status.set('Applying complete straightened page to 3D ball...');
    try{
      // The viewer requires a square texture. Fit the full page proportionally,
      // leaving white margins; never crop any source pixel.
      const square=this.pdf.convertPdfPageTo3DBallTexture(canvas);
      const file=await this.pdf.canvasToFile(square,'kora-whole-page.png','image/png');
      await this.router.navigate(['/']);
      await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
      await this.loader.loadTextureFile(file);
    }catch(error){this.status.set('Could not apply to 3D ball: '+String(error));}
    finally{this.busy.set(false);}
  }
}
