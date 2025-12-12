/**
 * Base class for pipeline stages.
 * Each stage processes the context and returns it (potentially modified).
 */
export class Stage {
    constructor(name = 'BaseStage') {
        this.name = name;
    }

    /**
     * Process the context. Must be implemented by subclasses.
     * @param {ProcessingContext} context - The processing context
     * @returns {Promise<ProcessingContext>} - The modified context
     */
    async process(context) {
        throw new Error(`${this.name}.process() not implemented`);
    }

    /**
     * Determine if this stage should run.
     * Override in subclasses for conditional execution.
     * @param {ProcessingContext} context - The processing context
     * @returns {Promise<boolean>} - True if stage should run
     */
    async shouldRun(context) {
        return true;
    }
}
