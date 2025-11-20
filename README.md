# Document Recognizer

A modern web application to parse Invoices, Bank Statements, and Loan Contracts using Google Gemini AI or OpenAi GPT-5

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
    - Edit `.env.local` and add your Google Generative AI API Key:
      ```
      GOOGLE_GENERATIVE_AI_API_KEY=your_actual_api_key_here
      ```

3.  **Run Development Server**:
    ```bash
    npm run dev
    ```

4.  **Open Browser**:
    - Navigate to [http://localhost:3000](http://localhost:3000)

## Features

-   **Multimodal Parsing**: Upload PDF or Images.
-   **Schema Validation**: Structured JSON output for specific document types.
-   **Premium UI**: Glassmorphism design with smooth animations.
