'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';

export default function Home() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [docType, setDocType] = useState('invoice');
  const [modelProvider, setModelProvider] = useState('gemini'); // 'gemini' or 'openai' or 'azure-openai'
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  // Advanced Configuration State
  const [allSchemas, setAllSchemas] = useState({});
  const [customSchema, setCustomSchema] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [enforceSchema, setEnforceSchema] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Load schemas on mount
  useEffect(() => {
    fetch('/api/schemas')
      .then((res) => res.json())
      .then((data) => {
        setAllSchemas(data);
        if (data[docType]) {
          setCustomSchema(JSON.stringify(data[docType], null, 2));
        }
      })
      .catch((err) => console.error('Failed to load schemas', err));
  }, []);

  // Update schema editor when docType changes
  useEffect(() => {
    if (allSchemas[docType]) {
      setCustomSchema(JSON.stringify(allSchemas[docType], null, 2));
    }
    
    // Set default custom prompt with placeholder
    const defaultText = `You are an expert document parser. Please extract information from this ${docType} and return it in JSON format.

Strictly follow this JSON schema:
{{schema}}

Return ONLY the JSON object.`;
    setCustomPrompt(defaultText);
    
  }, [docType, allSchemas]);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = (file) => {
    setFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setResult(null);
  };

  const handleSubmit = async () => {
    if (!file) return;

    setIsProcessing(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('docType', docType);
    formData.append('modelProvider', modelProvider);
    
    // Advanced params
    formData.append('enforceJsonSchema', enforceSchema.toString());
    if (customPrompt.trim()) formData.append('customPrompt', customPrompt);
    if (customSchema.trim()) formData.append('customSchema', customSchema);

    try {
      const response = await fetch('/api/recognize', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Error:', error);
      alert('Failed to process document');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <main className={styles.main}>
      <div className="container">
        <header className={styles.header}>
          <h1>Document Recognizer</h1>
          <p className={styles.subtitle}>
            Intelligent parsing for your financial documents using multimodal AI.
          </p>
        </header>

        <div className={styles.grid}>
          {/* Left Column: Upload & Controls */}
          <div className={styles.controls}>
            <div className="glass-panel" style={{ padding: '2rem' }}>
              <h2>1. Select Document Type</h2>
              <div className={styles.typeGrid}>
                {['invoice', 'bankStatement', 'loanContract', 'drawdown'].map((type) => (
                  <button
                    key={type}
                    className={`${styles.typeBtn} ${docType === type ? styles.active : ''}`}
                    onClick={() => setDocType(type)}
                  >
                    {type.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase())}
                  </button>
                ))}
              </div>

              <h2 style={{ marginTop: '2rem' }}>2. Select AI Model</h2>
              <div className={styles.typeGrid}>
                <button
                  className={`${styles.typeBtn} ${modelProvider === 'gemini' ? styles.active : ''}`}
                  onClick={() => setModelProvider('gemini')}
                >
                  Gemini 2.5 Flash
                </button>
                <button
                  className={`${styles.typeBtn} ${modelProvider === 'openai' ? styles.active : ''}`}
                  onClick={() => setModelProvider('openai')}
                >
                  OpenAI GPT-5
                </button>
                <button
                  className={`${styles.typeBtn} ${modelProvider === 'azure-openai' ? styles.active : ''}`}
                  onClick={() => setModelProvider('azure-openai')}
                >
                  Azure OpenAI
                </button>
              </div>

              {/* Advanced Settings Toggle */}
              <div style={{ marginTop: '2rem' }}>
                <button 
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    style={{ background: 'none', border: 'none', color: '#38bdf8', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                    {showAdvanced ? '▼' : '▶'} Advanced Configuration
                </button>
              </div>

              {showAdvanced && (
                  <div style={{ marginTop: '1rem', paddingLeft: '1rem', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                      
                      <div style={{ marginBottom: '1rem' }}>
                          <label style={{ display: 'block', color: '#94a3b8', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                              Strict Schema Enforcement
                          </label>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: modelProvider === 'gemini' ? '#64748b' : '#f8fafc', cursor: modelProvider === 'gemini' ? 'not-allowed' : 'pointer' }}>
                                  <input 
                                      type="checkbox" 
                                      checked={enforceSchema} 
                                      onChange={(e) => setEnforceSchema(e.target.checked)}
                                      disabled={modelProvider === 'gemini'}
                                      style={{ accentColor: '#38bdf8', width: '1.2rem', height: '1.2rem' }}
                                  />
                                  <span>Enforce Strict JSON Schema Output</span>
                              </label>
                              {modelProvider === 'gemini' && <span style={{fontSize: '0.8rem', color: '#eab308'}}>(Not supported on Gemini)</span>}
                          </div>
                          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                              Uncheck to allow the model more freedom (useful for complex reasoning before JSON generation).
                          </p>
                      </div>

                      <div style={{ marginBottom: '1rem' }}>
                          <label style={{ display: 'block', color: '#94a3b8', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                              Custom System Prompt
                          </label>
                          <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.5rem' }}>
                            Use <code>{`{{schema}}`}</code> as a placeholder for the JSON schema.
                          </p>
                          <textarea
                              value={customPrompt}
                              onChange={(e) => setCustomPrompt(e.target.value)}
                              placeholder="Override the default system prompt..."
                              style={{ 
                                  width: '100%', 
                                  height: '150px', 
                                  background: 'rgba(0,0,0,0.3)', 
                                  border: '1px solid rgba(255,255,255,0.1)', 
                                  borderRadius: '0.5rem', 
                                  padding: '0.75rem', 
                                  color: '#e2e8f0',
                                  fontFamily: 'inherit',
                                  resize: 'vertical',
                                  whiteSpace: 'pre-wrap'
                              }}
                          />
                      </div>

                      <div style={{ marginBottom: '1rem' }}>
                          <label style={{ display: 'block', color: '#94a3b8', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                              JSON Schema
                          </label>
                          <textarea
                              value={customSchema}
                              onChange={(e) => setCustomSchema(e.target.value)}
                              style={{ 
                                  width: '100%', 
                                  height: '200px', 
                                  background: 'rgba(0,0,0,0.3)', 
                                  border: '1px solid rgba(255,255,255,0.1)', 
                                  borderRadius: '0.5rem', 
                                  padding: '0.75rem', 
                                  color: '#a5b4fc',
                                  fontFamily: 'Fira Code, monospace',
                                  fontSize: '0.85rem',
                                  resize: 'vertical'
                              }}
                          />
                      </div>
                  </div>
              )}

              <h2 style={{ marginTop: '2rem' }}>3. Upload Document</h2>
              <div
                className={`${styles.dropzone} ${dragActive ? styles.dragActive : ''}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  id="file-upload"
                  className={styles.fileInput}
                  onChange={handleChange}
                  accept="image/*,.pdf"
                />
                <label htmlFor="file-upload" className={styles.fileLabel}>
                  {file ? (
                    <div className={styles.fileInfo}>
                      <span className={styles.fileName}>{file.name}</span>
                      <span className={styles.changeFile}>Click or drag to replace</span>
                    </div>
                  ) : (
                    <>
                      <span className={styles.uploadIcon}>📁</span>
                      <span>Drag & drop or click to upload</span>
                      <span className={styles.fileTypes}>PDF, JPEG, PNG supported</span>
                    </>
                  )}
                </label>
              </div>

              <button
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '2rem' }}
                onClick={handleSubmit}
                disabled={!file || isProcessing}
              >
                {isProcessing ? 'Processing...' : 'Analyze Document'}
              </button>
            </div>
          </div>

          {/* Right Column: Preview & Results */}
          <div className={styles.results}>
            {previewUrl && (
              <div className="glass-panel" style={{ padding: '1rem', marginBottom: '1rem' }}>
                <h3 className={styles.panelTitle}>Document Preview</h3>
                <div className={styles.previewContainer}>
                  {file.type === 'application/pdf' ? (
                    <iframe src={previewUrl} className={styles.previewFrame} />
                  ) : (
                    <img src={previewUrl} alt="Preview" className={styles.previewImage} />
                  )}
                </div>
              </div>
            )}

            {result && (
              <div className="glass-panel" style={{ padding: '1rem', animation: 'fadeIn 0.5s ease' }}>
                <h3 className={styles.panelTitle}>Analysis Result</h3>
                <pre className={styles.jsonResult}>
                  {JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
