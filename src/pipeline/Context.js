/**
 * Processing context that flows through the pipeline.
 * Contains all state needed for document recognition.
 */
export class ProcessingContext {
    /**
     * @param {Object} request - Initial request data
     * @param {Buffer} request.file - File buffer
     * @param {string} request.mimeType - MIME type of the file
     * @param {string} request.docType - Document type (invoice, drawdown, etc.)
     * @param {Object} request.schema - JSON schema for extraction
     * @param {Object} request.options - Processing options
     */
    constructor(request) {
        // Immutable request data
        this.file = request.file;
        this.mimeType = request.mimeType;
        this.docType = request.docType;
        this.schema = request.schema;
        this.options = request.options || {};

        // Mutable processing state
        this.images = [];           // After preprocessing: array of JPEG buffers
        this.tiles = [];            // After tiling: array of tile objects with images
        this.extractions = [];      // Raw results from provider calls
        this.result = null;         // Final merged/aggregated result

        // Internal tracking metadata (cleaned up before return)
        this.metadata = {
            startTime: Date.now(),
            stagesCompleted: [],
            tilesProcessed: 0,
            reVerificationAttempted: false
        };

        // Error tracking
        this.error = null;          // First critical error (stops pipeline)
        this.errors = [];           // All errors (including non-critical)
        this.warnings = [];         // Non-critical warnings
    }

    /**
     * Check if file is a PDF.
     * @returns {boolean}
     */
    isPDF() {
        return this.mimeType === 'application/pdf';
    }

    /**
     * Check if tiling is enabled.
     * @returns {boolean}
     */
    isTilingEnabled() {
        return this.options.enableTiling !== false &&
            (this.options.enableTiling === true || this.docType === 'drawdown');
    }

    /**
     * Get provider name.
     * @returns {string}
     */
    getProvider() {
        return this.options.modelProvider || 'gemini';
    }

    /**
     * Check if using OpenAI-compatible provider.
     * @returns {boolean}
     */
    isOpenAIProvider() {
        const provider = this.getProvider();
        return provider === 'openai' || provider === 'azure-openai';
    }

    /**
     * Mark a stage as completed.
     * @param {string} stageName
     */
    completeStage(stageName) {
        this.metadata.stagesCompleted.push({
            name: stageName,
            completedAt: Date.now()
        });
    }

    /**
     * Add a warning (non-critical issue).
     * @param {string} stage - Stage name
     * @param {string} message - Warning message
     */
    addWarning(stage, message) {
        this.warnings.push({ stage, message, timestamp: Date.now() });
        console.warn(`[${stage}] Warning: ${message}`);
    }

    /**
     * Get processing duration in milliseconds.
     * @returns {number}
     */
    getDuration() {
        return Date.now() - this.metadata.startTime;
    }

    /**
     * Create a summary of the processing.
     * @returns {Object}
     */
    getSummary() {
        return {
            docType: this.docType,
            provider: this.getProvider(),
            duration: this.getDuration(),
            stagesCompleted: this.metadata.stagesCompleted.map(s => s.name),
            tilesProcessed: this.metadata.tilesProcessed,
            hasError: !!this.error,
            warningCount: this.warnings.length
        };
    }
}
