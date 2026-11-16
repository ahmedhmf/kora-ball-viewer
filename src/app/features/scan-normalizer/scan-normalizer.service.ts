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
      let finished = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        if (error) {
          element.remove();
          reject(error);
        } else resolve();
      };
      const timeout = setTimeout(
        () => finish(new Error('Timed out loading ' + url + '. Check connection or content blockers.')), 25000
      );
      element.onload = () => finish();
      element.onerror = () => finish(new Error('Could not load ' + url));
      document.head.append(element);
    });
  }

  private async pdf(): Promise<any> {
    return this.pdfPromise ??= (async () => {
      if (!(window as any).pdfjsLib) await this.script(this.pdfUrl);
      const pdf = (window as any).pdfjsLib;
      pdf.GlobalWorkerOptions.workerSrc = this.pdfWorkerUrl;
      return pdf;
    })().catch((error: unknown) => { this.pdfPromise = undefined; throw error; });
  }

  private async cv(): Promise<any> {
    return this.cvPromise ??= (async () => {
      if (!(window as any).cv) await this.script(this.cvUrl);
      let cv = (window as any).cv;
      if (typeof cv?.then === 'function') {
        cv = await Promise.race([
          cv,
          new Promise<never>((_, reject) => setTimeout(
            () => reject(new Error('OpenCV startup timed out. Try reloading the page.')), 25000)),
        ]);
      }
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
        if (typeof cv?.then === 'function') cv = await cv;
      }
      if (typeof cv?.getPerspectiveTransform !== 'function')
        throw new Error('OpenCV loaded but its image-processing API is unavailable');
      return cv;
    })().catch((error: unknown) => { this.cvPromise = undefined; throw error; });
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


  /**
   * Deterministic two-stage registration:
   * blank print sheet -> child's scan, blank print sheet -> UV master.
   * Child artwork is never compared directly with a different colored design.
   */
  async registerWithBlank(
    scan: HTMLCanvasElement,
    blank: HTMLCanvasElement,
    master: HTMLCanvasElement,
    reportProgress: (message: string) => void = () => {},
  ): Promise<RegistrationResult & { panels: number; scanInliers: number; masterInliers: number }> {
    reportProgress('Loading image-processing library...');
    const cv = await this.cv();
    reportProgress('Matching blank sheet to the child scan...');
    // Yield once so Angular can paint the progress text before synchronous WASM processing.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const scanMatch = this.matchReference(cv, blank, scan);
    let masterMatch: { h: any; inliers: number; total: number } | null = null;
    let inverse: any, composite: any;
    const source = cv.imread(scan), aligned = new cv.Mat();
    const panelMaskSource = new cv.Mat(), panelMaskTarget = new cv.Mat();
    const imageResult = new cv.Mat();
    try {
      reportProgress('Matching blank sheet to the 1024px texture...');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      masterMatch = this.matchReference(cv, blank, master);
      inverse = new cv.Mat();
      if (cv.invert(scanMatch.h, inverse, cv.DECOMP_LU) === 0)
        throw new Error('Could not invert scan alignment');
      composite = new cv.Mat();
      cv.gemm(masterMatch.h, inverse, 1, new cv.Mat(), 0, composite);
      cv.warpPerspective(source, aligned, composite, new cv.Size(1024, 1024),
        cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));

      reportProgress('Extracting printable panels and composing the PNG...');
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      // Extract closed 5/6-sided printable panels from the BLANK reference.
      // This excludes page text, QR, and contact details without guessing their location on a scan.
      const blankMat = cv.imread(blank);
      const gray = new cv.Mat(), binary = new cv.Mat();
      const contours = new cv.MatVector(), hierarchy = new cv.Mat();
      panelMaskSource.create(blank.height, blank.width, cv.CV_8UC1);
      panelMaskSource.setTo(new cv.Scalar(0));
      let panels = 0;
      try {
        cv.cvtColor(blankMat, gray, cv.COLOR_RGBA2GRAY);
        cv.threshold(gray, binary, 238, 255, cv.THRESH_BINARY_INV);
        cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
        const scale = blank.height / 1024;
        for (let i = 0; i < contours.size(); i++) {
          const contour = contours.get(i);
          const poly = new cv.Mat();
          try {
            const area = cv.contourArea(contour);
            cv.approxPolyDP(contour, poly, 0.025 * cv.arcLength(contour, true), true);
            const box = cv.boundingRect(contour);
            if (area < 3500 * scale * scale || area > 12500 * scale * scale ||
                poly.rows < 5 || poly.rows > 8 ||
                box.width < 50 * scale || box.height < 55 * scale ||
                box.x < blank.width * 0.09 || box.x + box.width > blank.width * 0.94 ||
                box.y < blank.height * 0.025 || box.y + box.height > blank.height * 0.97) continue;
            const polygon = new cv.MatVector();
            polygon.push_back(poly);
            try {
              cv.fillPoly(panelMaskSource, polygon, new cv.Scalar(255));
              panels++;
            } finally { polygon.delete(); }
          } finally { poly.delete(); contour.delete(); }
        }
      } finally {
        blankMat.delete(); gray.delete(); binary.delete(); contours.delete(); hierarchy.delete();
      }
      if (panels < 28 || panels > 35)
        throw new Error(`Expected about 32 closed panels in the blank PDF; detected ${panels}. Try an unmodified KORA blank sheet.`);

      cv.warpPerspective(panelMaskSource, panelMaskTarget, masterMatch.h,
        new cv.Size(1024, 1024), cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
      imageResult.create(1024, 1024, cv.CV_8UC4);
      imageResult.setTo(new cv.Scalar(255, 255, 255, 255));
      aligned.copyTo(imageResult, panelMaskTarget);
      const canvas = document.createElement('canvas');
      canvas.width = 1024; canvas.height = 1024;
      cv.imshow(canvas, imageResult);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(data => data ? resolve(data) : reject(new Error('Could not export PNG')), 'image/png'));
      return { blob, previewUrl: URL.createObjectURL(blob), method: 'automatic',
        inliers: scanMatch.inliers + masterMatch.inliers,
        matches: scanMatch.total + masterMatch.total,
        scanInliers: scanMatch.inliers, masterInliers: masterMatch.inliers, panels };
    } finally {
      scanMatch.h.delete(); masterMatch?.h.delete();
      inverse?.delete(); composite?.delete(); source.delete(); aligned.delete();
      panelMaskSource.delete(); panelMaskTarget.delete(); imageResult.delete();
    }
  }

  private matchReference(cv: any, reference: HTMLCanvasElement, target: HTMLCanvasElement):
      { h: any; inliers: number; total: number } {
    // Match on smaller canvases to avoid freezing the browser on scanned 2K-4K PDF pages.
    // Scale detected keypoint positions back to original pixel coordinates for homography.
    const maxDimension = 1100;
    const prepared = (image: HTMLCanvasElement) => {
      const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { canvas, scaleX: image.width / canvas.width, scaleY: image.height / canvas.height };
    };
    const ref = prepared(reference), tgt = prepared(target);
    const a = cv.imread(ref.canvas), b = cv.imread(tgt.canvas);
    const ag = new cv.Mat(), bg = new cv.Mat();
    const k1 = new cv.KeyPointVector(), k2 = new cv.KeyPointVector();
    const d1 = new cv.Mat(), d2 = new cv.Mat();
    const matches = new cv.DMatchVectorVector();
    const emptyMask = new cv.Mat();
    let orb: any, matcher: any;
    try {
      cv.cvtColor(a, ag, cv.COLOR_RGBA2GRAY);
      cv.cvtColor(b, bg, cv.COLOR_RGBA2GRAY);
      orb = new cv.ORB(1800);
      orb.detectAndCompute(ag, emptyMask, k1, d1);
      orb.detectAndCompute(bg, emptyMask, k2, d2);
      if (d1.empty() || d2.empty()) throw new Error('Not enough recognizable features');
      matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
      matcher.knnMatch(d1, d2, matches, 2);
      const sourcePoints: number[] = [], targetPoints: number[] = [];
      for (let i = 0; i < matches.size(); i++) {
        const pair = matches.get(i);
        try {
          if (pair.size() < 2) continue;
          const best = pair.get(0), next = pair.get(1);
          if (best.distance >= 0.70 * next.distance) continue;
          const from = k1.get(best.queryIdx).pt, to = k2.get(best.trainIdx).pt;
          sourcePoints.push(from.x * ref.scaleX, from.y * ref.scaleY);
          targetPoints.push(to.x * tgt.scaleX, to.y * tgt.scaleY);
        } finally { pair.delete(); }
      }
      const count = sourcePoints.length / 2;
      if (count < 18) throw new Error('Too few matching outlines; check the blank sheet and scan.');
      const src = cv.matFromArray(count, 1, cv.CV_32FC2, sourcePoints);
      const dst = cv.matFromArray(count, 1, cv.CV_32FC2, targetPoints);
      const inlierMask = new cv.Mat();
      try {
        const h = cv.findHomography(src, dst, cv.RANSAC, 5, inlierMask);
        const inliers = cv.countNonZero(inlierMask);
        if (h.empty() || inliers < 12 || inliers / count < 0.24) {
          h.delete();
          throw new Error('Low-confidence template matching; try a clearer scan.');
        }
        const corners = cv.matFromArray(4, 1, cv.CV_32FC2,
          [0, 0, reference.width, 0, reference.width, reference.height, 0, reference.height]);
        const warped = new cv.Mat();
        try {
          cv.perspectiveTransform(corners, warped, h);
          for (let i = 0; i < 4; i++) {
            const x = warped.data32F[i * 2], y = warped.data32F[i * 2 + 1];
            if (!Number.isFinite(x) || !Number.isFinite(y) ||
                x < -target.width * 0.7 || y < -target.height * 0.7 ||
                x > target.width * 1.7 || y > target.height * 1.7) {
              h.delete();
              throw new Error('Alignment distortion is too large');
            }
          }
        } finally { corners.delete(); warped.delete(); }
        return { h, inliers, total: count };
      } finally { src.delete(); dst.delete(); inlierMask.delete(); }
    } finally {
      a.delete(); b.delete(); ag.delete(); bg.delete();
      k1.delete(); k2.delete(); d1.delete(); d2.delete(); matches.delete(); emptyMask.delete();
      orb?.delete(); matcher?.delete();
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
