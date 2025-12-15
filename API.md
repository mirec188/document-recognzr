# Document Recognizer API

The Document Recognizer API allows you to extract structured data from documents (PDF, Images) using state-of-the-art AI models (Google Gemini, OpenAI GPT-5, Azure OpenAI).

## Endpoint

`POST /api/recognize`

## Authentication
Currently, the API does not enforce authentication for local usage, but it relies on server-side environment variables for AI provider keys (`OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, etc.).

## Supported Content Types
1. `multipart/form-data` (Best for standard file uploads)
2. `application/json` (Best for programmatic access using Base64 files)

---

## 1. Using `multipart/form-data`

### Parameters
| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `file` | File | Yes | The document file (PDF, JPG, PNG). |
| `docType` | String | Yes | The type of document (e.g., `invoice`, `bankStatement`, `loanContract`). |
| `modelProvider` | String | No | `gemini` (default), `openai`, or `azure-openai`. |
| `enforceJsonSchema` | Boolean | No | `true` (default) to strict enforcement. `false` for loose mode. |
| `customPrompt` | String | No | Override the system prompt. Use `{{schema}}` as a placeholder for the JSON schema. |
| `customSchema` | JSON String | No | Provide a custom JSON schema to extract data against. |

### Example (cURL)
```bash
curl -X POST http://localhost:3000/api/recognize \
  -F "file=@/path/to/invoice.pdf" \
  -F "docType=invoice" \
  -F "modelProvider=openai"
```

---

## 2. Using `application/json`

### Payload Structure
```json
{
  "file": "base64_encoded_string",
  "mimeType": "application/pdf",
  "docType": "invoice",
  "modelProvider": "gemini",
  "enforceJsonSchema": true,
  "customPrompt": "Extract this...",
  "customSchema": { ... }
}
```

### Parameters
| Key | Type | Required | Description |
|-----|------|----------|-------------|
| `file` | String | Yes | **Base64 encoded** content of the file. |
| `mimeType` | String | Yes | Mime type of the file (e.g., `application/pdf`, `image/png`). |
| `docType` | String | Yes | The type of document. |
| `modelProvider` | String | No | `gemini`, `openai`, `azure-openai`. |
| `enforceJsonSchema` | Boolean | No | Default `true`. |
| `customPrompt` | String | No | Custom system prompt. |
| `customSchema` | Object | No | Custom JSON schema object. |

### Example (cURL)
```bash
# 1. Encode file to base64 (MacOS/Linux)
base64 -i invoice.pdf > invoice.b64

# 2. Send Request
curl -X POST http://localhost:3000/api/recognize \
  -H "Content-Type: application/json" \
  -d '{
    "file": "'"$(cat invoice.b64)"'",
    "mimeType": "application/pdf",
    "docType": "invoice",
    "modelProvider": "gemini"
  }'
```

---

## Configuration Options

### `enforceJsonSchema`
*   **`true` (Strict Mode)**: Forces the model to output strictly valid JSON matching the schema.
    *   *OpenAI*: Uses `response_format: { type: "json_schema" }`.
    *   *Gemini*: Uses prompt engineering.
*   **`false` (Loose Mode)**: Allows the model more freedom. Useful if you want the model to "think" or "reason" before outputting JSON, or if strict mode is too rigid.
    *   *OpenAI*: Removes `response_format`, appends schema instruction to prompt.
    *   *Gemini*: Same as strict (Gemini is prompt-based).

### `customPrompt`
You can override the default system instruction.
*   **Placeholder**: Use `{{schema}}` in your prompt string. The API will replace this tag with the actual JSON schema.
*   **Default Behavior**: If you don't use `{{schema}}`, the API will smartly append the schema instruction to the end of your prompt (in loose mode) or rely on structured output (in strict mode).

### `customSchema`
Pass a valid JSON Schema object (or stringified JSON in FormData) to define exactly what fields you want to extract. This overrides the pre-defined schemas on the server.

---

## Tiling Options (OpenAI/Azure Only)

For documents with dense tabular data (many rows of IBANs, invoice numbers, amounts), tiling breaks large images into smaller, overlapping slices for better accuracy. Each slice is sent with the table header for context.

**Note:** Tiling is **automatically enabled** for the `drawdown` document type when using OpenAI or Azure OpenAI providers.

### Tiling Parameters

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enableTiling` | Boolean | `auto` | Enable/disable tiling. Auto-enabled for `drawdown` type. |
| `tileHeight` | Number | `800` | Height of each tile slice in pixels. |
| `tileOverlap` | Number | `100` | Overlap between tiles in pixels (prevents cutting rows). |
| `headerHeight` | Number | `200` | Height of the header region to include with each tile. |
| `parallelTiling` | Boolean | `false` | Process tiles in parallel (faster, more API calls). |
| `maxConcurrency` | Number | `3` | Max parallel requests when using parallel mode. |

**Note:** PDF images are automatically resized to max 2048px width and converted to grayscale for optimal OCR performance.

### Example with Tiling

```json
{
  "file": "base64_encoded_string",
  "mimeType": "application/pdf",
  "docType": "drawdown",
  "modelProvider": "azure-openai",
  "enableTiling": true,
  "parallelTiling": true,
  "tileHeight": 1000,
  "headerHeight": 350
}
```

### How Tiling Works

1. PDF/image is converted to JPEG pages
2. Each page taller than 1.5x `tileHeight` is split into overlapping horizontal slices
3. The header (top `headerHeight` pixels) is extracted separately
4. Each slice is sent to the API paired with the header for context
5. Results are merged and deduplicated based on unique identifiers (variableSymbol, invoiceNumber, iban)

### When to Use Tiling

- **Recommended for:** Dense tables with 20+ rows, scanned documents, drawdown lists with IBANs
- **Not needed for:** Simple invoices, single-page documents with few data points

---

## Pipeline Modes (v2 API)

**Endpoint:** `POST /api/recognize-v2`

The v2 API supports three pipeline modes for different accuracy/cost trade-offs:

### Pipeline Mode Parameter

| Mode | Description | Speed | Cost | Accuracy |
|------|-------------|-------|------|----------|
| `default` | Standard tiling + AI vision | Medium | High | Good |
| `ocr-enhanced` | Azure OCR text + images to AI | Slow | Highest | Best |
| `ocr-only` | Azure OCR text only (no images) | Fast | Low | Good* |
| `ocr-verified` | OCR + image + IBAN verification loop | Slowest | Highest | Best for IBANs |

*OCR-only works well when document structure is simple and OCR quality is high.

### Mode 1: Default (Tiling + Vision)

Standard mode using image tiling and AI vision.

```json
{
  "file": "base64...",
  "mimeType": "application/pdf",
  "docType": "drawdown",
  "modelProvider": "openai",
  "pipelineMode": "default"
}
```

### Mode 2: OCR-Enhanced (Best Accuracy)

Azure OCR extracts text first, then sends **both OCR text AND images** to OpenAI.
The AI can cross-reference the accurate OCR text with the visual layout.

```json
{
  "file": "base64...",
  "mimeType": "application/pdf",
  "docType": "drawdown",
  "modelProvider": "openai",
  "pipelineMode": "ocr-enhanced"
}
```

**Benefits:**
- OCR provides accurate character recognition (97%+ accuracy)
- AI uses images to understand layout and match values
- Best for documents where character accuracy is critical (IBANs, invoice numbers)

### Mode 3: OCR-Only (Fastest & Cheapest)

Azure OCR extracts text, then sends **only the text** to OpenAI (no images).

```json
{
  "file": "base64...",
  "mimeType": "application/pdf",
  "docType": "drawdown",
  "modelProvider": "openai",
  "pipelineMode": "ocr-only"
}
```

**Benefits:**
- Much faster (no image processing by AI)
- Much cheaper (text tokens vs image tokens)
- Works well for simple, well-structured documents

**Limitations:**
- AI doesn't see document layout
- May struggle to match values that belong together in complex tables

### Mode 4: OCR-Verified (Best for IBANs)

Multi-step pipeline with IBAN verification and correction loop:

1. Azure OCR extracts text
2. AI parses OCR text + image into structured JSON
3. All IBANs are validated using MOD-97 checksum
4. If invalid IBANs found, AI re-examines them with context about valid IBANs

```json
{
  "file": "base64...",
  "mimeType": "application/pdf",
  "docType": "drawdown",
  "modelProvider": "openai",
  "pipelineMode": "ocr-verified"
}
```

**Benefits:**
- Highest accuracy for IBAN extraction
- Automatic correction of OCR/parsing errors
- Deduplication of similar IBANs (removes duplicates where one is valid)
- AI gets context about what's already valid to make better corrections

**How the Verification Loop Works:**
1. Initial extraction produces a list of items with IBANs
2. Each IBAN is validated using the MOD-97 checksum algorithm
3. Items are split into valid and invalid groups
4. For invalid IBANs, AI is prompted with:
   - The original image for visual reference
   - List of valid IBANs (for duplicate detection)
   - List of invalid IBANs to re-examine
5. AI attempts to correct IBANs or identify duplicates
6. Only successfully corrected IBANs (passing checksum) are added to final result

**When to Use:**
- Documents with many IBANs where accuracy is critical
- Scanned documents with potential OCR errors
- When you need guaranteed valid IBANs in the output

---

## Azure Computer Vision OCR Configuration

### Required Environment Variables

```bash
AZURE_VISION_ENDPOINT=https://your-resource.cognitiveservices.azure.com
AZURE_VISION_KEY=your-api-key
```

### OCR Parameters

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `pipelineMode` | String | `default` | Pipeline mode: `default`, `ocr-enhanced`, `ocr-only` |
| `useAzureOCR` | Boolean | `false` | Enable OCR in default mode (auto-enabled for other modes) |
| `ocrLanguage` | String | `sk` | Language hint for OCR (e.g., `en`, `sk`, `de`). |
| `ocrConcurrency` | Number | `3` | Max parallel OCR requests. |

### When to Use Each Mode

| Scenario | Recommended Mode |
|----------|------------------|
| High-quality digital PDFs | `default` |
| Scanned documents with tables | `ocr-enhanced` |
| Simple invoices, good quality | `ocr-only` |
| Documents with many IBANs/numbers | `ocr-enhanced` |
| Cost-sensitive batch processing | `ocr-only` |
| Complex multi-column layouts | `ocr-enhanced` |
