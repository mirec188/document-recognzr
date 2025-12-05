const fs = require('fs');
const path = require('path');
const { validateDrawdown } = require('./validators');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000/api/recognize';
const DEFAULT_TIMEOUT = 800000; // 5 minutes - needed for parallel tiling with many tiles

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
        maxConcurrency: null
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
        else if (args[i] === '--help' || args[i] === '-h') {
            printHelp();
            process.exit(0);
        }
    }

    console.log('--- Benchmark Configuration ---');
    console.log(`Directory:       ${config.dir}`);
    console.log(`Runs per file:   ${config.runs}`);
    console.log(`Provider:        ${config.provider}`);
    console.log(`Expected sum:    ${config.expectedSum || 'not set'}`);
    console.log(`Tiling:          ${config.enableTiling === null ? 'auto' : config.enableTiling ? 'enabled' : 'disabled'}`);
    console.log(`Parallel tiling: ${config.parallelTiling}`);
    if (config.tileHeight) console.log(`Tile height:     ${config.tileHeight}px`);
    if (config.tileOverlap) console.log(`Tile overlap:    ${config.tileOverlap}px`);
    if (config.headerHeight) console.log(`Header height:   ${config.headerHeight}px`);
    if (config.maxConcurrency) console.log(`Max concurrency: ${config.maxConcurrency}`);
    console.log('-------------------------------');

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
        tilesProcessed: 0
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
                    requestBody.parallelTiling = true;
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

Examples:
  # Basic benchmark with OpenAI
  node benchmark/run.js --provider openai

  # Benchmark with tiling enabled and parallel processing
  node benchmark/run.js --provider openai --enable-tiling --parallel-tiling

  # Custom tiling parameters
  node benchmark/run.js --provider azure-openai --tile-height 1000 --tile-overlap 200

  # Validate expected sum
  node benchmark/run.js --provider openai --expected-sum 12500.50
`);
}

runBenchmark();
