import { BaseValidator } from './BaseValidator.js';
import { IBANValidator } from './IBANValidator.js';

export { BaseValidator, IBANValidator };

/**
 * Validator registry - maps validator names to classes.
 */
const validatorRegistry = {
    'iban': IBANValidator
};

/**
 * Get validator instances for a document type.
 * @param {string[]} validatorNames - Array of validator names
 * @returns {BaseValidator[]}
 */
export function getValidators(validatorNames) {
    if (!validatorNames || !Array.isArray(validatorNames)) {
        return [];
    }

    return validatorNames
        .filter(name => validatorRegistry[name])
        .map(name => new validatorRegistry[name]());
}

/**
 * Register a custom validator.
 * @param {string} name - Validator name
 * @param {typeof BaseValidator} ValidatorClass - Validator class
 */
export function registerValidator(name, ValidatorClass) {
    validatorRegistry[name] = ValidatorClass;
}
