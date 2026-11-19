import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PdfConverterService } from '../../services/pdf-converter.service';
import { PaperStraightenerService } from '../../services/paper-straightener.service';
import { KoraScanNetService } from '../../services/kora-scan-net.service';
import { ModelLoaderService } from '../../services/model-loader.service';

/**
 * One-click A3 preparation: straighten the page when needed and place its
 * entire print into the OBJ square atlas. No panel is independently warped.
 */
@Component({
  selector: 'app-techpack-preparer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="orienter">
      <header>
        <div>
          <h2>KORA BALL TEXTURE PREPARER</h2>
          <p>Upload the original A3 PDF or upright photograph. Center only the printed football panels in one click.</p>
        </div>
        <a routerLink="/">Back to 3D Ball</a>
      </header>
      <div class="workspace">
        <section class="controls">
          <label>PDF or photo
            <input type="file" accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
              [disabled]="busy()" (change)="loadFile($event)" />
          </label>
          @if (hasImage()) {
            <p class="file">{{fileName()}}</p>
            <button type="button" class="prepare" [disabled]="busy()" (click)="prepareBallTexture()">
              {{busy() ? 'PREPARING...' : 'PREPARE BALL TEXTURE'}}
            </button>
            <p class="helper">Finds the actual grey football-panel outlines, straightens QR orientation, and centers the whole printed design on white. No individual panels are altered.</p>
          }
          <p class="status" role="status" aria-live="polite">{{status()}}</p>
          @if (prepared()) {
            <button type="button" [disabled]="busy()" (click)="flipWholeSheet()">Rotate entire design 180°</button>
            <button type="button" [disabled]="busy()" (click)="download()">Download ready PNG</button>
            <button type="button" [disabled]="busy()" (click)="applyToBall()">Apply to 3D Ball</button>
          }
        </section>
        <section class="preview">
          <h3>{{prepared() ? 'Ready: 32-panel 1024 × 1024 ball texture' : 'Original scan'}}</h3>
          <canvas #previewCanvas aria-label="Preview of the original scan or final OBJ-aligned ball texture"></canvas>
        </section>
      </div>
    </main>
  `,
  styles: [`
    .orienter{min-height:100vh;background:#0d0f12;color:#e5e7eb;padding:20px;box-sizing:border-box}
    header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}
    h2{font-size:18px;color:#ef4444;margin:0 0 6px}
    h3{font-size:14px;margin:0 0 12px}
    p{font-size:12px;color:#aeb4bd;line-height:1.5}
    a{color:#fca5a5}
    .workspace{display:grid;grid-template-columns:310px minmax(0,1fr);gap:16px}
    .controls,.preview{padding:16px;background:#10151c;border:1px solid #353b44;border-radius:8px}
    label{display:block;font-size:13px;font-weight:600;margin-bottom:16px}
    input[type=file]{display:block;width:100%;margin-top:8px;font-size:12px}
    button{display:block;width:100%;border:1px solid #555;background:#303744;color:white;padding:11px;cursor:pointer;border-radius:5px;margin:10px 0}
    button:disabled{opacity:.5;cursor:not-allowed}
    .prepare{background:#b91c1c;border-color:#b91c1c;font-weight:700}
    .status{color:#e5e7eb;font-weight:600;overflow-wrap:anywhere}
    .file{overflow-wrap:anywhere}.helper{color:#fcd34d}
    .preview{display:flex;flex-direction:column;align-items:center;min-width:0;max-height:87vh;overflow:auto}
    .preview h3{align-self:flex-start}
    .preview canvas{display:block;max-width:100%;height:auto;background:#fff}
    @media(max-width:800px){.workspace{grid-template-columns:1fr}}
  `]
})
export class TechpackPreparerComponent {
  @ViewChild('previewCanvas', { static: true }) private previewRef!: ElementRef<HTMLCanvasElement>;
  private readonly pdf = inject(PdfConverterService);
  private readonly paper = inject(PaperStraightenerService);
  private readonly scanNet = inject(KoraScanNetService);
  private readonly model = inject(ModelLoaderService);
  private readonly router = inject(Router);

  private original: HTMLCanvasElement | null = null;
  private ready: HTMLCanvasElement | null = null;
  private preparedSource: HTMLCanvasElement | null = null;
  readonly hasImage = signal(false);
  readonly prepared = signal(false);
  readonly busy = signal(false);
  readonly fileName = signal('');
  readonly status = signal('Upload an original KORA print or photo to begin.');

  async loadFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.busy()) return;

    this.busy.set(true);
    this.hasImage.set(false);
    this.prepared.set(false);
    this.original = null;
    this.ready = null;
    this.preparedSource = null;
    this.status.set('Reading original page...');
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      if (isPdf) {
        const pdfDocument = await this.pdf.loadPdfDocument(file);
        try {
          const page = await pdfDocument.getPage(1);
          const viewport = page.getViewport({scale:1});
          const scale = Math.min(2.4, 2400 / Math.max(viewport.width, viewport.height));
          const rendered = await this.pdf.renderPageToCanvas(pdfDocument, 1, scale);
          this.original = rendered.canvas;
        } finally {
          await pdfDocument.destroy();
        }
      } else if (file.type.startsWith('image/')) {
        const bitmap = await createImageBitmap(file);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Cannot read uploaded image.');
          ctx.drawImage(bitmap, 0, 0);
          this.original = canvas;
        } finally {
          bitmap.close();
        }
      } else {
        throw new Error('Please select a PDF, JPG, PNG or WEBP.');
      }
      this.fileName.set(file.name);
      this.hasImage.set(true);
      this.showCanvas(this.original);
      this.status.set('Scan loaded. Press Prepare Ball Texture to create the final 3D ball image.');
    } catch (error) {
      this.status.set('Could not load page: ' + String(error));
      console.error('[KORA upload]', error);
    } finally {
      this.busy.set(false);
    }
  }

  /** Straighten the complete A3 photo, orient the whole page, and safely extract its net. */
  async prepareBallTexture(): Promise<void> {
    if (!this.original || this.busy()) return;
    this.busy.set(true);
    this.prepared.set(false);
    this.ready = null;
    try {
      this.status.set('Preparing the upright A3 page...');
      const input=this.original;
      let corrected=input;
      // A PDF can be a scanned PHOTO (the supplied WhatsApp A3 is one).
      // Do not skip perspective correction because the container is .pdf.
      // The detector requires a long, consistently visible paper/table edge;
      // when it is not detected, retain the complete unmodified source.
      const detected=this.paper.detect(input);
      if (detected.confidence === 'detected') {
        this.status.set('Straightening the photographed A3 paper...');
        const corners=this.paper.corners(input,detected.topRight,detected.bottomRight);
        corrected=await this.paper.straighten(input,corners);
      }
      // Portrait paper can still be upside down. Always look for the
      // KORA QR marker and orient the WHOLE page, before any registration
      // or cropping. Rotating only landscape pages caused the 180° failure.
      this.status.set('Orienting the A3 print using its QR marker...');
      const oriented=await this.paper.orientPrintedSheet(corrected);
      // QR detection is advisory. Faint or partially scanned QR marks should
      // not block an otherwise usable A3 sheet. The user can flip the whole
      // original sheet with the 180° control after preparation.
      const orientationUncertain=!oriented.reliable;
      corrected=oriented.canvas;
      const ratio=corrected.width/corrected.height;
      if (ratio < .62 || ratio > .79)
        throw new Error('The original A3 page must be upright portrait (297 × 420 mm).');
      this.status.set('Detecting actual printed outlines in the A3 scan...');
      this.preparedSource=corrected;
      const atlas=this.scanNet.render(corrected);
      this.ready = atlas;
      this.prepared.set(true);
      this.showCanvas(atlas);
      this.status.set(orientationUncertain
        ? 'Texture prepared. QR orientation was uncertain: check the preview, and use Rotate entire design 180° if upside down.'
        : 'Ready: whole football print centered, with all panel artwork preserved.');
    } catch (error) {
      this.prepared.set(false);
      this.ready = null;
      this.showCanvas(this.original);
      this.status.set('Preparation failed: ' + String(error));
      console.error('[KORA one-click UV preparation]', error);
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Optional orientation correction for scans where the QR decoder gives a
   * false corner. Rotate the source A3 page and perform a NEW registration:
   * flipping only an already cropped atlas could keep incorrectly cut ink.
   */
  async flipWholeSheet(): Promise<void> {
    if (!this.preparedSource || !this.prepared() || this.busy()) return;
    this.busy.set(true);
    this.status.set('Rotating the entire A3 sheet 180° and rebuilding texture...');
    try {
      const source=this.preparedSource;
      const rotated=document.createElement('canvas');
      rotated.width=source.width;
      rotated.height=source.height;
      const ctx=rotated.getContext('2d');
      if(!ctx)throw new Error('Cannot rotate original A3 artwork');
      ctx.translate(rotated.width,rotated.height);
      ctx.rotate(Math.PI);
      ctx.drawImage(source,0,0);
      const atlas=this.scanNet.render(rotated);
      this.preparedSource=rotated;
      this.ready=atlas;
      this.showCanvas(atlas);
      this.status.set('Whole-sheet orientation flipped 180°. All panel artwork retained.');
    } catch(error) {
      this.status.set('Could not flip the A3 design: '+String(error));
      console.error('[KORA whole-page rotate]',error);
    } finally {
      this.busy.set(false);
    }
  }

  private showCanvas(source: HTMLCanvasElement): void {
    const preview = this.previewRef.nativeElement;
    preview.width = source.width;
    preview.height = source.height;
    const ctx = preview.getContext('2d');
    if (!ctx) throw new Error('Cannot preview prepared texture');
    ctx.drawImage(source, 0, 0);
  }

  async download(): Promise<void> {
    if (!this.ready || !this.prepared() || this.busy()) return;
    try {
      const file = await this.pdf.canvasToFile(this.ready, 'kora-ready-ball-1024.png', 'image/png');
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      this.status.set('Download failed: ' + String(error));
    }
  }

  async applyToBall(): Promise<void> {
    if (!this.ready || !this.prepared() || this.busy()) return;
    this.busy.set(true);
    try {
      // Final atlas is already 1024x1024 and must NOT be recropped or padded.
      const file = await this.pdf.canvasToFile(this.ready, 'kora-ready-ball-1024.png', 'image/png');
      await this.router.navigate(['/']);
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      await this.model.loadTextureFile(file);
    } catch (error) {
      this.status.set('Applying to ball failed: ' + String(error));
      console.error('[KORA texture apply]', error);
    } finally {
      this.busy.set(false);
    }
  }
}
