# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Document Recognizer is a Next.js web application that extracts structured data from documents (invoices, bank statements, loan contracts, drawdowns) using multimodal AI models from Google Gemini and OpenAI. The app supports both images and PDFs, enforces strict JSON schemas for reliable extraction, and includes a schema editor for customization.

## Development Commands

### Running the Application
```bash
npm run dev       # Start development server on http://localhost:3000
npm run build     # Create production build
npm start         # Start production server
```

### Testing the API
```bash
./test-api.sh     # Test both multipart/form-data and JSON endpoints
```

### Benchmarking
```bash
# Basic benchmark (tests documents in benchmark/data/)
node benchmark/run.js

# Advanced benchmark options
node benchmark/run.js --dir <path> --runs <number> --provider <gemini|openai> --expected-sum <number>

# Example: Run 3 times with OpenAI, expect total sum of 1500.50
node benchmark/run.js --runs 3 --provider openai --expected-sum 1500.50
```

## Architecture Overview

### Service Layer Architecture
The application uses a **provider-agnostic service pattern** where different AI providers implement the same interface:

- **gemini.service.js**: Handles Google Gemini API calls (uses native multimodal support for PDFs/images)
- **openai.service.js**: Handles OpenAI and Azure OpenAI API calls (uses Vision API for images, converts PDFs to JPEGs)
- **pdf.service.js**: Converts PDFs to JPEG images using ImageMagick (`convert` command)
- **schema.service.js**: Manages JSON schemas and enforces strict schema validation for OpenAI

### Key Architectural Patterns

1. **Dual Provider Support**: The `/api/recognize` route delegates to either `analyzeWithGemini()` or `analyzeWithOpenAI()` based on the `modelProvider` parameter.

2. **PDF Handling Differences**:
   - **Gemini**: Native PDF support via multimodal API
   - **OpenAI**: PDFs are converted to JPEG images via ImageMagick (`pdfToJpegs()` in pdf.service.js:27)

3. **Schema Enforcement**:
   - **OpenAI**: Uses `response_format: { type: "json_schema" }` with strict mode (enforced by `enforceStrictSchema()` in schema.service.js:16)
   - **Gemini**: Uses prompt engineering to enforce schema adherence
   - When `enforceJsonSchema` is false, schema instructions are appended to prompts instead

4. **Request Handling**: The main API route (`src/app/api/recognize/route.js`) accepts both:
   - `multipart/form-data` (file uploads from UI)
   - `application/json` (base64-encoded files for programmatic access)

### Directory Structure
```
src/
├── app/
│   ├── api/
│   │   ├── recognize/route.js    # Main document recognition endpoint
│   │   └── schemas/route.js      # Schema CRUD endpoint
│   ├── schemas/page.js           # Schema editor UI
│   └── page.js                   # Main upload UI
├── services/
│   ├── gemini.service.js         # Gemini API integration
│   ├── openai.service.js         # OpenAI/Azure API integration
│   ├── pdf.service.js            # PDF to JPEG conversion
│   └── schema.service.js         # Schema management & validation
└── data/
    └── schemas.json              # JSON schemas for document types
```

## Important Implementation Details

### PDF Conversion Dependencies
- **ImageMagick** must be installed on the system for PDF processing with OpenAI
- The `pdfToJpegs()` function uses the `convert` command with density and quality settings
- Maximum of 10 pages per PDF (configurable via `maxPages` parameter)

### Schema Structure
All schemas in `src/data/schemas.json` follow JSON Schema format. The `enforceStrictSchema()` function:
- Sets `additionalProperties: false` on all objects
- Makes all properties required at each object level
- Recursively applies these rules to nested objects and arrays

### Environment Variables
Required in `.env.local`:
```
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENAI_API_KEY=...

# Optional for Azure OpenAI
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_RESOURCE_NAME=...
AZURE_OPENAI_DEPLOYMENT=...
AZURE_OPENAI_API_VERSION=...

# Optional proxy and timeout
HTTP_PROXY=...
HTTPS_PROXY=...
OPENAI_TIMEOUT_MS=300000
```

### API Route Configuration
The recognize endpoint (`src/app/api/recognize/route.js`) uses:
```javascript
export const dynamic = 'force-dynamic';
export const maxDuration = 300;  // 5 minutes for long-running AI requests
export const runtime = 'nodejs';
```

### Custom Prompts and Schemas
Both the UI and API support:
- **customPrompt**: Override system instructions; use `{{schema}}` placeholder for schema injection
- **customSchema**: Provide a custom JSON schema object to override predefined schemas
- **enforceJsonSchema**: Toggle between strict mode (structured outputs) and loose mode (prompt-based)

## Benchmark Tool
Located in `benchmark/`, this tool validates:
1. **IBAN Validity**: Uses MOD-97 algorithm to validate extracted IBANs
2. **Total Sum**: Validates that extracted amounts match expected totals
3. **Schema Conformance**: Ensures responses contain expected structure

Run benchmarks before committing changes to detection logic.

## Key Files Reference
- API routing: `src/app/api/recognize/route.js:10` (POST handler)
- Gemini integration: `src/services/gemini.service.js:5` (analyzeWithGemini)
- OpenAI integration: `src/services/openai.service.js:23` (analyzeWithOpenAI)
- PDF to JPEG conversion: `src/services/pdf.service.js:27` (pdfToJpegs)
- Schema enforcement: `src/services/schema.service.js:16` (enforceStrictSchema)
- Document schemas: `src/data/schemas.json`

## Current Models
- **Gemini**: `gemini-2.5-flash` (hardcoded in gemini.service.js:7)
- **OpenAI**: `gpt-5` (hardcoded in openai.service.js:145)
- **Azure OpenAI**: Uses deployment name from `AZURE_OPENAI_DEPLOYMENT` env var
