import { Injectable, inject } from '@angular/core';
import { PdfConverterService } from './pdf-converter.service';
import { PaperStraightenerService } from './paper-straightener.service';
import { KoraPanelCutoutService } from './kora-panel-cutout.service';
import { KoraUvAlignService } from './kora-uv-align.service';

@Injectable({ providedIn: 'root' })
export class BallTexturePreparationService {
  private readonly pdf = inject(PdfConverterService);
  private readonly paper = inject(PaperStraightenerService);
  private readonly panelCutout = inject(KoraPanelCutoutService);
  private readonly uvAligner = inject(KoraUvAlignService);

  async readPdf(file: File): Promise<HTMLCanvasElement> {
    const document = await this.pdf.loadPdfDocument(file);
    try {
      const page = await document.getPage(1);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2.4, 2400 / Math.max(viewport.width, viewport.height));
      return (await this.pdf.renderPageToCanvas(document, 1, scale)).canvas;
    } finally {
      await document.destroy();
    }
  }

  async preparePdf(file: File, report: (status: string) => void): Promise<File> {
    report('Reading PDF...');
    const source = await this.readPdf(file);
    const { atlas } = await this.prepare(source, true, true, report);
    return this.pdf.canvasToFile(atlas, 'kora-ready-ball-1024.png', 'image/png');
  }

  async prepare(input: HTMLCanvasElement, preserveOriginalSizes: boolean, oneToOne: boolean,
    report: (status: string) => void
  ): Promise<{ atlas: HTMLCanvasElement; corrected: HTMLCanvasElement; orientationUncertain: boolean }> {
    report('Preparing the upright A3 page...');
    let corrected=input;
    // A PDF can be a scanned PHOTO (the supplied WhatsApp A3 is one).
    // Do not skip perspective correction because the container is .pdf.
    // The detector requires a long, consistently visible paper/table edge;
    // when it is not detected, retain the complete unmodified source.
    const detected=this.paper.detect(input);
    if (detected.confidence === 'detected') {
      report('Straightening the photographed A3 paper...');
      const corners=this.paper.corners(input,detected.topRight,detected.bottomRight);
      corrected=await this.paper.straighten(input,corners);
    }
    // Portrait paper can still be upside down. Always look for the
    // KORA QR marker and orient the WHOLE page, before any registration
    // or cropping. Rotating only landscape pages caused the 180° failure.
    report('Orienting the A3 print using its QR marker...');
    const oriented=await this.paper.orientPrintedSheet(corrected);
    // QR detection is advisory. Faint or partially scanned QR marks should
    // not block an otherwise usable A3 sheet. The user can flip the whole
    // original sheet with the 180° control after preparation.
    let orientationUncertain=!oriented.reliable;
    corrected=oriented.canvas;
    const ratio=corrected.width/corrected.height;
    if (ratio < .62 || ratio > .79)
      throw new Error('The original A3 page must be upright portrait (297 × 420 mm).');
    report('Registering the 32 printed outlines and checking orientation...');

    // QR codes can be blurred in WhatsApp scans. Independently fit the
    // printed 32-panel template in BOTH portrait orientations. The real
    // A3 layout should match the correctly rotated page more closely.
    // Avoid silently choosing a QR corner based on colorful handwriting.
    const rotated=this.rotatePage180(corrected);
    let first: {panels:number[][][]; score:number} | null=null;
    let second: {panels:number[][][]; score:number} | null=null;
    try {
      const panels=await this.panelCutout.registerPanels(corrected);
      first={panels,score:this.panelCutout.getRegistrationScore(corrected)};
    } catch(error) {
      console.warn('[KORA 0-degree registration]',error);
    }
    try {
      const panels=await this.panelCutout.registerPanels(rotated);
      second={panels,score:this.panelCutout.getRegistrationScore(rotated)};
    } catch(error) {
      console.warn('[KORA 180-degree registration]',error);
    }
    if(!first && !second)
      throw new Error('Neither A3 orientation matches the 32 printed panels. Check that the full sheet is visible.');
    // A modest difference is enough when QR is uncertain; when the QR
    // decoder was confident, require a stronger geometric contradiction.
    const minimumImprovement=oriented.reliable ? 0.8 : 0.25;
    const useRotated=!!second && (!first ||
      second.score + minimumImprovement < first.score);
    if(useRotated) {
      corrected=rotated;
      orientationUncertain=false;
    }
    const panels=(useRotated ? second : first)?.panels;
    if(!panels)throw new Error('Cannot obtain the registered 32-panel template.');
    report(oneToOne ? 'Preparing the 1:1 texture...' : preserveOriginalSizes
      ? 'Preserving original printed panel sizes in the OBJ UV atlas...'
      : 'Applying the previous fine-fit UV alignment...');
    await new Promise<void>(resolve=>setTimeout(resolve,0));
    const atlas = oneToOne
      ? this.uvAligner.renderContinuous(corrected, panels, true, true)
      : this.uvAligner.renderContinuous(corrected, panels, preserveOriginalSizes);
    return { atlas, corrected, orientationUncertain };
  }

  rotatePage180(source: HTMLCanvasElement): HTMLCanvasElement {
    const rotated=document.createElement('canvas');
    rotated.width=source.width;
    rotated.height=source.height;
    const ctx=rotated.getContext('2d');
    if(!ctx)throw new Error('Cannot rotate original A3 artwork');
    ctx.translate(rotated.width,rotated.height);
    ctx.rotate(Math.PI);
    ctx.drawImage(source,0,0);
    return rotated;
  }
}
