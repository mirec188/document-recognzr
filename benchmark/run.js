const fs = require('fs');
const path = require('path');
const { validateDrawdown } = require('./validators');

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000/api/recognize';

async function runBenchmark() {
    const args = process.argv.slice(2);
    const config = {
        dir: 'benchmark/data',
        runs: 1,
        provider: 'gemini',
        expectedSum: null
    };

    // Simple argument parsing
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--dir') config.dir = args[++i];
        else if (args[i] === '--runs') config.runs = parseInt(args[++i]);
        else if (args[i] === '--provider') config.provider = args[++i];
        else if (args[i] === '--expected-sum') config.expectedSum = parseFloat(args[++i]);
    }

    console.log('--- Benchmark Configuration ---');
    console.log(config);
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
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        file: base64File,
                        mimeType: mimeType,
                        docType: 'drawdown',
                        modelProvider: config.provider
                    })
                });

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
}

runBenchmark();
