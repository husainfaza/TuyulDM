/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { 
  Download, 
  Settings, 
  Plus, 
  Play, 
  Pause, 
  X, 
  ChevronRight, 
  Menu,
  Activity,
  CheckCircle2,
  Clock,
  Video,
  Monitor,
  Github,
  RefreshCw
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DownloadItem {
  id: number | string;
  name?: string;
  filename?: string;
  size?: string;
  total_size?: number;
  progress: number;
  speed: string;
  status: 'downloading' | 'paused' | 'finished' | 'queued' | 'error' | 'muxing';
  type?: string;
  error?: string;
}

export default function App() {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'finished' | 'grabber'>('all');
  const [isAdding, setIsAdding] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [segmentsCount, setSegmentsCount] = useState(() => {
    const saved = localStorage.getItem("tuyuldm_segments");
    return saved ? parseInt(saved, 10) : 8;
  });

  useEffect(() => {
    const isExtension = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage;
    
    if (isExtension) {
      const listener = (message: any) => {
        if (message.type === "PROGRESS_UPDATE") {
           setDownloads(prev => {
             const exists = prev.find(d => d.id === message.payload.id);
             if (exists) {
               return prev.map(d => d.id === message.payload.id ? { ...d, ...message.payload } : d);
             } else {
               return [...prev, message.payload];
             }
           });
        } else if (message.type === "LIST_UPDATE") {
           setDownloads(message.payload || []);
        }
      };
      
      // We need to type-cast chrome to any to avoid TypeScript errors since we don't have @types/chrome
      (window as any).chrome.runtime.onMessage.addListener(listener);
      (window as any).chrome.runtime.sendMessage({ type: "GET_DOWNLOADS" });
      
      return () => {
         (window as any).chrome.runtime.onMessage.removeListener(listener);
      };
    } else {
      fetch("/api/downloads")
        .then(res => res.json())
        .then(data => setDownloads(data));
        
      const interval = setInterval(() => {
        fetch("/api/downloads")
          .then(res => res.json())
          .then(data => setDownloads(data));
      }, 2000);
      return () => clearInterval(interval);
    }
  }, []);

  const addDownload = async () => {
    if (!urlInput) return;
    const isExtension = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;
    
    if (isExtension) {
      (window as any).chrome.runtime.sendMessage({ 
         type: "START_DOWNLOAD",
         url: urlInput,
         segments: segmentsCount
      });
    } else {
      const res = await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: urlInput, segments: segmentsCount })
      });
      const newDownload = await res.json();
      setDownloads([...downloads, newDownload]);
    }
    
    setUrlInput("");
    setIsAdding(false);
  };

  const togglePlayPause = async (id: number | string, currentStatus: string) => {
    const isExtension = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage;
    if (isExtension) {
      (window as any).chrome.runtime.sendMessage({
        type: (currentStatus === "downloading" || currentStatus === "queued" || currentStatus === "muxing") ? "PAUSE_DOWNLOAD" : "RESUME_DOWNLOAD",
        id: id
      });
    } else {
      await fetch(`/api/downloads/${id}/${(currentStatus === "downloading" || currentStatus === "muxing") ? "pause" : "resume"}`, { method: "POST" });
      setDownloads(downloads.map(d => 
        d.id === id ? { ...d, status: (currentStatus === "downloading" || currentStatus === "muxing") ? "paused" : "downloading" } : d
      ));
    }
  };

  const filteredDownloads = downloads.filter(d => {
    if (activeTab === 'grabber') return d.type === 'video';
    if (activeTab === 'all') return true;
    if (activeTab === 'active') return d.status === 'downloading' || d.status === 'queued' || d.status === 'muxing';
    if (activeTab === 'finished') return d.status === 'finished';
    return true;
  });

  const formatSize = (bytes: number | string) => {
    if (typeof bytes === 'string') return bytes;
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0A0A0A] text-[#EDEDED]">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 flex flex-col bg-white/[0.02] backdrop-blur-xl">
        <div className="p-6 border-b border-white/5">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-white/10 p-2 rounded-xl border border-white/10 shadow-inner">
              <Download className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-white">TuyulDM</h1>
          </div>
          <p className="text-[10px] text-white/40 uppercase tracking-widest font-mono">v0.1.0-alpha</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <SidebarItem 
            active={activeTab === 'all'} 
            onClick={() => setActiveTab('all')}
            icon={<Monitor className="w-4 h-4" />} 
            label="All Downloads" 
          />
          <SidebarItem 
            active={activeTab === 'active'} 
            onClick={() => setActiveTab('active')}
            icon={<Activity className="w-4 h-4" />} 
            label="Acive Queue" 
            count={downloads.filter(d => d.status === 'downloading').length}
          />
          <SidebarItem 
            active={activeTab === 'finished'} 
            onClick={() => setActiveTab('finished')}
            icon={<CheckCircle2 className="w-4 h-4" />} 
            label="Finished" 
          />
          <SidebarItem 
            active={activeTab === 'grabber'} 
            onClick={() => setActiveTab('grabber')}
            icon={<Video className="w-4 h-4" />} 
            label="Video Grabber" 
          />
        </nav>

        <div className="p-4 border-t border-white/5 space-y-1">
           <SidebarItem icon={<Settings className="w-4 h-4" />} label="Settings" onClick={() => setIsSettingsOpen(true)} />
           <SidebarItem icon={<Github className="w-4 h-4" />} label="Source Code" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header toolbar */}
        <header className="h-16 flex-none border-b border-white/5 flex items-center justify-between px-6 bg-[#0A0A0A]/80 backdrop-blur-md z-20">
          <div className="flex gap-3">
            <button 
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 px-4 py-1.5 bg-white text-black rounded-lg text-sm font-medium hover:bg-white/90 shadow-sm transition-all shadow-white/10"
            >
              <Plus className="w-4 h-4" /> Add URL
            </button>
            <ToolbarButton icon={<Play className="w-4 h-4" />} label="Resume All" />
            <ToolbarButton icon={<Pause className="w-4 h-4" />} label="Pause All" />
          </div>

          <div className="flex items-center gap-6">
             <div className="text-right">
                <p className="col-header mb-1">Global Speed</p>
                <p className="text-[13px] font-mono text-white/90">14.5 MB/s</p>
             </div>
             <div className="h-8 w-px bg-white/10" />
             <div className="text-right">
                <p className="col-header mb-1">Free Space</p>
                <p className="text-[13px] font-mono text-white/90">84.2 GB</p>
             </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-auto relative">
          <div className="grid grid-cols-[40px_1fr_120px_180px_120px_100px] gap-4 px-6 py-3 sticky top-0 border-b border-white/5 bg-[#0A0A0A]/90 backdrop-blur-xl z-10">
            <div className="col-header">ID</div>
            <div className="col-header">File Name</div>
            <div className="col-header">Size</div>
            <div className="col-header">Status / Progress</div>
            <div className="col-header">Speed</div>
            <div className="col-header">Actions</div>
          </div>

          <AnimatePresence>
            <div className="p-3 space-y-1">
            {filteredDownloads.map((d) => (
              <motion.div 
                key={d.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="data-row grid grid-cols-[40px_1fr_120px_180px_120px_100px] gap-4 px-3 py-3 items-center group"
              >
                <div className="data-value opacity-40">{typeof d.id === 'number' ? d.id.toString().padStart(2, '0') : d.id.substring(0, 4)}</div>
                <div className="flex flex-col min-w-0 pr-4">
                  <div className="font-medium truncate text-[13px] text-white/90">{d.name || d.filename}</div>
                  {d.status === 'error' && d.error && (
                    <div className="text-xs text-red-400 mt-0.5 truncate" title={d.error}>{d.error}</div>
                  )}
                </div>
                <div className="data-value">{formatSize((d as any).total_size ?? d.size ?? 0)}</div>
                <div className="space-y-2 pr-4">
                  <div className="flex justify-between text-[10px] uppercase font-mono tracking-widest font-medium">
                    <span className={d.status === 'downloading' ? 'text-blue-400' : d.status === 'error' ? 'text-red-400' : 'text-white/40'}>
                      {d.status}
                    </span>
                    <span className="text-white/50">{typeof d.progress === 'number' ? Math.round(d.progress) : d.progress}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden shadow-inner">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${d.progress}%` }}
                      className={`h-full rounded-full ${d.status === 'finished' ? 'bg-green-500' : d.status === 'error' ? 'bg-red-500' : 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]'}`}
                    />
                  </div>
                </div>
                <div className="data-value">{d.speed}</div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => togglePlayPause(d.id, d.status)}
                    className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-md transition-all"
                    title={ (d.status === "downloading" || d.status === "queued" || d.status === "muxing") ? "Pause" : d.status === 'error' ? "Retry" : "Resume" }
                  >
                    {(d.status === 'downloading' || d.status === 'queued' || d.status === "muxing") ? 
                      <Pause className="w-3.5 h-3.5" /> : 
                      d.status === 'error' ? 
                      <RefreshCw className="w-3.5 h-3.5 text-red-500" /> : 
                      <Play className="w-3.5 h-3.5 pl-[1px]" />
                    }
                  </button>
                  <button className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-all">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
            </div>
          </AnimatePresence>
        </div>

        {/* Footer info */}
        <footer className="h-8 border-t border-white/5 bg-[#0A0A0A] text-white/40 px-6 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest">
          <div>Native Host: <span className="text-green-400">Connected (IPC v1)</span></div>
          <div>Queue: Default (Parallel x{segmentsCount})</div>
          <div>Active Connections: {downloads.filter(d => d.status === 'downloading').length * segmentsCount}</div>
        </footer>
      </main>

      {/* Add URL Modal */}
      <AnimatePresence>
        {isAdding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdding(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-[#141414] border border-white/10 p-8 rounded-2xl shadow-2xl"
            >
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
                <Plus className="w-5 h-5 text-white/50" /> Add New Download
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] uppercase font-mono tracking-widest text-white/50 mb-2 block">Enter URL</label>
                  <input 
                    autoFocus
                    type="text" 
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="https://example.com/file.iso"
                    className="w-full bg-[#0A0A0A] border border-white/10 px-4 py-3 rounded-xl font-mono text-[13px] text-white focus:outline-none focus:border-white/30 transition-colors"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    onClick={() => setIsAdding(false)}
                    className="px-6 py-3 border border-white/10 text-white/70 rounded-xl font-medium hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={addDownload}
                    className="flex-1 py-3 bg-white text-black rounded-xl font-medium hover:bg-white/90 transition-colors shadow-sm"
                  >
                    Start Download
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#141414] border border-white/10 p-8 rounded-2xl shadow-2xl"
            >
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
                <Settings className="w-5 h-5 text-white/50" /> Settings
              </h2>
              <div className="space-y-6">
                <div>
                  <label className="text-[13px] font-medium mb-1.5 flex justify-between tracking-wide text-white/90">
                    <span>Download Segments</span>
                    <span className="font-mono bg-white/10 text-white/80 rounded px-2">{segmentsCount}</span>
                  </label>
                  <p className="text-[10px] uppercase font-mono mb-4 tracking-wider text-white/40 block">Number of parallel connections per file</p>
                  <input 
                    type="range" 
                    min="1" 
                    max="32" 
                    value={segmentsCount}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setSegmentsCount(val);
                      localStorage.setItem("tuyuldm_segments", val.toString());
                    }}
                    className="w-full accent-white"
                  />
                  <div className="flex justify-between text-[10px] font-mono mt-2 text-white/40">
                    <span>1</span>
                    <span>32</span>
                  </div>
                </div>
                
                <div className="pt-6 mt-6 border-t border-white/10 flex justify-end">
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="px-6 py-2.5 bg-white text-black rounded-lg font-medium hover:bg-white/90 transition-colors shadow-sm"
                  >
                    Done
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SidebarItem({ icon, label, active = false, count, onClick }: { icon: React.ReactNode, label: string, active?: boolean, count?: number, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all group ${active ? 'bg-white/10 text-white shadow-sm' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
    >
      <div className="flex items-center gap-3">
        <span className={`${active ? 'text-white' : 'text-white/40 group-hover:text-white/80'}`}>{icon}</span>
        <span className="text-[13px] font-medium">{label}</span>
      </div>
      {count !== undefined && (
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-white/5 text-white/50'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function ToolbarButton({ icon, label }: { icon: React.ReactNode, label: string }) {
  return (
    <button className="flex items-center gap-2 px-3 py-1.5 border border-white/10 bg-white/5 rounded-lg text-sm font-medium hover:bg-white/10 transition-all text-white/80 shadow-sm">
      {icon} <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
