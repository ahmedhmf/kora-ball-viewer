import { Injectable } from '@angular/core';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker src from CDN matching pdfjs-dist version
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface PdfPageResult {
  pageNumber: number;
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
  dataUrl: string;
}

@Injectable({
  providedIn: 'root',
})
export class PdfConverterService {
  /**
   * Load a PDF file and return total number of pages
   */
  public async loadPdfDocument(fileOrUrl: File | string): Promise<pdfjsLib.PDFDocumentProxy> {
    try {
      let loadingTask: pdfjsLib.PDFDocumentLoadingTask;

      if (typeof fileOrUrl === 'string') {
        loadingTask = pdfjsLib.getDocument(fileOrUrl);
      } else {
        const arrayBuffer = await fileOrUrl.arrayBuffer();
        loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      }

      return await loadingTask.promise;
    } catch (err: any) {
      console.error('Error loading PDF document:', err);
      throw new Error(`Failed to parse PDF document: ${err.message || err}`);
    }
  }

  /**
   * Render a specific page of a PDF document to an HTMLCanvasElement & JPG data URL at high resolution (scale factor)
   */
  public async renderPageToCanvas(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    pageNumber: number,
    scale = 2.0 // 2.0 = ~300 DPI High-Res
  ): Promise<PdfPageResult> {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

    // Fill white background for PDF page render
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
    };

    await page.render(renderContext).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', 0.95);

    return {
      pageNumber,
      width: canvas.width,
      height: canvas.height,
      canvas,
      dataUrl,
    };
  }

  /**
   * Convert an HTMLCanvasElement (from PDF render) into a File object for downloading or 3D loader
   */
  public canvasToFile(canvas: HTMLCanvasElement, fileName: string, mimeType = 'image/jpeg'): Promise<File> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(new File([blob], fileName, { type: mimeType }));
        } else {
          reject(new Error('Failed to convert canvas to image blob.'));
        }
      }, mimeType, 0.95);
    });
  }

  /**
   * Map PDF Page canvas to a 1:1 Square 3D Ball Texture (1024x1024)
   */
  public convertPdfPageTo3DBallTexture(pdfCanvas: HTMLCanvasElement): HTMLCanvasElement {
    const ballCanvas = document.createElement('canvas');
    ballCanvas.width = 1024;
    ballCanvas.height = 1024;
    const ctx = ballCanvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1024, 1024);

    // Map central region of PDF page to square 3D ball texture
    const srcAspect = pdfCanvas.width / pdfCanvas.height;
    let dstW = 920;
    let dstH = 920;

    if (srcAspect > 1) {
      dstH = dstW / srcAspect;
    } else {
      dstW = dstH * srcAspect;
    }

    const dstX = (1024 - dstW) / 2;
    const dstY = (1024 - dstH) / 2;

    ctx.drawImage(pdfCanvas, 0, 0, pdfCanvas.width, pdfCanvas.height, dstX, dstY, dstW, dstH);
    return ballCanvas;
  }
}
