import fs from 'fs/promises';
import path from 'path';

const dataFilePath = path.join(process.cwd(), 'src/data/schemas.json');

export async function getSchemas() {
    const fileContent = await fs.readFile(dataFilePath, 'utf8');
    return JSON.parse(fileContent);
}

export async function getSchema(docType) {
    const schemas = await getSchemas();
    return schemas[docType];
}

export function enforceStrictSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;

    const newSchema = { ...schema };

    if (newSchema.type === 'object') {
        newSchema.additionalProperties = false;
        newSchema.required = Object.keys(newSchema.properties || {});

        // Recursively enforce for properties
        if (newSchema.properties) {
            for (const key in newSchema.properties) {
                newSchema.properties[key] = enforceStrictSchema(newSchema.properties[key]);
            }
        }
    } else if (newSchema.type === 'array') {
        if (newSchema.items) {
            newSchema.items = enforceStrictSchema(newSchema.items);
        }
    }

    return newSchema;
}
