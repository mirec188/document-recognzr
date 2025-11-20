import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const dataFilePath = path.join(process.cwd(), 'src/data/schemas.json');

export async function GET() {
    try {
        const fileContent = await fs.readFile(dataFilePath, 'utf8');
        const schemas = JSON.parse(fileContent);
        return NextResponse.json(schemas);
    } catch (error) {
        console.error('Error reading schemas:', error);
        return NextResponse.json({ error: 'Failed to load schemas' }, { status: 500 });
    }
}

export async function POST(req) {
    try {
        const newSchemas = await req.json();

        // Basic validation: ensure it's an object and has keys
        if (!newSchemas || typeof newSchemas !== 'object') {
            return NextResponse.json({ error: 'Invalid schema data' }, { status: 400 });
        }

        await fs.writeFile(dataFilePath, JSON.stringify(newSchemas, null, 2), 'utf8');
        return NextResponse.json({ success: true, schemas: newSchemas });
    } catch (error) {
        console.error('Error saving schemas:', error);
        return NextResponse.json({ error: 'Failed to save schemas' }, { status: 500 });
    }
}
