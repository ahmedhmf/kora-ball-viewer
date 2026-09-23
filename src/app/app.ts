import { Component, ElementRef, ViewChild, AfterViewInit, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BabylonEngineService } from './services/babylon-engine.service';
import { ModelLoaderService } from './services/model-loader.service';
import { AuthService } from './services/auth.service';
import { BallVisualizerStore } from './store/ball-visualizer.store';
import { DropZoneComponent } from './components/drop-zone/drop-zone.component';
import { ControlsPanelComponent } from './components/controls-panel/controls-panel.component';
import { LockScreenComponent } from './components/lock-screen/lock-screen.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    DropZoneComponent,
    ControlsPanelComponent,
    LockScreenComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements AfterViewInit {
  @ViewChild('renderCanvas', { static: true }) renderCanvas!: ElementRef<HTMLCanvasElement>;

  readonly store = inject(BallVisualizerStore);
  readonly authService = inject(AuthService);
  private babylonEngine = inject(BabylonEngineService);
  private modelLoader = inject(ModelLoaderService);

  isCanvasDragOver = false;
  private dragCounter = 0;

  ngAfterViewInit(): void {
    this.babylonEngine.initialize(this.renderCanvas.nativeElement);
    // Automatically load default 32-Panel Ball model on startup
    this.modelLoader.loadDefaultModel();
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
