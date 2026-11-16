# Scan normalizer — JavaScript-only worker (experimental)

The scan normalizer is frontend-only; it uses PDF.js for input, JSFeat 0.0.8 for ORB features / homography RANSAC, and plain JavaScript for the color warp and 32-panel masking.

**There is no OpenCV.js or WebAssembly requirement.** The scanned artwork never leaves the browser.

## Run
```bash
git switch feature/browser-scan-normalizer
npm install
npm start
```
The npm postinstall/start scripts copy JSFeat from the local npm installation into `public/vendor/jsfeat.min.js`. Check `http://localhost:4200/vendor/jsfeat.min.js` if the worker reports an asset error.

Upload the child scan (PDF or image), the original blank KORA printing PDF and the already-working 1024×1024 texture target, then choose Auto Align. The worker reports independent matching stages.

## Technical details
- Two-stage perspective registration: blank print → child scan and blank print → render texture.
- Image features are detected on downsized copies, while final pixels are sampled from the full-resolution original scan.
- Static reference polygons represent the 32 football panels extracted from the supplied blank printable PDF; polygon edges have a small safety margin to reduce clipping.
- Rejects low-confidence homographies instead of exporting a plausible but incorrect design.
- No manual four-point calibration.

## Limitations
- Browser rendering has **not yet been verified** on the user's machine. JSFeat RANSAC can fail for some heavily colored, blurred or cropped scans.
- The polygon reference is tied to the provided KORA blank sheet. Different revisions may need updated panel geometry.
- Perspective correction cannot fix a folded or strongly curved paper sheet; inspect before using the PNG.
- PDF.js still loads from a CDN; this can be vendored in another iteration.
