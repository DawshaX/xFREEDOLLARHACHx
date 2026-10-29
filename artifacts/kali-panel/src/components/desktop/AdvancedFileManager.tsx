import { useEffect, useState } from "react";
import {
  FileText, Folder, Download, Upload, Trash2, Search, Filter,
  Copy, Move, Edit, Eye, Terminal, Shield, Clock,
  HardDrive, Users, Lock, Unlock, FilePlus, FolderPlus,
} from "lucide-react";

interface FileItem {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
  permissions: {
    read: boolean;
    write: boolean;
    execute: boolean;
  };
  owner: string;
  attributes: {
    hidden: boolean;
    system: boolean;
    encrypted: boolean;
  };
}

interface FileSystemStats {
  totalSpace: number;
  usedSpace: number;
  freeSpace: number;
  totalFiles: number;
  totalDirectories: number;
  systemFiles: number;
  hiddenFiles: number;
}

export function AdvancedFileManager() {
  const [currentPath, setCurrentPath] = useState('C:\\');
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified' | 'type'>('name');
  const [filter, setFilter] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [stats, setStats] = useState<FileSystemStats | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const loadDirectory = async (path: string) => {
    try {
      const response = await fetch('/api/files/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, showHidden }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
        setStats(data.stats || null);
        setCurrentPath(path);
      }
    } catch (error) {
      console.error('Failed to load directory:', error);
    }
  };

  const executeFileOperation = async (operation: string, params: any) => {
    try {
      const response = await fetch('/api/files/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, ...params }),
      });
      
      if (response.ok) {
        await loadDirectory(currentPath); // Refresh directory
      }
    } catch (error) {
      console.error('File operation failed:', error);
    }
  };

  const deleteFiles = async () => {
    if (selectedFiles.length === 0) return;
    
    const confirmed = window.confirm(
      `هل أنت متأكد من حذف ${selectedFiles.length} عنصر؟ هذا الإجراء لا يمكن التراجع عنه.`
    );
    
    if (confirmed) {
      await executeFileOperation('delete', { files: selectedFiles });
      setSelectedFiles([]);
    }
  };

  const copyFiles = async () => {
    if (selectedFiles.length === 0) return;
    await executeFileOperation('copy', { files: selectedFiles, destination: currentPath });
  };

  const moveFiles = async () => {
    if (selectedFiles.length === 0) return;
    await executeFileOperation('move', { files: selectedFiles, destination: currentPath });
  };

  const createDirectory = async () => {
    const name = prompt('أدخل اسم المجلد الجديد:');
    if (name) {
      await executeFileOperation('create_directory', { path: currentPath, name });
    }
  };

  const createFile = async () => {
    const name = prompt('أدخل اسم الملف الجديد:');
    if (name) {
      await executeFileOperation('create_file', { path: currentPath, name });
    }
  };

  const openTerminal = async (path?: string) => {
    await executeFileOperation('open_terminal', { path: path || currentPath });
  };

  const handleTerminalClick = () => {
    openTerminal();
  };

  const formatDrive = async () => {
    const confirmed = window.confirm(
      'تحذير: هذا سيقوم بتهيئة القرص بالكامل! كل البيانات ستفقد. هل تريد المتابعة؟'
    );
    
    if (confirmed) {
      await executeFileOperation('format_drive', { path: currentPath });
    }
  };

  const getPermissionsIcon = (permissions: FileItem['permissions']) => {
    if (permissions.read && permissions.write && permissions.execute) {
      return <Unlock className="w-3 h-3 text-green-400" />;
    }
    return <Lock className="w-3 h-3 text-red-400" />;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('ar-SA');
  };

  const sortFiles = (files: FileItem[]) => {
    return [...files].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'size':
          return b.size - a.size;
        case 'modified':
          return new Date(b.modified).getTime() - new Date(a.modified).getTime();
        case 'type':
          return a.type.localeCompare(b.type);
        default:
          return 0;
      }
    });
  };

  const filteredFiles = sortFiles(files).filter(file => 
    file.name.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    loadDirectory(currentPath);
  }, []);

  if (!files.length) {
    return (
      <div className="p-4 text-center">
        <Folder className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <div className="text-sm text-muted-foreground">جاري تحميل الملفات...</div>
      </div>
    );
  }

  return (
    <div className="bg-card/50 backdrop-blur-xl border border-primary/20 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">مدير الملفات المتقدم</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
            className="p-1 rounded hover:bg-primary/10 transition-colors"
            title="تغيير العرض"
          >
            <Folder className="w-4 h-4 text-primary" />
          </button>
          <button
            onClick={() => setShowHidden(!showHidden)}
            className={`p-1 rounded transition-colors ${showHidden ? 'bg-primary/20' : 'hover:bg-primary/10'}`}
            title="إظهار الملفات المخفية"
          >
            <Eye className="w-4 h-4 text-primary" />
          </button>
        </div>
      </div>

      {/* Path Navigation */}
      <div className="flex items-center gap-2 bg-background/40 rounded p-2">
        <Terminal className="w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              loadDirectory(currentPath);
            }
          }}
          className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-foreground"
          placeholder="مسار المجلد"
        />
        <button
          onClick={() => loadDirectory(currentPath)}
          className="px-2 py-1 rounded bg-primary/20 text-primary text-xs hover:bg-primary/30 transition-colors"
        >
          انتقال
        </button>
      </div>

      {/* Search and Filter */}
      <div className="flex items-center gap-2">
        <div className="flex-1 relative">
          <Search className="absolute right-2 top-2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="بحث في الملفات والمجلدات..."
            className="w-full bg-background/60 border border-border/40 rounded pl-3 pr-10 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as any)}
          className="bg-background/60 border border-border/40 rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
        >
          <option value="name">حسب الاسم</option>
          <option value="size">حسب الحجم</option>
          <option value="modified">حسب التعديل</option>
          <option value="type">حسب النوع</option>
        </select>
      </div>

      {/* Statistics */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 bg-background/40 rounded p-3">
          <div className="text-center">
            <div className="text-xs text-muted-foreground">المساحة الإجمالية</div>
            <div className="text-sm font-mono text-foreground">{formatFileSize(stats.totalSpace)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">المستخدم</div>
            <div className="text-sm font-mono text-foreground">{formatFileSize(stats.usedSpace)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">المتبقي</div>
            <div className="text-sm font-mono text-foreground">{formatFileSize(stats.freeSpace)}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-muted-foreground">الملفات</div>
            <div className="text-sm font-mono text-foreground">{stats.totalFiles.toLocaleString('ar-SA')}</div>
          </div>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={createDirectory}
          className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors text-sm"
        >
          <FolderPlus className="w-3 h-3" />
          مجلد جديد
        </button>
        <button
          onClick={createFile}
          className="flex items-center gap-1 px-3 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors text-sm"
        >
          <FilePlus className="w-3 h-3" />
          ملف جديد
        </button>
        <button
          onClick={copyFiles}
          disabled={selectedFiles.length === 0}
          className="flex items-center gap-1 px-3 py-1 rounded bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
        >
          <Copy className="w-3 h-3" />
          نسخ
        </button>
        <button
          onClick={moveFiles}
          disabled={selectedFiles.length === 0}
          className="flex items-center gap-1 px-3 py-1 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
        >
          <Move className="w-3 h-3" />
          نقل
        </button>
        <button
          onClick={deleteFiles}
          disabled={selectedFiles.length === 0}
          className="flex items-center gap-1 px-3 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
        >
          <Trash2 className="w-3 h-3" />
          حذف
        </button>
        <button
          onClick={() => openTerminal()}
          className="flex items-center gap-1 px-3 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors text-sm"
        >
          <Terminal className="w-3 h-3" />
          فتح Terminal
        </button>
        <button
          onClick={formatDrive}
          className="flex items-center gap-1 px-3 py-1 rounded bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-colors text-sm"
        >
          <Shield className="w-3 h-3" />
          تهيئة القرص
        </button>
      </div>

      {/* Files List/Grid */}
      <div className="border border-border/40 rounded-lg bg-background/30">
        {filteredFiles.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <div className="text-sm">لا توجد ملفات في هذا المسار</div>
          </div>
        ) : (
          <div className={viewMode === 'grid' ? 'grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 p-2' : 'space-y-1 p-2'}>
            {filteredFiles.map((file) => (
              <div
                key={file.id}
                onClick={() => {
                  if (file.type === 'directory') {
                    loadDirectory(file.path);
                  } else {
                    // Handle file selection
                    setSelectedFiles(prev => 
                      prev.includes(file.id) 
                        ? prev.filter(id => id !== file.id)
                        : [...prev, file.id]
                    );
                  }
                }}
                className={`group relative p-3 rounded-lg border transition-all cursor-pointer ${
                  selectedFiles.includes(file.id)
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border/30 hover:border-primary/40 hover:bg-background/60'
                } ${viewMode === 'list' ? 'flex items-center justify-between' : ''}`}
              >
                <div className="flex items-center gap-2">
                  {file.type === 'directory' ? (
                    <Folder className={`w-4 h-4 ${file.attributes.hidden ? 'text-muted-foreground/50' : 'text-blue-400'}`} />
                  ) : (
                    <FileText className={`w-4 h-4 ${file.attributes.hidden ? 'text-muted-foreground/50' : 'text-foreground'}`} />
                  )}
                  <span className={`text-sm ${file.attributes.hidden ? 'text-muted-foreground/50 italic' : 'text-foreground'}`}>
                    {file.name}
                  </span>
                  {file.attributes.system && (
                    <span title="ملف نظام">
                      <Shield className="w-3 h-3 text-amber-400" />
                    </span>
                  )}
                  {getPermissionsIcon(file.permissions)}
                </div>
                
                {viewMode === 'list' && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{formatFileSize(file.size)}</span>
                    <span>{formatDate(file.modified)}</span>
                    <span>{file.owner}</span>
                  </div>
                )}
                
                {viewMode === 'grid' && (
                  <div className="text-xs text-muted-foreground mt-1 space-y-1">
                    <div>{formatFileSize(file.size)}</div>
                    <div>{formatDate(file.modified)}</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
