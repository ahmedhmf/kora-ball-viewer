# Optional “Remove Outside Panels” preview

The successful automatic paper straightening and QR-based orientation are untouched.

On `/prepare-design`, upload the scanned PDF/photo. The full straightened sheet appears by default, including its printed QR, handwritten footer and all artwork.

Once the preview is ready, click **REMOVE OUTSIDE PANELS** to hide page content outside the KORA football net (all 32 panels). The algorithm uses the known blank KORA print outline (725×1024 reference coordinates), performs a small global translation/scale registration against the straightened page, and applies one combined mask **with an 18px safety margin** around printed panel boundaries. This preserves the children's colored marks near panel borders but may retain a little surrounding ink near extreme edges. It doesn't warp the image or move panels separately.

Click **SHOW FULL PAPER** to restore the original corrected page immediately, without re-uploading. The current preview is what gets downloaded or applied to the ball. The X/Y rulers remain outside the exported image. If panel-border alignment is unreliable, the cleanup rejects the result and leaves the full paper unchanged.

No new backend, OpenCV, AI model, or user-selected corner points. The full paper remains the default because this feature is being tested behind a button. The output is still not guaranteed to align to the original ball UV map.

## Test
```bash
git switch feature/browser-scan-normalizer
git pull origin feature/browser-scan-normalizer
npm install
npm start
```
Upload the original WhatsApp PDF, click **REMOVE OUTSIDE PANELS**, inspect every panel boundary, try **SHOW FULL PAPER**, then optionally download or apply to ball.

## New third button: Cut to Panel Shapes

The existing Remove Outside Panels button continues to produce an uncropped white-background image. After pressing it, the **CUT TO PANEL SHAPES** button appears. It uses the same reference alignment but clips directly to the union of the 32 printed panel polygons, with only a 4px safety margin around the outlines, and then **trims the image canvas to their combined bounding rectangle**. The area between/outside shapes has transparent alpha; no panel is moved, separately warped, rotated or rearranged. This is distinct from trimming away every white pixel—blank white panel faces are preserved.

**SHOW UNCROPPED PANELS** restores the previous panel-only preview, and **SHOW FULL PAPER** restores the untouched straightened sheet. Download a transparent PNG or apply the selected view to the ball. X/Y ruler coordinates update with the cropped canvas; ruler UI is excluded from the PNG.

The printed outline registration remains approximate and can be rejected if unreliable. Tight masking can still clip color drawn beyond the printed panel border, so verify the result before export.


## Fourth step: Make 1:1

After **Cut to Panel Shapes**, click **MAKE 1:1**. This centers the already cropped
panel image on a square **solid white** canvas whose side equals the original
image's longest side. **No resizing, stretching or additional cropping** is
performed. All 32 panel shapes retain their exact relative positions. Click
**SHOW ORIGINAL ASPECT RATIO** to undo the square padding.

Changing the earlier cleanup/crop stage clears square mode automatically so
the exported preview always matches the active stage. Download yields
`kora-panel-shapes-square.png` with a solid white background (including gaps between the panels), while Apply to Ball
renders the square art into the Babylon viewer's required 1024×1024 texture.
The X/Y ruler labels continue to track the actual currently displayed canvas.

The earlier **Cut to Panel Shapes** mode still remains transparent; only **Make 1:1** composites the cutout onto solid white in both downloaded PNG and ball texture.

## UV-aware final placement (misaligned 3D seams)

The original **Cut to Panel Shapes** step saves a tightly cropped bitmap.
Previously **Make 1:1** centered that bitmap on an arbitrary square. That is
not the same as placing the artwork at the coordinates of the model's UVs.

The final square now uses **one geometry-calibrated global transform** matched
against `public/3d-models/32-CLB.obj`'s actual `vt` records. The printed
725×1024 KORA panel coordinates are mapped to the default model's texture
space with:

- `u = 0.105 + 0.00109 * templateX`
- `topDownV = -0.065 + 0.00109 * templateY`

The exported image remains 1024×1024 with **solid white background** and the
panels are *not* independently warped, recolored or rearranged. The
`Make 1:1` preview itself shows the new UV placement. When applying that mode
to the ball, the app uses those 1024 pixels directly, with **no second
rescaling or 920px inset**. Prior stages and toggle behavior are unchanged.

This registration is specifically for the default `32-CLB.obj` model;
custom OBJ models may have a different UV atlas. Because the printed scan's
panel geometry and model UV atlas are not perfectly identical, this global
fit reduces systematic offset but does **not** guarantee every individual
seam will match perfectly.
