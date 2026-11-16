# KORA complete-net extraction and canonical 1024×1024 placement

Two parts run in the browser without backend, OpenCV, AI, or panel-wise manipulation.

## Part A — whole-net extraction
- Read PDF/image and infer printed-sheet orientation from its QR landmark (manual 0/90/180/270 correction available).
- Estimate one global 2D page registration from all printed panel boundaries simultaneously.
- Preserve every original scan pixel within the complete net as one continuous warped image. A **single union silhouette** of the original blank print net is rasterized with 15px edge bleed into final coordinates. This removes external QR, instructions and contact details while retaining seams between neighboring panels.
- No separate panel transformations or interior panel masks.

## Part B — canonical placement
- Sample the original RGB scan once into an exact 1024×1024 white canvas.
- Fixed calibration from the provided KORA blank sheet (725×1024) into the known-good master is xTarget=115+1.10*xBlank; yTarget=-54+1.09*yBlank.
- Preview optional green target outlines; green lines never appear in PNG.
- Check visual alignment before download; controls for whole-sheet X/Y, scale and fine rotation are still available after automatic failure.

## Reliability
- Reject uncertain whole-net registrations if too few printed outline samples agree or too few of 8 scan regions align.
- The single global transform is affine, including independent X/Y scale, translation, rotation and skew. It **cannot perfectly correct strong camera perspective or curled paper**; the user should inspect the green guides.
- PDF.js currently loads from CDN; it processes locally after loading and does not upload user images.
- **Unverified in live Chrome**. Feature remains a draft PR; do not merge before checking all 32 panels on the supplied sample scan.

## Test
```bash
git switch feature/browser-scan-normalizer
git pull origin feature/browser-scan-normalizer
npm install
npm start
```
Upload the sample PDF. Confirm QR/printed logo orientation. The result must show only the connected net on the 1024×1024 canvas and no QR/footer, without cuts between individual panels. Compare outlines with the green guide before approving export.
