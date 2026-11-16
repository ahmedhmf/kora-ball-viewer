# Browser-only scan normalizer (experimental)

## How to try
1. Start the Angular app normally with `npm install && npm start`.
2. Unlock the viewer, and find **Scan to 3D Texture** in the sidebar.
3. Upload a child's scanned PDF/JPG and the **exact 1024×1024 master texture image**.
4. Choose **Auto align scan**. Inspect the generated preview.
5. If detection is uncertain, choose four identical **panel outline corners** on the Scan image and the same four on Master **in the same order**. Use widely separated corners spanning the entire net. Choose **Align by 4 points**.
6. Only after visual review, choose **Render on ball**; or download the PNG.

## Architecture
All processing happens locally in the browser: PDF.js renders PDF page 1, OpenCV.js estimates a homography and warps into a 1024×1024 PNG, then the existing Babylon model-loader applies it. No backend or upload endpoint was added.

**Prototype limitation:** PDF.js and OpenCV.js are loaded on demand from public CDNs, so first-time use needs Internet access. For a production/offline deployment, vend these scripts under public/vendor and update their URLs in the service.

## Known limits / follow-ups
- This is a proof of concept. No live-browser build or visual accuracy test has been completed.
- Automatic ORB matching can fail when the child's coloring differs drastically from the master. Such results are labeled **estimated** and cannot be sent directly to the model.
- Manual 4-point alignment corrects a planar perspective transform but not local page curvature or non-planar distortion.
- No automatic ink masking, shadow removal, panel-wise warping, orientation recognition, color cleanup, or page selection beyond page 1 yet.
- The canonical master PNG is **not included** in this branch: upload the exact reference texture that is already confirmed to work in the current 3D viewer.
- The original project's client-side password check is not a secure authentication boundary.
