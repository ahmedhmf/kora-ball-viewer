import { Injectable } from '@angular/core';

export interface RegistrationResult {
  blob: Blob;
  previewUrl: string;
  inliers: number;
  matches: number;
  method: 'automatic' | 'manual' | 'estimated';
}

/**
 * All image and PDF processing is performed in the browser.
 * External libraries are loaded on demand; no document is sent to a server.
 * For production, vendor these two scripts under /public/vendor/ and update the URLs.
 */
@Injectable({ providedIn: 'root' })
export class ScanNormalizerService {
  private pdfPromise?: Promise<any>;
  private cvPromise?: Promise<any>;
  private readonly pdfUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  private readonly pdfWorkerUrl = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  private readonly cvUrl = 'https://docs.opencv.org/4.x/opencv.js';

  private script(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const element = document.createElement('script');
      element.src = url;
      element.async = true;
      element.onload = () => resolve();
      element.onerror = () => reject(new Error('Could not load browser processing library: ' + url));
      document.head.append(element);
    });
  }

  private async pdf(): Promise<any> {
    return this.pdfPromise ??= (async () => {
      if (!(window as any).pdfjsLib) await this.script(this.pdfUrl);
      const pdf = (window as any).pdfjsLib;
      pdf.GlobalWorkerOptions.workerSrc = this.pdfWorkerUrl;
      return pdf;
    })();
  }

  private async cv(): Promise<any> {
    return this.cvPromise ??= (async () => {
      if (!(window as any).cv) await this.script(this.cvUrl);
      let cv = (window as any).cv;
      if (typeof cv?.then === 'function') cv = await cv;
      if (typeof cv?.getPerspectiveTransform !== 'function') {
        await new Promise<void>((resolve, reject) => {
          const start = Date.now();
          const check = () => {
            if (typeof (window as any).cv?.getPerspectiveTransform === 'function') resolve();
            else if (Date.now() - start > 15000) reject(new Error('OpenCV initialization timed out'));
            else setTimeout(check, 100);
          };
          check();
        });
        cv = (window as any).cv;
      }
      return cv;
    })();
  }

  async readFile(file: File): Promise<HTMLCanvasElement> {
    if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      const pdfjs = await this.pdf();
      const buffer = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
      try {
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        await page.render({ canvasContext: context, viewport }).promise;
        return canvas;
      } finally {
        await doc.destroy();
      }
    }
    if (!file.type.startsWith('image/')) throw new Error('Please select a PDF or image');
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d', { willReadFrequently: true })!.drawImage(bitmap, 0, 0);
      return canvas;
    } finally {
      bitmap.close();
    }
  }

  /** Four ordered corresponding source/target points, in original pixel coordinates. */
  async register(
    scan: HTMLCanvasElement,
    master: HTMLCanvasElement,
    points?: { scan: [number, number][]; master: [number, number][] },
  ): Promise<RegistrationResult> {
    const cv = await this.cv();
    const destination = document.createElement('canvas');
    destination.width = 1024;
    destination.height = 1024;
    const normalizedMaster = document.createElement('canvas');
    normalizedMaster.width = 1024;
    normalizedMaster.height = 1024;
    normalizedMaster.getContext('2d')!.drawImage(master, 0, 0, 1024, 1024);

    const sourceMat = cv.imread(scan);
    const output = new cv.Mat();
    let transform: any;
    let inliers = 0, matches = 0;
    let method: RegistrationResult['method'] = 'manual';
    try {
      if (points) {
        if (points.scan.length !== 4 || points.master.length !== 4)
          throw new Error('Select exactly four matching points in each image');
        const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, points.scan.flat());
        const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2,
          points.master.flatMap(([x, y]) => [x * 1024 / master.width, y * 1024 / master.height]));
        try { transform = cv.getPerspectiveTransform(srcPts, dstPts); }
        finally { srcPts.delete(); dstPts.delete(); }
      } else {
        const found = this.findAutomaticTransform(cv, scan, normalizedMaster);
        if (found) {
          transform = found.transform;
          inliers = found.inliers;
          matches = found.matches;
          method = 'automatic';
        } else {
          // Approximation only: cannot be treated as a validated registration.
          // User can click four identical panel corners to refine it.
          transform = this.estimateInitialTransform(cv, scan, normalizedMaster);
          method = 'estimated';
        }
      }
      cv.warpPerspective(sourceMat, output, transform, new cv.Size(1024, 1024),
        cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
      cv.imshow(destination, output);
      const blob = await new Promise<Blob>((resolve, reject) =>
        destination.toBlob(b => b ? resolve(b) : reject(new Error('PNG generation failed')), 'image/png'));
      return { blob, previewUrl: URL.createObjectURL(blob), inliers, matches, method };
    } finally {
      sourceMat.delete(); output.delete(); transform?.delete();
    }
  }

  private findAutomaticTransform(cv: any, scan: HTMLCanvasElement, master: HTMLCanvasElement):
      { transform: any; inliers: number; matches: number } | null {
    // Use a coarse-to-fine keypoint registration. Never accept a weak homography.
    const maxWidth = 1500;
    const scanScale = Math.min(1, maxWidth / Math.max(scan.width, scan.height));
    const scaled = document.createElement('canvas');
    scaled.width = Math.round(scan.width * scanScale);
    scaled.height = Math.round(scan.height * scanScale);
    scaled.getContext('2d')!.drawImage(scan, 0, 0, scaled.width, scaled.height);
    const src = cv.imread(scaled), dst = cv.imread(master);
    const srcGray = new cv.Mat(), dstGray = new cv.Mat();
    const kp1 = new cv.KeyPointVector(), kp2 = new cv.KeyPointVector();
    const descriptors1 = new cv.Mat(), descriptors2 = new cv.Mat();
    let orb: any, matcher: any, neighborMatches: any;
    try {
      cv.cvtColor(src, srcGray, cv.COLOR_RGBA2GRAY);
      cv.cvtColor(dst, dstGray, cv.COLOR_RGBA2GRAY);
      cv.equalizeHist(srcGray, srcGray);
      cv.equalizeHist(dstGray, dstGray);
      orb = new cv.ORB(2200);
      orb.detectAndCompute(srcGray, new cv.Mat(), kp1, descriptors1);
      orb.detectAndCompute(dstGray, new cv.Mat(), kp2, descriptors2);
      if (descriptors1.empty() || descriptors2.empty()) return null;
      matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
      neighborMatches = new cv.DMatchVectorVector();
      matcher.knnMatch(descriptors1, descriptors2, neighborMatches, 2);
      const scanPoints: number[] = [], masterPoints: number[] = [];
      for (let i = 0; i < neighborMatches.size(); i++) {
        const neighbors = neighborMatches.get(i);
        try {
          if (neighbors.size() < 2) continue;
          const a = neighbors.get(0), b = neighbors.get(1);
          if (a.distance >= 0.70 * b.distance) continue;
          const p = kp1.get(a.queryIdx).pt, q = kp2.get(a.trainIdx).pt;
          scanPoints.push(p.x / scanScale, p.y / scanScale);
          masterPoints.push(q.x, q.y);
        } finally { neighbors.delete(); }
      }
      if (scanPoints.length < 18) return null;
      const s = cv.matFromArray(scanPoints.length / 2, 1, cv.CV_32FC2, scanPoints);
      const d = cv.matFromArray(masterPoints.length / 2, 1, cv.CV_32FC2, masterPoints);
      const mask = new cv.Mat();
      try {
        const homography = cv.findHomography(s, d, cv.RANSAC, 4, mask);
        const inliers = cv.countNonZero(mask);
        if (homography.empty() || inliers < 18 || inliers / scanPoints.length < 0.48) {
          homography.delete();
          return null;
        }
        return { transform: homography, inliers, matches: scanPoints.length };
      } finally { s.delete(); d.delete(); mask.delete(); }
    } catch (error) {
      console.warn('Automatic feature registration failed, using editable estimate:', error);
      return null;
    } finally {
      src.delete(); dst.delete(); srcGray.delete(); dstGray.delete();
      kp1.delete(); kp2.delete(); descriptors1.delete(); descriptors2.delete();
      orb?.delete(); matcher?.delete(); neighborMatches?.delete();
    }
  }

  private estimateInitialTransform(cv: any, scan: HTMLCanvasElement, master: HTMLCanvasElement): any {
    // Estimate ink extents in the central part of each sheet. Excludes most page margins.
    // It is deliberately flagged as ESTIMATED, not verified.
    const extent = (canvas: HTMLCanvasElement, cutoff: number) => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const { width: w, height: h } = canvas;
      const data = ctx.getImageData(0, 0, w, h).data;
      const row: number[] = Array(h).fill(0), col: number[] = Array(w).fill(0);
      for (let y = Math.floor(h * .04); y < h * .94; y += 2) {
        for (let x = Math.floor(w * .08); x < w * .92; x += 2) {
          const i = (y * w + x) * 4;
          if (Math.min(data[i], data[i + 1], data[i + 2]) < cutoff) { row[y]++; col[x]++; }
        }
      }
      const activeX = col.map((v, i) => v > 2 ? i : -1).filter(v => v >= 0);
      const activeY = row.map((v, i) => v > 2 ? i : -1).filter(v => v >= 0);
      if (!activeX.length || !activeY.length) throw new Error('Could not find artwork');
      return [Math.min(...activeX), Math.min(...activeY), Math.max(...activeX), Math.max(...activeY)];
    };
    const a = extent(scan, 140), b = extent(master, 140);
    const src = cv.matFromArray(4, 1, cv.CV_32FC2,
      [a[0],a[1], a[2],a[1], a[2],a[3], a[0],a[3]]);
    const dst = cv.matFromArray(4, 1, cv.CV_32FC2,
      [b[0],b[1], b[2],b[1], b[2],b[3], b[0],b[3]]);
    try { return cv.getPerspectiveTransform(src, dst); }
    finally { src.delete(); dst.delete(); }
  }
}
