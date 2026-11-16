import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  inject,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { PdfConverterService, PdfPageResult } from '../../services/pdf-converter.service';
import { ModelLoaderService } from '../../services/model-loader.service';
import { BallVisualizerStore } from '../../store/ball-visualizer.store';
import { AuthService } from '../../services/auth.service';
import type { PDFDocumentProxy } from 'pdfjs-dist';

@Component({
  selector: 'app-techpack-preparer',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './techpack-preparer.component.html',
  styleUrl: './techpack-preparer.component.scss',
})
export class TechpackPreparerComponent implements AfterViewInit {
  @ViewChild('pdfCanvas') pdfCanvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  readonly store = inject(BallVisualizerStore);
  readonly authService = inject(AuthService);
  readonly Math = Math;

  private pdfConverter = inject(PdfConverterService);
  private modelLoader = inject(ModelLoaderService);
  private router = inject(Router);
  private cdr = inject(ChangeDetectorRef);

  // PDF State
  pdfDoc: PDFDocumentProxy | null = null;
  fileName = 'cat.pdf';
  numPages = 0;
  currentPage = 1;

  // DPI Render Scale (1.5 = ~150 DPI, 3.0 = ~300 DPI HD, 5.0 = 600 DPI Ultra HD)
  renderScale = 3.0; // 300 DPI HD default

  // Outer Text Removal Controls (Preserving 100% panel geometry)
  removeOuterText = true;
  headerCutoff = 11.0; // Top header cutoff percentage (0-13.0% safe max)
  footerCutoff = 84.0; // Bottom footer cutoff percentage (82.5-100% safe min)
  sideMarginCutoff = 0.0; // Left & right margin cutoff percentage (0-2.5% safe max)

  // Image Adjustment Controls
  brightness = 0; // -100 to 100
  contrast = 0; // -100 to 100
  rotation = 0; // 0, 90, 180, 270
  flipH = false;
  flipV = false;

  // Current Extracted Page Result
  currentRenderResult: PdfPageResult | null = null;

  // Drag over dropzone state
  isDragOver = false;

  // Status & Loading
  isLoading = false;
  statusMsg = 'Upload or drop a WhatsApp scanned PDF document to extract as JPG.';

  ngAfterViewInit(): void {
    this.loadSamplePdf();
  }

  /**
   * Load default sample PDF (public/cat.pdf)
   */
  public async loadSamplePdf(): Promise<void> {
    try {
      this.isLoading = true;
      this.statusMsg = 'Loading sample PDF document...';

      this.pdfDoc = await this.pdfConverter.loadPdfDocument('cat.pdf');
      this.fileName = 'cat.pdf';
      this.numPages = this.pdfDoc.numPages;
      this.currentPage = 1;

      await this.renderCurrentPage();
      this.statusMsg = `PDF loaded (${this.numPages} ${this.numPages === 1 ? 'page' : 'pages'}). Page 1 rendered as high-res JPG.`;
    } catch (err: any) {
      console.warn('Sample PDF load info:', err);
      this.statusMsg = 'Ready. Upload or drop any WhatsApp PDF document to extract to JPG.';
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Handle File Upload (PDF or Image)
   */
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.loadPdfFile(input.files[0]);
    }
  }

  onFileDropped(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      this.loadPdfFile(event.dataTransfer.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver = false;
  }

  /**
   * Load uploaded PDF file
   */
  async loadPdfFile(file: File): Promise<void> {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext !== 'pdf') {
      this.statusMsg = `Please upload a PDF document (.pdf file format). Received: .${ext}`;
      return;
    }

    try {
      this.isLoading = true;
      this.statusMsg = `Parsing WhatsApp scanned PDF: '${file.name}'...`;

      this.pdfDoc = await this.pdfConverter.loadPdfDocument(file);
      this.fileName = file.name;
      this.numPages = this.pdfDoc.numPages;
      this.currentPage = 1;

      await this.renderCurrentPage();
      this.statusMsg = `Successfully extracted '${file.name}' (${this.numPages} ${this.numPages === 1 ? 'page' : 'pages'}). Rendered as HD JPG.`;
    } catch (err: any) {
      console.error('PDF parsing error:', err);
      this.statusMsg = `Error parsing PDF: ${err.message || err}`;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Change Render Scale (150 DPI, 300 DPI, 600 DPI)
   */
  async setScale(scale: number): Promise<void> {
    this.renderScale = scale;
    await this.renderCurrentPage();
  }

  /**
   * Pagination: Go to Page
   */
  async goToPage(page: number): Promise<void> {
    if (!this.pdfDoc || page < 1 || page > this.numPages) return;
    this.currentPage = page;
    await this.renderCurrentPage();
  }

  /**
   * Quick Presets for Text Cleaning (Preserving 100% panel geometry)
   */
  setCleaningPreset(preset: 'safe' | 'balanced' | 'tight'): void {
    this.removeOuterText = true;
    if (preset === 'safe') {
      this.headerCutoff = 9.5;
      this.footerCutoff = 86.0;
      this.sideMarginCutoff = 0.0;
    } else if (preset === 'balanced') {
      this.headerCutoff = 11.0;
      this.footerCutoff = 84.0;
      this.sideMarginCutoff = 0.0;
    } else if (preset === 'tight') {
      this.headerCutoff = 12.5;
      this.footerCutoff = 83.0;
      this.sideMarginCutoff = 0.5;
    }
    this.renderCurrentPage();
  }

  /**
   * Render Current PDF Page onto Canvas with text removal and image adjustments
   */
  async renderCurrentPage(): Promise<void> {
    if (!this.pdfDoc || !this.pdfCanvasRef) return;

    try {
      this.isLoading = true;

      // 1. Render PDF Page at requested DPI scale factor
      const pageResult = await this.pdfConverter.renderPageToCanvas(
        this.pdfDoc,
        this.currentPage,
        this.renderScale
      );

      this.currentRenderResult = pageResult;

      // 2. Remove outer text (Top header tagline, top logo, bottom QR & contest text, side margins)
      const cleanCanvas = this.prepareCleanCanvas(pageResult.canvas);

      // 3. Apply Brightness, Contrast, Rotation, Flips onto target view canvas
      const targetCanvas = this.pdfCanvasRef.nativeElement;
      this.applyImageFilters(cleanCanvas, targetCanvas);
    } catch (err: any) {
      console.error('Page render error:', err);
      this.statusMsg = `Failed to render PDF page: ${err.message || err}`;
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Mask out outer text (Top header tagline, top logo, bottom QR & contest text, side margins) with white #FFFFFF
   */
  private prepareCleanCanvas(originalCanvas: HTMLCanvasElement): HTMLCanvasElement {
    if (!this.removeOuterText) {
      return originalCanvas;
    }

    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = originalCanvas.width;
    cleanCanvas.height = originalCanvas.height;

    const ctx = cleanCanvas.getContext('2d', { willReadFrequently: true })!;

    // Copy original rendered image
    ctx.drawImage(originalCanvas, 0, 0);

    const W = cleanCanvas.width;
    const H = cleanCanvas.height;
    ctx.fillStyle = '#ffffff';

    // Mask Top Header Text & Logo (y = 0 to headerCutoff%)
    if (this.headerCutoff > 0) {
      const topH = Math.round((H * this.headerCutoff) / 100);
      ctx.fillRect(0, 0, W, topH);
    }

    // Mask Bottom Footer Text, QR code & form fields (y = footerCutoff% to 100%)
    if (this.footerCutoff < 100) {
      const bottomY = Math.round((H * this.footerCutoff) / 100);
      const bottomH = H - bottomY;
      ctx.fillRect(0, bottomY, W, bottomH);
    }

    // Mask Left Side Margin (x = 0 to sideMarginCutoff%)
    if (this.sideMarginCutoff > 0) {
      const leftW = Math.round((W * this.sideMarginCutoff) / 100);
      ctx.fillRect(0, 0, leftW, H);
    }

    // Mask Right Side Margin (x = 100 - sideMarginCutoff% to 100%)
    if (this.sideMarginCutoff > 0) {
      const rightW = Math.round((W * this.sideMarginCutoff) / 100);
      ctx.fillRect(W - rightW, 0, rightW, H);
    }

    return cleanCanvas;
  }

  /**
   * Apply Brightness, Contrast, Rotation, and Flips onto final canvas
   */
  private applyImageFilters(srcCanvas: HTMLCanvasElement, dstCanvas: HTMLCanvasElement): void {
    const is90or270 = this.rotation === 90 || this.rotation === 270;
    const outW = is90or270 ? srcCanvas.height : srcCanvas.width;
    const outH = is90or270 ? srcCanvas.width : srcCanvas.height;

    dstCanvas.width = outW;
    dstCanvas.height = outH;

    const ctx = dstCanvas.getContext('2d')!;

    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);

    ctx.save();
    ctx.translate(outW / 2, outH / 2);

    if (this.rotation !== 0) {
      ctx.rotate((this.rotation * Math.PI) / 180);
    }
    if (this.flipH || this.flipV) {
      ctx.scale(this.flipH ? -1 : 1, this.flipV ? -1 : 1);
    }

    ctx.drawImage(srcCanvas, -srcCanvas.width / 2, -srcCanvas.height / 2);
    ctx.restore();

    // Apply Brightness & Contrast pixel filters if set
    if (this.brightness !== 0 || this.contrast !== 0) {
      const imageData = ctx.getImageData(0, 0, outW, outH);
      const data = imageData.data;
      const cFactor = (259 * (this.contrast + 255)) / (255 * (259 - this.contrast));

      for (let i = 0; i < data.length; i += 4) {
        data[i] = Math.min(255, Math.max(0, Math.round(cFactor * (data[i] - 128 + this.brightness) + 128)));
        data[i + 1] = Math.min(255, Math.max(0, Math.round(cFactor * (data[i + 1] - 128 + this.brightness) + 128)));
        data[i + 2] = Math.min(255, Math.max(0, Math.round(cFactor * (data[i + 2] - 128 + this.brightness) + 128)));
      }

      ctx.putImageData(imageData, 0, 0);
    }
  }

  /**
   * Reset Image Adjustments & Text Removal Masks
   */
  onResetFilters(): void {
    this.brightness = 0;
    this.contrast = 0;
    this.rotation = 0;
    this.flipH = false;
    this.flipV = false;
    this.removeOuterText = true;
    this.headerCutoff = 11.0;
    this.footerCutoff = 84.0;
    this.sideMarginCutoff = 0.0;
    this.renderCurrentPage();
  }

  /**
   * Rotate and Flip Controls
   */
  rotate(deg: number): void {
    this.rotation = (this.rotation + deg + 360) % 360;
    this.renderCurrentPage();
  }

  toggleFlipH(): void {
    this.flipH = !this.flipH;
    this.renderCurrentPage();
  }

  toggleFlipV(): void {
    this.flipV = !this.flipV;
    this.renderCurrentPage();
  }

  /**
   * Export Current Extracted Page as High-Quality JPG File
   */
  exportAsJPG(): void {
    if (!this.pdfCanvasRef) return;
    const canvas = this.pdfCanvasRef.nativeElement;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

    const baseName = this.fileName.replace(/\.pdf$/i, '');
    const link = document.createElement('a');
    link.download = `${baseName}_extracted_page${this.currentPage}_${Date.now()}.jpg`;
    link.href = dataUrl;
    link.click();

    this.statusMsg = `Exported Page ${this.currentPage} as high-res JPG (${canvas.width}x${canvas.height} px).`;
  }

  /**
   * Export Extracted Page as Lossless PNG File
   */
  exportAsPNG(): void {
    if (!this.pdfCanvasRef) return;
    const canvas = this.pdfCanvasRef.nativeElement;
    const dataUrl = canvas.toDataURL('image/png');

    const baseName = this.fileName.replace(/\.pdf$/i, '');
    const link = document.createElement('a');
    link.download = `${baseName}_extracted_page${this.currentPage}_${Date.now()}.png`;
    link.href = dataUrl;
    link.click();

    this.statusMsg = `Exported Page ${this.currentPage} as PNG (${canvas.width}x${canvas.height} px).`;
  }

  /**
   * Apply Extracted Page JPG directly to 3D Ball Visualizer Scene & Navigate to Viewer
   */
  async applyTo3DViewer(): Promise<void> {
    if (!this.pdfCanvasRef) return;

    try {
      this.isLoading = true;
      this.statusMsg = 'Formatting extracted PDF page for 3D ball texture and loading into engine...';

      const canvas = this.pdfCanvasRef.nativeElement;
      const ballCanvas = this.pdfConverter.convertPdfPageTo3DBallTexture(canvas);

      const blob = await new Promise<Blob>((resolve) =>
        ballCanvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95)
      );

      const baseName = this.fileName.replace(/\.pdf$/i, '');
      const file = new File([blob], `${baseName}_page${this.currentPage}_ball.jpg`, { type: 'image/jpeg' });

      await this.modelLoader.loadTextureFile(file);

      // Navigate to main 3D viewer route '/'
      this.router.navigate(['/']);
    } catch (err: any) {
      console.error('Error applying PDF to 3D viewer:', err);
      this.statusMsg = `Failed to apply PDF texture: ${err.message || err}`;
    } finally {
      this.isLoading = false;
    }
  }
}
