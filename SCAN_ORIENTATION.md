# KORA paper-only perspective straightening

The code now implements the actual photographed-paper correction demonstrated on the uploaded WhatsApp PDF. It does **not** mask, adjust, or interpret any football panels, drawings, handwriting or text.

- `/prepare-design`: PDF/image upload, automatically seek the faint diagonal border between white paper and slightly green table, perspective-rectify the entire paper in a **single warp**, preview and download its PNG.
- The provided sample has its page touching top, left and bottom image edges, with a slanted right boundary. Automatic border detection estimates the right-edge location at top and bottom; the sliders allow fine correction when paper/table contrast is too weak.
- If the diagonal border cannot be detected reliably, show the **entire photo**, not an invented crop.
- No forced 180° rotation; rotate 0/90/180/270 or fine-adjust up to 7° if necessary.
- Apply the entire corrected paper to the existing 3D model using the existing square-with-white-padding texture method.
- Uses only PDF.js already in the app and browser Canvas APIs plus a small plain-JS Worker. No OpenCV loading, external AI model, additional backend or new dependencies.

The correction is **not** UV panel registration. The entire corrected document may not match the exact ball UV layout; the source graphics remain intact.

## Run
```bash
git switch feature/browser-scan-normalizer
git pull origin feature/browser-scan-normalizer
npm install
npm start
```

Open the viewer, then choose `Upload page, straighten & apply to ball`. Test with `WhatsApp Scan 2026-09-25 at 21.25.58(1).pdf` and compare the preview to the previously approved paper-only correction. If the table appears, adjust the right-edge sliders and click `STRAIGHTEN PAPER`. After visual verification, apply to the ball.
