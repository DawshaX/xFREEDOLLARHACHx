import React, { useState, useRef } from "react";
import { X, Wrench, Zap, Shield, Globe, Bot, Terminal, Monitor, Settings, Play, Pause, Square, RefreshCw, Search, Filter } from "lucide-react";

interface Tool {
  id: string;
  name: string;
  category: string;
  icon: React.ReactNode;
  status: "active" | "idle" | "error";
  memory?: number;
  cpu?: number;
}

interface ToolsManagerProps {
  tools: Tool[];
  onToolToggle: (id: string) => void;
  onToolRestart: (id: string) => void;
  onToolStop: (id: string) => void;
}

export function ToolsManager({ tools, onToolToggle, onToolRestart, onToolStop }: ToolsManagerProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "status" | "memory">("name");
  const dragRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 500, y: 100 });
  const [isDragging, setIsDragging] = useState(false);

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const startLeft = position.x;
    const startTop = position.y;
    const onMove = (ev: MouseEvent) => {
      const newX = Math.max(0, Math.min(window.innerWidth - 400, startLeft + ev.clientX - startX));
      const newY = Math.max(60, Math.min(window.innerHeight - 400, startTop + ev.clientY - startY));
      setPosition({ x: newX, y: newY });
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelected(filteredTools.map(t => t.id));
  const clearSelection = () => setSelected([]);

  const startSelected = () => {
    selected.forEach(id => onToolToggle(id));
    clearSelection();
  };

  const stopSelected = () => {
    selected.forEach(id => onToolStop(id));
    clearSelection();
  };

  const restartSelected = () => {
    selected.forEach(id => onToolRestart(id));
    clearSelection();
  };

  const categories = ["all", ...Array.from(new Set(tools.map(t => t.category)))];
  
  const filteredTools = tools.filter(tool => {
    const matchesSearch = tool.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "all" || tool.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const sortedTools = [...filteredTools].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "status") return a.status.localeCompare(b.status);
    if (sortBy === "memory") return (b.memory || 0) - (a.memory || 0);
    return 0;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "text-emerald-400 bg-emerald-400/10";
      case "idle": return "text-muted-foreground bg-muted/10";
      case "error": return "text-rose-400 bg-rose-400/10";
      default: return "text-muted-foreground bg-muted/10";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active": return <Play className="w-3 h-3" />;
      case "idle": return <Pause className="w-3 h-3" />;
      case "error": return <Square className="w-3 h-3" />;
      default: return <Pause className="w-3 h-3" />;
    }
  };

  return (
    <div 
      ref={dragRef}
      className={`fixed z-50 w-96 bg-card/95 backdrop-blur-2xl border border-primary/30 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.4)] overflow-hidden ${isDragging ? 'cursor-grabbing scale-105' : 'cursor-grab'}`}
      style={{ left: `${position.x}px`, top: `${position.y}px` }}
    >
      {/* Header */}
      <div 
        className="px-4 py-3 bg-gradient-to-r from-orange-500/10 to-amber-500/5 border-b border-primary/20 flex items-center justify-between"
        onMouseDown={startDrag}
      >
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-orange-400" />
          <span className="text-sm font-bold text-orange-400">Tools Manager</span>
          <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
            {filteredTools.length} tools
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSortBy(sortBy === "name" ? "status" : sortBy === "status" ? "memory" : "name")}
            className="w-6 h-6 rounded hover:bg-primary/10 flex items-center justify-center transition-colors"
            title="Sort by"
          >
            <Filter className="w-3 h-3 text-muted-foreground" />
          </button>
          <button
            onClick={() => {/* Close handler */}}
            className="w-6 h-6 rounded hover:bg-rose-500/20 flex items-center justify-center transition-colors"
            title="Close"
          >
            <X className="w-3 h-3 text-rose-400" />
          </button>
        </div>
      </div>

      {/* Search and Filter */}
      <div className="px-4 py-2 border-b border-primary/10 space-y-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search tools..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-muted/10 border border-primary/20 rounded focus:outline-none focus:border-primary/40"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="flex-1 text-xs bg-muted/10 border border-primary/20 rounded px-2 py-1 focus:outline-none focus:border-primary/40"
          >
            {categories.map(cat => (
              <option key={cat} value={cat}>
                {cat === "all" ? "All Categories" : cat}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Controls */}
      <div className="px-4 py-2 border-b border-primary/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-xs px-2 py-1 bg-primary/10 border border-primary/20 rounded hover:bg-primary/20 transition-colors"
          >
            Select All
          </button>
          <button
            onClick={clearSelection}
            className="text-xs px-2 py-1 bg-muted/10 border border-muted/20 rounded hover:bg-muted/20 transition-colors"
          >
            Clear
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startSelected}
            disabled={selected.length === 0}
            className="w-6 h-6 rounded hover:bg-emerald-500/20 flex items-center justify-center transition-colors disabled:opacity-50"
            title="Start Selected"
          >
            <Play className="w-3 h-3 text-emerald-400" />
          </button>
          <button
            onClick={stopSelected}
            disabled={selected.length === 0}
            className="w-6 h-6 rounded hover:bg-rose-500/20 flex items-center justify-center transition-colors disabled:opacity-50"
            title="Stop Selected"
          >
            <Square className="w-3 h-3 text-rose-400" />
          </button>
          <button
            onClick={restartSelected}
            disabled={selected.length === 0}
            className="w-6 h-6 rounded hover:bg-orange-500/20 flex items-center justify-center transition-colors disabled:opacity-50"
            title="Restart Selected"
          >
            <RefreshCw className="w-3 h-3 text-orange-400" />
          </button>
        </div>
      </div>

      {/* Tools List */}
      <div className="max-h-80 overflow-y-auto">
        {sortedTools.map((tool) => (
          <div
            key={tool.id}
            className={`px-4 py-2 border-b border-primary/5 flex items-center gap-3 hover:bg-primary/5 transition-colors cursor-pointer ${
              selected.includes(tool.id) ? 'bg-primary/10' : ''
            }`}
            onClick={() => onToolToggle(tool.id)}
          >
            <input
              type="checkbox"
              checked={selected.includes(tool.id)}
              onChange={() => toggleSelect(tool.id)}
              className="w-3 h-3 rounded border-primary/30"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="w-6 h-6 rounded flex items-center justify-center bg-muted/10">
              {tool.icon}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground truncate">{tool.name}</div>
              <div className="text-xs text-muted-foreground">{tool.category}</div>
            </div>
            <div className="flex items-center gap-2">
              <div className={`px-1.5 py-0.5 rounded-full flex items-center gap-1 text-xs ${getStatusColor(tool.status)}`}>
                {getStatusIcon(tool.status)}
                <span>{tool.status}</span>
              </div>
              {tool.memory && (
                <div className="text-xs text-muted-foreground">
                  {tool.memory}MB
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Status Bar */}
      <div className="px-4 py-2 bg-muted/10 border-t border-primary/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-3 h-3 text-orange-400" />
          <span className="text-xs text-muted-foreground">Tools System</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {selected.length} selected
        </div>
      </div>
    </div>
  );
}
