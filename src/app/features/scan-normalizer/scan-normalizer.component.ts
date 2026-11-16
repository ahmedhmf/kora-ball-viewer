import { Component, inject, signal } from '@angular/core';
import { ScanNormalizerService, QuarterTurn } from './scan-normalizer.service';

@Component({
  selector: 'app-scan-normalizer',
  standalone: true,
  template: `
    <section class="sheet-orienter">
      <h3>ORIENT KORA SCAN <span class="experimental">BETA</span></h3>
      <p>Rotation only. We never move, cut, redraw or recolor the artwork.</p>
      <label>Upload scanned PDF or image
        <input type="file" accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
          [disabled]="busy()" (change)="onFile($event)" />
      </label>
      <p role="status" aria-live="polite" class="status">{{status()}}</p>
      @if (source()) {
        <p class="selection">Detected orientation: {{rotation()}}° clockwise.
          @if (confidence() === 'uncertain') {
            <strong>Please confirm visually.</strong>
          }
        </p>
        <label>Adjust rotation if necessary
          <select [value]="rotation()" (change)="changeRotation($event)">
            <option value="0">0° – unchanged</option>
            <option value="90">90° clockwise</option>
            <option value="180">180°</option>
            <option value="270">90° counterclockwise</option>
          </select>
        </label>
        <div class="preview">
          <strong>Entire page preview — no cropping</strong>
          <img [src]="previewUrl()" alt="Full KORA sheet with corrected rotation" />
        </div>
        <button type="button" [disabled]="busy()" (click)="download()">
          {{busy() ? 'PREPARING FILE...' : 'DOWNLOAD ORIENTED ' + (isPdf() ? 'PDF' : 'PNG')}}
        </button>
        <p class="note">The original file remains unchanged. The PDF output rotates its
          existing pages without redrawing their content. If the QR cannot be recognized,
          choose the correct orientation above.</p>
      }
    </section>
  `,
  styles: [`
    .sheet-orienter {color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:14px;background:#101318;font-size:12px}
    h3 {font-size:13px;color:#ef4444;margin:0 0 10px}
    p {color:#aaa;line-height:1.5}
    .experimental {font-size:10px;color:#fbbf24;margin-left:5px}
    label {display:block;margin:12px 0;font-weight:600}
    input,select {display:block;margin-top:6px;max-width:100%;font-size:12px}
    select {background:#20242c;color:white;padding:7px;width:100%;border:1px solid #4b5563}
    button {background:#b91c1c;color:white;border:0;padding:10px;border-radius:4px;font-weight:600;cursor:pointer}
    button:disabled {opacity:.4;cursor:not-allowed}
    .status {font-weight:600;color:#f9fafb;overflow-wrap:anywhere}
    .selection strong {color:#fbbf24}
    .preview {margin:12px 0}
    .preview strong {display:block;margin-bottom:6px}
    .preview img {width:100%;max-height:460px;object-fit:contain;background:#fff}
    .note {font-size:11px}
  `]
})
export class ScanNormalizerComponent {
  private readonly processor = inject(ScanNormalizerService);
  readonly source = signal<HTMLCanvasElement | null>(null);
  readonly rotation = signal<QuarterTurn>(0);
  readonly confidence = signal<'high' | 'uncertain'>('uncertain');
  readonly status = signal('Upload the full KORA scan to detect its printed-sheet orientation.');
  readonly busy = signal(false);
  readonly isPdf = signal(false);
  readonly previewUrl = signal('');
  private file: File | null = null;

  async onFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.file = null;
    this.source.set(null);
    this.clearPreview();
    this.status.set('Reading full sheet and locating printed QR code...');
    try {
      const canvas = await this.processor.preview(file);
      const guess = await this.processor.detectOrientation(canvas);
      this.file = file;
      this.source.set(canvas);
      this.isPdf.set(file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
      this.rotation.set(guess.rotation);
      this.confidence.set(guess.confidence);
      this.updatePreview();
      this.status.set(guess.explanation);
    } catch (error) {
      this.status.set('Cannot open file: ' + String(error));
    } finally {
      this.busy.set(false);
    }
  }

  changeRotation(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (value !== 0 && value !== 90 && value !== 180 && value !== 270) return;
    this.rotation.set(value as QuarterTurn);
    this.confidence.set('high');
    this.status.set('Rotation selected manually. Confirm the QR is at bottom-left before downloading.');
    this.updatePreview();
  }

  private clearPreview(): void {
    const previous = this.previewUrl();
    if (previous) URL.revokeObjectURL(previous);
    this.previewUrl.set('');
  }

  private updatePreview(): void {
    const source = this.source();
    if (!source) return;
    const oriented = this.processor.rotatePreview(source, this.rotation());
    oriented.toBlob(blob => {
      if (!blob) return;
      this.clearPreview();
      this.previewUrl.set(URL.createObjectURL(blob));
    }, 'image/png');
  }

  async download(): Promise<void> {
    if (!this.file || !this.source() || this.busy()) return;
    this.busy.set(true);
    this.status.set('Preparing full-page file with rotation only...');
    try {
      const blob = await this.processor.exportFile(this.file, this.rotation(), this.source()!);
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      const stem = this.file.name.replace(/\.[^.]+$/, '');
      link.href = url;
      link.download = stem + '-oriented.' + (this.isPdf() ? 'pdf' : 'png');
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.status.set('Oriented file prepared. Original artwork and page layout preserved.');
    } catch (error) {
      this.status.set('Download failed: ' + String(error));
    } finally { this.busy.set(false); }
  }
}
