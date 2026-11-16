# KORA canonical full-page registration — experimental

The task is to straighten a scan and produce **one continuous 1024×1024 image** whose football net has the same size and location as the known KORA reference texture. This is **not** PDF orientation metadata and **not** panel-wise warping.

## Processing
- Upload one PDF, JPG, PNG or WEBP. PDF.js renders only the first page.
- Determine the printed sheet orientation from the bottom-left printed QR-code landmark. If uncertain, manually choose 0/90/180/270 rotation.
- Work with all 32 panel boundary line samples *together* to optimize one constrained whole-page affine registration (translation, independent X/Y scale, small skew and rotation).
- Map the entire scanned page continuously into a **1024×1024** canvas using the calibrated KORA blank-sheet → master mapping. **No panel masks, no clipping around individual polygons, no recoloring, no removal of handwriting.**
- Optional fine controls for X/Y position, width, height and small rotation. This is a fallback for scans with perspective, not a request to choose polygon points.
- Download PNG. No OpenCV, JSFeat, AI model or backend.

## Limitations
- The default target coordinates are calibrated to the exact 1024×1024 KORA master image. Different master layouts need another calibration.
- Full-page affine fitting does not perfectly eliminate strong perspective distortion, page curvature, or non-linear scanner effects. The user should inspect the output against the known-good master.
- QR-density fallback is only a heuristic when native BarcodeDetector is missing. Explicit rotation control prevents silent mistakes.
- **Do not merge** the draft PR until the Angular worker output has been validated in-browser with the original uploaded scanned PDFs.
- The original scan's handwriting orientation is preserved relative to its printed panels.
