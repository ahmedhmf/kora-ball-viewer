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
      <p>Process a child's PDF or WhatsApp image locally. No scan is uploaded to a server.</p>
      <label>1. Child's scanned sheet (PDF / JPG / PNG)
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*" (change)="loadScan($event)" />
      </label>
      <label>2. Exact 1024×1024 master texture
        <input type="file" accept="image/*" (change)="loadMaster($event)" />
      </label>
      <button (click)="normalize()" [disabled]="!scan || !master || busy">
        {{ busy ? 'PROCESSING...' : 'AUTO ALIGN SCAN' }}
      </button>
      <p class="status" role="status">{{ status }}</p>
      <p *ngIf="result && result.method === 'estimated'" class="warning">
        Automatic matching was not confident. This is an approximate preview only.
        Use four matching panel corners below to align accurately before rendering.
      </p>
      <p *ngIf="result && result.method === 'automatic'">Automatic alignment: {{result.inliers}} inliers from {{result.matches}} matches. Inspect the preview before rendering.</p>
      <div class="images" *ngIf="scan && master">
        <div><strong>Scan</strong><canvas #scanView (click)="pickPoint($event, 'scan')" title="Click four matching panel corners"></canvas></div>
        <div><strong>Master</strong><canvas #masterView (click)="pickPoint($event, 'master')" title="Click corresponding corners in same order"></canvas></div>
      </div>
      <p *ngIf="scan && master">Manual adjustment: select 4 matching panel corners on Scan, then the same 4 corners on Master. Points: {{scanPoints.length}} / {{masterPoints.length}}.</p>
      <div class="actions" *ngIf="scan && master">
        <button (click)="resetPoints()" [disabled]="busy">CLEAR POINTS</button>
        <button (click)="manualAlign()" [disabled]="busy || scanPoints.length !== 4 || masterPoints.length !== 4">ALIGN BY 4 POINTS</button>
      </div>
      <div *ngIf="result" class="result">
        <strong>1024×1024 result — {{result.method}}</strong>
        <img [src]="result.previewUrl" alt="Normalized football texture preview" />
        <div class="actions">
          <button (click)="download()">DOWNLOAD PNG</button>
          <button (click)="render()" [disabled]="result.method === 'estimated'">RENDER ON BALL</button>
        </div>
      </div>
    </section>
  `,
  styles: [`
    .scan-normalizer { color:#e5e7eb; border:1px solid #374151; border-radius:8px; padding:14px; background:#101318; font-size:12px; }
    h3 {font-size:13px; color:#ef4444; margin:0 0 10px} p {line-height:1.4; color:#aaa}
    .experimental {font-size:10px; color:#fbbf24; margin-left:5px}
    label {display:block; margin:10px 0; font-weight:600} input {display:block; margin-top:6px; max-width:100%; font-size:11px}
    button {background:#b91c1c; color:#fff; border:0; padding:9px; cursor:pointer; border-radius:4px; font-weight:600}
    button:disabled {opacity:.4; cursor:not-allowed} .warning {color:#fbbf24}
    .images {display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:14px}
    .images canvas {width:100%; height:auto; cursor:crosshair; background:white; border:1px solid #555}
    .images strong {display:block; margin-bottom:4px} .actions {display:flex; flex-wrap:wrap; gap:8px; margin-top:10px}
    .result {margin-top:14px} .result img {display:block; width:100%; max-height:360px; object-fit:contain; background:#fff; margin-top:8px}
    .status {overflow-wrap:anywhere}
  `]
})
export class ScanNormalizerComponent {
  @Output() textureReady = new EventEmitter<File>();
  private processor = inject(ScanNormalizerService);
  scan?: HTMLCanvasElement;
  master?: HTMLCanvasElement;
  result?: RegistrationResult;
  busy = false;
  status = 'Choose a scan and the original reference texture.';
  scanPoints: [number, number][] = [];
  masterPoints: [number, number][] = [];

  private async open(file: File | undefined, type: 'scan' | 'master') {
    if (!file) return;
    this.busy = true;
    try {
      const canvas = await this.processor.readFile(file);
      if (type === 'scan') this.scan = canvas;
      else this.master = canvas;
      this.clearResult();
      this.resetPoints();
      this.status = 'Loaded ' + file.name;
      // Let Angular insert the canvases before drawing.
      setTimeout(() => this.drawViews(), 0);
    } catch (error) { this.status = String(error); }
    finally { this.busy = false; }
  }
  loadScan(event: Event) { void this.open((event.target as HTMLInputElement).files?.[0], 'scan'); }
  loadMaster(event: Event) { void this.open((event.target as HTMLInputElement).files?.[0], 'master'); }
  private drawViews() {
    this.draw('scan', this.scan, this.scanPoints);
    this.draw('master', this.master, this.masterPoints);
  }
  private draw(which: 'scan' | 'master', source: HTMLCanvasElement | undefined, points: [number, number][]) {
    if (!source) return;
    const canvas = document.querySelector<HTMLCanvasElement>(which === 'scan' ? '.scan-normalizer canvas:first-of-type' : '.scan-normalizer .images > div:nth-child(2) canvas');
    if (!canvas) return;
    canvas.width = source.width; canvas.height = source.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(source, 0, 0);
    points.forEach(([x, y], index) => {
      const size = Math.max(8, source.width / 90);
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.lineWidth = size / 3; ctx.strokeStyle = '#00d1ff'; ctx.stroke();
      ctx.font = `${size * 2}px sans-serif`; ctx.fillStyle = '#0055ee'; ctx.fillText(String(index + 1), x + size, y - size);
    });
  }
  pickPoint(event: MouseEvent, type: 'scan' | 'master') {
    const canvas = event.target as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const p: [number, number] = [(event.clientX - rect.left) * canvas.width / rect.width,
      (event.clientY - rect.top) * canvas.height / rect.height];
    const points = type === 'scan' ? this.scanPoints : this.masterPoints;
    if (points.length === 4) return;
    points.push(p);
    this.drawViews();
  }
  resetPoints() { this.scanPoints = []; this.masterPoints = []; this.drawViews(); }
  private clearResult() {
    if (this.result) URL.revokeObjectURL(this.result.previewUrl);
    this.result = undefined;
  }
  async normalize(manual = false) {
    if (!this.scan || !this.master || this.busy) return;
    this.busy = true;
    this.status = 'Aligning template in browser...';
    try {
      const points = manual ? { scan: this.scanPoints, master: this.masterPoints } : undefined;
      const next = await this.processor.register(this.scan, this.master, points);
      this.clearResult();
      this.result = next;
      this.status = next.method === 'estimated'
        ? 'Low-confidence automatic result: select 4 matching corners to correct alignment.'
        : 'Registration complete. Inspect the resulting texture before applying.';
    } catch (error) { this.status = 'Alignment failed: ' + String(error); }
    finally { this.busy = false; }
  }
  manualAlign() { void this.normalize(true); }
  download() {
    if (!this.result) return;
    const a = document.createElement('a');
    a.href = this.result.previewUrl; a.download = 'kora-normalized-1024.png'; a.click();
  }
  render() {
    if (!this.result || this.result.method === 'estimated') return;
    this.textureReady.emit(new File([this.result.blob], 'kora-normalized-1024.png', { type: 'image/png' }));
  }
}
