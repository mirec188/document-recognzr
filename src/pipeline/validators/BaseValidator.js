/**
 * Base class for field validators.
 * Validators check extracted data and can attempt repairs via re-verification.
 */
export class BaseValidator {
    constructor(name) {
        this.name = name;
    }

    /**
     * Get the field name this validator checks.
     * @returns {string}
     */
    getFieldName() {
        throw new Error(`${this.name}.getFieldName() not implemented`);
    }

    /**
     * Validate a single item.
     * @param {Object} item - The item to validate
     * @returns {boolean} - True if valid
     */
    validate(item) {
        throw new Error(`${this.name}.validate() not implemented`);
    }

    /**
     * Validate all items and return invalid ones.
     * @param {Array} items - Array of items to validate
     * @returns {Array} - Array of invalid items
     */
    findInvalid(items) {
        if (!Array.isArray(items)) {
            return [];
        }
        return items.filter(item => !this.validate(item));
    }

    /**
     * Attempt to repair invalid items.
     * Default implementation does nothing - override in subclasses.
     *
     * @param {Array} invalidItems - Items that failed validation
     * @param {Object} context - Processing context with tiles, etc.
     * @returns {Promise<Array>} - Array of repaired items
     */
    async repair(invalidItems, context) {
        return [];  // Default: no repair capability
    }

    /**
     * Apply repairs to the result.
     * @param {Object} result - The result object to update
     * @param {Array} repairs - Array of repaired items
     * @param {string} arrayField - The field name containing the array
     */
    applyRepairs(result, repairs, arrayField) {
        if (!result[arrayField] || !Array.isArray(result[arrayField]) || repairs.length === 0) {
            return;
        }

        const keyField = this.getKeyField();
        const repairMap = new Map();

        for (const repair of repairs) {
            const key = this.getItemKey(repair);
            if (key) {
                repairMap.set(key, repair);
            }
        }

        for (const item of result[arrayField]) {
            const key = this.getItemKey(item);
            if (key && repairMap.has(key)) {
                const repair = repairMap.get(key);
                // Update the field this validator checks
                const fieldName = this.getFieldName();
                if (repair[fieldName] !== undefined) {
                    console.log(`[${this.name}] Applying repair: ${item[fieldName]} → ${repair[fieldName]}`);
                    item[fieldName] = repair[fieldName];
                }
            }
        }
    }

    /**
     * Get the key field used for matching items.
     * @returns {string}
     */
    getKeyField() {
        return 'invoiceNumber';  // Default
    }

    /**
     * Get a unique key for an item.
     * @param {Object} item
     * @returns {string|null}
     */
    getItemKey(item) {
        const keyField = this.getKeyField();
        const value = item[keyField];
        return value ? String(value).trim().toLowerCase() : null;
    }
}
