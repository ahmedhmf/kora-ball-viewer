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
   * The destination mask is made from the actual OBJ UV islands, with 12px
   * bleed. It only removes distant paper/QR marks; no SOURCE polygon is
   * clipped or resampled independently.
   */
  renderContinuous(source: HTMLCanvasElement, sourcePanels: number[][][]): HTMLCanvasElement {
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
    const [a,b,tx]=solve(bu), [c,d,ty]=solve(bv);
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
