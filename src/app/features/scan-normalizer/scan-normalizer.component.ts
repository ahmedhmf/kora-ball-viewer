import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { ScanNormalizerService, RegistrationResult } from './scan-normalizer.service';

@Component({
  selector: 'app-scan-normalizer',
  standalone: true,
  template: `
    <section class="scan-normalizer">
      <h3>SCAN TO 3D TEXTURE <span class="experimental">BETA</span></h3>
      <p>Runs locally in your browser using the original blank print sheet.
         No manual point selection or server upload is needed.</p>

      <label>1. Child's scanned sheet (PDF / JPG / PNG)
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
          [disabled]="busy()" (change)="load($event, 'scan')" />
      </label>
      <label>2. Original blank KORA print PDF
        <input type="file" accept=".pdf,application/pdf,image/*"
          [disabled]="busy()" (change)="load($event, 'blank')" />
      </label>
      <label>3. Master 1024×1024 render texture
        <input type="file" accept="image/*"
          [disabled]="busy()" (change)="load($event, 'master')" />
      </label>

      <p class="files">Files ready:
        Scan <strong>{{ scan() ? '✓' : '—' }}</strong> ·
        Blank <strong>{{ blank() ? '✓' : '—' }}</strong> ·
        Texture <strong>{{ master() ? '✓' : '—' }}</strong>
      </p>
      <button type="button" (click)="normalize()"
        [disabled]="!scan() || !blank() || !master() || busy()">
        {{ busy() ? 'ANALYZING OUTLINES...' : 'AUTO ALIGN & REMOVE PAGE TEXT' }}
      </button>
      <p class="status" role="status" aria-live="polite">{{ status() }}</p>
      @if (busy()) {
        <p class="warning">Processing is active. If the worker stops responding, it will be
          terminated automatically and an error will appear here.</p>
      }
      @if (result(); as output) {
        <div class="result">
          <strong>1024×1024 registered texture</strong>
          <img [src]="output.previewUrl" alt="Automatically aligned child artwork on football net" />
          <p>Detected {{ panelCount() }} panels. Outline checks:
            {{ scanInliers() }} scan edges, {{ masterInliers() }} texture edges aligned.</p>
          <p class="warning">Inspect panel positions on the ball before final use.
            Automatic registration does not correct curved or folded paper.</p>
          <div class="actions">
            <button type="button" (click)="download()">DOWNLOAD PNG</button>
            <button type="button" (click)="render()">RENDER ON BALL</button>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .scan-normalizer {color:#e5e7eb;border:1px solid #374151;border-radius:8px;padding:14px;background:#101318;font-size:12px}
    h3 {font-size:13px;color:#ef4444;margin:0 0 10px}
    p {line-height:1.5;color:#aaa}
    .experimental {font-size:10px;color:#fbbf24;margin-left:5px}
    label {display:block;margin:10px 0;font-weight:600}
    input {display:block;margin-top:6px;max-width:100%;font-size:11px}
    button {background:#b91c1c;color:#fff;border:0;padding:9px;cursor:pointer;border-radius:4px;font-weight:600}
    button:disabled {opacity:.4;cursor:not-allowed}
    .actions {display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
    .result {margin-top:14px}
    .result img {display:block;width:100%;max-height:420px;object-fit:contain;background:#fff;margin-top:8px}
    .warning {color:#fbbf24}
    .status {overflow-wrap:anywhere;color:#f9fafb;font-weight:600}
    .files {font-size:11px}
  `],
})
export class ScanNormalizerComponent {
  @Output() textureReady = new EventEmitter<File>();
  private readonly processor = inject(ScanNormalizerService);

  // Angular 22 may run without Zone.js. Signals explicitly notify the view
  // when async file reads, worker messages, errors or PNG creation finish.
  readonly scan = signal<HTMLCanvasElement | null>(null);
  readonly blank = signal<HTMLCanvasElement | null>(null);
  readonly master = signal<HTMLCanvasElement | null>(null);
  readonly result = signal<RegistrationResult | null>(null);
  readonly panelCount = signal(0);
  readonly scanInliers = signal(0);
  readonly masterInliers = signal(0);
  readonly busy = signal(false);
  readonly status = signal(
    'Choose the colored scan, the original blank PDF and the known-working 1024×1024 texture.'
  );
  private operationId = 0;

  async load(event: Event, kind: 'scan' | 'blank' | 'master'): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.status.set('Reading ' + file.name + '...');
    try {
      const canvas = await this.processor.readFile(file);
      this[kind].set(canvas);
      this.clearResult();
      this.status.set('Loaded ' + file.name);
    } catch (error) {
      this.status.set('Could not read file: ' + String(error));
    } finally {
      this.busy.set(false);
    }
  }

  async normalize(): Promise<void> {
    const scan = this.scan(), blank = this.blank(), master = this.master();
    if (!scan || !blank || !master || this.busy()) return;
    const id = ++this.operationId;
    this.busy.set(true);
    this.clearResult();
    this.status.set('Starting background processing...');
    try {
      const output = await this.processor.registerWithBlank(scan, blank, master,
        (message) => {
          if (id === this.operationId) this.status.set(message);
        }
      );
      if (id !== this.operationId) {
        URL.revokeObjectURL(output.previewUrl);
        return;
      }
      this.result.set(output);
      this.panelCount.set(output.panels);
      this.scanInliers.set(output.scanInliers);
      this.masterInliers.set(output.masterInliers);
      this.status.set('Automatic registration complete. Review the preview.');
    } catch (error) {
      this.status.set('Automatic registration failed: ' + String(error));
      console.error('[KORA scan normalizer]', error);
    } finally {
      this.busy.set(false);
    }
  }

  private clearResult(): void {
    const existing = this.result();
    if (existing) URL.revokeObjectURL(existing.previewUrl);
    this.result.set(null);
  }

  download(): void {
    const output = this.result();
    if (!output) return;
    const anchor = document.createElement('a');
    anchor.href = output.previewUrl;
    anchor.download = 'kora-child-design-1024.png';
    anchor.click();
  }

  render(): void {
    const output = this.result();
    if (!output) return;
    this.textureReady.emit(new File([output.blob],
      'kora-child-design-1024.png', { type: 'image/png' }));
  }
}
