import { Component, ElementRef, ViewChild, AfterViewInit, inject, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { BabylonEngineService } from '../../services/babylon-engine.service';
import { BallTexturePreparationService } from '../../services/ball-texture-preparation.service';
import { ModelLoaderService } from '../../services/model-loader.service';
import { AuthService } from '../../services/auth.service';
import { BallVisualizerStore } from '../../store/ball-visualizer.store';
import { DropZoneComponent } from '../drop-zone/drop-zone.component';
import { ControlsPanelComponent } from '../controls-panel/controls-panel.component';

@Component({
  selector: 'app-viewer',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DropZoneComponent,
    ControlsPanelComponent,
  ],
  templateUrl: './viewer.component.html',
  styleUrl: './viewer.component.scss',
})
export class ViewerComponent implements AfterViewInit {
  @ViewChild('renderCanvas', { static: true }) renderCanvas!: ElementRef<HTMLCanvasElement>;

  readonly store = inject(BallVisualizerStore);
  readonly authService = inject(AuthService);
  private babylonEngine = inject(BabylonEngineService);
  private modelLoader = inject(ModelLoaderService);
  private readonly preparation = inject(BallTexturePreparationService);
  readonly pdfProgress = signal('');

  isCanvasDragOver = false;
  private dragCounter = 0;

  ngAfterViewInit(): void {
    this.babylonEngine.initialize(this.renderCanvas.nativeElement);
    // If no model is loaded yet, load default 32-Panel Ball model
    if (!this.store.hasModel()) {
      this.modelLoader.loadDefaultModel();
    }
  }

  // Prevent browser default file open behavior anywhere on the window
  @HostListener('window:dragover', ['$event'])
  onWindowDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  @HostListener('window:drop', ['$event'])
  onWindowDrop(event: DragEvent): void {
    event.preventDefault();
  }

  async onBallPdfSelected(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file || this.pdfProgress()) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      this.store.setStatus('Please select a PDF.');
      return;
    }
    this.pdfProgress.set('Reading PDF...');
    try {
      const texture = await this.preparation.preparePdf(file, status => this.pdfProgress.set(status));
      await this.modelLoader.loadTextureFile(texture);
    } catch (error) {
      this.store.setStatus('Could not prepare and apply PDF: ' + String(error));
    } finally {
      this.pdfProgress.set('');
    }
  }

  async onModelDropped(file: File): Promise<void> {
    try {
      await this.modelLoader.loadModelFile(file);
    } catch (err: any) {
      console.error('Failed to load model file:', err);
      this.store.setStatus(`Error loading model ${file.name}: ${err.message || err}`);
    }
  }

  async onTextureDropped(file: File): Promise<void> {
    try {
      await this.modelLoader.loadTextureFile(file);
    } catch (err: any) {
      console.error('Failed to load texture file:', err);
      this.store.setStatus(`Error loading texture ${file.name}: ${err.message || err}`);
    }
  }

  onCanvasDragEnter(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter++;
    this.isCanvasDragOver = true;
  }

  onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isCanvasDragOver = true;
  }

  onCanvasDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter--;
    if (this.dragCounter <= 0) {
      this.dragCounter = 0;
      this.isCanvasDragOver = false;
    }
  }

  async onCanvasDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.dragCounter = 0;
    this.isCanvasDragOver = false;

    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const files = Array.from(event.dataTransfer.files);
      let handled = false;

      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() || '';
        if (['obj', 'glb', 'gltf'].includes(ext)) {
          handled = true;
          await this.onModelDropped(file);
        } else if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
          handled = true;
          await this.onTextureDropped(file);
        }
      }

      if (!handled) {
        this.store.setStatus('Unsupported file format. Drop an .OBJ 3D model or .JPG/.PNG face filter texture.');
      }
    }
  }
}
