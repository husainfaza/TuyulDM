const HOST_NAME = "com.tuyuldm.daemon";

console.log("TuyulDM Background Worker Started");

// Connect to the Go binary
let port = null;
const activeDownloads = new Set();
let progressInterval = null;

function connectToHost() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
    
    port.onMessage.addListener((response) => {
      console.log("Received from TuyulDM Host:", response);
      if (response.message === "download.progressUpdate") {
        // Broadcast progress update to popup/options pages
        const payload = response.payload;
        chrome.runtime.sendMessage({ 
          type: "PROGRESS_UPDATE", 
          payload: payload 
        }).catch(() => {
          // Ignore error if popup is closed
        });

        // Track active downloads for polling
        if (payload && payload.id) {
          if (payload.status === "downloading" || payload.status === "queued" || payload.status === "muxing") {
            activeDownloads.add(payload.id);
          } else {
            activeDownloads.delete(payload.id);
          }
        }
      } else if (response.message === "download.list" || (response.id > 0 && Array.isArray(response.payload))) {
        chrome.runtime.sendMessage({
          type: "LIST_UPDATE",
          payload: response.payload
        }).catch(() => {});
      } else if (response.id > 0 && response.payload && response.payload.id) {
         // Also check for getProgress responses
         if (response.payload.status) {
           chrome.runtime.sendMessage({ 
             type: "PROGRESS_UPDATE", 
             payload: response.payload 
           }).catch(() => {});
           
           if (response.payload.status === "downloading" || response.payload.status === "queued" || response.payload.status === "muxing") {
             activeDownloads.add(response.payload.id);
           } else {
             activeDownloads.delete(response.payload.id);
           }
         }
      }
    });

    port.onDisconnect.addListener(() => {
      console.error("TuyulDM Host disconnected. Error:", chrome.runtime.lastError?.message);
      port = null;
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    });

    // Test ping
    port.postMessage({ method: "ping", params: { data: "Hello from Chrome" }, id: 1 });

    // Start polling active downloads
    progressInterval = setInterval(() => {
      if (!port) return;
      activeDownloads.forEach(id => {
        port.postMessage({
          method: "download.getProgress",
          params: { id: id },
          id: Date.now()
        });
      });
    }, 1000);
  } catch (e) {
    console.error("Failed to connect to native host:", e);
  }
}

connectToHost();

// Sniff for video manifests by URL and Headers
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    const url = details.url;
    let isManifest = false;
    let manifestType = '';

    // Check by content-type header
    if (details.responseHeaders) {
      for (let header of details.responseHeaders) {
        if (header.name.toLowerCase() === 'content-type') {
          const value = header.value.toLowerCase();
          if (value.includes('application/vnd.apple.mpegurl') || value.includes('application/x-mpegurl')) {
            isManifest = true;
            manifestType = 'HLS';
            break;
          } else if (value.includes('application/dash+xml')) {
            isManifest = true;
            manifestType = 'DASH';
            break;
          }
        }
      }
    }

    // Fallback: check by URL extension
    if (!isManifest && (url.includes('.m3u8') || url.includes('.mpd'))) {
      isManifest = true;
      manifestType = url.includes('.m3u8') ? 'HLS' : 'DASH';
    }

    if (isManifest) {
      console.log(`Detected ${manifestType} manifest:`, url);
      // Inject content script dynamically if it's not already there
      if (details.tabId >= 0) {
        chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          files: ['content.js']
        }).then(() => {
          // Send message to the content script of the tab after injection
          chrome.tabs.sendMessage(details.tabId, {
            type: "MANIFEST_DETECTED",
            url: url,
            manifestType: manifestType
          }).catch(() => {});
        }).catch((err) => {
          console.error("Failed to inject content script:", err);
        });
      }
    }
  },
  { urls: ["<all_urls>"], types: ["xmlhttprequest", "other"] },
  ["responseHeaders"]
);

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_VIDEO_DOWNLOAD") {
    console.log("Starting video download:", message.url);
    if (port) {
      port.postMessage({
        method: "download.video",
        params: {
          url: message.url,
          filename: `Video_${Date.now()}.mp4`,
          manifestType: message.manifestType
        },
        id: Date.now()
      });
    } else {
      console.error("Native host not connected.");
    }
  } else if (message.type === "START_DOWNLOAD") {
    console.log("Starting regular download:", message.url);
    if (port) {
      const filename = message.url.substring(message.url.lastIndexOf('/') + 1) || `Download_${Date.now()}`;
      port.postMessage({
        method: "download.add",
        params: {
          url: message.url,
          filename: filename,
          segments: message.segments || 8
        },
        id: Date.now()
      });
    } else {
      console.error("Native host not connected.");
    }
  } else if (message.type === "PAUSE_DOWNLOAD") {
    if (port) {
      port.postMessage({ method: "download.pause", params: { id: String(message.id) }, id: Date.now() });
    }
  } else if (message.type === "RESUME_DOWNLOAD") {
    if (port) {
      port.postMessage({ method: "download.resume", params: { id: String(message.id) }, id: Date.now() });
    }
  } else if (message.type === "GET_DOWNLOADS") {
    if (port) {
      port.postMessage({ method: "download.list", params: {}, id: Date.now() });
    }
  }
});

// Intercept downloads
chrome.downloads.onCreated.addListener((item) => {
  console.log("Download intercepted:", item.url);
  if (port) {
    // Send to TuyulDM host instead of browser
    port.postMessage({ 
      method: "download.add", 
      params: { 
        url: item.url,
        referer: item.referrer,
        filename: item.filename
      },
      id: Date.now()
    });
    // Cancel browser download
    chrome.downloads.cancel(item.id);
  }
});
