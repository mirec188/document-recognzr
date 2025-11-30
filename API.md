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
