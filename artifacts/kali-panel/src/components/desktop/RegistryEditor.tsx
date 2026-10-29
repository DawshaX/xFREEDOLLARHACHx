import { useEffect, useState } from "react";
import {
  Shield, Search, Edit, Trash2, Save, Upload, Download,
  Lock, Unlock, AlertTriangle, RefreshCw, Key,
  Database, FileText, Clock, ChevronRight,
} from "lucide-react";

interface RegistryKey {
  path: string;
  name: string;
  type: 'string' | 'dword' | 'binary' | 'multistring';
  value: string | number | boolean | Uint8Array;
  dataType: 'REG_SZ' | 'REG_DWORD' | 'REG_BINARY' | 'REG_MULTI_SZ';
  permissions: {
    read: boolean;
    write: boolean;
    delete: boolean;
  };
  lastModified: string;
  size: number;
}

interface RegistryHive {
  name: string;
  path: string;
  description: string;
  keys: number;
  size: number;
  isProtected: boolean;
}

export function RegistryEditor() {
  const [selectedHive, setSelectedHive] = useState<string>('HKEY_LOCAL_MACHINE');
  const [currentPath, setCurrentPath] = useState<string>('SOFTWARE\\Microsoft\\Windows\\CurrentVersion');
  const [keys, setKeys] = useState<RegistryKey[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editingKey, setEditingKey] = useState<RegistryKey | null>(null);
  const [backupPath, setBackupPath] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const hives: RegistryHive[] = [
    {
      name: 'HKEY_CLASSES_ROOT',
      path: 'HKEY_CLASSES_ROOT',
      description: 'ملحقات الملفات والبرامج',
      keys: 0,
      size: 0,
      isProtected: true,
    },
    {
      name: 'HKEY_CURRENT_USER',
      path: 'HKEY_CURRENT_USER',
      description: 'إعدادات المستخدم الحالي',
      keys: 0,
      size: 0,
      isProtected: false,
    },
    {
      name: 'HKEY_LOCAL_MACHINE',
      path: 'HKEY_LOCAL_MACHINE',
      description: 'إعدادات النظام',
      keys: 0,
      size: 0,
      isProtected: true,
    },
    {
      name: 'HKEY_USERS',
      path: 'HKEY_USERS',
      description: 'ملفات تعريفات المستخدمين',
      keys: 0,
      size: 0,
      isProtected: false,
    },
    {
      name: 'HKEY_CURRENT_CONFIG',
      path: 'HKEY_CURRENT_CONFIG',
      description: 'إعدادات الأجهزة',
      keys: 0,
      size: 0,
      isProtected: true,
    },
  ];

  const loadRegistryKeys = async (hive: string, path: string) => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/registry/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hive, path }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setKeys(data.keys || []);
      }
    } catch (error) {
      console.error('Failed to load registry keys:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const searchRegistry = async (query: string) => {
    if (!query.trim()) return;
    
    setIsLoading(true);
    try {
      const response = await fetch('/api/registry/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, hive: selectedHive }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setKeys(data.results || []);
      }
    } catch (error) {
      console.error('Failed to search registry:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const createKey = async (name: string, type: string, value: string) => {
    try {
      const response = await fetch('/api/registry/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hive: selectedHive,
          path: currentPath,
          name,
          type,
          value,
        }),
      });
      
      if (response.ok) {
        await loadRegistryKeys(selectedHive, currentPath);
      }
    } catch (error) {
      console.error('Failed to create registry key:', error);
    }
  };

  const updateKey = async (key: RegistryKey) => {
    try {
      const response = await fetch('/api/registry/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hive: selectedHive,
          path: currentPath,
          key: key.path,
          value: key.value,
        }),
      });
      
      if (response.ok) {
        await loadRegistryKeys(selectedHive, currentPath);
        setIsEditing(false);
        setEditingKey(null);
      }
    } catch (error) {
      console.error('Failed to update registry key:', error);
    }
  };

  const deleteKeys = async () => {
    if (selectedKeys.length === 0) return;
    
    const confirmed = window.confirm(
      `تحذير: حذف مفاتيح الريجستري قد يسبب مشاكل في النظام. هل أنت متأكد من حذف ${selectedKeys.length} مفاتيح؟`
    );
    
    if (confirmed) {
      try {
        const response = await fetch('/api/registry/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            hive: selectedHive,
            path: currentPath,
            keys: selectedKeys,
          }),
        });
        
        if (response.ok) {
          await loadRegistryKeys(selectedHive, currentPath);
          setSelectedKeys([]);
        }
      } catch (error) {
        console.error('Failed to delete registry keys:', error);
      }
    }
  };

  const backupRegistry = async () => {
    try {
      const response = await fetch('/api/registry/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hive: selectedHive,
          path: currentPath,
          includeSubkeys: true,
        }),
      });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `registry_backup_${selectedHive}_${Date.now()}.reg`;
        a.click();
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Failed to backup registry:', error);
    }
  };

  const restoreRegistry = async (file: File) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('hive', selectedHive);
      
      const response = await fetch('/api/registry/restore', {
        method: 'POST',
        body: formData,
      });
      
      if (response.ok) {
        await loadRegistryKeys(selectedHive, currentPath);
        alert('تم استعادة الريجستري بنجاح');
      }
    } catch (error) {
      console.error('Failed to restore registry:', error);
    }
  };

  const getValueDisplay = (key: RegistryKey) => {
    if (typeof key.value === 'boolean') {
      return key.value ? 'TRUE' : 'FALSE';
    }
    if (typeof key.value === 'number') {
      return key.value.toString();
    }
    if (key.value instanceof Uint8Array) {
      return `[Binary Data: ${key.value.length} bytes]`;
    }
    return String(key.value);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'string':
      case 'multistring':
        return <FileText className="w-3 h-3 text-blue-400" />;
      case 'dword':
        return <Database className="w-3 h-3 text-green-400" />;
      case 'binary':
        return <Lock className="w-3 h-3 text-red-400" />;
      default:
        return <FileText className="w-3 h-3 text-gray-400" />;
    }
  };

  useEffect(() => {
    loadRegistryKeys(selectedHive, currentPath);
  }, [selectedHive, currentPath]);

  useEffect(() => {
    if (!searchQuery.trim()) return;
    const timeoutId = setTimeout(() => searchRegistry(searchQuery), 500);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  return (
    <div className="bg-card/50 backdrop-blur-xl border border-primary/20 rounded-lg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-bold text-foreground">محرر الريجستري</h3>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={backupRegistry}
            className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors text-sm"
          >
            <Download className="w-3 h-3" />
            نسخ احتياطي
          </button>
          <button
            onClick={() => {
              const input = document.createElement('input');
              input.type = 'file';
              input.accept = '.reg';
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (file) restoreRegistry(file);
              };
              input.click();
            }}
            className="flex items-center gap-1 px-3 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors text-sm"
          >
            <Upload className="w-3 h-3" />
            استعادة
          </button>
        </div>
      </div>

      {/* Hive Selection */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        {hives.map((hive) => (
          <button
            key={hive.name}
            onClick={() => setSelectedHive(hive.name)}
            className={`p-3 rounded-lg border transition-all text-right ${
              selectedHive === hive.name
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-border/30 hover:border-primary/40 hover:bg-background/60'
            }`}
          >
            <div className="flex items-center gap-2">
              <Key className={`w-4 h-4 ${hive.isProtected ? 'text-amber-400' : 'text-primary'}`} />
              <div>
                <div className="text-sm font-semibold text-foreground">{hive.name}</div>
                <div className="text-xs text-muted-foreground">{hive.description}</div>
              </div>
              {hive.isProtected && (
                <Lock className="w-3 h-3 text-amber-400" />
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Path Navigation */}
      <div className="flex items-center gap-2 bg-background/40 rounded p-2">
        <ChevronRight className="w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={currentPath}
          onChange={(e) => setCurrentPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              loadRegistryKeys(selectedHive, currentPath);
            }
          }}
          className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-foreground"
          placeholder="مسار الريجستري"
        />
        <button
          onClick={() => loadRegistryKeys(selectedHive, currentPath)}
          className="px-3 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors text-sm"
        >
          انتقال
        </button>
      </div>

      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute right-2 top-2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث في الريجستري..."
            className="w-full bg-background/60 border border-border/40 rounded pl-3 pr-10 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
        <button
          onClick={() => {
            setEditingKey({ path: '', name: '', type: 'string', value: '', dataType: 'REG_SZ', permissions: { read: true, write: true, delete: false }, lastModified: '', size: 0 });
            setIsEditing(true);
          }}
          className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors text-sm"
        >
          <Edit className="w-3 h-3" />
          مفتاح جديد
        </button>
      </div>

      {/* Action Bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={deleteKeys}
          disabled={selectedKeys.length === 0}
          className="flex items-center gap-1 px-3 py-1 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
        >
          <Trash2 className="w-3 h-3" />
          حذف المحدد ({selectedKeys.length})
        </button>
        <button
          onClick={() => {
            if (selectedKeys.length === 1) {
              const key = keys.find(k => k.path === selectedKeys[0]);
              if (key) {
                setEditingKey(key);
                setIsEditing(true);
              }
            }
          }}
          disabled={selectedKeys.length !== 1}
          className="flex items-center gap-1 px-3 py-1 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
        >
          <Edit className="w-3 h-3" />
          تعديل
        </button>
        <button
          onClick={() => {
            const allKeys = keys.map(k => k.path);
            setSelectedKeys(allKeys);
          }}
          className="flex items-center gap-1 px-3 py-1 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 transition-colors text-sm"
        >
          <Lock className="w-3 h-3" />
          تحديد الكل
        </button>
        <button
          onClick={() => setSelectedKeys([])}
          className="flex items-center gap-1 px-3 py-1 rounded bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 transition-colors text-sm"
        >
          <RefreshCw className="w-3 h-3" />
          إلغاء التحديد
        </button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 text-primary animate-spin" />
          <span className="mr-2 text-sm text-muted-foreground">جاري تحميل الريجستري...</span>
        </div>
      )}

      {/* Edit Modal */}
      {isEditing && editingKey && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card border border-primary/20 rounded-lg p-6 w-full max-w-md">
            <h4 className="text-lg font-bold text-foreground mb-4">تعديل مفتاح الريجستري</h4>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">الاسم</label>
                <input
                  type="text"
                  value={editingKey.name}
                  onChange={(e) => setEditingKey({ ...editingKey, name: e.target.value })}
                  className="w-full bg-background/60 border border-border/40 rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">النوع</label>
                <select
                  value={editingKey.dataType}
                  onChange={(e) => setEditingKey({ ...editingKey, dataType: e.target.value as any })}
                  className="w-full bg-background/60 border border-border/40 rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
                >
                  <option value="REG_SZ">String (REG_SZ)</option>
                  <option value="REG_DWORD">DWORD (REG_DWORD)</option>
                  <option value="REG_BINARY">Binary (REG_BINARY)</option>
                  <option value="REG_MULTI_SZ">Multi-String (REG_MULTI_SZ)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">القيمة</label>
                <textarea
                  value={String(editingKey.value)}
                  onChange={(e) => setEditingKey({ ...editingKey, value: e.target.value })}
                  className="w-full bg-background/60 border border-border/40 rounded px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                  rows={4}
                  placeholder="أدخل القيمة..."
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => updateKey(editingKey)}
                className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors text-sm"
              >
                <Save className="w-3 h-3" />
                حفظ
              </button>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setEditingKey(null);
                }}
                className="flex items-center gap-1 px-3 py-1 rounded bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 transition-colors text-sm"
              >
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Registry Keys List */}
      {!isLoading && (
        <div className="space-y-2">
          {keys.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Database className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <div className="text-sm">لا توجد مفاتيح في هذا المسار</div>
            </div>
          ) : (
            keys.map((key) => (
              <div
                key={key.path}
                onClick={() => {
                  setSelectedKeys(prev => 
                    prev.includes(key.path) 
                      ? prev.filter(p => p !== key.path)
                      : [...prev, key.path]
                  );
                }}
                className={`p-3 rounded-lg border transition-all cursor-pointer ${
                  selectedKeys.includes(key.path)
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-border/30 hover:border-primary/40 hover:bg-background/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedKeys.includes(key.path)}
                      onChange={() => {}}
                      className="pointer-events-none"
                    />
                    {getTypeIcon(key.dataType)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{key.name}</div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{key.path}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {key.permissions.delete ? (
                      <Lock className="w-3 h-3 text-green-400" />
                    ) : (
                      <Unlock className="w-3 h-3 text-amber-400" />
                    )}
                    <span className="text-xs text-muted-foreground">
                      {new Date(key.lastModified).toLocaleString('ar-SA')}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  <div className="flex justify-between">
                    <span>النوع: {key.dataType}</span>
                    <span>الحجم: {key.size} bytes</span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="font-mono text-foreground truncate max-w-[300px]">
                      القيمة: {getValueDisplay(key)}
                    </span>
                    {key.permissions.write && (
                      <Edit className="w-3 h-3 text-blue-400 cursor-pointer hover:text-blue-300" />
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
