/**
 * Media Protection Utility
 * Prevents IDM and other download managers from capturing media files
 * Also prevents drag & drop and right-click context menu
 */

// Prevent right-click context menu on media elements
export const preventContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();
  return false;
};

// Prevent drag start on media elements
export const preventDragStart = (e: React.DragEvent) => {
  e.preventDefault();
  return false;
};

// Prevent selection on media elements
export const preventSelection = (e: React.MouseEvent) => {
  e.preventDefault();
  return false;
};

// Apply protection attributes to media elements
export const getMediaProtectionProps = () => ({
  onContextMenu: preventContextMenu,
  onDragStart: preventDragStart,
  onMouseDown: preventSelection,
  draggable: false,
  style: {
    userSelect: 'none' as const,
    WebkitUserSelect: 'none' as const,
    MozUserSelect: 'none' as const,
    msUserSelect: 'none' as const,
    pointerEvents: 'auto' as const,
  }
});

// Global CSS to block IDM and download managers
export const injectMediaProtectionStyles = () => {
  const styleId = 'media-protection-styles';

  // Check if already injected
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* Prevent selection on all media elements */
    img, video, source, picture, canvas {
      -webkit-user-select: none !important;
      -moz-user-select: none !important;
      -ms-user-select: none !important;
      user-select: none !important;
      -webkit-user-drag: none !important;
      -khtml-user-drag: none !important;
      -moz-user-drag: none !important;
      -o-user-drag: none !important;
      user-drag: none !important;
      pointer-events: auto !important;
    }

    /* Block IDM and download manager overlays - Multiple selector variations */
    img::before, img::after,
    video::before, video::after,
    picture::before, picture::after {
      display: none !important;
      content: none !important;
      visibility: hidden !important;
    }

    /* Hide all potential IDM overlay elements */
    [id*="IDM"], [class*="IDM"], [id*="download"], [class*="download-button"],
    [id*="DownloadManager"], [class*="DownloadManager"] {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    /* Disable right-click context menu styling */
    *::-webkit-media-controls-download-button {
      display: none !important;
    }

    *::-webkit-media-controls-enclosure {
      overflow: hidden !important;
    }

    /* Hide download button in video controls */
    video::-internal-media-controls-download-button {
      display: none !important;
    }

    video::-webkit-media-controls {
      overflow: hidden !important;
    }

    video::-webkit-media-controls-enclosure {
      overflow: hidden !important;
    }

    video::-webkit-media-controls-panel {
      overflow: hidden !important;
    }

    /* Prevent drag ghost images */
    * {
      -webkit-user-drag: none;
    }

    /* Additional protection for image containers */
    div[style*="background-image"], 
    section[style*="background-image"],
    article[style*="background-image"] {
      -webkit-user-select: none !important;
      -moz-user-select: none !important;
      user-select: none !important;
    }
  `;

  document.head.appendChild(style);
};

// Disable keyboard shortcuts for saving media (Ctrl+S, etc.)
export const preventMediaSaveShortcuts = (e: KeyboardEvent) => {
  // Prevent Ctrl+S, Ctrl+Shift+S
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' || target.tagName === 'VIDEO') {
      e.preventDefault();
      return false;
    }
  }
};

// Initialize global media protection
export const initMediaProtection = () => {
  // Inject protection styles
  injectMediaProtectionStyles();

  // Add global event listeners
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' || target.tagName === 'VIDEO') {
      e.preventDefault();
      return false;
    }
  }, true);

  document.addEventListener('dragstart', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG' || target.tagName === 'VIDEO') {
      e.preventDefault();
      return false;
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    // Keep DevTools shortcuts available for desktop debugging.
    preventMediaSaveShortcuts(e);
  }, true);

  // Disable copy on images and videos
  document.addEventListener('copy', (e) => {
    const selection = window.getSelection();
    const target = e.target as HTMLElement;
    if (selection && selection.toString() === '' &&
        (target.tagName === 'IMG' || target.tagName === 'VIDEO')) {
      e.preventDefault();
      return false;
    }
  }, true);

  // Override toDataURL and other canvas methods that could capture video frames
  if (typeof HTMLCanvasElement !== 'undefined') {
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      // Allow screenshots but prevent automated bulk extraction
      const stack = new Error().stack;
      if (stack && (stack.includes('IDM') || stack.includes('Download'))) {
        throw new Error('Access denied');
      }
      return originalToDataURL.apply(this, args);
    };
  }

  // Block video element src inspection by external tools
  if (typeof HTMLVideoElement !== 'undefined') {
    const originalGetAttribute = HTMLVideoElement.prototype.getAttribute;
    HTMLVideoElement.prototype.getAttribute = function(name: string) {
      // Only guard obvious IDM stack traces; do not block generic extension stacks.
      if (name === 'src' || name === 'currentSrc') {
        const stack = new Error().stack;
        if (stack && stack.includes('IDM')) {
          return '';
        }
      }
      return originalGetAttribute.call(this, name);
    };
  }

  // Protect against blob URL extraction
  if (typeof URL !== 'undefined' && URL.createObjectURL) {
    const originalCreateObjectURL = URL.createObjectURL;
    const protectedBlobs = new WeakSet();

    URL.createObjectURL = function(obj: Blob | MediaSource) {
      const url = originalCreateObjectURL(obj);
      if (obj instanceof Blob) {
        protectedBlobs.add(obj);
      }
      return url;
    };
  }
};
