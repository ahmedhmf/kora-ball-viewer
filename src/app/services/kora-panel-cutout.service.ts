import { Injectable } from '@angular/core';

/**
 * Optional, reversible removal of marks outside the printed KORA panels.
 *
 * The known blank-print polygons are the reference (725 x 1024). Each
 * straightened photograph is aligned slightly in X/Y/scale using the
 * *printed outlines*, then one combined mask is applied. No polygon is
 * independently warped and no pixel inside a masked region is recolored.
 */
@Injectable({ providedIn: 'root' })
export class KoraPanelCutoutService {
  private registered: {source: HTMLCanvasElement; panels: number[][][]} | null = null;

  /** Register all 32 outlines against the full original scan, without
   * removing, cropping, masking or recoloring a single source pixel. */
  async registerPanels(source: HTMLCanvasElement): Promise<number[][][]> {
    this.registered = null;
    await this.removeOutside(source, 'register');
    return this.getRegisteredPanels(source);
  }

  /** Validated printed panel corners in the full upright scanned image. */
  getRegisteredPanels(source: HTMLCanvasElement): number[][][] {
    if(this.registered?.source!==source)
      throw new Error('Please prepare the scan before UV alignment.');
    return this.registered.panels;
  }

  private readonly referenceWidth = 725;
  private readonly referenceHeight = 1024;
  private readonly polygons: number[][][] = [[[353,63],[400,97],[382,152],[325,152],[307,97]],[[250,84],[306,96],[321,140],[285,195],[229,183],[211,130]],[[458,85],[496,131],[477,184],[422,195],[383,150],[402,96]],[[324,152],[388,159],[412,201],[382,251],[322,247],[296,200]],[[413,202],[468,214],[475,271],[423,295],[383,252]],[[295,202],[324,253],[284,295],[233,272],[238,217]],[[325,252],[382,252],[411,300],[382,352],[325,352],[298,307]],[[478,329],[521,367],[507,425],[454,442],[411,403],[424,346]],[[229,329],[285,348],[296,404],[254,442],[197,422],[186,368]],[[324,354],[382,353],[400,408],[353,442],[307,408]],[[590,365],[623,417],[601,465],[544,471],[512,417],[534,371]],[[117,366],[174,372],[194,416],[163,472],[106,466],[85,420]],[[455,442],[509,425],[539,465],[509,518],[454,500]],[[402,414],[454,443],[454,500],[405,529],[353,500],[353,443]],[[302,414],[353,443],[353,500],[303,530],[253,500],[253,443]],[[198,426],[253,444],[253,500],[200,519],[164,473]],[[163,472],[196,524],[173,572],[116,577],[87,519],[107,477]],[[544,471],[601,477],[623,525],[591,577],[535,572],[511,523]],[[353,502],[400,536],[382,590],[325,590],[308,541]],[[454,501],[509,519],[521,576],[478,614],[422,595],[411,540]],[[253,501],[296,539],[283,597],[229,614],[186,575],[199,519]],[[324,591],[388,598],[412,640],[382,690],[322,686],[296,639]],[[295,641],[324,691],[284,734],[232,709],[238,654]],[[412,641],[470,661],[475,710],[422,734],[383,691]],[[325,691],[382,691],[411,739],[382,791],[325,791],[298,746]],[[422,748],[477,760],[496,815],[458,858],[402,847],[385,800]],[[285,748],[321,803],[305,847],[250,859],[211,816],[230,760]],[[324,793],[382,792],[400,847],[350,879],[307,847]],[[404,853],[454,882],[454,940],[404,969],[354,940],[354,882]],[[302,853],[353,882],[353,940],[303,969],[253,940],[253,882]],[[201,865],[253,883],[253,939],[198,958],[164,911]],[[509,864],[543,912],[508,958],[454,939],[454,883]]];

  /**
   * Render a cutout into the 32-CLB OBJ's real UV atlas.
   *
   * Unlike centering a crop on a square, this maps its known PRINTED TEMPLATE
   * bounds back to fixed UV coordinates. The constants were calibrated
   * against the actual model's vt coordinates (0..1 texture space):
   *   u = 0.105 + 0.00109 * templateX
   *   topDownV = -0.065 + 0.00109 * templateY
   * This is one GLOBAL scale/translation. All 32 panels keep their relative
   * layout; the correction does not alter individual panels or scan colors.
   *
   * The cutToPanelShapes crop includes a five-reference-pixel margin on all
   * four sides. Reconstructing the same bounds here prevents the crop from
   * silently changing atlas coordinates.
   */
  placeCutoutInBallUV(cropped: HTMLCanvasElement): HTMLCanvasElement {
    if(cropped.width<=0 || cropped.height<=0)
      throw new Error('No panel cutout to place in ball UV atlas');
    const allPoints=this.polygons.flat();
    const xs=allPoints.map(([x])=>x),ys=allPoints.map(([,y])=>y);
    const referenceMargin=5;
    const left=Math.min(...xs)-referenceMargin;
    const top=Math.min(...ys)-referenceMargin;
    const right=Math.max(...xs)+referenceMargin;
    const bottom=Math.max(...ys)+referenceMargin;

    // These are UV coordinates in the default public/3d-models/32-CLB.obj.
    const uvPixelsPerReferencePixel=1024*0.00109;
    const atlasOffsetX=1024*0.105;
    const atlasOffsetY=1024*(-0.065);
    const x=atlasOffsetX+left*uvPixelsPerReferencePixel;
    const y=atlasOffsetY+top*uvPixelsPerReferencePixel;
    const width=(right-left)*uvPixelsPerReferencePixel;
    const height=(bottom-top)*uvPixelsPerReferencePixel;

    const atlas=document.createElement('canvas');
    atlas.width=1024;
    atlas.height=1024;
    const ctx=atlas.getContext('2d');
    if(!ctx)throw new Error('Cannot construct UV-aligned square texture');
    // Solid white even where the cropped shape mask is transparent.
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,1024,1024);
    ctx.drawImage(cropped,x,y,width,height);
    return atlas;
  }

  /**
   * Produce the final 1024² ball texture from the 32 printed panel regions.
   *
   * A single, UNIFORM transform is applied to the entire unaltered A3 scan.
   * We center the UNION of the registered panels (rather than the paper),
   * keep a protective margin around their outlines, then make every pixel
   * outside the combined mask white. No panel is ever moved or warped alone.
   */
  placeFullSheetInBallUV(source: HTMLCanvasElement, registeredPanels: number[][][]): HTMLCanvasElement {
    if (source.width < 2 || source.height < 2 || registeredPanels.length !== 32)
      throw new Error('Expected an upright A3 sheet with 32 registered panels');
    if (registeredPanels.some((p,i) =>
      p.length !== this.polygons[i].length ||
      p.some(v => v.length !== 2 || !v.every(Number.isFinite))))
      throw new Error('Invalid printed panel outlines');

    const points=registeredPanels.flat();
    const minX=Math.min(...points.map(p=>p[0])), maxX=Math.max(...points.map(p=>p[0]));
    const minY=Math.min(...points.map(p=>p[1])), maxY=Math.max(...points.map(p=>p[1]));
    const spanX=maxX-minX, spanY=maxY-minY;
    if(spanX<10 || spanY<10)throw new Error('Insufficient panel registration span');

    // Set the vertical panel silhouette to ~980px, centered in the atlas.
    // This closely matches the real OBJ UV island layout (not the A3 paper).
    // Use one uniform factor for both axes, so circles, writing and printed
    // polygons preserve their proportions and original orientation.
    const scale=Math.min(980/spanY, 980/spanX);
    const dx=512-(minX+maxX)*.5*scale;
    const dy=512-(minY+maxY)*.5*scale;

    const art=document.createElement('canvas');
    art.width=1024;art.height=1024;
    const actx=art.getContext('2d');
    if(!actx)throw new Error('Cannot prepare full-resolution panel artwork');
    // No cropping, resampling or segmentation per panel: just one draw.
    actx.drawImage(source,dx,dy,source.width*scale,source.height*scale);

    const mask=document.createElement('canvas');
    mask.width=1024;mask.height=1024;
    const mctx=mask.getContext('2d');
    if(!mctx)throw new Error('Cannot prepare combined panel mask');
    mctx.fillStyle='#ffffff';
    mctx.strokeStyle='#ffffff';
    mctx.lineJoin='round';
    mctx.lineCap='round';
    // Protect lettering crossing the printed borders without bringing back
    // the distant A3 page margin/QR/extraneous outside-page artwork.
    mctx.lineWidth=16;
    for(const polygon of registeredPanels){
      mctx.beginPath();
      for(let i=0;i<polygon.length;i++){
        const x=dx+polygon[i][0]*scale,y=dy+polygon[i][1]*scale;
        if(i===0)mctx.moveTo(x,y);
        else mctx.lineTo(x,y);
      }
      mctx.closePath();
      mctx.fill();
      mctx.stroke();
    }
    actx.globalCompositeOperation='destination-in';
    actx.drawImage(mask,0,0);
    actx.globalCompositeOperation='source-over';

    const atlas=document.createElement('canvas');
    atlas.width=1024;atlas.height=1024;
    const ctx=atlas.getContext('2d');
    if(!ctx)throw new Error('Cannot create centered 1:1 ball texture');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,1024,1024);
    ctx.drawImage(art,0,0);
    return atlas;
  }

  /** A transparent, trimmed polygon-only PNG uses the same verified alignment
   * as the existing white-background preview, but a tighter edge bleed. */
  async cutToPanelShapes(source: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    return this.removeOutside(source, 'cut');
  }

  async removeOutside(source: HTMLCanvasElement, mode: 'white' | 'cut' | 'register' = 'white'): Promise<HTMLCanvasElement> {
    if (source.width < 300 || source.height < 400)
      throw new Error('The straightened image is too small for panel detection.');
    const aspect = source.width / source.height;
    if (aspect < .62 || aspect > .79)
      throw new Error('The page must be upright and portrait before removing outside artwork.');

    // Downscale only for alignment; the final masked drawing retains the
    // original corrected scan resolution and all source color pixels.
    const analysis = document.createElement('canvas');
    analysis.width = this.referenceWidth;
    analysis.height = this.referenceHeight;
    const actx = analysis.getContext('2d', { willReadFrequently: true });
    if (!actx) throw new Error('Cannot analyze the printed football outlines');
    actx.drawImage(source, 0, 0, analysis.width, analysis.height);
    const rgba = actx.getImageData(0, 0, analysis.width, analysis.height).data;
    const width = this.referenceWidth, height = this.referenceHeight;
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i++) {
      const index = i * 4;
      gray[i] = Math.round(.299 * rgba[index] + .587 * rgba[index+1] + .114 * rgba[index+2]);
    }

    // Fast 3/4 chamfer distance to all printed edges. This avoids relying on
    // children's handwriting, which varies and may cross printed outlines.
    const distance = new Uint16Array(width * height);
    distance.fill(900);
    for (let y = 1; y < height-1; y++) {
      for (let x = 1; x < width-1; x++) {
        const i = y*width + x;
        const horizontal = Math.abs(gray[i+1] - gray[i-1]);
        const vertical = Math.abs(gray[i+width] - gray[i-width]);
        if (horizontal + vertical > 22) distance[i] = 0;
      }
    }
    for (let y = 1; y < height; y++) {
      for (let x = 1; x < width-1; x++) {
        const i = y*width + x;
        distance[i] = Math.min(distance[i], distance[i-1]+3, distance[i-width]+3,
          distance[i-width-1]+4, distance[i-width+1]+4);
      }
    }
    for (let y = height-2; y >= 0; y--) {
      for (let x = width-2; x >= 1; x--) {
        const i = y*width + x;
        distance[i] = Math.min(distance[i], distance[i+1]+3, distance[i+width]+3,
          distance[i+width-1]+4, distance[i+width+1]+4);
      }
    }

    const outlines: Array<[number, number]> = [];
    for (const polygon of this.polygons) {
      for (let j = 0; j < polygon.length; j++) {
        const start = polygon[j], end = polygon[(j+1)%polygon.length];
        const count = Math.max(2, Math.round(Math.hypot(end[0]-start[0], end[1]-start[1])/6));
        for (let k = 0; k < count; k++) {
          const t = k/count;
          outlines.push([start[0]*(1-t)+end[0]*t, start[1]*(1-t)+end[1]*t]);
        }
      }
    }

    const score = (params: number[]): number => {
      const [dx,dy,sx,sy] = params;
      let total = 0;
      for (let i = 0; i < outlines.length; i += 2) {
        const [x,y] = outlines[i];
        const px = Math.round(x*sx+dx), py = Math.round(y*sy+dy);
        const value = px < 0 || py < 0 || px >= width || py >= height
          ? 12 : distance[py*width+px]/3;
        total += Math.min(12,value);
      }
      return total/Math.ceil(outlines.length/2)
        + .018*Math.hypot(dx,dy) + 32*(Math.abs(sx-1)+Math.abs(sy-1));
    };

    let best = [0,0,1,1];
    let bestScore = score(best);
    let steps = [12,12,.025,.025];
    for (let round = 0; round < 8; round++) {
      for (let iteration = 0; iteration < 6; iteration++) {
        let changed = false;
        for (let j = 0; j < 4; j++) {
          for (const direction of [-1,1]) {
            const next = best.slice();
            next[j] += direction*steps[j];
            if (Math.abs(next[0])>24 || Math.abs(next[1])>24 ||
                next[2]<.95 || next[2]>1.05 ||
                next[3]<.95 || next[3]>1.05) continue;
            const value = score(next);
            if (value < bestScore) {
              best = next;
              bestScore = value;
              changed = true;
            }
          }
        }
        if (!changed) break;
      }
      steps = steps.map(step=>step*.55);
    }

    let close = 0;
    for (const [x,y] of outlines) {
      const px = Math.round(x*best[2]+best[0]), py = Math.round(y*best[3]+best[1]);
      if (px>=0 && px<width && py>=0 && py<height &&
          distance[py*width+px] < 18) close++;
    }
    if (close/outlines.length < .32)
      throw new Error('Printed panel borders could not be aligned reliably. The original page has not been changed.');

    // Preserve the alignment that the already working cutout operation uses.
    // UV rendering samples the full original corrected page, not the cropped
    // and re-centered 1:1 result.
    const factorX=source.width/width,factorY=source.height/height;
    // The fixed print reference has one consistent clockwise winding.
    // Do not move its individual edges based on handwriting or faint marks:
    // local edge snapping caused visible clipped and distorted panels.
    this.registered={source,panels:this.polygons.map(polygon=>polygon.map(([x,y])=>[
      (x*best[2]+best[0])*factorX,
      (y*best[3]+best[1])*factorY
    ]))};


    // The one-click ball preparation path only needs the registration.
    // It never creates or uses the destructive intermediate cutout.
    if (mode === 'register') return source;

    // One mask covering the union of all 32 panels. A generous 18px margin
    // in 725px template space protects children’s color near panel borders.
    const mask = document.createElement('canvas');
    mask.width = source.width;
    mask.height = source.height;
    const maskCtx = mask.getContext('2d');
    if (!maskCtx) throw new Error('Cannot create KORA panel mask');
    maskCtx.fillStyle = '#fff';
    maskCtx.strokeStyle = '#fff';
    maskCtx.lineJoin = 'round';
    maskCtx.lineCap = 'round';
    const scaleX = source.width/width, scaleY = source.height/height;
    maskCtx.save();
    maskCtx.scale(scaleX, scaleY);
    maskCtx.lineWidth = mode === 'cut' ? 8 : 36;
    // The original white preview keeps 18px bleed. Cut mode follows the
    // actual polygons much more closely, retaining a 4px protection margin.
    for (const polygon of this.polygons) {
      maskCtx.beginPath();
      polygon.forEach(([x,y],index) => {
        const tx = x*best[2]+best[0], ty = y*best[3]+best[1];
        if (index === 0) maskCtx.moveTo(tx,ty);
        else maskCtx.lineTo(tx,ty);
      });
      maskCtx.closePath();
      maskCtx.fill();
      maskCtx.stroke();
    }
    maskCtx.restore();

    // Preserve every source pixel within the combined mask and whiten only
    // pixels outside it. No image warp or per-panel transformation is done.
    const masked = document.createElement('canvas');
    masked.width = source.width;
    masked.height = source.height;
    const mctx = masked.getContext('2d');
    if (!mctx) throw new Error('Cannot produce panel-only preview');
    mctx.drawImage(source,0,0);
    mctx.globalCompositeOperation = 'destination-in';
    mctx.drawImage(mask,0,0);
    mctx.globalCompositeOperation = 'source-over';
    if (mode === 'cut') {
      // Find the bounding rectangle of the combined panel silhouette, not
      // non-white source pixels (white panel faces must remain fully intact).
      const all = this.polygons.flat();
      const left = Math.max(0, Math.floor(Math.min(...all.map(([x])=>x*best[2]+best[0]))*scaleX - 5*scaleX));
      const right = Math.min(source.width, Math.ceil(Math.max(...all.map(([x])=>x*best[2]+best[0]))*scaleX + 5*scaleX));
      const top = Math.max(0, Math.floor(Math.min(...all.map(([,y])=>y*best[3]+best[1]))*scaleY - 5*scaleY));
      const bottom = Math.min(source.height, Math.ceil(Math.max(...all.map(([,y])=>y*best[3]+best[1]))*scaleY + 5*scaleY));
      if (right-left<100 || bottom-top<100)
        throw new Error('Panel-only bounds could not be determined safely.');
      const cropped = document.createElement('canvas');
      cropped.width = right-left;
      cropped.height = bottom-top;
      const croppedCtx = cropped.getContext('2d');
      if (!croppedCtx) throw new Error('Cannot crop transparent panel artwork');
      // Keep outside-panel alpha zero; no white background is painted here.
      croppedCtx.drawImage(masked,left,top,cropped.width,cropped.height,0,0,cropped.width,cropped.height);
      return cropped;
    }
    const finished = document.createElement('canvas');
    finished.width = source.width;
    finished.height = source.height;
    const fctx = finished.getContext('2d');
    if (!fctx) throw new Error('Cannot finish panel cutout');
    fctx.fillStyle = '#fff';
    fctx.fillRect(0,0,finished.width,finished.height);
    fctx.drawImage(masked,0,0);
    return finished;
  }
}
