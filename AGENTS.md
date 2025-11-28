# Agent Guide for document-recognizer

This document summarizes how to work effectively in this repository based on the current codebase. Only include and rely on what is observed here.

## Project Type and Stack

- Framework: Next.js 16 (App Router)
- Language: JavaScript (ES modules in app/api routes, client components in src/app)
- UI: React 19 with CSS modules and global CSS
- Backend endpoints: Next.js Route Handlers under src/app/api
- Dependencies: @google/generative-ai, openai, pdf2json

## Directory Structure

- src/
  - app/
    - layout.js, globals.css: global app layout and styles
    - page.js, page.module.css: main UI for uploading and analyzing documents
    - schemas/page.js: schema editor UI
    - api/
      - recognize/route.js: POST endpoint for document recognition via Gemini, OpenAI, or Azure OpenAI
      - schemas/route.js: GET/POST for loading/saving JSON schemas
  - data/
    - schemas.json: JSON schemas used by APIs and UI
  - lib/
    - schemas.js: example schema definitions (not imported by APIs)
- public/: static assets
- list-models.js: helper script to list available Gemini models via REST
- next.config.mjs, jsconfig.json, package.json

## Environment Variables

- GOOGLE_GENERATIVE_AI_API_KEY: required for Gemini
- OPENAI_API_KEY: required for OpenAI (public OpenAI)
- AZURE_OPENAI_API_KEY, AZURE_OPENAI_RESOURCE_NAME, AZURE_OPENAI_API_VERSION, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_USE_DEPLOYMENT_URLS: required for Azure OpenAI option
- Copy env.example to .env.local and fill keys when running locally

## Commands

- Install: npm install
- Dev server: npm run dev
- Build: npm run build
- Start (prod): npm run start
- List Gemini models (optional helper): node list-models.js (requires GOOGLE_GENERATIVE_AI_API_KEY)

No test or lint commands are defined in package.json at this time.

## Running Locally

1. cp env.example .env.local and set API keys
2. npm install
3. npm run dev and open http://localhost:3000

## API Endpoints

- POST /api/recognize (src/app/api/recognize/route.js)
  - form-data fields: file (Blob), docType ("invoice" | "bankStatement" | "loanContract"), modelProvider ("gemini" | "openai" | "azure-openai", default gemini)
  - Behavior:
    - Loads schema from src/data/schemas.json by key docType
    - For OpenAI/Azure OpenAI:
      - PDFs: extracts raw text with pdf2json; if no text (e.g., scanned PDFs), returns 400 advising to use Gemini
      - Images: sends as image_url data URL
      - Uses chat.completions with response_format json_schema (strict) using enforceStrictSchema()
      - For Azure: baseURL built from AZURE_* env; api_version passed; model uses deployment name
    - For Gemini:
      - Uses model gemini-2.5-flash
      - Sends prompt + inlineData with uploaded file
      - Strips Markdown fences from response before JSON.parse
- GET /api/schemas (src/app/api/schemas/route.js)
  - Returns parsed contents of src/data/schemas.json
- POST /api/schemas (src/app/api/schemas/route.js)
  - Accepts JSON body and overwrites src/data/schemas.json

## UI Flows

- Main page (src/app/page.js):
  - Select doc type, select model (Gemini, OpenAI, Azure OpenAI), upload PDF or image, submit to /api/recognize
  - Previews PDFs via iframe, images via img
  - Displays raw JSON result with JSON.stringify
- Schema editor (src/app/schemas/page.js):
  - Fetches current schemas from /api/schemas
  - Allows editing JSON in a textarea and saving via POST /api/schemas

## Schemas

- Source of truth: src/data/schemas.json (read/write by APIs and editor)
- src/lib/schemas.js provides example schema objects but is not wired into runtime
- enforceStrictSchema in recognize route sets additionalProperties=false and required fields recursively for OpenAI structured outputs

## Conventions and Patterns

- App Router file layout: API routes under src/app/api/{name}/route.js exporting HTTP methods
- Client components denoted by 'use client' at top
- Logging: Request prompts and full model responses are logged to server console (avoid committing secrets to logs)
- JSON parsing: Gemini responses may include Markdown code fences; they are stripped before parsing
- Error handling:
  - Validates presence of file and docType (400)
  - Schema load/write failures return 500 with error message
  - OpenAI PDF path returns 400 when OCR would be required

## Gotchas

- Keys must be set in environment; without them, SDK calls will fail at runtime
- For OpenAI with PDFs: pdf2json extracts text only; scanned PDFs without embedded text are not supported here
- Schema keys must match docType exactly; invalid docType returns 400
- src/lib/schemas.js is not referenced; ensure src/data/schemas.json stays in sync with any examples
- The Gemini model name is hardcoded to gemini-2.5-flash; adjust if availability changes
- list-models.js uses fetch against Google API and requires Node 18+ or a global fetch polyfill

## Extending

- Adding a new document type:
  - Update src/data/schemas.json with a new top-level key and schema
  - Update UI options in src/app/page.js docType selection list if needed
- Adding tests/linting:
  - No existing config; add preferred tools explicitly and document new commands
- Supporting OCR for OpenAI PDFs would require integrating an OCR library/service before sending text to OpenAI

## Coding Style

- Uses ES modules in route handlers (import ... from)
- Uses async/await, NextResponse for API responses
- Styling via CSS modules and globals.css

## Path Aliases

- jsconfig.json defines @/* -> ./src/* (unused in current imports but available)
