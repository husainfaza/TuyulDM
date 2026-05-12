import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Mock Native Host API for the preview
  const activeDownloads = [
    { id: 1, name: "ubuntu-24.04-desktop-amd64.iso", size: "4.7 GB", progress: 45, speed: "12.4 MB/s", status: "downloading", type: "file" },
    { id: 2, name: "TuyulDM_Source.zip", size: "120 MB", progress: 100, speed: "0 B/s", status: "finished", type: "file" },
    { id: 3, name: "Presentation_Video_HLS.mp4", size: "890 MB", progress: 12, speed: "2.1 MB/s", status: "downloading", type: "video" },
  ];

  app.get("/api/downloads", (req, res) => {
    res.json(activeDownloads);
  });

  app.post("/api/downloads", (req, res) => {
    const { url, segments } = req.body;
    const newDownload = {
      id: activeDownloads.length + 1,
      name: url.split("/").pop() || "new_download",
      size: "Unknown",
      progress: 0,
      speed: "0 B/s",
      status: "queued",
      segments: segments || 8
    };
    activeDownloads.push(newDownload as any);
    res.json(newDownload);
  });

  app.post("/api/downloads/:id/:action", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const action = req.params.action; // "pause" or "resume"
    const dl = activeDownloads.find(d => d.id === id);
    if (dl) {
      if (action === "pause") {
        dl.status = "paused";
        dl.speed = "0 B/s";
      } else if (action === "resume") {
        dl.status = "downloading";
        dl.speed = "10.5 MB/s"; // mock speed
      }
    }
    res.json(dl || {});
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`TuyulDM Mock Server running on http://localhost:${PORT}`);
  });
}

startServer();
