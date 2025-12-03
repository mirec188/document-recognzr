# Document Recognizer

A modern web application to parse Invoices, Bank Statements, Loan Contracts, and Drawdowns using **Google Gemini AI**, **OpenAI GPT-5**, or **Azure OpenAI**.

## Features

-   **Multi-Provider Support**: Choose between Google Gemini (Flash 2.5), OpenAI (GPT-5), and Azure OpenAI.
-   **Multimodal Parsing**: 
    -   **Gemini**: Native support for Images and PDFs.
    -   **OpenAI/Azure OpenAI**: Native support for Images; PDFs are converted to images (via ImageMagick) and processed using Vision capabilities.
-   **Structured Outputs**: Enforces strict JSON schemas for reliable data extraction.
-   **Advanced Recognition Control**:
    -   **Custom Prompts**: Inject custom instructions or override the system prompt.
    -   **Strict Mode**: Toggle strict JSON schema enforcement (supported on OpenAI).
-   **Schema Editor**: Customize your JSON schemas directly in the app (`/schemas`).
-   **Premium UI**: Glassmorphism design with smooth animations and dark mode.
-   **Dynamic Runtime**: Configured for `force-dynamic` and `maxDuration` of 300 seconds for long-running recognition tasks.

## How it Works

The application provides an API endpoint (`/api/recognize`) that accepts document uploads (images or PDFs) and a specified document type.
1.  **Schema Loading**: Based on the `docType` (Invoice, Bank Statement, Loan Contract, Drawdown), a corresponding JSON schema is loaded from `src/data/schemas.json`. This schema defines the structure of the data to be extracted.
2.  **PDF Handling**: 
    -   **Gemini**: The PDF is passed natively to the model.
    -   **OpenAI/Azure OpenAI**: The PDF is converted to a series of JPEG images using **ImageMagick**. These images are then sent to the model's Vision endpoint. *Note: This allows for processing of scanned documents.*
3.  **AI Analysis**: The document (or its visual representation) is sent to the selected AI model along with the JSON schema.
4.  **Structured Extraction**: The AI model extracts information according to the provided schema, ensuring a structured JSON output. For OpenAI/Azure OpenAI, `response_format json_schema` is used for strict enforcement.
5.  **Result Display**: The extracted JSON data is returned and displayed in the UI.

## Setup

### Prerequisites

*   **Node.js** (v18+ recommended)
*   **ImageMagick**: Required for processing PDFs with OpenAI (converts PDF pages to images).
    *   *macOS*: `brew install imagemagick`
    *   *Linux*: `sudo apt-get install imagemagick`
    *   *Windows*: Download and install from [imagemagick.org](https://imagemagick.org/).

### Installation

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Environment Variables**:
    - Copy `env.example` to `.env.local`:
      ```bash
      cp env.example .env.local
      ```
    - Edit `.env.local` and configure the keys for your chosen providers:
      ```env
      # Google Gemini API Key (required for Gemini)
      GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key

      # OpenAI API Key (required for public OpenAI)
      OPENAI_API_KEY=your_openai_api_key

      # Azure OpenAI Configuration (required for Azure OpenAI)
      AZURE_OPENAI_API_KEY=your_azure_openai_api_key
      AZURE_OPENAI_RESOURCE_NAME=your_azure_openai_resource_name
      AZURE_OPENAI_API_VERSION=2025-02-01-preview
      AZURE_OPENAI_DEPLOYMENT=gpt-5
      # Optional: Set to true if your Azure OpenAI setup requires full deployment URLs
      # AZURE_OPENAI_USE_DEPLOYMENT_URLS=true

      # Optional Settings
      # OPENAI_TIMEOUT_MS=300000 (Default: 5 minutes)
      # HTTPS_PROXY=http://... (If you are behind a proxy)
      ```

3.  **Run Development Server**:
    ```bash
    npm run dev
    ```

4.  **Open Browser**:
    - Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1.  **Upload**: Drag & drop an image or PDF file.
2.  **Select Type**: Choose the document type (Invoice, Bank Statement, Loan Contract, Drawdown).
3.  **Select Model**: Choose between Gemini, OpenAI, or Azure OpenAI.
4.  **Advanced (Optional)**: Open "Advanced Configuration" to tweak prompts or toggle strict schema enforcement.
5.  **Recognize**: Click "Recognize" to extract data.
6.  **Edit Schemas**: Click "Edit Schemas" in the header to modify the extraction structure permanently.

## Additional Tools

*   **List Gemini Models**: You can use the `list-models.js` script to list available Gemini models:
    ```bash
    node list-models.js
    ```
    (Requires `GOOGLE_GENERATIVE_AI_API_KEY` to be set.)
*   **Benchmarking**: The `benchmark/` directory contains scripts for running and validating the performance of the recognition process.
