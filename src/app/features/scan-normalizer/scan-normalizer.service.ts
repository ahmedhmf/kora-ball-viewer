import { Injectable } from '@angular/core';
import { PDFDocument, degrees } from 'pdf-lib';

export type QuarterTurn = 0 | 90 | 180 | 270;
export type OrientationGuess = {
  rotation: QuarterTurn;
  confidence: 'high' | 'uncertain';
  explanation: string;
};

@Injectable({ providedIn: 'root' })
export class ScanNormalizerService {
  private pdfPromise?: Promise<any>;
  private readonly pdfUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  private readonly pdfWorkerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  private loadScript(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = window.setTimeout(() => reject(new Error('Timed out loading PDF reader')), 25000);
      script.async = true;
      script.src = url;
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); reject(new Error('Cannot load the PDF reader')); };
      document.head.append(script);
    });
  }

  private pdfjs(): Promise<any> {
    return this.pdfPromise ??= (async () => {
      if (!(window as any).pdfjsLib) await this.loadScript(this.pdfUrl);
      const pdf = (window as any).pdfjsLib;
      if (!pdf) throw new Error('PDF.js is unavailable');
      pdf.GlobalWorkerOptions.workerSrc = this.pdfWorkerUrl;
      return pdf;
    })().catch((error: unknown) => { this.pdfPromise = undefined; throw error; });
  }

  async preview(file: File): Promise<HTMLCanvasElement> {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!isPdf && !file.type.startsWith('image/'))
      throw new Error('Choose a PDF, JPG, PNG or WEBP file.');
    if (isPdf) {
      const pdf = await this.pdfjs();
      const doc = await pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      try {
        const page = await doc.getPage(1);
        const original = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1600 / Math.max(original.width, original.height));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
        return canvas;
      } finally {
        await doc.destroy();
      }
    }
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      return canvas;
    } finally { bitmap.close(); }
  }

  /**
   * The printed KORA sheet contains a QR code at bottom-left.
   * Unlike handwritten words, this is an invariant orientation anchor.
   * A missing/ambiguous QR is not permission to guess.
   */
  async detectOrientation(canvas: HTMLCanvasElement): Promise<OrientationGuess> {
    const BarcodeDetector = (window as any).BarcodeDetector;
    if (typeof BarcodeDetector === 'function') {
      try {
        const detector = new BarcodeDetector({ formats: ['qr_code'] });
        const codes: any[] = await detector.detect(canvas);
        if (codes.length === 1) {
          const box = codes[0].boundingBox;
          const x = (box.x + box.width / 2) / canvas.width;
          const y = (box.y + box.height / 2) / canvas.height;
          const corner = this.corner(x, y);
          if (corner) return {
            rotation: this.turnForCorner(corner),
            confidence: 'high',
            explanation: 'Printed QR code detected at ' + corner + '.'
          };
        }
      } catch { /* Fallback to QR-like corner analysis below. */ }
    }

    const result = this.detectQrDensity(canvas);
    if (result) return result;
    return {
      rotation: 0,
      confidence: 'uncertain',
      explanation: 'Could not reliably identify the printed QR code. Choose the correct rotation using the preview.'
    };
  }

  private corner(x: number, y: number): string | null {
    if (x < .36 && y < .36) return 'top-left';
    if (x > .64 && y < .36) return 'top-right';
    if (x < .36 && y > .64) return 'bottom-left';
    if (x > .64 && y > .64) return 'bottom-right';
    return null;
  }

  private turnForCorner(corner: string): QuarterTurn {
    // Rotation applied clockwise to place the QR code at bottom-left.
    switch (corner) {
      case 'top-right': return 180;
      case 'top-left': return 270;
      case 'bottom-right': return 90;
      default: return 0;
    }
  }

  private detectQrDensity(canvas: HTMLCanvasElement): OrientationGuess | null {
    const w = 320, h = Math.max(1, Math.round(320 * canvas.height / canvas.width));
    const temp = document.createElement('canvas');
    temp.width = w; temp.height = h;
    const ctx = temp.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(canvas, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < gray.length; i++)
      gray[i] = (.299 * data[4*i] + .587 * data[4*i+1] + .114 * data[4*i+2]) | 0;
    const dense = new Uint8Array(w * h);
    for (let y = 1; y < h-1; y++) for (let x = 1; x < w-1; x++) {
      const i = y*w+x;
      if (Math.abs(gray[i-1]-gray[i+1]) > 25 &&
          Math.abs(gray[i-w]-gray[i+w]) > 25) dense[i] = 1;
    }
    const ii = new Uint32Array((w+1)*(h+1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += dense[y*w+x];
        ii[(y+1)*(w+1)+x+1] = ii[y*(w+1)+x+1]+row;
      }
    }
    const block = Math.max(12, Math.round(Math.min(w,h) * .065));
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    const scores = corners.map(corner => {
      const right = corner.includes('right'), bottom = corner.includes('bottom');
      const x0 = right ? Math.floor(.65*w) : 0;
      const x1 = right ? w : Math.floor(.35*w);
      const y0 = bottom ? Math.floor(.65*h) : 0;
      const y1 = bottom ? h : Math.floor(.35*h);
      let best = 0;
      for (let y = y0; y <= y1-block; y += 2)
        for (let x = x0; x <= x1-block; x += 2) {
          const x2=x+block,y2=y+block;
          const count=ii[y2*(w+1)+x2]-ii[y*(w+1)+x2]-
            ii[y2*(w+1)+x]+ii[y*(w+1)+x];
          if(count > best)best=count;
        }
      return { corner, score: best };
    }).sort((a,b) => b.score - a.score);
    const [first, second] = scores;
    // Heuristic density is not a full QR decoder; only offer a suggestion.
    if (first.score < 10 || first.score < second.score * 1.35) return null;
    return {
      rotation: this.turnForCorner(first.corner),
      confidence: 'uncertain',
      explanation: 'Possible QR code at ' + first.corner +
        '. Please verify the page preview before exporting.'
    };
  }

  rotatePreview(canvas: HTMLCanvasElement, degreesClockwise: QuarterTurn): HTMLCanvasElement {
    const sideways = degreesClockwise === 90 || degreesClockwise === 270;
    const result = document.createElement('canvas');
    result.width = sideways ? canvas.height : canvas.width;
    result.height = sideways ? canvas.width : canvas.height;
    const ctx = result.getContext('2d')!;
    ctx.translate(result.width / 2, result.height / 2);
    ctx.rotate(degreesClockwise * Math.PI / 180);
    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return result;
  }

  async exportFile(file: File, angle: QuarterTurn, source: HTMLCanvasElement): Promise<Blob> {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      // Set PDF page rotation metadata, preserving the actual drawings, vectors,
      // embedded scan image and page contents; no rasterization or cropping.
      const document = await PDFDocument.load(await file.arrayBuffer());
      for (const page of document.getPages()) {
        const existing = page.getRotation().angle;
        page.setRotation(degrees((((existing + angle) % 360) + 360) % 360));
      }
      const bytes = await document.save();
      const pdfBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return new Blob([pdfBuffer], { type: 'application/pdf' });
    }
    const result = this.rotatePreview(source, angle);
    return new Promise((resolve, reject) => result.toBlob(
      blob => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png'
    ));
  }
}
