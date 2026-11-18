# KORA automatic paper straightening

**No manual alignment.** On `/prepare-design`, upload one PDF or photo. The app:
1. Reads the image or first PDF page.
2. Locates the faint diagonal between the photographed sheet and the table.
3. Corrects the entire sheet with one perspective transform in a browser worker.
4. Immediately previews the full corrected paper; all drawings, printed text, and QR markings on it remain.
5. Offers only `Apply straightened paper to ball` and `Download corrected PNG`.

The detection specifically handles the uploaded WhatsApp example, where the top, left and bottom of the paper meet the frame and the right edge slopes inward. If the paper/table boundary is too ambiguous, the app displays a clear error rather than silently exporting the table.

No OpenCV startup, additional backend, panel-by-panel warp, masks, or manual edge sliders. An entire corrected A4 paper placed on the ball will still use the existing square-texture fitting; this does not solve UV registration.

Test: `npm start`, then go to `/prepare-design` and upload `WhatsApp Scan 2026-09-25 at 21.25.58(1).pdf`.
