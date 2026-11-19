/**
 * Refine the 32 known KORA print polygons against the faint grey panel lines.
 * All coordinates are in the 725 x 1024 analysis image.
 *
 * The global page registration remains the starting point. For each edge we
 * look for a *continuous dark hairline*, not an individual dark pixel; marker
 * ink is much darker but generally does not line up along an entire edge.
 * Ambiguous edges stay exactly where the globally registered template put them.
 *
 * This adjusts source sampling coordinates only: no source pixels are cut,
 * whitened, masked or painted by this routine.
 */
export function refineKoraPanelCorners(
  gray: Uint8Array, width: number, height: number, panels: number[][][]
): number[][][] {
  if (gray.length !== width * height || width < 100 || height < 100)
    throw new Error('Invalid registered scan for panel edge refinement');

  const intensity = (x: number, y: number): number => {
    const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
    const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
    return gray[iy * width + ix];
  };
  const area = (poly: number[][]): number =>
    poly.reduce((sum, p, i) => {
      const q = poly[(i + 1) % poly.length];
      return sum + p[0] * q[1] - q[0] * p[1];
    }, 0);
  const cross = (a: number[], b: number[]): number => a[0] * b[1] - a[1] * b[0];

  return panels.map((polygon) => {
    if (polygon.length !== 5 && polygon.length !== 6) return polygon;
    const n = polygon.length;
    const edges: Array<{a: number[]; b: number[]; offset: number; strength: number}> = [];

    for (let i = 0; i < n; i++) {
      const a = polygon[i], b = polygon[(i + 1) % n];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 20) return polygon;
      // Normal points outside a clockwise screen-space polygon.
      const nx = (b[1] - a[1]) / length, ny = (a[0] - b[0]) / length;
      const samples = 13;
      const evidence = (offset: number): {score: number; support: number} => {
        const contrasts: number[] = [];
        for (let k = 0; k < samples; k++) {
          const t = .16 + .68 * k / (samples - 1);
          const x = a[0] * (1 - t) + b[0] * t + nx * offset;
          const y = a[1] * (1 - t) + b[1] * t + ny * offset;
          if (x < 5 || y < 5 || x >= width - 5 || y >= height - 5) continue;
          // Compare to both sides, so writing occupying just one side does
          // not look like a printed contour. Limit dark-marker influence.
          const line = intensity(x, y);
          const sides = (intensity(x + nx * 3, y + ny * 3) +
            intensity(x - nx * 3, y - ny * 3)) / 2;
          contrasts.push(Math.max(0, Math.min(55, sides - line)));
        }
        if (contrasts.length < samples - 3) return {score: 0, support: 0};
        contrasts.sort((a, b) => a - b);
        // A median-like statistic rejects isolated ink and line junctions.
        const score = (contrasts[5] + contrasts[6] + contrasts[7]) / 3;
        const support = contrasts.filter(v => v > 8).length / contrasts.length;
        return {score, support};
      };

      const baseline = evidence(0);
      let best = {offset: 0, score: baseline.score, support: baseline.support};
      for (let offset = -8; offset <= 8; offset++) {
        const candidate = evidence(offset);
        const adjusted = candidate.score - .28 * Math.abs(offset);
        const current = best.score - .28 * Math.abs(best.offset);
        if (candidate.support >= .52 && adjusted > current + .05) {
          best = {offset, ...candidate};
        }
      }
      // Only accept an actual supported line improvement. Weak/white scans
      // continue to use the existing globally aligned original polygon.
      const verified = best.offset !== 0 && best.score >= 10 &&
        best.support >= .60 && best.score > baseline.score + 3;
      edges.push({
        a: [a[0] + nx * (verified ? best.offset : 0),
            a[1] + ny * (verified ? best.offset : 0)],
        b: [b[0] + nx * (verified ? best.offset : 0),
            b[1] + ny * (verified ? best.offset : 0)],
        offset: verified ? best.offset : 0,
        strength: verified ? best.score : 0
      });
    }

    const refined: number[][] = [];
    for (let i = 0; i < n; i++) {
      const previous = edges[(i + n - 1) % n], current = edges[i];
      const u = [previous.b[0] - previous.a[0], previous.b[1] - previous.a[1]];
      const v = [current.b[0] - current.a[0], current.b[1] - current.a[1]];
      const det = cross(u, v);
      if (Math.abs(det) < 1e-4) return polygon;
      const delta = [current.a[0] - previous.a[0],
        current.a[1] - previous.a[1]];
      const t = cross(delta, v) / det;
      const x = previous.a[0] + t * u[0], y = previous.a[1] + t * u[1];
      if (!Number.isFinite(x) || !Number.isFinite(y) ||
          Math.hypot(x - polygon[i][0], y - polygon[i][1]) > 13)
        return polygon;
      refined.push([x, y]);
    }
    // Safeguard polygon topology and reject abnormal growth/shrinkage.
    const originalArea = area(polygon), newArea = area(refined);
    if (originalArea < 1 || newArea <= 0 ||
        newArea / originalArea < .78 || newArea / originalArea > 1.22)
      return polygon;
    return refined;
  });
}
