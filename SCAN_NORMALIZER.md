# KORA scan orientation only

**Scope:** Correct the rotation of the complete printed sheet. This feature does NOT align the artwork to the 3D UV map, mask panels, recolor, crop, or modify individual drawings.

- Accept PDF, JPG, PNG and WEBP with one upload.
- Auto-detect KORA's printed QR-code corner: bottom-left is canonical.
- Use native browser BarcodeDetector when supported; fallback QR-density heuristic is marked uncertain.
- Show an entire-page preview with manual 0°, 90°, 180°, 270° selection.
- PDF export uses pdf-lib to change only page rotation metadata. Embedded scan images or vector drawing contents are not re-rendered or resampled. PDF save still produces a new PDF file.
- Image export uses a lossless PNG with full resolution and 90° rotation only.
- No OpenCV, JSFeat, or local AI model needed.

## Local test
```bash
git switch feature/browser-scan-normalizer
git pull origin feature/browser-scan-normalizer
npm install
npm start
```

Use the upside-down `WhatsApp Scan 2026-09-25 at 21.25.58.pdf`. The printed QR on that sample is at top-right, so the intended correction is **180° clockwise**. Verify the entire preview, then download an oriented PDF. If detection confidence is uncertain, inspect and select the correct angle manually.

**Important:** Rotating a printed sheet is NOT sufficient to map it to the 1024×1024 UV texture or to remove scanner perspective distortion. The current UI intentionally does not offer the previous broken "render on ball" export. A distinct texture-mapping feature would need separate validated work.

**Multi-page PDFs:** The selected angle is applied to every page. For PDFs whose pages have mixed orientations, split the file or correct pages individually.
