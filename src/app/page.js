'use client';

import { useState } from 'react';
import styles from './page.module.css';

export default function Home() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [docType, setDocType] = useState('invoice');
  const [modelProvider, setModelProvider] = useState('gemini'); // 'gemini' or 'openai'
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState(null);
  const [dragActive, setDragActive] = useState(false);

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
          <div style={{ marginTop: '1rem' }}>
            <a href="/schemas" className="btn" style={{ background: 'rgba(255,255,255,0.1)', fontSize: '0.9rem' }}>⚙️ Edit Schemas</a>
          </div>
        </header>

        <div className={styles.grid}>
          {/* Left Column: Upload & Controls */}
          <div className={styles.controls}>
            <div className="glass-panel" style={{ padding: '2rem' }}>
              <h2>1. Select Document Type</h2>
              <div className={styles.typeGrid}>
                {['invoice', 'bankStatement', 'loanContract'].map((type) => (
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
              </div>

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
