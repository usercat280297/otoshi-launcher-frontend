/**
 * DownloadPreAllocationModal.jsx
 * 
 * Pre-allocation storage check & download confirmation popup
 * - Check file size từ HuggingFace
 * - Check disk space available
 * - Pre-allocate storage (create empty file)
 * - Confirm trước khi download
 */

import React, { useState, useEffect } from 'react';
import './DownloadPreAllocationModal.css';

const DownloadPreAllocationModal = ({ 
  gameInfo, 
  selectedVersion, 
  installPath,
  onConfirm, 
  onCancel,
  apiUrl = 'http://localhost:5000/api'
}) => {
  const [fileSize, setFileSize] = useState(null);
  const [availableSpace, setAvailableSpace] = useState(null);
  const [preAllocationStatus, setPreAllocationStatus] = useState('idle'); // idle, checking, allocating, success, error
  const [errorMessage, setErrorMessage] = useState(null);
  const [allocationPath, setAllocationPath] = useState(null);

  // Format bytes to GB/MB
  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const gb = bytes / (1024 * 1024 * 1024);
    const mb = bytes / (1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    return `${bytes} B`;
  };

  // Fetch file size từ HuggingFace
  const checkFileSize = async () => {
    try {
      setPreAllocationStatus('checking');
      setErrorMessage(null);

      // Call backend to get HuggingFace file size
      const response = await fetch(
        `${apiUrl}/hf-file-size/${gameInfo.id}/${selectedVersion.version}`
      );

      if (!response.ok) {
        throw new Error('Failed to get file size from HuggingFace');
      }

      const data = await response.json();
      
      if (data.status === 'success') {
        setFileSize(data.file_size);
        // Also get available disk space
        await checkDiskSpace(data.file_size);
      } else {
        throw new Error(data.message || 'Failed to retrieve file size');
      }
    } catch (err) {
      setPreAllocationStatus('error');
      setErrorMessage(`❌ Error checking file size: ${err.message}`);
    }
  };

  // Check available disk space
  const checkDiskSpace = async (requiredSize) => {
    try {
      // Call backend to check disk space
      const response = await fetch(
        `${apiUrl}/disk-space?path=${encodeURIComponent(installPath)}`
      );

      if (!response.ok) {
        throw new Error('Failed to check disk space');
      }

      const data = await response.json();
      
      if (data.status === 'success') {
        setAvailableSpace(data.available_space);
        
        // Check if enough space
        if (data.available_space < requiredSize) {
          setPreAllocationStatus('error');
          const shortage = requiredSize - data.available_space;
          setErrorMessage(
            `❌ Not enough disk space!\n` +
            `Need: ${formatBytes(requiredSize)}\n` +
            `Available: ${formatBytes(data.available_space)}\n` +
            `Shortage: ${formatBytes(shortage)}`
          );
        } else {
          // Proceed to pre-allocation
          await preAllocateStorage(requiredSize);
        }
      } else {
        throw new Error(data.message || 'Failed to check disk space');
      }
    } catch (err) {
      setPreAllocationStatus('error');
      setErrorMessage(`❌ Error checking disk space: ${err.message}`);
    }
  };

  // Pre-allocate storage (create empty file)
  const preAllocateStorage = async (requiredSize) => {
    try {
      setPreAllocationStatus('allocating');

      // Call backend to pre-allocate file
      const response = await fetch(
        `${apiUrl}/pre-allocate-storage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: installPath,
            size: requiredSize,
            game_id: gameInfo.id,
            version: selectedVersion.version
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to pre-allocate storage');
      }

      const data = await response.json();
      
      if (data.status === 'success') {
        setPreAllocationStatus('success');
        setAllocationPath(data.file_path);
      } else {
        throw new Error(data.message || 'Pre-allocation failed');
      }
    } catch (err) {
      setPreAllocationStatus('error');
      setErrorMessage(`❌ Error pre-allocating storage: ${err.message}`);
    }
  };

  // Initialize check
  useEffect(() => {
    checkFileSize();
  }, [gameInfo, selectedVersion, installPath]);

  const handleConfirm = () => {
    if (preAllocationStatus === 'success') {
      onConfirm({
        file_size: fileSize,
        allocated_path: allocationPath,
        available_space: availableSpace
      });
    }
  };

  const handleRetry = () => {
    checkFileSize();
  };

  return (
    <div className="download-modal-overlay">
      <div className="download-modal">
        {/* Header */}
        <div className="modal-header">
          <h2>📥 Download Pre-Check</h2>
          <button className="close-btn" onClick={onCancel}>✕</button>
        </div>

        {/* Content */}
        <div className="modal-content">
          {/* Game Info */}
          <div className="game-info-section">
            <h3>{gameInfo.name}</h3>
            <p className="version-info">{selectedVersion.version}</p>
          </div>

          {/* Status Display */}
          <div className="status-section">
            {preAllocationStatus === 'checking' && (
              <div className="status-checking">
                <div className="spinner"></div>
                <p>🔍 Checking file size from HuggingFace...</p>
              </div>
            )}

            {preAllocationStatus === 'allocating' && (
              <div className="status-allocating">
                <div className="spinner"></div>
                <p>💾 Pre-allocating storage space...</p>
              </div>
            )}

            {preAllocationStatus === 'success' && (
              <div className="status-success">
                <p className="success-msg">✅ Pre-allocation successful!</p>
                <div className="check-items">
                  <div className="check-item">
                    <span className="check-icon">✓</span>
                    <span className="check-text">
                      File size: <strong>{formatBytes(fileSize)}</strong>
                    </span>
                  </div>
                  <div className="check-item">
                    <span className="check-icon">✓</span>
                    <span className="check-text">
                      Available space: <strong>{formatBytes(availableSpace)}</strong>
                    </span>
                  </div>
                  <div className="check-item">
                    <span className="check-icon">✓</span>
                    <span className="check-text">
                      Storage pre-allocated: <strong>{formatBytes(fileSize)}</strong>
                    </span>
                  </div>
                </div>
                <div className="allocation-details">
                  <p className="allocation-path">
                    📁 Location: <code>{allocationPath}</code>
                  </p>
                </div>
              </div>
            )}

            {preAllocationStatus === 'error' && (
              <div className="status-error">
                <p className="error-msg">{errorMessage}</p>
                <div className="error-suggestions">
                  <h4>💡 Suggestions:</h4>
                  <ul>
                    <li>Free up disk space and try again</li>
                    <li>Change installation path to another drive</li>
                    <li>Check if the path is accessible</li>
                  </ul>
                </div>
              </div>
            )}

            {preAllocationStatus === 'idle' && (
              <div className="status-idle">
                <p>⏳ Preparing download...</p>
              </div>
            )}
          </div>

          {/* Installation Path */}
          <div className="install-path-section">
            <label>Installation Path:</label>
            <code className="path-display">{installPath}</code>
          </div>

          {/* Benefits */}
          <div className="benefits-section">
            <h4>✨ Pre-allocation Benefits:</h4>
            <div className="benefit-list">
              <div className="benefit-item">
                <span className="benefit-icon">⚡</span>
                <span className="benefit-text"><strong>10-20% faster</strong> read/write</span>
              </div>
              <div className="benefit-item">
                <span className="benefit-icon">🔒</span>
                <span className="benefit-text">Prevents file <strong>fragmentation</strong></span>
              </div>
              <div className="benefit-item">
                <span className="benefit-icon">🛑</span>
                <span className="benefit-text">Fails <strong>early</strong> if space insufficient</span>
              </div>
              <div className="benefit-item">
                <span className="benefit-icon">⏸️</span>
                <span className="benefit-text">Easy <strong>resume</strong> on pause</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer - Buttons */}
        <div className="modal-footer">
          <button 
            className="btn btn-cancel" 
            onClick={onCancel}
            disabled={preAllocationStatus === 'allocating' || preAllocationStatus === 'checking'}
          >
            Cancel
          </button>

          {preAllocationStatus === 'error' && (
            <button 
              className="btn btn-retry" 
              onClick={handleRetry}
            >
              🔄 Retry
            </button>
          )}

          {preAllocationStatus === 'success' && (
            <button 
              className="btn btn-confirm" 
              onClick={handleConfirm}
            >
              ✓ Start Download
            </button>
          )}

          {(preAllocationStatus === 'checking' || preAllocationStatus === 'allocating' || preAllocationStatus === 'idle') && (
            <button 
              className="btn btn-confirm disabled" 
              disabled
            >
              ⏳ Checking...
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DownloadPreAllocationModal;
