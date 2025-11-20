'use client';

import { useState, useEffect } from 'react';
import styles from '../page.module.css'; // Reuse main styles for consistency

export default function SchemaEditor() {
    const [schemas, setSchemas] = useState(null);
    const [jsonString, setJsonString] = useState('');
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        fetchSchemas();
    }, []);

    const fetchSchemas = async () => {
        try {
            const res = await fetch('/api/schemas');
            const data = await res.json();
            setSchemas(data);
            setJsonString(JSON.stringify(data, null, 2));
        } catch (err) {
            setError('Failed to load schemas');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setError(null);
        setSuccess(null);

        try {
            // Validate JSON
            const parsed = JSON.parse(jsonString);

            const res = await fetch('/api/schemas', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(parsed),
            });

            if (!res.ok) throw new Error('Failed to save');

            setSuccess('Schemas saved successfully!');
            setSchemas(parsed);
        } catch (err) {
            setError(err.message === 'Failed to save' ? 'Failed to save schemas' : 'Invalid JSON format');
        }
    };

    return (
        <main className={styles.main}>
            <div className="container">
                <header className={styles.header}>
                    <h1>Schema Editor</h1>
                    <p className={styles.subtitle}>
                        Customize the JSON structure for your documents.
                    </p>
                    <div style={{ marginTop: '1rem' }}>
                        <a href="/" className="btn" style={{ background: 'rgba(255,255,255,0.1)' }}>← Back to Recognizer</a>
                    </div>
                </header>

                <div className="glass-panel" style={{ padding: '2rem' }}>
                    {isLoading ? (
                        <p>Loading...</p>
                    ) : (
                        <>
                            <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <h2>Edit Schemas (JSON)</h2>
                                <button onClick={handleSave} className="btn btn-primary">
                                    Save Changes
                                </button>
                            </div>

                            {error && (
                                <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid #ef4444', borderRadius: '0.5rem', marginBottom: '1rem', color: '#fca5a5' }}>
                                    {error}
                                </div>
                            )}

                            {success && (
                                <div style={{ padding: '1rem', background: 'rgba(34, 197, 94, 0.2)', border: '1px solid #22c55e', borderRadius: '0.5rem', marginBottom: '1rem', color: '#86efac' }}>
                                    {success}
                                </div>
                            )}

                            <textarea
                                value={jsonString}
                                onChange={(e) => setJsonString(e.target.value)}
                                style={{
                                    width: '100%',
                                    height: '600px',
                                    background: 'rgba(15, 23, 42, 0.8)',
                                    color: '#a5b4fc',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    borderRadius: '0.5rem',
                                    padding: '1rem',
                                    fontFamily: 'monospace',
                                    fontSize: '0.9rem',
                                    resize: 'vertical'
                                }}
                                spellCheck="false"
                            />
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}
