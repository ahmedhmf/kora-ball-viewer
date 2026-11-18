# Automatic KORA paper straightening and printed orientation

Upload one WhatsApp PDF/photo at `/prepare-design`. Processing is frontend-only and uses the existing pure-JS perspective worker.

1. Detect the paper/table boundary and straighten the whole paper.
2. **Automatically orient the PRINTED sheet** so its QR marker sits at bottom-left. Prefer native browser QR decoding; use strong corner fine-detail density as fallback (with explicit confidence threshold). Rotate the entire corrected canvas by 0°, 90°, 180°, or 270°; never rotate panels individually or remove content printed on the sheet.
3. Display the final canvas with **X/Y pixel rulers** outside the preview. Rulers are excluded from both the download and ball texture.
4. Download corrected PNG or apply the entire upright page to the 3D ball.

The reported latest image has the printed QR top-right, so it requires **180° clockwise** after perspective straightening. If neither detection method can establish orientation reliably, retain the corrected page rather than guess a rotation.

The scan's handwriting may itself have been written upside-down relative to the paper; only the printed paper determines the canonical orientation.

Run: `git switch feature/browser-scan-normalizer && git pull && npm start`.
