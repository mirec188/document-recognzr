# Document Recognizer

A modern web application to parse Invoices, Bank Statements, and Loan Contracts using **Google Gemini AI**, **OpenAI models**, or **Azure OpenAI**.

## Features

-   **Multi-Provider Support**: Choose between Google Gemini (Flash 2.5), OpenAI (various models), and Azure OpenAI.
-   **Multimodal Parsing**: 
    -   **Gemini**: Native support for Images and PDFs.
    -   **OpenAI/Azure OpenAI**: Native support for Images; PDFs are parsed via text extraction (`pdf2json`) + LLM.
-   **Structured Outputs**: Enforces strict JSON schemas for reliable data extraction.
-   **Schema Editor**: Customize your JSON schemas directly in the app (`/schemas`).
-   **Premium UI**: Glassmorphism design with smooth animations and dark mode.
-   **Dynamic Runtime**: Configured for `force-dynamic` and `maxDuration` of 300 seconds for long-running recognition tasks.

## How it Works

The application provides an API endpoint (`/api/recognize`) that accepts document uploads (images or PDFs) and a specified document type.
1.  **Schema Loading**: Based on the `docType`, a corresponding JSON schema is loaded from `src/data/schemas.json`. This schema defines the structure of the data to be extracted.
2.  **PDF Handling**: If a PDF is uploaded for OpenAI/Azure OpenAI models, `pdf2json` extracts raw text from the document. Scanned PDFs without embedded text are not supported in this mode. Gemini, however, can natively process both image and PDF files.
3.  **AI Analysis**: The document (or its extracted text) is sent to the selected AI model (Gemini, OpenAI, or Azure OpenAI) along with the JSON schema.
4.  **Structured Extraction**: The AI model extracts information according to the provided schema, ensuring a structured JSON output. For OpenAI/Azure OpenAI, `response_format json_schema` is used for strict enforcement.
5.  **Result Display**: The extracted JSON data is returned and displayed in the UI.

## Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Environment Variables**:
    - Copy `env.example` to `.env.local`:
      ```bash
      cp env.example .env.local
      ```
    - Edit `.env.local` and add your API Keys. Depending on the model providers you intend to use, you will need to set the relevant keys:
      ```env
      # Google Gemini API Key (required for Gemini)
      GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key

      # OpenAI API Key (required for public OpenAI)
      OPENAI_API_KEY=your_openai_api_key

      # Azure OpenAI Configuration (required for Azure OpenAI)
      AZURE_OPENAI_API_KEY=your_azure_openai_api_key
      AZURE_OPENAI_RESOURCE_NAME=your_azure_openai_resource_name
      AZURE_OPENAI_API_VERSION=your_azure_openai_api_version
      AZURE_OPENAI_DEPLOYMENT=your_azure_openai_deployment_name
      # Optional: Set to true if your Azure OpenAI setup requires full deployment URLs
      # AZURE_OPENAI_USE_DEPLOYMENT_URLS=true
      ```

3.  **Run Development Server**:
    ```bash
    npm run dev
    ```

4.  **Open Browser**:
    - Navigate to [http://localhost:3000](http://localhost:3000)

## Usage

1.  **Upload**: Drag & drop an image or PDF file.
2.  **Select Type**: Choose the document type (Invoice, Bank Statement, Loan Contract).
3.  **Select Model**: Choose between Gemini, OpenAI, or Azure OpenAI.
4.  **Recognize**: Click "Recognize" to extract data.
5.  **Edit Schemas**: Click "Edit Schemas" in the header to modify the extraction structure.

## Additional Tools

*   **List Gemini Models**: You can use the `list-models.js` script to list available Gemini models:
    ```bash
    node list-models.js
    ```
    (Requires `GOOGLE_GENERATIVE_AI_API_KEY` to be set.)
*   **Benchmarking**: The `benchmark/` directory contains scripts for running and validating the performance of the recognition process.
