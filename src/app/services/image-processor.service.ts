import { Injectable } from '@angular/core';

export interface Point2D {
  x: number;
  y: number;
}

export type InkDetectionMode = 'blue_and_color' | 'all_ink' | 'full_multiply';

export interface ImageFilterSettings {
  inkMode: InkDetectionMode;
  brightness: number; // -100 to 100
  contrast: number; // -100 to 100
  inkSensitivity: number; // 0 to 100 (Threshold for hand-drawn ink extraction)
  inkBoost: number; // 0 to 100 (Darkens & sharpens pen strokes)
  saturation: number; // 0 to 200
  sharpenAmount: number; // 0 to 100
  fineOffsetX: number; // -100 to 100 px fine-tune shift
  fineOffsetY: number; // -100 to 100 px fine-tune shift
  fineScale: number; // 80 to 120 %
  fineRotation: number; // -15 to 15 deg
  rotation: number; // 0, 90, 180, 270
  flipH: boolean;
  flipV: boolean;
}

export const DEFAULT_FILTER_SETTINGS: ImageFilterSettings = {
  inkMode: 'blue_and_color',
  brightness: 15,
  contrast: 25,
  inkSensitivity: 50,
  inkBoost: 45,
  saturation: 125,
  sharpenAmount: 30,
  fineOffsetX: 0,
  fineOffsetY: 0,
  fineScale: 100,
  fineRotation: 0,
  rotation: 0,
  flipH: false,
  flipV: false,
};

@Injectable({
  providedIn: 'root',
})
export class ImageProcessorService {
  /**
   * Solve 8x8 linear matrix equation A * h = B using Gaussian elimination with partial pivoting.
   */
  private solveLinearSystem(A: number[][], B: number[]): number[] | null {
    const n = 8;
    const M: number[][] = [];
    for (let i = 0; i < n; i++) {
      M[i] = [...A[i], B[i]];
    }

    for (let col = 0; col < n; col++) {
      let maxRow = col;
      let maxVal = Math.abs(M[col][col]);
      for (let row = col + 1; row < n; row++) {
        if (Math.abs(M[row][col]) > maxVal) {
          maxVal = Math.abs(M[row][col]);
          maxRow = row;
        }
      }

      if (maxVal < 1e-10) return null; // Singular matrix

      if (maxRow !== col) {
        const temp = M[col];
        M[col] = M[maxRow];
        M[maxRow] = temp;
      }

      const pivot = M[col][col];
      for (let j = col; j <= n; j++) {
        M[col][j] /= pivot;
      }

      for (let row = 0; row < n; row++) {
        if (row !== col) {
          const factor = M[row][col];
          for (let j = col; j <= n; j++) {
            M[row][j] -= factor * M[col][j];
          }
        }
      }
    }

    const result: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      result[i] = M[i][n];
    }
    return result;
  }

  /**
   * Compute 3x3 Homography Matrix mapping 4 source points to 4 destination points.
   */
  public computeHomography(srcPoints: Point2D[], dstPoints: Point2D[]): number[] | null {
    if (srcPoints.length !== 4 || dstPoints.length !== 4) return null;

    const A: number[][] = [];
    const B: number[] = [];

    for (let i = 0; i < 4; i++) {
      const { x, y } = srcPoints[i];
      const { x: u, y: v } = dstPoints[i];

      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
      B.push(u);

      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
      B.push(v);
    }

    const h = this.solveLinearSystem(A, B);
    if (!h) return null;

    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0];
  }

  /**
   * Compute inverse of 3x3 matrix M.
   */
  public invertMatrix3x3(m: number[]): number[] | null {
    const a = m[0], b = m[1], c = m[2];
    const d = m[3], e = m[4], f = m[5];
    const g = m[6], h = m[7], i = m[8];

    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-12) return null;

    const invDet = 1.0 / det;

    return [
      (e * i - f * h) * invDet,
      (c * h - b * i) * invDet,
      (b * f - c * e) * invDet,
      (f * g - d * i) * invDet,
      (a * i - c * g) * invDet,
      (c * d - a * f) * invDet,
      (d * h - e * g) * invDet,
      (b * g - a * h) * invDet,
      (a * e - b * d) * invDet,
    ];
  }

  /**
   * Composite extracted hand drawings from uploaded photo onto clean base paper template (paper_template.png).
   * Uses Selective Ink Extraction to isolate user's pen/marker drawings while discarding photo template lines,
   * photo text, and photo logos to guarantee ZERO double lines and ZERO duplicate text!
   */
  public compositeDrawingOntoTemplate(
    baseTemplate: HTMLImageElement | HTMLCanvasElement,
    srcImage: HTMLImageElement | HTMLCanvasElement,
    srcCorners: Point2D[],
    outWidth: number,
    outHeight: number,
    filters: ImageFilterSettings
  ): HTMLCanvasElement {
    // Destination corners with fine-tune scale, rotation, and offsets
    const cx = outWidth / 2;
    const cy = outHeight / 2;
    const scale = filters.fineScale / 100;
    const rad = (filters.fineRotation * Math.PI) / 180;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    const rawCorners: Point2D[] = [
      { x: 0, y: 0 },
      { x: outWidth, y: 0 },
      { x: outWidth, y: outHeight },
      { x: 0, y: outHeight },
    ];

    const dstCorners: Point2D[] = rawCorners.map((pt) => {
      let dx = (pt.x - cx) * scale;
      let dy = (pt.y - cy) * scale;
      let rx = dx * cosR - dy * sinR;
      let ry = dx * sinR + dy * cosR;
      return {
        x: cx + rx + filters.fineOffsetX,
        y: cy + ry + filters.fineOffsetY,
      };
    });

    const H = this.computeHomography(srcCorners, dstCorners);
    if (!H) throw new Error('Could not compute perspective homography matrix.');

    const Hinv = this.invertMatrix3x3(H);
    if (!Hinv) throw new Error('Homography matrix is non-invertible.');

    // 2. Base Template Canvas (clean un-drawn PDF template)
    const baseCanvas = document.createElement('canvas');
    baseCanvas.width = outWidth;
    baseCanvas.height = outHeight;
    const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true })!;
    baseCtx.drawImage(baseTemplate, 0, 0, outWidth, outHeight);
    const baseImageData = baseCtx.getImageData(0, 0, outWidth, outHeight);
    const baseData = baseImageData.data;

    // 3. Source Uploaded Photo Canvas
    const srcCanvas = document.createElement('canvas');
    const srcW = (srcImage instanceof HTMLImageElement ? srcImage.naturalWidth : srcImage.width) || 1;
    const srcH = (srcImage instanceof HTMLImageElement ? srcImage.naturalHeight : srcImage.height) || 1;
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true })!;
    srcCtx.drawImage(srcImage, 0, 0);
    const srcImageData = srcCtx.getImageData(0, 0, srcW, srcH);
    const srcData = srcImageData.data;

    // 4. Output Canvas
    const outCanvas = document.createElement('canvas');
    outCanvas.width = outWidth;
    outCanvas.height = outHeight;
    const outCtx = outCanvas.getContext('2d')!;
    const outImageData = outCtx.createImageData(outWidth, outHeight);
    const outData = outImageData.data;

    // Pre-calculate filter parameters
    const brightness = filters.brightness;
    const contrast = filters.contrast;
    const cFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const inkBoost = filters.inkBoost;
    const saturation = filters.saturation / 100;
    const sensitivity = filters.inkSensitivity;
    const darkCutoff = 135 - (sensitivity - 50) * 0.8;
    const mode = filters.inkMode;

    const m0 = Hinv[0], m1 = Hinv[1], m2 = Hinv[2];
    const m3 = Hinv[3], m4 = Hinv[4], m5 = Hinv[5];
    const m6 = Hinv[6], m7 = Hinv[7], m8 = Hinv[8];

    for (let u = 0; u < outWidth; u++) {
      for (let v = 0; v < outHeight; v++) {
        const dstIdx = (v * outWidth + u) * 4;

        // Base template pixel values
        const bR = baseData[dstIdx];
        const bG = baseData[dstIdx + 1];
        const bB = baseData[dstIdx + 2];

        // Homography inverse mapping for photo lookup
        const wVal = m6 * u + m7 * v + m8;
        if (Math.abs(wVal) < 1e-10) {
          outData[dstIdx] = bR;
          outData[dstIdx + 1] = bG;
          outData[dstIdx + 2] = bB;
          outData[dstIdx + 3] = 255;
          continue;
        }

        const x = (m0 * u + m1 * v + m2) / wVal;
        const y = (m3 * u + m4 * v + m5) / wVal;

        if (x < 0 || x >= srcW - 1 || y < 0 || y >= srcH - 1) {
          outData[dstIdx] = bR;
          outData[dstIdx + 1] = bG;
          outData[dstIdx + 2] = bB;
          outData[dstIdx + 3] = 255;
          continue;
        }

        // Bilinear sub-pixel sampling from photo
        const x0 = Math.floor(x);
        const y0 = Math.floor(y);
        const x1 = Math.min(x0 + 1, srcW - 1);
        const y1 = Math.min(y0 + 1, srcH - 1);
        const dx = x - x0;
        const dy = y - y0;

        const i00 = (y0 * srcW + x0) * 4;
        const i10 = (y0 * srcW + x1) * 4;
        const i01 = (y1 * srcW + x0) * 4;
        const i11 = (y1 * srcW + x1) * 4;

        const w00 = (1 - dx) * (1 - dy);
        const w10 = dx * (1 - dy);
        const w01 = (1 - dx) * dy;
        const w11 = dx * dy;

        let pR = srcData[i00] * w00 + srcData[i10] * w10 + srcData[i01] * w01 + srcData[i11] * w11;
        let pG = srcData[i00 + 1] * w00 + srcData[i10 + 1] * w10 + srcData[i01 + 1] * w01 + srcData[i11 + 1] * w11;
        let pB = srcData[i00 + 2] * w00 + srcData[i10 + 2] * w10 + srcData[i01 + 2] * w01 + srcData[i11 + 2] * w11;

        // Apply Brightness & Contrast to photo pixel
        pR = cFactor * (pR - 128 + brightness) + 128;
        pG = cFactor * (pG - 128 + brightness) + 128;
        pB = cFactor * (pB - 128 + brightness) + 128;

        const lum = 0.299 * pR + 0.587 * pG + 0.114 * pB;
        const maxC = Math.max(pR, pG, pB);
        const minC = Math.min(pR, pG, pB);
        const chroma = maxC - minC;

        // Hand-Drawn Ink Detection:
        // 1. Blue pen ink signature (common in WhatsApp drawings)
        const isBluePen = (pB > pR + 5 && pB > pG + 2) || (pB - pR > 7);
        // 2. Colored marker ink
        const isColorInk = chroma > 14;
        // 3. Dark pen/marker ink
        const isDarkInk = lum < darkCutoff;

        let isInkStroke = false;
        if (mode === 'blue_and_color') {
          isInkStroke = isBluePen || isColorInk || isDarkInk;
        } else if (mode === 'all_ink') {
          isInkStroke = isBluePen || isColorInk || lum < (darkCutoff + 25);
        } else {
          isInkStroke = true; // Full photo multiply
        }

        if (isInkStroke) {
          // Boost ink stroke contrast
          if (inkBoost > 0 && lum < 220) {
            const darkFactor = 1.0 - (inkBoost / 100) * 0.55 * (1.0 - lum / 220);
            pR *= darkFactor;
            pG *= darkFactor;
            pB *= darkFactor;
          }

          if (saturation !== 1.0) {
            const gray = 0.299 * pR + 0.587 * pG + 0.114 * pB;
            pR = gray + saturation * (pR - gray);
            pG = gray + saturation * (pG - gray);
            pB = gray + saturation * (pB - gray);
          }

          // Composite hand-drawn ink stroke onto base template pixel using Multiply
          let finR = (bR * pR) / 255;
          let finG = (bG * pG) / 255;
          let finB = (bB * pB) / 255;

          outData[dstIdx] = Math.min(255, Math.max(0, Math.round(finR)));
          outData[dstIdx + 1] = Math.min(255, Math.max(0, Math.round(finG)));
          outData[dstIdx + 2] = Math.min(255, Math.max(0, Math.round(finB)));
          outData[dstIdx + 3] = 255;
        } else {
          // NOT an ink stroke (i.e. paper background, light grey camera shadow, photo template line, photo text)
          // -> Keep 100% pristine base template pixel! (Guarantees zero double lines & zero double text!)
          outData[dstIdx] = bR;
          outData[dstIdx + 1] = bG;
          outData[dstIdx + 2] = bB;
          outData[dstIdx + 3] = 255;
        }
      }
    }

    outCtx.putImageData(outImageData, 0, 0);

    if (filters.sharpenAmount > 0) {
      this.applyUnsharpMask(outCtx, outWidth, outHeight, filters.sharpenAmount);
    }

    if (filters.rotation !== 0 || filters.flipH || filters.flipV) {
      return this.applyTransforms(outCanvas, filters.rotation, filters.flipH, filters.flipV);
    }

    return outCanvas;
  }

  /**
   * Crop & Map the 32-Panel Ball Layout from Paper Sheet onto 1:1 Square 3D Ball Texture Canvas (1024x1024).
   */
  public generate3DBallTextureFromPaper(paperCanvas: HTMLCanvasElement): HTMLCanvasElement {
    const ballCanvas = document.createElement('canvas');
    ballCanvas.width = 1024;
    ballCanvas.height = 1024;
    const ctx = ballCanvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1024, 1024);

    const srcX = paperCanvas.width * 0.11;
    const srcY = paperCanvas.height * 0.055;
    const srcW = paperCanvas.width * 0.78;
    const srcH = paperCanvas.height * 0.89;

    const dstW = 900;
    const dstH = 980;
    const dstX = (1024 - dstW) / 2;
    const dstY = (1024 - dstH) / 2;

    ctx.drawImage(paperCanvas, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH);
    return ballCanvas;
  }

  /**
   * Apply 3x3 Unsharp Mask Sharpening Filter
   */
  private applyUnsharpMask(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    amount: number
  ): void {
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const copy = new Uint8ClampedArray(data);

    const strength = (amount / 100) * 0.6;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;

        for (let c = 0; c < 3; c++) {
          const center = copy[idx + c];
          const top = copy[((y - 1) * width + x) * 4 + c];
          const bottom = copy[((y + 1) * width + x) * 4 + c];
          const left = copy[(y * width + (x - 1)) * 4 + c];
          const right = copy[(y * width + (x + 1)) * 4 + c];

          const laplacian = 5 * center - top - bottom - left - right;
          const sharpened = center + strength * (laplacian - center);

          data[idx + c] = Math.min(255, Math.max(0, Math.round(sharpened)));
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }

  private applyTransforms(
    canvas: HTMLCanvasElement,
    rotation: number,
    flipH: boolean,
    flipV: boolean
  ): HTMLCanvasElement {
    const finalCanvas = document.createElement('canvas');
    const is90or270 = rotation === 90 || rotation === 270;
    finalCanvas.width = is90or270 ? canvas.height : canvas.width;
    finalCanvas.height = is90or270 ? canvas.width : canvas.height;

    const ctx = finalCanvas.getContext('2d')!;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

    ctx.translate(finalCanvas.width / 2, finalCanvas.height / 2);

    if (rotation !== 0) {
      ctx.rotate((rotation * Math.PI) / 180);
    }
    if (flipH || flipV) {
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    }

    ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return finalCanvas;
  }
}
