# Document Recognizer

A modern web application to parse Invoices, Bank Statements, and Loan Contracts using **Google Gemini AI** or **OpenAI GPT-5**.

## Features

-   **Multi-Provider Support**: Choose between Google Gemini (Flash 2.5) and OpenAI (GPT-5).
-   **Multimodal Parsing**: 
    -   **Gemini**: Native support for Images and PDFs.
    -   **OpenAI**: Native support for Images; PDFs are parsed via text extraction (`pdf2json`) + GPT-5.
-   **Structured Outputs**: Enforces strict JSON schemas for reliable data extraction.
-   **Schema Editor**: Customize your JSON schemas directly in the app (`/schemas`).
-   **Premium UI**: Glassmorphism design with smooth animations and dark mode.

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
    - Edit `.env.local` and add your API Keys:
      ```env
      GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key
      OPENAI_API_KEY=your_openai_api_key
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
3.  **Select Model**: Choose between Gemini and OpenAI.
4.  **Recognize**: Click "Recognize" to extract data.
5.  **Edit Schemas**: Click "Edit Schemas" in the header to modify the extraction structure.
