import { Component, inject, signal } from '@angular/core';
import { ScanNormalizerService, NormalizedPage, QuarterTurn, RegistrationOptions } from './scan-normalizer.service';

@Component({
  selector:'app-scan-normalizer',
  standalone:true,
  template:`
    <section class="normalizer">
      <h3>SCAN → 1024×1024 TEMPLATE <small>BETA</small></h3>
      <p>Align the whole football net continuously to the exact 1024×1024 reference. Surrounding page details are removed using one connected net mask, never individual panel cuts.</p>
      <label>Colored PDF or photo
        <input type="file" accept=".pdf,application/pdf,image/*" [disabled]="busy()" (change)="load($event)">
      </label>
      <p class="status" role="status" aria-live="polite">{{status()}}</p>
      @if (source()) {
        <label>Printed sheet orientation
          <select [value]="rotation()" (change)="setRotation($event)">
            <option value="0">0°</option>
            <option value="90">90° clockwise</option>
            <option value="180">180°</option>
            <option value="270">90° counterclockwise</option>
          </select>
        </label>
        @if (!certain()) {
          <p class="warning">Automatic QR orientation is a suggestion. Confirm that the printed KORA logo is upright.</p>
        }
        <button type="button" [disabled]="busy()" (click)="run(false)">
          {{busy()?'ALIGNING PAGE...':'AUTO-ALIGN FULL SHEET'}}
        </button>
      }
      @if (result(); as output) {
        <div class="preview">
          <strong>Complete football net: 1024 × 1024 PNG</strong>
          <label class="guide-label"><input type="checkbox" [checked]="showGuides()"
            (change)="showGuides.set($any($event.target).checked)">
            Show expected panel outlines (preview only)</label>
          <div class="preview-stack">
            <img [src]="output.previewUrl" alt="Continuous whole-sheet aligned artwork">
            @if (showGuides()) {
              <img class="guide" src="templates/kora-guides.svg"
                alt="Expected panel outline overlay" />
            }
          </div>
          <p class="quality">Alignment: {{output.nearEdges}} / {{output.samples}} edge samples. Only artwork inside the connected net silhouette is exported.
            Inspect the green guide lines carefully; misaligned edges need adjustment.</p>
        </div>
        <label class="guide-label"><input type="checkbox" [checked]="approved()"
          (change)="approved.set($any($event.target).checked)">
          I checked all printed panel outlines against the green guide.</label>
        <button type="button" [disabled]="!approved()" (click)="download()">DOWNLOAD 1024×1024 NET PNG</button>
      }
      @if (source()) {
        <details>
          <summary>Fine alignment controls (no point selection)</summary>
          <p>Adjust the complete sheet if the printed outlines don't match the guide. No panel is cut or moved independently.</p>
          <label>Move horizontally {{shiftX()}} px
            <input type="range" min="-80" max="80" step="1" [value]="shiftX()" (input)="change('shiftX',$event)">
          </label>
          <label>Move vertically {{shiftY()}} px
            <input type="range" min="-80" max="80" step="1" [value]="shiftY()" (input)="change('shiftY',$event)">
          </label>
          <label>Width {{scaleX()}} %
            <input type="range" min="85" max="115" step=".5" [value]="scaleX()" (input)="change('scaleX',$event)">
          </label>
          <label>Height {{scaleY()}} %
            <input type="range" min="85" max="115" step=".5" [value]="scaleY()" (input)="change('scaleY',$event)">
          </label>
          <label>Fine rotation {{fineRotation()}}°
            <input type="range" min="-7" max="7" step=".1" [value]="fineRotation()" (input)="change('fineRotation',$event)">
          </label>
          <div class="buttons">
            <button type="button" [disabled]="busy()" (click)="run(true)">APPLY ADJUSTMENTS</button>
            <button type="button" [disabled]="busy()" (click)="reset()">RESET</button>
          </div>
        </details>
      }
    </section>
  `,
  styles:[`
    .normalizer{color:#eee;background:#11151b;border:1px solid #404854;border-radius:8px;padding:14px;font-size:12px}
    h3{font-size:13px;color:#ef4444;margin:0 0 8px}small{font-size:10px;color:#fbbf24}
    p{color:#b6b6b6;line-height:1.5}label{display:block;margin:10px 0;font-weight:600}
    input[type=file]{display:block;margin-top:6px;max-width:100%}
    input[type=range]{display:block;width:100%}
    select{background:#252b34;color:#fff;border:1px solid #58616e;padding:6px;margin-top:5px;width:100%}
    button{padding:10px 9px;background:#b91c1c;color:#fff;border:0;border-radius:5px;font-weight:600;cursor:pointer}
    button:disabled{opacity:.45;cursor:not-allowed}
    .preview{margin:15px 0}.preview-stack{position:relative;width:100%;aspect-ratio:1;background:#fff;margin:8px 0}
    .preview-stack img{display:block;position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
    .preview-stack .guide{opacity:.8;pointer-events:none}
    .guide-label{font-size:11px;font-weight:400}.guide-label input{vertical-align:middle}
    .warning{color:#fbbf24}.status{color:white;font-weight:600;overflow-wrap:anywhere}
    details{margin-top:12px}summary{cursor:pointer;color:#ddd}.buttons{display:flex;gap:8px}
  `]
})
export class ScanNormalizerComponent {
  private readonly normalizer=inject(ScanNormalizerService);
  readonly source=signal<HTMLCanvasElement|null>(null);
  readonly result=signal<NormalizedPage|null>(null);
  readonly busy=signal(false);
  readonly status=signal('Choose a scanned KORA PDF or image.');
  readonly rotation=signal<QuarterTurn>(0);
  readonly certain=signal(false);
  readonly shiftX=signal(0);
  readonly shiftY=signal(0);
  readonly scaleX=signal(100);
  readonly scaleY=signal(100);
  readonly fineRotation=signal(0);
  readonly showGuides=signal(true);
  readonly approved=signal(false);

  async load(event:Event):Promise<void>{
    const file=(event.target as HTMLInputElement).files?.[0];
    if(!file||this.busy())return;
    this.busy.set(true);this.clear();this.source.set(null);
    this.status.set('Reading scan...');
    try{
      const canvas=await this.normalizer.readFile(file);
      const guess=await this.normalizer.guessRotation(canvas);
      this.source.set(canvas);
      this.rotation.set(guess.rotation);
      this.certain.set(guess.certain);
      this.status.set('Scan loaded. Orientation guess: '+guess.rotation+'°. Reviewing full-page geometry...');
      await this.run(false,true);
    }catch(error){
      this.status.set('Scan failed: '+String(error));
      console.error('[KORA scan]',error);
    }finally{this.busy.set(false);}
  }
  setRotation(event:Event):void{
    this.rotation.set(Number((event.target as HTMLSelectElement).value) as QuarterTurn);
    this.certain.set(true);
    this.clear();
    this.status.set('New orientation selected. Click Auto-align full sheet.');
  }
  change(key:'shiftX'|'shiftY'|'scaleX'|'scaleY'|'fineRotation',event:Event):void{
    this[key].set(Number((event.target as HTMLInputElement).value));
  }
  private opts():RegistrationOptions{
    return {rotation:this.rotation(),shiftX:this.shiftX(),shiftY:this.shiftY(),
      scaleX:this.scaleX()/100,scaleY:this.scaleY()/100,fineRotation:this.fineRotation()};
  }
  async run(_manual=false,alreadyBusy=false):Promise<void>{
    const scan=this.source();
    if(!scan||(!alreadyBusy&&this.busy()))return;
    this.busy.set(true);this.clear();
    this.status.set('Registering one continuous page...');
    try{
      const response=await this.normalizer.normalize(scan,this.opts(),
        status=>this.status.set(status));
      this.result.set(response);
      this.status.set('Created 1024×1024 continuous image. Verify panel positions before download.');
    }catch(error){
      this.status.set('Alignment failed: '+String(error));
      console.error('[KORA full-page alignment]',error);
    }finally{this.busy.set(false);}
  }
  reset():void{
    this.shiftX.set(0);this.shiftY.set(0);this.scaleX.set(100);
    this.scaleY.set(100);this.fineRotation.set(0);
    void this.run(false);
  }
  download():void{
    const output=this.result();
    if(!output)return;
    const anchor=document.createElement('a');
    anchor.href=output.previewUrl;
    anchor.download='kora-sheet-aligned-1024.png';
    anchor.click();
  }
  private clear():void{
    this.approved.set(false);
    const old=this.result();
    if(old)URL.revokeObjectURL(old.previewUrl);
    this.result.set(null);
  }
}
