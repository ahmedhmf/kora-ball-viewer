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
      const xs = to.map(p => p[0]), ys = to.map(p => p[1]);
      const minX = Math.max(0, Math.floor(Math.min(...xs)));
      const maxX = Math.min(size - 1, Math.ceil(Math.max(...xs)));
      const minY = Math.max(0, Math.floor(Math.min(...ys)));
      const maxY = Math.min(size - 1, Math.ceil(Math.max(...ys)));

      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const atlasIndex = y * size + x;
          if (owner[atlasIndex] || !this.inside(x + .5, y + .5, to)) continue;
          const [sx, sy] = this.mapPoint(x + .5, y + .5, from, to);
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
