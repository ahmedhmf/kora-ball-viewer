import { Injectable } from '@angular/core';
import { KORA_UV_PANEL_CORNERS } from './kora-uv-panel-corners';

/**
 * Samples the upright, registered print directly into the 32-CLB.obj atlas.
 *
 * The UV and print polygons have corresponding vertices. Mean-value polygon
 * coordinates interpolate these vertices smoothly across the whole face,
 * avoiding the visible radial derivatives of a center-to-corner triangle fan.
 * Nothing is changed in the original straightened photo or legacy 1:1 mode.
 */
@Injectable({ providedIn: 'root' })
export class KoraUvAlignService {
  private readonly size = 1024;

  private twiceArea(points: number[][]): number {
    return points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0);
  }

  private inside(x: number, y: number, poly: number[][]): boolean {
    // The exported 32-CLB panel hulls are convex, but even/odd also works
    // for slightly irregular polygons produced by future OBJ revisions.
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a[1] > y) !== (b[1] > y) &&
          x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  }

  /** Smooth polygon interpolation with exact vertex/edge correspondence.
   * See mean-value coordinates for convex polygons (Floater, 2003).
   * Returns the source point for one pixel in the destination UV polygon.
   */
  private mapPoint(x: number, y: number, from: number[][], to: number[][]): [number, number] {
    const n = to.length;
    const dx = new Array<number>(n), dy = new Array<number>(n);
    const length = new Array<number>(n), tan = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      dx[i] = to[i][0] - x;
      dy[i] = to[i][1] - y;
      length[i] = Math.hypot(dx[i], dy[i]);
      if (length[i] < 1e-8) return [from[i][0], from[i][1]];
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const cross = dx[i] * dy[j] - dy[i] * dx[j];
      const dot = dx[i] * dx[j] + dy[i] * dy[j];
      // A destination point exactly on the polygon edge maps linearly to
      // its matching source edge. Avoid the 0/0 of tan(180°/2).
      if (Math.abs(cross) < 1e-7 && dot < 0) {
        const t = length[i] / (length[i] + length[j]);
        return [
          from[i][0] * (1 - t) + from[j][0] * t,
          from[i][1] * (1 - t) + from[j][1] * t
        ];
      }
      const denom = length[i] * length[j] + dot;
      tan[i] = Math.abs(denom) < 1e-12 ? 0 : cross / denom;
    }
    let total = 0, sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
      const w = (tan[(i + n - 1) % n] + tan[i]) / length[i];
      total += w;
      sx += w * from[i][0];
      sy += w * from[i][1];
    }
    if (!Number.isFinite(total) || Math.abs(total) < 1e-12)
      throw new Error('Cannot interpolate OBJ polygon point');
    return [sx / total, sy / total];
  }

  /**
   * Render the complete, original A3 artwork through ONE globally fitted
   * affine transform into the real 32-CLB.obj UV atlas.
   *
   * Both the printed KORA net and this OBJ are the SAME 32-panel net layout.
   * Across all 180 corresponding panel vertices their atlas positions differ
   * by only a few pixels after a global affine fit. Independently sampling
   * each source polygon destroyed handwritten strokes crossing estimated
   * panel boundaries, so the one-click workflow must NEVER call render().
   *
   * Preserve-original-sizes mode applies only a uniform similarity
   * transform, so individual printed panels retain their original proportions.
   * The optional fine-fit mode applies the previous continuous local warp.
   * Both modes mask only distant paper marks in DESTINATION OBJ UV space.
   */
  renderContinuous(source: HTMLCanvasElement, sourcePanels: number[][][], preserveOriginalSizes = true, correctPerspective = false): HTMLCanvasElement {
    if (source.width<2 || source.height<2 || sourcePanels.length!==32 ||
      KORA_UV_PANEL_CORNERS.length!==32)
      throw new Error('Expected an A3 page registered to 32 OBJ panels.');
    const samples: Array<{x:number;y:number;u:number;v:number}>=[];
    for(let panel=0;panel<32;panel++){
      const from=sourcePanels[panel], to=KORA_UV_PANEL_CORNERS[panel];
      if(!Array.isArray(from)||from.length!==to.length ||
        (from.length!==5&&from.length!==6))
        throw new Error('Mismatched polygon corners for panel '+(panel+1));
      for(let vertex=0;vertex<from.length;vertex++){
        const [x,y]=from[vertex], [u,v]=to[vertex];
        if(![x,y,u,v].every(Number.isFinite))
          throw new Error('Invalid printed/UV corner for panel '+(panel+1));
        samples.push({x,y,u,v});
      }
    }

    // Solve the least-squares affine transform [x,y,1] -> [u,v].
    // Unlike a polygon-by-polygon warp this is continuous over every seam.
    const m=[[0,0,0],[0,0,0],[0,0,0]], bu=[0,0,0],bv=[0,0,0];
    for(const p of samples){
      const q=[p.x,p.y,1];
      for(let i=0;i<3;i++){
        bu[i]+=q[i]*p.u;
        bv[i]+=q[i]*p.v;
        for(let j=0;j<3;j++)m[i][j]+=q[i]*q[j];
      }
    }
    const solve=(rhs:number[]):number[]=>{
      const a=m.map((row,i)=>[...row,rhs[i]]);
      for(let i=0;i<3;i++){
        let pivot=i;
        for(let j=i+1;j<3;j++)
          if(Math.abs(a[j][i])>Math.abs(a[pivot][i]))pivot=j;
        if(Math.abs(a[pivot][i])<1e-9)throw new Error('Degenerate A3 panel registration.');
        [a[i],a[pivot]]=[a[pivot],a[i]];
        const divisor=a[i][i];
        for(let j=i;j<4;j++)a[i][j]/=divisor;
        for(let k=0;k<3;k++)if(k!==i){
          const factor=a[k][i];
          for(let j=i;j<4;j++)a[k][j]-=factor*a[i][j];
        }
      }
      return a.map(row=>row[3]);
    };
    let [a,b,tx]=solve(bu), [c,d,ty]=solve(bv);

    if(preserveOriginalSizes) {
      // Fit ONE similarity transform: same scale in both directions and no
      // skew. This preserves every printed panel's original proportions,
      // rather than forcing each face to exactly fill a slightly different
      // OBJ UV polygon. The mesh itself is never resized.
      let sx=0,sy=0,ux=0,uy=0;
      for(const p of samples){sx+=p.x;sy+=p.y;ux+=p.u;uy+=p.v;}
      sx/=samples.length;sy/=samples.length;
      ux/=samples.length;uy/=samples.length;
      let dot=0,cross=0,denominator=0;
      for(const p of samples){
        const x=p.x-sx,y=p.y-sy,u=p.u-ux,v=p.v-uy;
        dot+=x*u+y*v;
        cross+=x*v-y*u;
        denominator+=x*x+y*y;
      }
      if(denominator<1e-9)throw new Error('Degenerate original panel dimensions');
      const uniformCos=dot/denominator;
      const uniformSin=cross/denominator;
      a=uniformCos;b=-uniformSin;
      c=uniformSin;d=uniformCos;
      tx=ux-a*sx-b*sy;
      ty=uy-c*sx-d*sy;
    }

    if(![a,b,c,d,tx,ty].every(Number.isFinite) || a*d-b*c<=0)
      throw new Error('Mirrored or invalid A3-to-OBJ UV registration.');

    const size=this.size;
    const art=document.createElement('canvas');
    art.width=size;art.height=size;
    const actx=art.getContext('2d');
    if(!actx)throw new Error('Cannot prepare continuous A3 artwork');
    actx.save();
    actx.setTransform(a,c,b,d,tx,ty);
    actx.drawImage(source,0,0);
    actx.restore();

    if (correctPerspective && preserveOriginalSizes) this.correctSheetPerspective(actx);

    if(!preserveOriginalSizes) {
      // A single affine transform gets the net close, but leaves a few
      // millimetres of mismatch at individual panel seams. Smoothly correct
      // the residuals of ALL 180 corresponding corners in destination space.
      // This is one continuous displacement field, never 32 source cutouts.
      // In particular, a handwritten letter crossing a border remains whole.
      const controls=samples.map(p=>({
        u:p.u,v:p.v,
        dx:a*p.x+b*p.y+tx-p.u,
        dy:c*p.x+d*p.y+ty-p.v
      }));
      const gridStep=4,gridSize=size/gridStep+1;
      const gridX=new Float32Array(gridSize*gridSize);
      const gridY=new Float32Array(gridSize*gridSize);
      const radiusSquared=96*96,softeningSquared=4*4;
      for(let gy=0;gy<gridSize;gy++){
        for(let gx=0;gx<gridSize;gx++){
          const u=gx*gridStep,v=gy*gridStep;
          let sum=0,weightedX=0,weightedY=0;
          for(const p of controls){
            const distanceSquared=(u-p.u)**2+(v-p.v)**2;
            if(distanceSquared>radiusSquared)continue;
            // Compact, smoothly vanishing influence prevents one panel's
            // correction from pulling distant artwork. The softening avoids
            // singularities where neighboring island corners nearly coincide.
            const falloff=1-distanceSquared/radiusSquared;
            const weight=falloff*falloff/(distanceSquared+softeningSquared);
            sum+=weight;
            weightedX+=weight*p.dx;
            weightedY+=weight*p.dy;
          }
          const index=gy*gridSize+gx;
          gridX[index]=sum?weightedX/sum:0;
          gridY[index]=sum?weightedY/sum:0;
        }
      }

      const original=actx.getImageData(0,0,size,size).data;
      const remapped=new Uint8ClampedArray(original.length);
      for(let y=0;y<size;y++){
        const gy=Math.floor(y/gridStep), fy=(y%gridStep)/gridStep;
        for(let x=0;x<size;x++){
          const gx=Math.floor(x/gridStep), fx=(x%gridStep)/gridStep;
          const i=gy*gridSize+gx;
          const w00=(1-fx)*(1-fy),w10=fx*(1-fy);
          const w01=(1-fx)*fy,w11=fx*fy;
          // The base canvas contains artwork placed by the original affine.
          // To sample a registered source corner at its exact OBJ UV corner,
          // read from affine(sourceCorner) rather than UV(sourceCorner).
          const offsetX=gridX[i]*w00+gridX[i+1]*w10+
            gridX[i+gridSize]*w01+gridX[i+gridSize+1]*w11;
          const offsetY=gridY[i]*w00+gridY[i+1]*w10+
            gridY[i+gridSize]*w01+gridY[i+gridSize+1]*w11;
          const sx=Math.max(0,Math.min(size-1.001,x+offsetX));
          const sy=Math.max(0,Math.min(size-1.001,y+offsetY));
          const ix=Math.floor(sx),iy=Math.floor(sy);
          const wx=sx-ix,wy=sy-iy;
          const p=(iy*size+ix)*4,below=p+size*4,dst=(y*size+x)*4;
          for(let channel=0;channel<4;channel++){
            remapped[dst+channel]=Math.round(
              original[p+channel]*(1-wx)*(1-wy)+
              original[p+4+channel]*wx*(1-wy)+
              original[below+channel]*(1-wx)*wy+
              original[below+4+channel]*wx*wy
            );
          }
        }
      }
      actx.putImageData(new ImageData(remapped,size,size),0,0);

    }

    // Clip only in DESTINATION OBJ UV space. No printed-source edge is cut.
    // A 12px protective bleed catches modest residual print-line deviations
    // while excluding the distant A3 QR, instructions and extra doodles.
    const mask=document.createElement('canvas');
    mask.width=size;mask.height=size;
    const maskCtx=mask.getContext('2d');
    if(!maskCtx)throw new Error('Cannot prepare OBJ UV island mask');
    maskCtx.fillStyle='#ffffff';
    maskCtx.strokeStyle='#ffffff';
    maskCtx.lineJoin='round';
    maskCtx.lineCap='round';
    maskCtx.lineWidth=24;
    for(const polygon of KORA_UV_PANEL_CORNERS){
      maskCtx.beginPath();
      polygon.forEach(([x,y],i)=>{
        if(i===0)maskCtx.moveTo(x,y);
        else maskCtx.lineTo(x,y);
      });
      maskCtx.closePath();
      maskCtx.fill();
      maskCtx.stroke();
    }
    actx.globalCompositeOperation='destination-in';
    actx.drawImage(mask,0,0);
    actx.globalCompositeOperation='source-over';

    const result=document.createElement('canvas');
    result.width=size;result.height=size;
    const ctx=result.getContext('2d');
    if(!ctx)throw new Error('Cannot create white OBJ texture');
    ctx.fillStyle='#ffffff';
    ctx.fillRect(0,0,size,size);
    ctx.drawImage(art,0,0);
    return result;
  }

  /** Fit the printed outline as one projective transform in atlas space. */
  private correctSheetPerspective(context: CanvasRenderingContext2D): void {
    const size = this.size;
    const half = size / 2;
    const image = context.getImageData(0, 0, size, size);
    const pixels = image.data;
    const observations: { row: number[]; offset: number; y: number }[] = [];

    const gray = (x: number, y: number): number => {
      const px = Math.round(x), py = Math.round(y);
      if (px < 0 || py < 0 || px >= size || py >= size) return 255;
      const index = (py * size + px) * 4;
      if (pixels[index + 3] < 250) return 255;
      const r = pixels[index], g = pixels[index + 1], b = pixels[index + 2];
      return Math.max(r, g, b) - Math.min(r, g, b) > 20 ? 255 : (r + g + b) / 3;
    };

    for (const panel of KORA_UV_PANEL_CORNERS) {
      for (let i = 0; i < panel.length; i++) {
        const [ax, ay] = panel[i];
        const [bx, by] = panel[(i + 1) % panel.length];
        const length = Math.hypot(bx - ax, by - ay);
        const nx = (by - ay) / length, ny = (ax - bx) / length;
        const x = (ax + bx) / 2, y = (ay + by) / 2;
        // Use the outside edges. Interior print lines are shared by two UV
        // islands and can correspond to both sides of a narrow atlas gutter.
        if (KORA_UV_PANEL_CORNERS.some(poly => this.inside(x + nx * 14, y + ny * 14, poly))) continue;
        if (x < 20 || y < 20 || x > size - 20 || y > size - 20) continue;

        let bestOffset = 0;
        let bestScore = 0;
        for (let offset = -18; offset <= 18; offset++) {
          let score = 0;
          let support = 0;
          for (let k = -10; k <= 10; k++) {
            const px = x + (bx - ax) * k / 30 + nx * offset;
            const py = y + (by - ay) * k / 30 + ny * offset;
            const center = gray(px, py);
            const a = gray(px - nx * 2.5, py - ny * 2.5);
            const b = gray(px + nx * 2.5, py + ny * 2.5);
            const contrast = Math.min(a, b) - center;
            if (center >= 95 && a > 225 && b > 225 && contrast >= 8) {
              score += Math.min(contrast, 32);
              support++;
            }
          }
          if (support >= 7 && score > bestScore) {
            bestOffset = offset;
            bestScore = score;
          }
        }
        if (!bestScore) continue;

        // The detected line determines motion perpendicular to the edge.
        // Normalize coordinates so the eight-parameter fit is well scaled.
        const u = (x - half) / half, v = (y - half) / half;
        const offset = bestOffset / half;
        const position = nx * u + ny * v + offset;
        observations.push({
          row: [nx * u, nx * v, nx, ny * u, ny * v, ny, -position * u, -position * v],
          offset,
          y
        });
      }
    }

    if (observations.length < 16 || [0, 1, 2].some(third =>
      observations.filter(p => Math.floor(p.y * 3 / size) === third).length < 3)) return;

    const count = 8;
    let weights = observations.map(() => 1);
    let fit = Array<number>(count).fill(0);
    for (let iteration = 0; iteration < 4; iteration++) {
      const matrix = Array.from({ length: count }, () => Array<number>(count + 1).fill(0));
      observations.forEach(({row, offset}, n) => {
        for (let i = 0; i < count; i++) {
          const w = row[i] * weights[n];
          for (let j = 0; j < count; j++) matrix[i][j] += w * row[j];
          matrix[i][count] += w * offset;
        }
      });
      for (let i = 0; i < count; i++) {
        let pivot = i;
        for (let j = i + 1; j < count; j++) {
          if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
        }
        if (Math.abs(matrix[pivot][i]) < 1e-8) return;
        [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
        const scale = matrix[i][i];
        for (let j = i; j <= count; j++) matrix[i][j] /= scale;
        for (let n = 0; n < count; n++) {
          if (n === i) continue;
          const scale = matrix[n][i];
          for (let j = i; j <= count; j++) matrix[n][j] -= scale * matrix[i][j];
        }
      }
      fit = matrix.map(row => row[count]);
      weights = observations.map(({row, offset}) => {
        const residual = Math.abs(row.reduce((sum, value, i) => sum + value * fit[i], 0) - offset) * half;
        return Math.min(1, 2.5 / Math.max(residual, 0.01));
      });
    }
    const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const before = median(observations.map(({offset}) => Math.abs(offset) * half));
    const after = median(observations.map(({row, offset}) =>
      Math.abs(row.reduce((sum, value, i) => sum + value * fit[i], 0) - offset) * half));
    if (before - after < 1 || after > 3) return;

    const [a, b, c, d, e, f, g, h] = fit;
    if (Math.abs(g) + Math.abs(h) > 0.08) return;
    const project = (x: number, y: number): [number, number] => {
      const divisor = 1 + g * x + h * y;
      return [(x + a*x + b*y + c) / divisor, (y + d*x + e*y + f) / divisor];
    };
    for (const x of [-1, 1]) {
      for (const y of [-1, 1]) {
        const [sx, sy] = project(x, y);
        if (Math.hypot(sx - x, sy - y) * half > 44) return;
      }
    }

    const corrected = context.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [u, v] = project((x - half) / half, (y - half) / half);
        const sx = u * half + half, sy = v * half + half;
        const ix = Math.floor(sx), iy = Math.floor(sy);
        if (ix < 0 || iy < 0 || ix >= size - 1 || iy >= size - 1) continue;
        const wx = sx - ix, wy = sy - iy;
        const p = (iy * size + ix) * 4, q = p + size * 4;
        const dst = (y * size + x) * 4;
        for (let channel = 0; channel < 4; channel++) {
          corrected.data[dst + channel] =
            (pixels[p + channel] * (1 - wx) + pixels[p + 4 + channel] * wx) * (1 - wy) +
            (pixels[q + channel] * (1 - wx) + pixels[q + 4 + channel] * wx) * wy;
        }
      }
    }
    context.putImageData(corrected, 0, 0);
  }

  render(source: HTMLCanvasElement, sourcePanels: number[][][]): HTMLCanvasElement {
    if (sourcePanels.length !== 32 || KORA_UV_PANEL_CORNERS.length !== 32)
      throw new Error('Expected 32 printed panels and 32 OBJ UV panels.');
    if (source.width < 2 || source.height < 2)
      throw new Error('Corrected paper must contain source pixels.');

    for (let i = 0; i < 32; i++) {
      const from = sourcePanels[i], to = KORA_UV_PANEL_CORNERS[i];
      if (!Array.isArray(from) || from.length !== to.length || (to.length !== 5 && to.length !== 6))
        throw new Error('Panel ' + (i + 1) + ' UV corner count does not match print.');
      if (![...from, ...to].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))
        throw new Error('Non-finite panel corner on panel ' + (i + 1));
      if (to.some(([x, y]) => x < 0 || y < 0 || x > 1024 || y > 1024))
        throw new Error('UV corner outside atlas on panel ' + (i + 1));
      if (this.twiceArea(from) < 1 || this.twiceArea(to) < 1)
        throw new Error('Degenerate or mirrored panel ' + (i + 1));
    }

    const ctx = source.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Cannot read corrected panel artwork');
    const pixels = ctx.getImageData(0, 0, source.width, source.height).data;
    const sw = source.width, sh = source.height, size = this.size;
    const output = new Uint8ClampedArray(size * size * 4);
    output.fill(255);
    const owner = new Uint8Array(size * size);

    for (let panel = 0; panel < 32; panel++) {
      const from = sourcePanels[panel], to = KORA_UV_PANEL_CORNERS[panel];
      // Preserve ink and printed outlines that extend just beyond the
      // estimated print edges. The previous hard clipping lost entire
      // portions of letters and borders when the polygon fit was off by
      // a few source pixels. Pull a small (3px at reference resolution)
      // neighborhood into the UV island without changing its destination
      // footprint or accidentally sampling a masked/cropped intermediate.
      const center = from.reduce((sum, p) => [sum[0] + p[0] / from.length,
        sum[1] + p[1] / from.length], [0, 0]);
      const radius = from.reduce((sum, p) => sum + Math.hypot(p[0] - center[0], p[1] - center[1]), 0) / from.length;
      const extra = Math.min(3 * sw / 725, 3 * sh / 1024);
      const expanded = from.map(p => [center[0] + (p[0] - center[0]) * (1 + extra / radius),
        center[1] + (p[1] - center[1]) * (1 + extra / radius)]);
      const xs = to.map(p => p[0]), ys = to.map(p => p[1]);
      const minX = Math.max(0, Math.floor(Math.min(...xs)));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(...xs)));
      const minY = Math.max(0, Math.floor(Math.min(...ys)));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(...ys)));

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const atlasIndex = y * size + x;
          if (owner[atlasIndex] || !this.inside(x + .5, y + .5, to)) continue;
          const [sx, sy] = this.mapPoint(x + .5, y + .5, expanded, to);
          if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
              sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) continue;
          const ix = Math.floor(sx), iy = Math.floor(sy);
          const fx = sx - ix, fy = sy - iy;
          const base = (iy * sw + ix) * 4, below = base + sw * 4;
          const dst = atlasIndex * 4;
          for (let channel = 0; channel < 3; channel++) {
            output[dst + channel] = Math.round(
              pixels[base + channel] * (1 - fx) * (1 - fy) +
              pixels[base + 4 + channel] * fx * (1 - fy) +
              pixels[below + channel] * (1 - fx) * fy +
              pixels[below + 4 + channel] * fx * fy
            );
          }
          owner[atlasIndex] = panel + 1;
        }
      }
    }

    // Two-pixel dilation guards against sampling white texture gutters at
    // the edge of an OBJ UV island. Only propagate original panel colors
    // outward, and never overwrite any actual island texel.
    const originalOwner = owner.slice();
    const frontier = owner.slice();
    for (let pass = 0; pass < 2; pass++) {
      const next = frontier.slice();
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          const index = y * size + x;
          if (frontier[index] || originalOwner[index]) continue;
          for (const neighbor of [index - 1, index + 1, index - size, index + size]) {
            if (!frontier[neighbor]) continue;
            const dst = index * 4, src = neighbor * 4;
            output[dst] = output[src];
            output[dst + 1] = output[src + 1];
            output[dst + 2] = output[src + 2];
            next[index] = frontier[neighbor];
            break;
          }
        }
      }
      frontier.set(next);
    }

    const result = document.createElement('canvas');
    result.width = size;
    result.height = size;
    const resultCtx = result.getContext('2d');
    if (!resultCtx) throw new Error('Cannot create UV-matched texture');
    resultCtx.putImageData(new ImageData(output, size, size), 0, 0);
    return result;
  }
}
