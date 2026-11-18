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
