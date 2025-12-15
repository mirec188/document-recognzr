# IBAN Accuracy Improvement Ideas

## Problem
Dense tabular documents with 50+ IBANs sometimes have extraction errors - digits get confused (e.g., SK89 vs SK98), leading to invalid IBANs.

---

## Benchmark Results (2024-12-05)

**Configuration:**
- Provider: openai (gpt-5-mini)
- Tiling: enabled, parallel
- 4 pages → 16 tiles (4 slices per page)
- Image: 1600px wide, ~2000px tall pages
- ~2126 input tokens per tile

**Results:**
- 81 IBANs extracted
- **25 invalid IBANs (31% error rate)**
- Runtime: 142 seconds

**Error patterns observed:**
| Type | Example | Likely Cause |
|------|---------|--------------|
| Extra digit | `SK530900000000000411339965` (25 chars) | OCR added zero |
| Digit swap | `6820494002` vs `6620494002` | 8↔6 confusion |
| Repeated errors | Same IBAN wrong multiple times | Dedup picks wrong version |

**Key issue:** Same IBAN extracted correctly in one tile, incorrectly in another. Deduplication uses "first wins" strategy - if wrong version comes first, it persists.

---

## Idea: Use Responses API Conversation Context

The OpenAI Responses API supports `previous_response_id` to chain requests with context. Could this improve accuracy?

### Potential Strategies

#### 1. Two-Pass Verification
```
Pass 1: Extract all IBANs from image
Pass 2: "Review these IBANs for errors: SK89 7500 0000 0012 3456 7890, ..."
        → Model re-checks against the image with focused attention
```

#### 2. Self-Correction Loop
```
Pass 1: Extract data
Pass 2: "Verify each IBAN checksum. For any invalid ones, re-examine the image"
        → Model knows IBAN validation rules, can self-correct OCR mistakes
```

#### 3. Tile-by-Tile with Running Context
```
Tile 1: Extract rows 1-15 → store response
Tile 2: "Continue extracting. Previous tile ended with invoice 12345..."
        → Model has context about where it left off, reduces duplication
```

### Concerns / Reality Check

- **Core problem is resolution** - If model can't distinguish digits in first pass, second pass may not help
- **Hallucination reinforcement** - Model might double-down on mistakes rather than correct them
- **Cost doubles** - Two API calls per document
- **IBAN checksums already validate** - We detect invalid IBANs in post-processing anyway

---

## Alternative Approaches (Possibly More Effective)

### 1. Higher Resolution Tiles
- Reduce `sliceHeight` further (e.g., 600px instead of 900px)
- Fewer rows per image = larger text per row = better accuracy
- Trade-off: More API calls

### 2. Confidence Scores
- Modify schema to include confidence per IBAN:
  ```json
  {
    "iban": "SK89 7500 0000 0012 3456 7890",
    "confidence": "high" | "medium" | "low"
  }
  ```
- Flag low-confidence extractions for human review
- Could trigger re-extraction for low-confidence items only

### 3. Multiple Extractions + Voting
- Run extraction 2-3 times
- Take consensus (majority vote) for each IBAN
- Most expensive but potentially most accurate
- Could be selective: only re-run if checksum validation fails

### 4. Targeted Re-extraction
- First pass: Extract all
- Validate IBANs with checksum
- Second pass: Only re-extract rows with invalid IBANs
- More efficient than full two-pass

### 5. Preprocessing Enhancements
- Increase DPI for PDF conversion (200 instead of 150)
- Sharpen text edges before sending to API
- Experiment with different grayscale/contrast settings

---

## Prioritized Action Plan

Based on benchmark analysis (31% error rate), here are improvements ranked by effort/impact:

### Quick Wins (Low Effort)

#### 1. Smart Deduplication - Prefer Valid IBANs
**Current:** First occurrence wins
**Proposed:** If duplicate has valid checksum, prefer it over invalid version

```javascript
// In deduplicateRows()
if (seen.has(key)) {
    const existing = seen.get(key);
    const newIsValid = validateIBAN(row.iban);
    const existingIsValid = validateIBAN(existing.iban);
    if (newIsValid && !existingIsValid) {
        // Replace with valid version
        seen.set(key, row);
    }
}
```

#### 2. Try Larger Model (gpt-4.1 instead of gpt-5-mini)
- Mini models use different image processing (32x32 patches vs 512px tiles)
- Worth testing if accuracy improves significantly

#### 3. Reduce Tile Height (768px)
- Current: 900px tiles → downscaled by OpenAI
- 768px matches OpenAI's "shortest side" target = no downscaling
- May improve digit clarity

### Medium Effort

#### 4. Responses API - Targeted Re-verification
Use `previous_response_id` for failed checksums only:
```
Pass 1: Extract all (store: true)
Pass 2: "These IBANs failed checksum: [...]. Re-examine the image carefully."
        (previous_response_id: pass1.id)
```
- Only adds cost for tiles with errors
- Model has context of what it extracted before

#### 5. Confidence Scoring
Add to schema: `"ibanConfidence": "high" | "low"`
- Flag low-confidence for manual review or re-extraction
- Useful diagnostic even if not acted upon

### Higher Effort

#### 6. Voting (Multiple Extractions)
- Run 2-3 times per tile
- Take consensus for each IBAN
- Expensive but potentially most accurate

#### 7. Tile-by-Tile Context Chain
```
Tile 1: Extract → store response
Tile 2: "Continue from previous. Last row was invoice 12345..."
        → previous_response_id: tile1.id
```
- May reduce duplicates
- Helps model understand document flow

---

## Experiment Plan (Updated)

| # | Experiment | Expected Impact | Effort |
|---|------------|-----------------|--------|
| 1 | Smart dedup (prefer valid) | Medium | Low |
| 2 | Try gpt-4.1 | High? | Low |
| 3 | Tile height 768px | Medium | Low |
| 4 | Targeted re-verify | Medium | Medium |
| 5 | Confidence scores | Diagnostic | Medium |

## Notes

- Current tiling config: headerHeight=200, sliceHeight=900, overlap=100
- Current image width: 1600px max
- IBAN validation already happens in `benchmark/validators.js`

---

## OpenAI Vision API - Key Documentation Findings

### Detail Parameter (already implemented as "high")
```json
{
    "type": "input_image",
    "image_url": "...",
    "detail": "high"  // ← We use this
}
```

- `"low"` = 85 tokens, model gets 512x512px version - **NOT suitable for IBAN extraction**
- `"high"` = More tokens, better understanding - **Required for dense text**
- `"auto"` = Model decides

### Known Limitations (from OpenAI docs)
- **Small text**: "Enlarge text within the image to improve readability, but avoid cropping important details"
- **Non-Latin text**: May not perform optimally (not our issue with SK IBANs)
- **Counting**: "May give approximate counts" - relevant for row counting
- **Spatial reasoning**: Struggles with precise localization

### Image Processing / Token Costs

**For GPT-4.1 / GPT-4o (detail: high):**
1. Scale to fit 2048x2048 square
2. Scale shortest side to 768px
3. Count 512px tiles
4. Cost = (tile_count × 170) + 85 base tokens

**Example:** 1024x1024 image = 765 tokens (4 tiles × 170 + 85)

**For GPT-4.1-mini/nano:**
- Different calculation using 32x32 patches
- Max 1536 patches, with multiplier (1.62 for mini, 2.46 for nano)

### Implications for Our Tiling Strategy

Current setup (1600px wide images):
- At 1600px width, images will be scaled to fit 768px shortest side
- This means our 1600x900 tiles become ~768x432 for processing
- **This is significant downscaling!**

**Potential optimization:**
- Since OpenAI scales to 768px shortest side anyway, we could:
  - Use wider images (up to 2048px) without extra token cost
  - Or use square-ish tiles to maximize effective resolution

**Key insight:** A 768x768 tile and a 1600x1600 tile cost the same tokens but the 768px tile has NO downscaling loss!

### Recommended Experiments

1. **Test different tile aspect ratios:**
   - Current: 1600x900 (landscape) → scaled to ~768x432
   - Try: 900x900 (square) → scaled to 768x768 (less downscaling)
   - Try: 768x768 (native) → no scaling at all!

2. **Optimize for 768px sweet spot:**
   - If we make tiles 768px tall, OpenAI won't downscale them
   - Could improve IBAN readability significantly

3. **Consider image width:**
   - Current MAX_IMAGE_WIDTH=1600 may be overkill
   - 1024px might be sufficient and use fewer tokens
