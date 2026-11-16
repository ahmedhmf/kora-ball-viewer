import { Component, EventEmitter, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScanNormalizerService, RegistrationResult } from './scan-normalizer.service';

@Component({
  selector: 'app-scan-normalizer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section class="scan-normalizer">
      <h3>SCAN TO 3D TEXTURE <span class="experimental">BETA</span></h3>
      <p>Automatic registration uses the original uncolored print sheet.
         Your child's drawings stay intact, and page text outside the 32 panels is removed.</p>
      <label>1. Child's scanned sheet (PDF / JPG / PNG)
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*" (change)="load($event, 'scan')" />
      </label>
      <label>2. Original blank KORA print PDF
        <input type="file" accept=".pdf,application/pdf,image/*" (change)="load($event, 'blank')" />
      </label>
      <label>3. Exact master 1024×1024 render texture
        <input type="file" accept="image/*" (change)="load($event, 'master')" />
      </label>
      <button (click)="normalize()" [disabled]="!scan || !blank || !master || busy">
        {{ busy ? 'ANALYZING OUTLINES...' : 'AUTO ALIGN & REMOVE PAGE TEXT' }}
      </button>
      <p class="status" role="status">{{status}}</p>
      <div *ngIf="result" class="result">
        <strong>1024×1024 registered texture</strong>
        <img [src]="result.previewUrl" alt="Automatically aligned child artwork on the football net" />
        <p>Detected {{panelCount}} panels. Alignment: {{scanInliers}} scan matches, {{masterInliers}} texture matches.</p>
        <p class="warning">Inspect placement on the football before using it for manufacturing.
          Automatic alignment cannot correct bent or curved paper.</p>
        <div class="actions">
          <button (click)="download()">DOWNLOAD PNG</button>
          <button (click)="render()">RENDER ON BALL</button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .scan-normalizer {color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:14px;background:#101318;font-size:12px}
    h3 {font-size:13px;color:#ef4444;margin:0 0 10px} p {line-height:1.5;color:#aaa}
    .experimental {font-size:10px;color:#fbbf24;margin-left:5px}
    label {display:block;margin:10px 0;font-weight:600}
    input {display:block;margin-top:6px;max-width:100%;font-size:11px}
    button {background:#b91c1c;color:#fff;border:0;padding:9px;cursor:pointer;border-radius:4px;font-weight:600}
    button:disabled {opacity:.4;cursor:not-allowed}
    .actions {display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
    .result {margin-top:14px}
    .result img {display:block;width:100%;max-height:420px;object-fit:contain;background:#fff;margin-top:8px}
    .warning {color:#fbbf24}.status {overflow-wrap:anywhere}
  `],
})
export class ScanNormalizerComponent {
  @Output() textureReady = new EventEmitter<File>();
  private readonly processor = inject(ScanNormalizerService);
  scan?: HTMLCanvasElement;
  blank?: HTMLCanvasElement;
  master?: HTMLCanvasElement;
  result?: RegistrationResult;
  panelCount = 0;
  scanInliers = 0;
  masterInliers = 0;
  busy = false;
  currentStep = '';
  private operationId = 0;
  status = 'Choose the colored scan, the original blank PDF and the known-working 1024×1024 texture.';
  async load(event: Event, kind: 'scan' | 'blank' | 'master'): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || this.busy) return;
    this.busy = true;
    try {
      const canvas = await this.processor.readFile(file);
      this[kind] = canvas;
      this.clearResult();
      this.status = 'Loaded ' + file.name;
    } catch (error) { this.status = 'Could not read file: ' + String(error); }
    finally { this.busy = false; }
  }
  async normalize(): Promise<void> {
    if (!this.scan || !this.blank || !this.master || this.busy) return;
    this.busy = true;
    const id = ++this.operationId;
    this.clearResult();
    this.status = 'Starting background processing...';
    try {
      const res = await this.processor.registerWithBlank(this.scan, this.blank, this.master,
        (message) => { if (id === this.operationId) this.status = message; });
      this.result = res;
      this.panelCount = res.panels;
      this.scanInliers = res.scanInliers;
      this.masterInliers = res.masterInliers;
      this.status = 'Automatic registration complete. Review the preview.';
    } catch (error) {
      this.status = 'Automatic registration failed: ' + String(error) + '. You can retry after checking your files.';
    } finally { this.busy = false; }
  }
  private clearResult(): void {
    if (this.result) URL.revokeObjectURL(this.result.previewUrl);
    this.result = undefined;
  }
  download(): void {
    if (!this.result) return;
    const a = document.createElement('a');
    a.href = this.result.previewUrl;
    a.download = 'kora-child-design-1024.png';
    a.click();
  }
  render(): void {
    if (!this.result) return;
    this.textureReady.emit(new File([this.result.blob],
      'kora-child-design-1024.png', {type:'image/png'}));
  }
}
