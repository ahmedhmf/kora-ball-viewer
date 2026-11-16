# Browser-only scan normalizer — blank-template registration prototype

This implementation replaces the original four-point UI with a two-stage geometric registration:
1. **Blank printed sheet PDF → child's scanned PDF**: match the known outlines and static page markings.
2. **Blank printed sheet PDF → known-good 1024×1024 renderer texture**: map that exact panel net into the renderer's texture coordinates.
3. Compose the two transforms to warp the child scan directly into 1024×1024.
4. Extract approximately 32 closed polygon panels from the blank printed sheet and mask out margins, branding outside panels, QR code and handwritten contact details.

All image processing happens in the browser. No backend and no AI model needed.

## How to test in Angular
- Checkout `feature/browser-scan-normalizer`, then run `npm ci && npm start`.
- Unlock the app.
- Under **Scan to 3D Texture**, upload these three files:
  1. the colored scan (e.g. `WhatsApp Scan 2026-09-25 at 21.17.50.pdf`);
  2. the original uncolored printing file (`Kora 50 Copies(1).pdf`);
  3. the exact tested 1024×1024 texture master image.
- Click **Auto Align & Remove Page Text**, review preview, then **Render on Ball** or **Download PNG**.

No manual corner selection is required.

## Local algorithm verification
The method was independently tested using desktop OpenCV against the two user PDFs and reference JPG:
- blank-to-scan: **39 inliers / 58 feature matches**
- blank-to-render-texture: **36 inliers / 92 feature matches**
- closed panel contours detected: **32**
- generated 1024×1024 proof PNG with outside-of-panel contact text and QR removed

These are **offline OpenCV algorithm checks**, not evidence that the Angular browser/WASM implementation passes yet. Browser execution, build, 3D output, and compatibility still require validation.

## Limitations
- OpenCV.js & PDF.js currently load from static external CDNs (no file uploaded). To run offline, vendor their scripts locally.
- The blank printable sheet must be provided as input until we bundle a preprocessed reference with the app.
- Automatic feature matching can fail with blurred, heavily cropped or strongly distorted photos; it rejects low-confidence results rather than blindly warping.
- The 32-panel contour mask has a few edge artifacts due to scanned outlines, and the panel seam boundaries may need refinement.
- No local distortion correction, shadow/lighting correction or direct WhatsApp integration yet.
- Existing application client-side password handling is NOT secure authentication.
