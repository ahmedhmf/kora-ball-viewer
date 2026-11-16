# KORA scan normalizer — experimental panel-by-panel registration

## Verification status
The **latest upside-down WhatsApp PDF** and supplied original blank/reference texture were examined in an offline Python/OpenCV prototype. A local 32-panel fit gives a visibly better but **still imperfect** result. The browser algorithm below was ported to the web worker and has **not yet passed an end-to-end browser run**; do not merge until visually checked.

## Method
1. Determine the printed sheet's 0°/180° orientation using the QR position.
2. Normalize scan height to 1024 logical pixels while preserving the original full-resolution pixels for final sampling.
3. Estimate edge-distance maps in pure JavaScript (no OpenCV, no JSFeat, no WASM).
4. Fit each of the 32 known printed panel outlines independently using bounded local translation and X/Y scale.
5. Transfer child-painted pixels into the fixed 1024×1024 KORA layout with 4px edge margin.
6. Refuse export if too many panels have poor local confidence.

**Calibration caveat:** The scan initialization and target UV transform are calibrated to the exact user-provided printable sheet and master texture. Other revisions, significantly different phone framing, or strong perspective distortions may still fail or produce bad results. Output requires visual inspection.

## Test
```bash
git switch feature/browser-scan-normalizer
git pull
npm install
npm start
```
Upload the three known files: child scan PDF, blank KORA print PDF, exact 1024 master JPG. The worker should show QR orientation and a count of aligned panels.

The child's handwriting may be naturally upside down relative to the printed sheet; it is intentionally not rotated independently.

The feature is a draft PR and should remain unmerged until tested in a real browser.
