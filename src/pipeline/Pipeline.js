/**
 * Pipeline orchestrator for document processing.
 * Executes stages sequentially, passing context between them.
 */
export class Pipeline {
    constructor(name = 'DocumentPipeline') {
        this.name = name;
        this.stages = [];
    }

    /**
     * Add a stage to the pipeline.
     * @param {Stage} stage - Stage instance to add
     * @returns {Pipeline} - Returns this for chaining
     */
    add(stage) {
        this.stages.push(stage);
        return this;
    }

    /**
     * Execute all stages in sequence.
     * @param {ProcessingContext} context - The processing context
     * @returns {Promise<ProcessingContext>} - The final context after all stages
     */
    async execute(context) {
        console.log(`[Pipeline:${this.name}] Starting with ${this.stages.length} stages`);
        const startTime = Date.now();

        for (const stage of this.stages) {
            // Check if stage should run
            if (stage.shouldRun && !(await stage.shouldRun(context))) {
                console.log(`[Pipeline:${this.name}] Skipping ${stage.name} (shouldRun=false)`);
                continue;
            }

            // Check if we already have an error
            if (context.error) {
                console.log(`[Pipeline:${this.name}] Stopping at ${stage.name} due to error: ${context.error}`);
                break;
            }

            try {
                const stageStart = Date.now();
                console.log(`[Pipeline:${this.name}] Running ${stage.name}...`);

                context = await stage.process(context);

                const stageDuration = Date.now() - stageStart;
                console.log(`[Pipeline:${this.name}] ${stage.name} completed in ${stageDuration}ms`);
            } catch (err) {
                console.error(`[Pipeline:${this.name}] ${stage.name} threw error:`, err.message);
                context.error = err.message;
                context.errors.push({
                    stage: stage.name,
                    message: err.message,
                    stack: err.stack
                });
                break;
            }
        }

        const totalDuration = Date.now() - startTime;
        console.log(`[Pipeline:${this.name}] Completed in ${totalDuration}ms (error: ${!!context.error})`);

        return context;
    }

    /**
     * Get stage names for debugging.
     * @returns {string[]}
     */
    getStageNames() {
        return this.stages.map(s => s.name);
    }
}
