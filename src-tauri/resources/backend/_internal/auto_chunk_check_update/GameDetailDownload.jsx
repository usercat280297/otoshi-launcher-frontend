/**
 * GameDetailDownload.jsx
 * 
 * React Component - Game Detail với download từ HuggingFace
 * Hiển thị danh sách versions và download button
 * 
 * Usage:
 *   <GameDetailDownload gameId="dirt5" />
 */

import React, { useState, useEffect } from 'react';
import './GameDetailDownload.css';
import DownloadPreAllocationModal from './DownloadPreAllocationModal';

const GameDetailDownload = ({ gameId, apiUrl = 'http://localhost:5000/api' }) => {
  const [gameInfo, setGameInfo] = useState(null);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [installPath, setInstallPath] = useState('E:\\Otoshi Library Game');
  const [showPreAllocationModal, setShowPreAllocationModal] = useState(false);

  // Load game info
  useEffect(() => {
    const loadGameInfo = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${apiUrl}/games/${gameId}`);
        const data = await response.json();
        
        if (data.status === 'success') {
          setGameInfo(data.game);
          // Select latest version by default
          if (data.game.versions.length > 0) {
            setSelectedVersion(data.game.versions[0]);
          }
        } else {
          setError('Game not found');
        }
      } catch (err) {
        setError(`Failed to load game: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    if (gameId) {
      loadGameInfo();
    }
  }, [gameId, apiUrl]);

  const handleDownload = async () => {
    if (!selectedVersion) {
      setError('Please select a version');
      return;
    }

    // Show pre-allocation modal instead of directly downloading
    setShowPreAllocationModal(true);
  };

  // Handle confirmed pre-allocation
  const handlePreAllocationConfirmed = async (allocationData) => {
    setShowPreAllocationModal(false);
    
    try {
      setDownloading(true);
      setDownloadProgress(0);
      setError(null);

      // Step 1: Get download strategy (chunks vs link)
      const strategyResponse = await fetch(
        `${apiUrl}/download-strategy/${gameId}/${selectedVersion.version}`
      );

      if (!strategyResponse.ok) {
        throw new Error('Failed to get download strategy');
      }

      const strategyData = await strategyResponse.json();

      if (strategyData.status !== 'success') {
        throw new Error(strategyData.message || 'Strategy error');
      }

      // Step 2: Handle based on strategy
      if (strategyData.strategy === 'chunks') {
        // New chunk-based download
        console.log('📦 Using chunk download strategy');
        const downloadUrl = strategyData.download_url;
        window.open(downloadUrl, '_blank');
      } else if (strategyData.strategy === 'link') {
        // Legacy link-based download
        console.log('🔗 Using link-based download strategy');
        const downloadUrl = strategyData.download_url;
        window.open(downloadUrl, '_blank');
      } else {
        throw new Error('Unknown download strategy: ' + strategyData.strategy);
      }

      setDownloadProgress(100);
      setDownloading(false);

      // Reset after 3 seconds
      setTimeout(() => {
        setDownloadProgress(0);
      }, 3000);
    } catch (err) {
      setError(`Download failed: ${err.message}`);
      setDownloading(false);
    }
  };

  const handleCancelPreAllocation = () => {
    setShowPreAllocationModal(false);
  };

  const handleDownloadOld = async () => {
    if (!selectedVersion) {
      setError('Please select a version');
      return;
    }

    try {
      setDownloading(true);
      setDownloadProgress(0);
      setError(null);

      // Step 1: Get download strategy (chunks vs link)
      const strategyResponse = await fetch(
        `${apiUrl}/download-strategy/${gameId}/${selectedVersion.version}`
      );

      if (!strategyResponse.ok) {
        throw new Error('Failed to get download strategy');
      }

      const strategyData = await strategyResponse.json();

      if (strategyData.status !== 'success') {
        throw new Error(strategyData.message || 'Strategy error');
      }

      // Step 2: Handle based on strategy
      if (strategyData.strategy === 'chunks') {
        // New chunk-based download
        console.log('📦 Using chunk download strategy');
        const downloadUrl = strategyData.download_url;
        window.open(downloadUrl, '_blank');
      } else if (strategyData.strategy === 'link') {
        // Legacy link-based download
        console.log('🔗 Using link-based download strategy');
        const downloadUrl = strategyData.download_url;
        window.open(downloadUrl, '_blank');
      } else {
        throw new Error('Unknown download strategy: ' + strategyData.strategy);
      }

      setDownloadProgress(100);
      setDownloading(false);

      // Reset after 3 seconds
      setTimeout(() => {
        setDownloadProgress(0);
      }, 3000);
    } catch (err) {
      setError(`Download failed: ${err.message}`);
      setDownloading(false);
    }
  };

  const handleBrowse = () => {
    alert('File picker would open here');
  };

  const handleOnlineFix = () => {
    window.open('https://example.com/online-fix-guide', '_blank');
  };

  const handleBypassGuide = () => {
    window.open('https://example.com/bypass-guide', '_blank');
  };

  if (loading) {
    return (
      <div className="game-detail-download">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="game-detail-download">
        <div className="error">{error}</div>
      </div>
    );
  }

  if (!gameInfo) {
    return null;
  }

  return (
    <div className="game-detail-download">
      {/* Pre-allocation Modal */}
      {showPreAllocationModal && (
        <DownloadPreAllocationModal
          gameInfo={gameInfo}
          selectedVersion={selectedVersion}
          installPath={installPath}
          onConfirm={handlePreAllocationConfirmed}
          onCancel={handleCancelPreAllocation}
          apiUrl={apiUrl}
        />
      )}

      <div className="download-card">
        {/* Header with icon */}
        <div className="download-header">
          <div className="game-icon">
            <img src={`/images/games/${gameId}.jpg`} alt={gameInfo.name} />
          </div>
          <div className="game-title">
            <h1>{gameInfo.name}</h1>
            {selectedVersion && (
              <p className="version-label">
                💾 {(selectedVersion.size / (1024 * 1024)).toFixed(1)} GB • {selectedVersion.version} (Latest)
              </p>
            )}
          </div>
        </div>

        {/* Denuvo Warning */}
        {gameInfo.denuvo && (
          <div className="denuvo-warning">
            <span className="warning-icon">⚠️</span>
            <div>
              <strong>Denuvo Protected</strong>
              <p>This game is protected by Denuvo DRM. It may have performance issues or may not work correctly without a proper crack/bypass.</p>
            </div>
          </div>
        )}

        {/* Download Info */}
        {selectedVersion && (
          <div className="download-info">
            <div className="info-item">
              <span className="info-label">Download</span>
              <span className="info-value">{(selectedVersion.size / (1024 * 1024)).toFixed(1)} GB</span>
            </div>
            <div className="info-item">
              <span className="info-label">Installed</span>
              <span className="info-value">{(selectedVersion.size / (1024 * 1024)).toFixed(1)} GB</span>
            </div>
            <div className="info-item">
              <span className="info-label">Parts</span>
              <span className="info-value">{selectedVersion.chunks || 1}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Type</span>
              <span className="info-value">{selectedVersion.format || '.zip'}</span>
            </div>
          </div>
        )}

        {/* Install Location */}
        <div className="install-location">
          <label>INSTALL LOCATION</label>
          <div className="location-input">
            <input 
              type="text" 
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
            />
            <button className="browse-btn" onClick={handleBrowse}>
              📁 Browse
            </button>
          </div>
        </div>

        {/* Online Fix & Bypass */}
        <div className="options">
          <div className="option online-fix">
            <button onClick={handleOnlineFix} className="option-btn">
              <span className="option-icon">🌐</span>
              <div className="option-text">
                <strong>Online Fix</strong>
                <p>Not Available</p>
              </div>
            </button>
          </div>
          <div className="option bypass-guide">
            <button onClick={handleBypassGuide} className="option-btn">
              <span className="option-icon">🔧</span>
              <div className="option-text">
                <strong>Bypass Guide</strong>
                <p>Check guide</p>
              </div>
            </button>
          </div>
        </div>

        {/* Download Method Selection */}
        <div className="download-method">
          <button className="method direct-download active">
            <span className="method-icon">⚡</span>
            <div className="method-text">
              <strong>Direct Download</strong>
              <p>High Speed</p>
            </div>
          </button>
          <button className="method torrent-download">
            <span className="method-icon">🧲</span>
            <div className="method-text">
              <strong>Torrent</strong>
              <p>P2P Download</p>
            </div>
          </button>
        </div>

        {/* Version Selection Dropdown */}
        <div className="version-selection">
          <label>SELECT VERSION</label>
          <div className="version-dropdown">
            {gameInfo.versions && gameInfo.versions.length > 0 ? (
              <div className="versions-list">
                {gameInfo.versions.map((version, index) => (
                  <div
                    key={index}
                    className={`version-item ${selectedVersion?.version === version.version ? 'active' : ''}`}
                    onClick={() => setSelectedVersion(version)}
                  >
                    <div className="version-radio">
                      <input
                        type="radio"
                        name="version"
                        value={version.version}
                        checked={selectedVersion?.version === version.version}
                        readOnly
                      />
                    </div>
                    <div className="version-info">
                      <div className="version-header">
                        <strong>{version.version}</strong>
                        {index === 0 && <span className="latest-badge">Latest</span>}
                      </div>
                      <div className="version-details">
                        <span className="version-date">
                          {version.timestamp ? new Date(version.timestamp).toLocaleDateString() : 'Unknown date'}
                        </span>
                        <span className="version-size">
                          {version.size_gb?.toFixed(2)} GB
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No versions available</p>
            )}
          </div>
        </div>

        {/* Download Button */}
        <button
          className="download-button"
          onClick={handleDownload}
          disabled={!selectedVersion || downloading}
        >
          <span className="download-icon">⬇️</span>
          {downloading ? 'Downloading...' : 'Download Now'}
        </button>

        {/* Footer */}
        <div className="footer">
          <p>Need help? Check our <a href="#">Bypass Guide</a></p>
        </div>
      </div>
    </div>
  );
};

export default GameDetailDownload;
