# Automatic KORA paper correction with X/Y rulers

On `/prepare-design` upload one original PDF or photo. The application detects the slanted paper/table boundary and straightens the **entire photographed sheet** using one projective transform, keeping the 32 football panels, text, QR and handwriting unchanged.

The automatic detector fits and refines a continuous colored-paper seam across multiple heights, and only accepts a boundary when it has sufficient support. The expected sample right-edge positions are roughly 96.5% across at the top and 69.2% at the bottom; the detector estimates the edge from pixels, not from hardcoded crop values.

An **X-axis ruler above the image** and **Y-axis ruler to its left** show corrected-image pixel coordinates. Both rulers are outside the preview canvas so the exported PNG and Babylon texture contain **no ruler marks**.

There are no manual crop-point selectors or adjustment sliders. If the paper edge is not reliably detected (for example an already-straightened image with no visible tabletop), the app requests a clearer original instead of generating an unverified crop.

## Test
```bash
git switch feature/browser-scan-normalizer
git pull
npm install
npm run test:paper
npm start
```
Open `/prepare-design`, upload the original WhatsApp scan PDF, inspect paper-only preview and axes, then use the existing download or apply-to-ball action. Neither the detector nor the viewer aligns paper artwork to individual 3D UV panels.
