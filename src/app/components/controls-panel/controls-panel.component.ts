import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BallVisualizerStore } from '../../store/ball-visualizer.store';
import { BabylonEngineService } from '../../services/babylon-engine.service';
import { ModelLoaderService } from '../../services/model-loader.service';

@Component({
  selector: 'app-controls-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="controls-card">
      <div class="card-header">
        <h3>3. BALL DYNAMICS & OPTICS</h3>
        <span class="badge">PRO-LEVEL</span>
      </div>

      <div class="control-group">
        <div class="control-label">
          <span>TILT ANGLE</span>
          <span class="value-display">{{ store.formattedTilt() }}</span>
        </div>
        <input
          type="range"
          min="-90"
          max="90"
          step="1"
          [ngModel]="store.tiltAngle()"
          (ngModelChange)="onTiltChange($event)"
          class="slider"
        />
      </div>

      <div class="control-group">
        <div class="control-label">
          <span>ROTATION SPEED</span>
          <span class="value-display">{{ store.formattedSpeed() }}</span>
        </div>
        <input
          type="range"
          min="0"
          max="0.1"
          step="0.002"
          [ngModel]="store.rotationSpeed()"
          (ngModelChange)="onSpeedChange($event)"
          class="slider"
        />
      </div>

      <div class="toggle-group">
        <label class="toggle-label">
          <input
            type="checkbox"
            [ngModel]="store.autoRotate()"
            (ngModelChange)="onAutoRotateChange($event)"
          />
          <span class="toggle-text">Continuous Spin</span>
        </label>

        <label class="toggle-label">
          <input
            type="checkbox"
            [ngModel]="store.stadiumBgEnabled()"
            (ngModelChange)="onStadiumBgChange($event)"
          />
          <span class="toggle-text">Stadium Background</span>
        </label>
      </div>

      <div class="toggle-group">
        <label class="toggle-label">
          <input
            type="checkbox"
            [ngModel]="store.wireframe()"
            (ngModelChange)="onWireframeChange($event)"
          />
          <span class="toggle-text">Wireframe Mesh</span>
        </label>
      </div>

      <hr class="divider" />

      <div class="card-header">
        <h3>FACE FILTER ORIENTATION</h3>
      </div>

      <div class="toggle-group">
        <label class="toggle-label">
          <input
            type="checkbox"
            [ngModel]="store.invertY()"
            (ngModelChange)="onInvertYChange($event)"
          />
          <span class="toggle-text">Invert Y (Flip Vertical)</span>
        </label>
      </div>

      <div class="control-group" *ngIf="store.hasTexture()">
        <div class="control-label">
          <span>ROTATE GRAPHIC</span>
          <span class="value-display">{{ store.textureAngle() }}°</span>
        </div>
        <div class="button-group">
          <button
            *ngFor="let angle of [0, 90, 180, 270]"
            type="button"
            class="angle-btn"
            [class.active]="store.textureAngle() === angle"
            (click)="onTextureAngleChange(angle)"
          >
            {{ angle }}°
          </button>
        </div>
      </div>

      <hr class="divider" />

      <div class="card-header">
        <h3>PANEL MATERIAL OPTICS</h3>
      </div>

      <div class="control-group">
        <div class="control-label">
          <span>METALLIC</span>
          <span class="value-display">{{ store.metallic().toFixed(2) }}</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.02"
          [ngModel]="store.metallic()"
          (ngModelChange)="onMetallicChange($event)"
          class="slider"
        />
      </div>

      <div class="control-group">
        <div class="control-label">
          <span>ROUGHNESS</span>
          <span class="value-display">{{ store.roughness().toFixed(2) }}</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.02"
          [ngModel]="store.roughness()"
          (ngModelChange)="onRoughnessChange($event)"
          class="slider"
        />
      </div>

      <div class="action-buttons">
        <button class="action-btn secondary" (click)="onResetCamera()">
          📷 RESET VIEW
        </button>
        <button class="action-btn secondary" (click)="onTakeScreenshot()">
          ✨ SNAPSHOT
        </button>
      </div>

      <button class="action-btn default-model-btn" (click)="onLoadDefaultModel()">
        ⚽ RELOAD DEFAULT 32-PANEL BALL
      </button>

      <hr class="divider" />

      <div class="card-header">
        <h3>EXPORT 360° VIDEO</h3>
        <div class="format-selector">
          <button
            type="button"
            class="format-btn"
            [class.active]="store.exportFormat() === 'mp4'"
            (click)="onFormatChange('mp4')"
          >
            MP4
          </button>
          <button
            type="button"
            class="format-btn"
            [class.active]="store.exportFormat() === 'webm'"
            (click)="onFormatChange('webm')"
          >
            WEBM
          </button>
        </div>
      </div>

      <!-- Export 360 Video Button -->
      <button
        class="action-btn record-btn"
        [class.recording]="store.isRecording()"
        [disabled]="store.isRecording()"
        (click)="onExport360Video()"
      >
        <span *ngIf="!store.isRecording()">
          🎥 EXPORT 360° {{ store.exportFormat().toUpperCase() }} VIDEO
        </span>
        <span *ngIf="store.isRecording()">
          🔴 ENCODING {{ store.exportFormat().toUpperCase() }}... {{ store.recordingProgress() }}%
        </span>
      </button>

      <!-- Video Progress Bar -->
      <div class="progress-bar-container" *ngIf="store.isRecording()">
        <div class="progress-bar-fill" [style.width.%]="store.recordingProgress()"></div>
      </div>
    </div>
  `,
  styles: [
    `
      .controls-card {
        background: #101318;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 18px;
        color: #f3f4f6;
        display: flex;
        flex-direction: column;
        gap: 14px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      }

      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .card-header h3 {
        margin: 0;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 1px;
        color: #ef4444; // KORA red primary
        text-transform: uppercase;
      }

      .badge {
        font-size: 0.65rem;
        font-weight: 700;
        padding: 2px 6px;
        background: rgba(239, 68, 68, 0.15);
        color: #ef4444;
        border: 1px solid rgba(239, 68, 68, 0.35);
        border-radius: 4px;
        letter-spacing: 0.5px;
      }

      .format-selector {
        display: flex;
        gap: 4px;
        background: rgba(255, 255, 255, 0.06);
        padding: 2px;
        border-radius: 4px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .format-btn {
        padding: 2px 8px;
        font-size: 0.68rem;
        font-weight: 700;
        border: none;
        background: transparent;
        color: #9ca3af;
        border-radius: 3px;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .format-btn.active {
        background: #ef4444;
        color: #ffffff;
      }

      .control-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .control-label {
        display: flex;
        justify-content: space-between;
        font-size: 0.75rem;
        font-weight: 600;
        letter-spacing: 0.5px;
        color: #9ca3af;
      }

      .value-display {
        color: #ef4444; // KORA red primary
        font-weight: 700;
        font-family: monospace;
      }

      .slider {
        -webkit-appearance: none;
        width: 100%;
        height: 5px;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.12);
        outline: none;
        transition: background 0.2s;
      }

      .slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #ef4444; // KORA red thumb
        cursor: pointer;
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
        transition: transform 0.15s ease;
      }

      .slider::-webkit-slider-thumb:hover {
        transform: scale(1.2);
      }

      .toggle-group {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        margin-top: 2px;
      }

      .toggle-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.78rem;
        color: #d1d5db;
        cursor: pointer;
      }

      .toggle-label input[type='checkbox'] {
        accent-color: #ef4444;
        width: 15px;
        height: 15px;
        cursor: pointer;
      }

      .button-group {
        display: flex;
        gap: 8px;
      }

      .angle-btn {
        flex: 1;
        padding: 6px 4px;
        font-size: 0.75rem;
        font-weight: 600;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 4px;
        color: #d1d5db;
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .angle-btn:hover {
        background: rgba(255, 255, 255, 0.15);
      }

      .angle-btn.active {
        background: #ef4444;
        border-color: #f87171;
        color: #ffffff;
        font-weight: 700;
      }

      .divider {
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.08);
        margin: 2px 0;
      }

      .action-buttons {
        display: flex;
        gap: 10px;
      }

      .action-btn {
        padding: 9px;
        border-radius: 6px;
        font-size: 0.75rem;
        font-weight: 700;
        letter-spacing: 0.5px;
        cursor: pointer;
        transition: all 0.2s ease;
        border: none;
      }

      .action-btn.secondary {
        flex: 1;
        background: rgba(255, 255, 255, 0.06);
        color: #e5e7eb;
        border: 1px solid rgba(255, 255, 255, 0.15);
      }

      .action-btn.secondary:hover {
        background: rgba(255, 255, 255, 0.15);
        border-color: rgba(239, 68, 68, 0.4);
      }

      .action-btn.default-model-btn {
        width: 100%;
        background: rgba(255, 255, 255, 0.04);
        color: #d1d5db;
        border: 1px solid rgba(255, 255, 255, 0.15);
      }

      .action-btn.default-model-btn:hover {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(239, 68, 68, 0.5);
        color: #ffffff;
      }

      .action-btn.record-btn {
        width: 100%;
        margin-top: 2px;
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: #ffffff;
        box-shadow: 0 4px 15px rgba(239, 68, 68, 0.35);
      }

      .action-btn.record-btn:hover:not(:disabled) {
        transform: translateY(-1px);
        box-shadow: 0 6px 20px rgba(239, 68, 68, 0.5);
      }

      .action-btn.record-btn.recording {
        background: linear-gradient(135deg, #b91c1c, #991b1b);
        color: #ffffff;
        box-shadow: 0 0 15px rgba(239, 68, 68, 0.7);
        animation: pulse 1.5s infinite;
      }

      .progress-bar-container {
        width: 100%;
        height: 5px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 2px;
        overflow: hidden;
      }

      .progress-bar-fill {
        height: 100%;
        background: #ef4444;
        transition: width 0.1s linear;
      }

      @keyframes pulse {
        0%, 100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }
    `,
  ],
})
export class ControlsPanelComponent {
  readonly store = inject(BallVisualizerStore);
  private babylonEngine = inject(BabylonEngineService);
  private modelLoader = inject(ModelLoaderService);

  onTiltChange(angle: number): void {
    this.store.setTilt(angle);
    this.babylonEngine.setTilt(angle);
  }

  onSpeedChange(speed: number): void {
    this.store.setSpeed(speed);
    this.babylonEngine.setRotationSpeed(speed);
  }

  onAutoRotateChange(enabled: boolean): void {
    this.store.setAutoRotate(enabled);
    this.babylonEngine.setAutoRotate(enabled);
  }

  onStadiumBgChange(enabled: boolean): void {
    this.store.setStadiumBgEnabled(enabled);
    this.babylonEngine.setStadiumBgEnabled(enabled);
  }

  onMetallicChange(value: number): void {
    this.store.setMetallic(value);
    this.babylonEngine.setMetallic(value);
  }

  onRoughnessChange(value: number): void {
    this.store.setRoughness(value);
    this.babylonEngine.setRoughness(value);
  }

  onWireframeChange(enabled: boolean): void {
    this.store.setWireframe(enabled);
    this.babylonEngine.setWireframe(enabled);
  }

  onInvertYChange(enabled: boolean): void {
    this.store.setInvertY(enabled);
    this.babylonEngine.setTextureInvertY(enabled);
  }

  onTextureAngleChange(angle: number): void {
    this.store.setTextureAngle(angle);
    this.babylonEngine.setTextureAngle(angle);
  }

  onFormatChange(format: 'mp4' | 'webm'): void {
    this.store.setExportFormat(format);
  }

  onLoadDefaultModel(): void {
    this.modelLoader.loadDefaultModel();
  }

  onResetCamera(): void {
    this.babylonEngine.resetCamera();
  }

  async onTakeScreenshot(): Promise<void> {
    try {
      const dataUrl = await this.babylonEngine.captureScreenshot();
      const link = document.createElement('a');
      link.download = `kora-ball-visualizer-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Screenshot error:', err);
    }
  }

  async onExport360Video(): Promise<void> {
    if (this.store.isRecording()) return;

    try {
      this.store.setIsRecording(true, 0);
      const format = this.store.exportFormat();

      let videoBlob: Blob;
      if (format === 'mp4') {
        videoBlob = await this.babylonEngine.record360MP4Video(6, (progress) => {
          this.store.setRecordingProgress(progress);
        });
      } else {
        videoBlob = await this.babylonEngine.record360VideoMediaRecorder(
          this.babylonEngine.getScene().getEngine().getRenderingCanvas()!,
          6,
          'video/webm',
          (progress) => {
            this.store.setRecordingProgress(progress);
          }
        );
      }

      const url = URL.createObjectURL(videoBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kora-360-ball-${Date.now()}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error('Video recording error:', err);
      this.store.setStatus(`Failed to record video: ${err.message || err}`);
    } finally {
      this.store.setIsRecording(false);
    }
  }
}
