const fs = require('fs');
const path = require('path');
const { validateDrawdown } = require('./validators');
const {
    findReferenceCSV,
    loadReferenceCSV,
    compareWithReference,
    formatComparisonLog
} = require('./reference-validator');

// Configuration
const DEFAULT_TIMEOUT = 800000; // 5 minutes - needed for parallel tiling with many tiles

// Logging configuration
const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'api-calls.log');
const OUTPUT_DIR = path.join(LOG_DIR, 'outputs');

// Session timestamp for output files
let sessionTimestamp = null;

/**
 * Initialize log file and output directory for this benchmark session.
 */
function initializeLog(config, apiUrl) {
    // Ensure log directory exists
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }

    // Create session-specific output directory
    sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sessionOutputDir = path.join(OUTPUT_DIR, sessionTimestamp);
    if (!fs.existsSync(sessionOutputDir)) {
        fs.mkdirSync(sessionOutputDir, { recursive: true });
    }

    const header = `
${'#'.repeat(80)}
${'#'.repeat(80)}
##  BENCHMARK SESSION: ${sessionTimestamp}
${'#'.repeat(80)}
${'#'.repeat(80)}

CONFIGURATION:
${JSON.stringify({ ...config, apiUrl }, null, 2)}

`;

    // Clear and write new session header
    fs.writeFileSync(LOG_FILE, header, 'utf8');
    console.log(`Log file: ${LOG_FILE}`);
    console.log(`Output dir: ${sessionOutputDir}`);
}

/**
 * Save result JSON to output directory.
 */
function saveResultJson(filename, runIndex, result, validation, referenceComparison = null) {
    if (!sessionTimestamp) return;

    const sessionOutputDir = path.join(OUTPUT_DIR, sessionTimestamp);
    const baseName = path.basename(filename, path.extname(filename));
    const outputFile = path.join(sessionOutputDir, `${baseName}_run${runIndex + 1}.json`);

    const output = {
        source: filename,
        run: runIndex + 1,
        timestamp: new Date().toISOString(),
        validation: {
            validIbans: validation.validIbans,
            invalidIbans: validation.invalidIbans,
            totalAmount: validation.totalAmount,
            errors: validation.errors
        },
        result: result
    };

    // Add reference comparison if available
    if (referenceComparison) {
        output.referenceComparison = {
            refFile: referenceComparison.refFile,
            totalRef: referenceComparison.totalRef,
            totalApi: referenceComparison.totalApi,
            matched: referenceComparison.matched,
            matchedWithCorrectIban: referenceComparison.matchedWithCorrectIban,
            matchedWithCorrectAmount: referenceComparison.matchedWithCorrectAmount,
            perfectMatches: referenceComparison.matchedAllFields,
            ibanAccuracy: referenceComparison.matched > 0
                ? `${((referenceComparison.matchedWithCorrectIban / referenceComparison.matched) * 100).toFixed(1)}%`
                : '0%',
            amountAccuracy: referenceComparison.matched > 0
                ? `${((referenceComparison.matchedWithCorrectAmount / referenceComparison.matched) * 100).toFixed(1)}%`
                : '0%',
            missing: referenceComparison.missing,
            extra: referenceComparison.extra,
            fieldErrors: referenceComparison.fieldErrors
        };
    }

    fs.writeFileSync(outputFile, JSON.stringify(output, null, 2), 'utf8');
    return outputFile;
}

async function runBenchmark() {
    const args = process.argv.slice(2);
    const config = {
        dir: 'benchmark/data',
        runs: 1,
        provider: 'gemini',
        expectedSum: null,
        // Tiling options
        enableTiling: null,      // null = auto (enabled for drawdown)
        parallelTiling: false,
        tileHeight: null,
        tileOverlap: null,
        headerHeight: null,
        maxConcurrency: null,
        // Pipeline mode (v2 API)
        pipelineMode: null,      // null = use v1 API, otherwise: "default", "ocr-enhanced", "ocr-only"
        apiVersion: 'v1',        // v1 = /api/recognize, v2 = /api/recognize-v2
        // Reference validation
        useReference: false      // --reference flag
    };

    // Simple argument parsing
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dir') config.dir = args[++i];
        else if (args[i] === '--runs') config.runs = parseInt(args[++i]);
        else if (args[i] === '--provider') config.provider = args[++i];
        else if (args[i] === '--expected-sum') config.expectedSum = parseFloat(args[++i]);
        // Tiling options
        else if (args[i] === '--enable-tiling') config.enableTiling = true;
        else if (args[i] === '--disable-tiling') config.enableTiling = false;
        else if (args[i] === '--parallel-tiling') config.parallelTiling = true;
        else if (args[i] === '--tile-height') config.tileHeight = parseInt(args[++i]);
        else if (args[i] === '--tile-overlap') config.tileOverlap = parseInt(args[++i]);
        else if (args[i] === '--header-height') config.headerHeight = parseInt(args[++i]);
        else if (args[i] === '--max-concurrency') config.maxConcurrency = parseInt(args[++i]);
        // Pipeline mode (v2 API)
        else if (args[i] === '--pipeline-mode') {
            config.pipelineMode = args[++i];
            config.apiVersion = 'v2';  // Auto-switch to v2 API
        }
        else if (args[i] === '--api-version') config.apiVersion = args[++i];
        // Reference validation
        else if (args[i] === '--reference') config.useReference = true;
        else if (args[i] === '--help' || args[i] === '-h') {
            printHelp();
            process.exit(0);
        }
    }

    // Determine API URL based on version
    const API_URL = config.apiVersion === 'v2'
        ? 'http://localhost:3000/api/recognize-v2'
        : 'http://localhost:3000/api/recognize';

    console.log('--- Benchmark Configuration ---');
    console.log(`Directory:       ${config.dir}`);
    console.log(`Runs per file:   ${config.runs}`);
    console.log(`Provider:        ${config.provider}`);
    console.log(`API Version:     ${config.apiVersion}`);
    console.log(`API URL:         ${API_URL}`);
    if (config.pipelineMode) console.log(`Pipeline Mode:   ${config.pipelineMode}`);
    console.log(`Expected sum:    ${config.expectedSum || 'not set'}`);
    console.log(`Tiling:          ${config.enableTiling === null ? 'auto' : config.enableTiling ? 'enabled' : 'disabled'}`);
    console.log(`Parallel tiling: ${config.parallelTiling}`);
    if (config.tileHeight) console.log(`Tile height:     ${config.tileHeight}px`);
    if (config.tileOverlap) console.log(`Tile overlap:    ${config.tileOverlap}px`);
    if (config.headerHeight) console.log(`Header height:   ${config.headerHeight}px`);
    if (config.maxConcurrency) console.log(`Max concurrency: ${config.maxConcurrency}`);
    console.log(`Reference:       ${config.useReference ? 'enabled' : 'disabled'}`);
    console.log('-------------------------------');

    // Initialize log file for this session
    initializeLog(config, API_URL);

    if (!fs.existsSync(config.dir)) {
        console.error(`Directory not found: ${config.dir}`);
        process.exit(1);
    }

    // Filter for common document files
    const files = fs.readdirSync(config.dir).filter(f => {
        const ext = path.extname(f).toLowerCase();
        return !f.startsWith('.') && ['.pdf', '.png', '.jpg', '.jpeg'].includes(ext);
    });

    if (files.length === 0) {
        console.error('No document files (pdf, png, jpg) found in directory.');
        process.exit(1);
    }

    const stats = {
        totalRequests: 0,
        success: 0,
        failed: 0,
        totalRuntime: 0,
        validations: {
            ok: 0,
            nok: 0
        },
        ibans: {
            valid: 0,
            invalid: 0
        },
        tilesProcessed: 0,
        // Reference validation stats
        reference: {
            filesWithRef: 0,
            totalRefRows: 0,
            totalApiRows: 0,
            matched: 0,
            matchedWithCorrectIban: 0,
            matchedWithCorrectAmount: 0,
            perfectMatches: 0
        }
    };

    console.log(`Found ${files.length} files. Starting benchmark...`);

    for (const file of files) {
        const filePath = path.join(config.dir, file);
        console.log(`
Processing: ${file}`);

        // Prepare payload
        const fileBuffer = fs.readFileSync(filePath);
        const base64File = fileBuffer.toString('base64');

        const ext = path.extname(file).toLowerCase();
        const mimeType = ext === '.pdf' ? 'application/pdf' :
                         ext === '.png' ? 'image/png' :
                         'image/jpeg';

        for (let i = 0; i < config.runs; i++) {
            process.stdout.write(`  Run ${i + 1}/${config.runs}... `);

            const start = Date.now();
            try {
                // Build request body with tiling options
                const requestBody = {
                    file: base64File,
                    mimeType: mimeType,
                    docType: 'drawdown',
                    modelProvider: config.provider
                };

                // Add tiling options if specified
                if (config.enableTiling !== null) {
                    requestBody.enableTiling = config.enableTiling;
                }
                if (config.parallelTiling) {
                    requestBody.parallelTiling = false;
                }
                if (config.tileHeight) {
                    requestBody.tileHeight = config.tileHeight;
                }
                if (config.tileOverlap) {
                    requestBody.tileOverlap = config.tileOverlap;
                }
                if (config.headerHeight) {
                    requestBody.headerHeight = config.headerHeight;
                }
                if (config.maxConcurrency) {
                    requestBody.maxConcurrency = config.maxConcurrency;
                }
                // Pipeline mode (v2 API)
                if (config.pipelineMode) {
                    requestBody.pipelineMode = config.pipelineMode;
                }

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                const duration = Date.now() - start;
                stats.totalRuntime += duration;
                stats.totalRequests++;

                if (!response.ok) {
                    console.log(`FAIL (HTTP ${response.status}) - ${duration}ms`);
                    const txt = await response.text();
                    console.log(`    Msg: ${txt.substring(0, 200)}`);
                    stats.failed++;
                    continue;
                }

                const result = await response.json();

                // Validation
                const validation = validateDrawdown(result, config.expectedSum);

                // Accumulate IBAN statistics
                stats.ibans.valid += validation.validIbans;
                stats.ibans.invalid += validation.invalidIbans;

                // Reference validation (if enabled)
                let refComparison = null;
                if (config.useReference) {
                    const refPath = findReferenceCSV(filePath);
                    if (refPath) {
                        const refItems = loadReferenceCSV(refPath);
                        const apiItems = result.drawdowns || result.items || [];
                        const comparison = compareWithReference(apiItems, refItems);

                        // Add reference file info
                        refComparison = {
                            ...comparison,
                            refFile: path.basename(refPath)
                        };

                        // Accumulate reference stats
                        stats.reference.filesWithRef++;
                        stats.reference.totalRefRows += comparison.totalRef;
                        stats.reference.totalApiRows += comparison.totalApi;
                        stats.reference.matched += comparison.matched;
                        stats.reference.matchedWithCorrectIban += comparison.matchedWithCorrectIban;
                        stats.reference.matchedWithCorrectAmount += comparison.matchedWithCorrectAmount;
                        stats.reference.perfectMatches += comparison.matchedAllFields;

                        // Log comparison to file
                        const logEntry = formatComparisonLog(file, refPath, comparison);
                        fs.appendFileSync(LOG_FILE, logEntry, 'utf8');

                        // Console output for reference comparison
                        const ibanPct = comparison.matched > 0
                            ? ((comparison.matchedWithCorrectIban / comparison.matched) * 100).toFixed(1)
                            : '0.0';
                        console.log(`    Reference: ${comparison.matched}/${comparison.totalRef} matched, IBAN accuracy: ${ibanPct}%`);
                    }
                }

                // Save result JSON
                const outputFile = saveResultJson(file, i, result, validation, refComparison);

                if (validation.errors.length === 0) {
                    console.log(`OK - ${duration}ms | IBANs: ${validation.validIbans} | Sum: ${validation.totalAmount}`);
                    stats.success++;
                    stats.validations.ok++;
                } else {
                    console.log(`NOK - ${duration}ms`);
                    console.log(`    Errors: ${validation.errors.join(', ')}`);
                    stats.success++; // Request succeeded, but validation failed
                    stats.validations.nok++;
                }
                console.log(`    Output: ${outputFile}`);

            } catch (err) {
                 console.log(`ERROR: ${err.message}`);
                 stats.failed++;
            }
        }
    }

    console.log('\n\n--- Benchmark Results ---');
    console.log(`Total Requests:     ${stats.totalRequests}`);
    console.log(`Successful API:     ${stats.success}`);
    console.log(`Failed API:         ${stats.failed}`);
    console.log(`Avg Runtime:        ${stats.totalRequests ? Math.round(stats.totalRuntime / stats.totalRequests) : 0}ms`);
    console.log(`Validation OK:      ${stats.validations.ok}`);
    console.log(`Validation NOK:     ${stats.validations.nok}`);
    console.log(`Valid IBANs:        ${stats.ibans.valid}`);
    console.log(`Invalid IBANs:      ${stats.ibans.invalid}`);
    console.log(`IBAN Accuracy:      ${stats.ibans.valid + stats.ibans.invalid > 0 ? Math.round(stats.ibans.valid / (stats.ibans.valid + stats.ibans.invalid) * 100) : 0}%`);

    // Reference validation summary
    if (config.useReference && stats.reference.filesWithRef > 0) {
        const ref = stats.reference;
        const matchPct = ref.totalRefRows > 0
            ? ((ref.matched / ref.totalRefRows) * 100).toFixed(1)
            : '0.0';
        const ibanPct = ref.matched > 0
            ? ((ref.matchedWithCorrectIban / ref.matched) * 100).toFixed(1)
            : '0.0';
        const amountPct = ref.matched > 0
            ? ((ref.matchedWithCorrectAmount / ref.matched) * 100).toFixed(1)
            : '0.0';
        const perfectPct = ref.matched > 0
            ? ((ref.perfectMatches / ref.matched) * 100).toFixed(1)
            : '0.0';

        console.log('\n--- Reference Validation ---');
        console.log(`Files with ref:     ${ref.filesWithRef}`);
        console.log(`Reference rows:     ${ref.totalRefRows}`);
        console.log(`API rows:           ${ref.totalApiRows}`);
        console.log(`Matched rows:       ${ref.matched}/${ref.totalRefRows} (${matchPct}%)`);
        console.log(`IBAN accuracy:      ${ref.matchedWithCorrectIban}/${ref.matched} (${ibanPct}%)`);
        console.log(`Amount accuracy:    ${ref.matchedWithCorrectAmount}/${ref.matched} (${amountPct}%)`);
        console.log(`Perfect matches:    ${ref.perfectMatches}/${ref.matched} (${perfectPct}%)`);
    }
}

function printHelp() {
    console.log(`
Document Recognizer Benchmark Tool

Usage: node benchmark/run.js [options]

Options:
  --dir <path>           Directory containing test files (default: benchmark/data)
  --runs <number>        Number of times to process each file (default: 1)
  --provider <name>      AI provider: gemini, openai, azure-openai (default: gemini)
  --expected-sum <num>   Expected total amount sum for validation

Tiling Options:
  --enable-tiling        Force enable tiling (default: auto for drawdown)
  --disable-tiling       Force disable tiling
  --parallel-tiling      Use parallel API calls for each tile (faster, more requests)
  --tile-height <px>     Height of each tile slice (default: 1200)
  --tile-overlap <px>    Overlap between tiles (default: 150)
  --header-height <px>   Height of header region (default: 300)
  --max-concurrency <n>  Max parallel requests (default: 3)

Pipeline Options (v2 API):
  --pipeline-mode <mode> Pipeline mode (auto-enables v2 API):
                         - default: Standard tiling + AI vision
                         - ocr-enhanced: Azure OCR + images sent to AI (best accuracy)
                         - ocr-only: Azure OCR text only, no images (fastest, cheapest)
                         - ocr-verified: OCR + image + IBAN verification loop (best for IBANs)
  --api-version <v1|v2>  API version to use (default: v1, auto-set to v2 with --pipeline-mode)

Reference Validation:
  --reference            Enable validation against *_reference.csv files
                         (e.g., ziadost1.pdf validates against ziadost1_reference.csv)

Examples:
  # Basic benchmark with OpenAI
  node benchmark/run.js --provider openai

  # Benchmark with tiling enabled and parallel processing
  node benchmark/run.js --provider openai --enable-tiling --parallel-tiling

  # Custom tiling parameters
  node benchmark/run.js --provider azure-openai --tile-height 1000 --tile-overlap 200

  # Validate expected sum
  node benchmark/run.js --provider openai --expected-sum 12500.50

  # Pipeline mode: OCR-enhanced (best accuracy)
  node benchmark/run.js --provider openai --pipeline-mode ocr-enhanced

  # Pipeline mode: OCR-only (fastest, cheapest)
  node benchmark/run.js --provider openai --pipeline-mode ocr-only

  # Pipeline mode: OCR-verified (best for IBANs, includes verification loop)
  node benchmark/run.js --provider openai --pipeline-mode ocr-verified

  # Benchmark with reference validation
  node benchmark/run.js --provider openai --pipeline-mode ocr-verified --reference
`);
}

runBenchmark();
