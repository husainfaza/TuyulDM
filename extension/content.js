if (!window.tuyuldmContentScriptInjected) {
  window.tuyuldmContentScriptInjected = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "MANIFEST_DETECTED") {
      showDownloadOverlay(message.url, message.manifestType);
    }
  });

  function showDownloadOverlay(url, type) {
    if (document.getElementById('tuyuldm-video-overlay')) {
      return; // Already showing
    }

    const overlay = document.createElement('div');
    overlay.id = 'tuyuldm-video-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '20px';
    overlay.style.right = '20px';
    overlay.style.zIndex = '999999';
    overlay.style.backgroundColor = '#141414';
    overlay.style.color = '#E4E3E0';
    overlay.style.padding = '12px 16px';
    overlay.style.borderRadius = '8px';
    overlay.style.fontFamily = 'monospace';
    overlay.style.fontSize = '12px';
    overlay.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.gap = '8px';

    const text = document.createElement('span');
    text.innerText = `TuyulDM: ${type} Video Detected`;
    overlay.appendChild(text);

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '8px';

    const downloadBtn = document.createElement('button');
    downloadBtn.innerText = 'Download Video';
    downloadBtn.style.backgroundColor = '#E4E3E0';
    downloadBtn.style.color = '#141414';
    downloadBtn.style.border = 'none';
    downloadBtn.style.padding = '6px 12px';
    downloadBtn.style.borderRadius = '4px';
    downloadBtn.style.cursor = 'pointer';
    downloadBtn.style.fontWeight = 'bold';
    
    downloadBtn.onclick = () => {
      chrome.runtime.sendMessage({
        type: "START_VIDEO_DOWNLOAD",
        url: url,
        manifestType: type
      });
      overlay.remove();
    };
    btnContainer.appendChild(downloadBtn);

    const dismissBtn = document.createElement('button');
    dismissBtn.innerText = 'Dismiss';
    dismissBtn.style.backgroundColor = 'transparent';
    dismissBtn.style.color = '#E4E3E0';
    dismissBtn.style.border = '1px solid #E4E3E0';
    dismissBtn.style.padding = '6px 12px';
    dismissBtn.style.borderRadius = '4px';
    dismissBtn.style.cursor = 'pointer';
    
    dismissBtn.onclick = () => {
      overlay.remove();
    };
    btnContainer.appendChild(dismissBtn);

    overlay.appendChild(btnContainer);
    document.body.appendChild(overlay);

    // Auto dismiss after 15 seconds
    setTimeout(() => {
      if (document.getElementById('tuyuldm-video-overlay')) {
        overlay.remove();
      }
    }, 15000);
  }
}
