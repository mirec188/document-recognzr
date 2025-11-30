# Document Recognizer Benchmark

This tool benchmarks the accuracy and performance of the `drawdown` document recognition.

## Setup
1. Ensure the main application is running (`npm run dev`).
2. Place your test documents (PDF, PNG, JPG) in `benchmark/data/`.
3. Run the benchmark script.

## Usage

```bash
node benchmark/run.js [options]
```

### Options
- `--dir <path>`: Path to the directory containing test files (default: `benchmark/data`).
- `--runs <number>`: Number of times to process each file (default: 1).
- `--provider <name>`: AI Model Provider (`gemini` or `openai`) (default: `gemini`).
- `--expected-sum <number>`: Expected total amount sum for validation (optional).

### Example

```bash
# Run 3 times using OpenAI on files in 'my_tests'
node benchmark/run.js --dir my_tests --runs 3 --provider openai

# Validate that the total sum is exactly 1500.50
node benchmark/run.js --expected-sum 1500.50
```

## Validation Logic
The benchmark checks:
1. **IBAN Validity**: Uses strict MOD-97 algorithm check on all extracted IBANs.
2. **Total Sum**: Sums up all `amount` fields and compares with `--expected-sum` (if provided).
3. **Schema**: Checks if the response contains the expected `drawdown` array.
