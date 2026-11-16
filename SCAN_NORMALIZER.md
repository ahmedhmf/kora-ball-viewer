# KORA browser-only scan normalizer (experimental)

This branch no longer uses OpenCV.js or JSFeat to register sheets. Its worker runs pure JavaScript and compares the **whole printed 32-panel boundary pattern** with the child scan and the exact 1024×1024 master texture. A deterministic registration is then used to warp the original pixels into the target UV space. No keypoint correspondences, WebAssembly or server processing are required.

## Test

```bash
git switch feature/browser-scan-normalizer
git pull
npm install
npm start
```

1. Upload the colored scan PDF/image, the matching original blank KORA printable PDF and the canonical 1024×1024 texture.
2. Click **Auto Align & Remove Page Text**.
3. Observe stages for scan outline alignment, target outline alignment and compositing.
4. Inspect the generated PNG and 3D preview carefully, particularly around panel borders.

The confidence counts now indicate sampled **panel-edge positions** near detected image edges, **not** ORB feature matches. Low confidence produces a visible error instead of exporting unverified art.

## Current limitations

- The known panel-boundary coordinates are fixed to the **specific KORA blank template** provided for testing. Different printed template revisions require a new geometry definition.
- The whole-sheet matcher currently optimizes translation, rotation and independent scale factors. It does **not** yet correct strong projective distortion, curvature or folds.
- Edge-based registration is still experimental. It has not been validated as producing a usable output in Chrome on the user's real three uploaded files.
- Processing uses the browser Worker watchdog; there is no backend. PDF.js is still loaded from a CDN and may need bundling for complete offline support.
- Cropping/edge margin may need further adjustment after successful alignment.

## QR-orientation fix (test batch 2026-11-16)
The latest uploaded WhatsApp scan is rotated 180° relative to the **printed** blank sheet: its QR code appears top-right rather than bottom-left. A unique QR-density corner landmark is now required for automatic scan orientation and serves as a geometric registration anchor. This also enables non-uniform X/Y scan scaling. If the QR landmark or enough outlines are not found, the worker rejects the output.

Important: rotating the **printed page** upright does not guarantee a child's handwritten words will be upright; in this uploaded example much of the child writing was drawn upside-down relative to the print sheet. The 3D UV texture must use the template's printed orientation.

The output still requires a real-browser review and may need piecewise panel-by-panel registration to correct residual camera perspective. Do not merge the feature until a complete scan passes visual validation.
