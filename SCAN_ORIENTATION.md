# Scan orientation only — reset from experimental normalizer

The old 32-panel masking, per-panel warping, automatic 1024 registration, and experimental workers were removed from this feature branch. This branch now follows the current `main` architecture and makes **only one narrow change**: a new simplified PDF/image preparation page that straightens the entire page and applies it to the 3D ball.

- Open the main viewer and choose **Upload page, straighten & apply to ball**, or visit `/prepare-design`.
- Upload a PDF or JPG/PNG/WEBP. The whole first page is shown, nothing is erased or cropped.
- The browser attempts to infer 0/90/180/270 orientation from the printed QR code (fallback heuristics are *uncertain*), plus an optional ±7° tilt estimate from printed line edges.
- Verify the preview. Adjust the quarter-turn or fine angle with two simple controls if needed.
- **Apply whole page to ball**: produces a square PNG by fitting the complete page with white margins, then sends that texture to the existing Babylon viewer.
- **Download straightened PNG**: saves the complete page at its rotated natural resolution without cropping.

Notes: The 3D model's UV map is unchanged. A raw full-page image mapped to the ball may not line up with the original 1024×1024 UV layout; correcting that would be a separate feature explicitly excluded here. This code does not guarantee correct orientation when the QR cannot be found. The source file is never modified or uploaded.

## Local
```bash
git switch feature/browser-scan-normalizer
git pull origin feature/browser-scan-normalizer
npm install
npm start
```
