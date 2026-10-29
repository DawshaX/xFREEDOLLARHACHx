import { useState, useEffect } from "react";
import { Globe, RefreshCw, Loader2, Shield, AlertTriangle, Database, Target, Zap, Search, Server, Skull } from "lucide-react";
import { PageHeader } from "@/components/Layout";
import { jsonRequest } from "@/lib/sse";
import { intel } from "@/lib/intelligence";
import { useLocation } from "wouter";

interface Asset { id: string; name: string; category: string; criticality: string; domains: string[]; ips: string[]; techStack: string[]; tags: string[]; }
interface IOC { id: string; iocType: string; value: string; severity: string; source: string; }
interface Evidence { id: string; targetUrl: string; title: string; severity: string; evidenceType: string; cveId?: string; createdAt: string; }

const NEON_CARD = { background: "rgba(8,0,18,0.95)", border: "1px solid rgba(180,0,255,0.12)", borderRadius: 16, boxShadow: "0 0 20px rgba(150,0,255,0.04)" };
const DARK = { background: "rgba(5,0,12,0.8)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 12 };

const SEV_COLOR: Record<string, string> = { critical: "#ff4444", high: "#ff8844", medium: "#ffaa44", low: "#44ff88" };
const SEV_RGB: Record<string, string> = { critical: "255,68,68", high: "255,136,68", medium: "255,170,68", low: "68,255,136" };

export default function AttackSurface() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [iocs, setIocs] = useState<IOC[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [, navigate] = useLocation();

  async function load() {
    setLoading(true);
    try {
      const [assetData, iocData, evData] = await Promise.all([
        jsonRequest<{ assets: Asset[] }>("/assets"),
        jsonRequest<{ iocs: IOC[] }>("/ioc?limit=50"),
        jsonRequest<{ evidence: Evidence[] }>("/evidence?limit=20"),
      ]);
      setAssets(assetData.assets ?? []);
      setIocs(iocData.iocs ?? []);
      setEvidence(evData.evidence ?? []);
      for (const asset of (assetData.assets ?? []).slice(0, 10)) {
        if (asset.criticality === "critical" || asset.criticality === "high") {
          intel.publish({ category: "asset", severity: asset.criticality as "critical" | "high", title: `أصل حرج: ${asset.name}`, detail: `${asset.domains?.join(", ") || asset.ips?.join(", ") || "—"}`, source: "Attack Surface" });
        }
      }
    } catch { }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  function getAssetIocs(asset: Asset): IOC[] {
    const vals = [...(asset.domains ?? []), ...(asset.ips ?? [])];
    return iocs.filter(ioc => vals.some(v => ioc.value.includes(v) || v.includes(ioc.value)));
  }
  function getAssetEvidence(asset: Asset): Evidence[] {
    const vals = [...(asset.domains ?? []), ...(asset.ips ?? [])];
    return evidence.filter(ev => vals.some(v => ev.targetUrl.includes(v)));
  }

  const filteredAssets = assets.filter(a => !search || a.name.toLowerCase().includes(search.toLowerCase()) || (a.domains ?? []).some(d => d.includes(search)) || (a.ips ?? []).some(ip => ip.includes(search)));
  const critAssets = assets.filter(a => a.criticality === "critical" || a.criticality === "high");
  const assetsWithIocs = assets.filter(a => getAssetIocs(a).length > 0);
  const assetsWithEvidence = assets.filter(a => getAssetEvidence(a).length > 0);

  return (
    <div className="min-h-screen p-5 space-y-5" style={{ background: "linear-gradient(180deg,#060010 0%,#03000a 100%)" }} dir="rtl">
      <PageHeader title="⚡ Attack Surface" subtitle="رؤية كاملة لسطح الهجوم — ربط الأصول بالثغرات والمخاطر" icon={Globe} danger
        actions={<button onClick={load} className="p-1.5 rounded-xl transition-all" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}><RefreshCw className="w-4 h-4" /></button>}
      />

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "إجمالي الأصول", value: assets.length, color: "#44eebb", rgb: "68,238,187", icon: Database, page: "/assets" },
          { label: "أصول حرجة", value: critAssets.length, color: "#ff4444", rgb: "255,68,68", icon: AlertTriangle, page: "/risk-center" },
          { label: "أصول مع IOC", value: assetsWithIocs.length, color: "#ffaa44", rgb: "255,170,68", icon: Target, page: "/ioc" },
          { label: "أصول مع أدلة", value: assetsWithEvidence.length, color: "#ff8844", rgb: "255,136,68", icon: Shield, page: "/evidence" },
        ].map(({ label, value, color, rgb, icon: Icon, page }) => (
          <div key={label} onClick={() => navigate(page)} className="rounded-xl p-4 text-center cursor-pointer transition-all"
            style={{ background: `rgba(${rgb},0.06)`, border: `1px solid rgba(${rgb},0.18)`, borderRadius: 16 }}>
            <Icon className="w-5 h-5 mx-auto mb-2" style={{ color }} />
            <div className="text-2xl font-black font-mono" style={{ color, textShadow: `0 0 12px rgba(${rgb},0.5)` }}>{value}</div>
            <div className="text-[9px] font-mono mt-1" style={{ color: `rgba(${rgb},0.5)` }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Alerts for assets with IOCs */}
      {assetsWithIocs.length > 0 && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(255,30,30,0.04)", border: "1px solid rgba(255,30,30,0.2)", borderRadius: 16 }}>
          <h3 className="font-black text-sm flex items-center gap-2" style={{ color: "#ff4444" }}>
            <AlertTriangle className="w-4 h-4" />تنبيهات مرتبطة — أصول مخترقة
          </h3>
          <div className="space-y-2">
            {assetsWithIocs.map(asset => {
              const assetIocs = getAssetIocs(asset); const assetEv = getAssetEvidence(asset);
              return (
                <div key={asset.id} className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: "rgba(255,30,30,0.04)", border: "1px solid rgba(255,30,30,0.15)", borderRadius: 12 }}>
                  <Server className="w-4 h-4 shrink-0" style={{ color: "#ff4444" }} />
                  <div className="flex-1 min-w-0">
                    <span className="font-black text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>{asset.name}</span>
                    <div className="flex items-center gap-3 mt-0.5 font-mono text-[9px]">
                      {assetIocs.length > 0 && <span style={{ color: "#ffaa44" }}>{assetIocs.length} IOC مرتبط</span>}
                      {assetEv.length > 0 && <span style={{ color: "#ff8844" }}>{assetEv.length} دليل</span>}
                      <span style={{ color: "rgba(255,255,255,0.25)" }}>{(asset.domains ?? []).join(", ").slice(0, 40) || (asset.ips ?? []).join(", ")}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => navigate("/ioc")} className="text-[9px] font-black font-mono px-2 py-1 rounded-lg transition-all"
                      style={{ background: "rgba(255,170,68,0.1)", border: "1px solid rgba(255,170,68,0.2)", color: "#ffaa44" }}>IOC</button>
                    <button onClick={() => navigate("/active-scanner")} className="text-[9px] font-black font-mono px-2 py-1 rounded-lg transition-all"
                      style={{ background: "rgba(255,136,68,0.1)", border: "1px solid rgba(255,136,68,0.2)", color: "#ff8844" }}>فحص</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <Search className="w-3.5 h-3.5 shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
        <input className="bg-transparent flex-1 focus:outline-none text-xs font-mono"
          style={{ color: "rgba(255,255,255,0.7)" }}
          placeholder="بحث في الأصول بالاسم أو IP أو Domain..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Assets List */}
        <div className="lg:col-span-1 space-y-2 max-h-[600px] overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "#ff5555" }} /></div>
          ) : filteredAssets.length === 0 ? (
            <div className="rounded-2xl p-8 text-center space-y-3" style={NEON_CARD}>
              <Skull className="w-10 h-10 mx-auto" style={{ color: "rgba(255,255,255,0.05)" }} />
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>لا توجد أصول</p>
              <button onClick={() => navigate("/assets")} className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl transition-all"
                style={{ background: "rgba(255,30,30,0.08)", border: "1px solid rgba(255,30,30,0.2)", color: "#ff5555" }}>
                أضف أصولاً الآن
              </button>
            </div>
          ) : filteredAssets.map(asset => {
            const iocCount = getAssetIocs(asset).length;
            const evCount = getAssetEvidence(asset).length;
            const crit = asset.criticality;
            const color = SEV_COLOR[crit] ?? "#44ff88";
            const rgb = SEV_RGB[crit] ?? "68,255,136";
            const selected = selectedAsset?.id === asset.id;
            return (
              <div key={asset.id} onClick={() => setSelectedAsset(asset)}
                className="rounded-xl p-3.5 cursor-pointer transition-all"
                style={{ background: selected ? `rgba(${rgb},0.06)` : "rgba(8,0,18,0.8)", border: selected ? `1px solid rgba(${rgb},0.3)` : "1px solid rgba(255,255,255,0.05)", borderRadius: 14 }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-black text-[12px] truncate" style={{ color: "rgba(255,255,255,0.8)" }}>{asset.name}</span>
                      <span className="text-[8px] font-black font-mono px-1.5 py-0.5 rounded shrink-0"
                        style={{ color, background: `rgba(${rgb},0.1)`, border: `1px solid rgba(${rgb},0.25)` }}>{crit}</span>
                    </div>
                    <p className="text-[9px] font-mono truncate" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {(asset.domains ?? []).join(", ") || (asset.ips ?? []).join(", ") || "—"}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {iocCount > 0 && <span className="text-[9px] font-mono" style={{ color: "#ffaa44" }}>{iocCount} IOC</span>}
                      {evCount > 0 && <span className="text-[9px] font-mono" style={{ color: "#ff8844" }}>{evCount} دليل</span>}
                      {iocCount === 0 && evCount === 0 && <span className="text-[9px] font-mono" style={{ color: "#44ff88" }}>نظيف</span>}
                    </div>
                  </div>
                  <span className="text-[8px] font-mono" style={{ color: "rgba(255,255,255,0.25)" }}>{asset.category}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-2 space-y-4">
          {selectedAsset ? (
            <>
              <div className="rounded-2xl p-5 space-y-4" style={NEON_CARD}>
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-base" style={{ color: "rgba(255,255,255,0.8)" }}>{selectedAsset.name}</h3>
                  <div className="flex gap-2">
                    <button onClick={() => navigate("/active-scanner")} className="text-[10px] font-black font-mono px-2.5 py-1.5 rounded-xl flex items-center gap-1 transition-all"
                      style={{ background: "rgba(255,170,68,0.1)", border: "1px solid rgba(255,170,68,0.25)", color: "#ffaa44" }}>
                      <Zap className="w-3 h-3" />فحص الآن
                    </button>
                    <button onClick={() => navigate("/assets")} className="text-[10px] font-black font-mono px-2.5 py-1.5 rounded-xl flex items-center gap-1 transition-all"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.4)" }}>
                      <Database className="w-3 h-3" />تفاصيل
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-[11px] font-mono">
                  <div style={DARK} className="p-2.5 rounded-xl">
                    <span style={{ color: "rgba(255,255,255,0.3)" }}>الفئة: </span>
                    <span style={{ color: "rgba(255,255,255,0.7)" }}>{selectedAsset.category}</span>
                  </div>
                  <div style={DARK} className="p-2.5 rounded-xl">
                    <span style={{ color: "rgba(255,255,255,0.3)" }}>الأهمية: </span>
                    <span style={{ color: SEV_COLOR[selectedAsset.criticality] ?? "#888" }}>{selectedAsset.criticality}</span>
                  </div>
                  {(selectedAsset.domains ?? []).length > 0 && (
                    <div className="col-span-2 p-2.5 rounded-xl" style={DARK}>
                      <span style={{ color: "rgba(255,255,255,0.3)" }}>Domains: </span>
                      <span style={{ color: "#4488ff" }}>{selectedAsset.domains.join(", ")}</span>
                    </div>
                  )}
                  {(selectedAsset.ips ?? []).length > 0 && (
                    <div className="col-span-2 p-2.5 rounded-xl" style={DARK}>
                      <span style={{ color: "rgba(255,255,255,0.3)" }}>IPs: </span>
                      <span style={{ color: "#44eebb" }}>{selectedAsset.ips.join(", ")}</span>
                    </div>
                  )}
                  {(selectedAsset.techStack ?? []).length > 0 && (
                    <div className="col-span-2 p-2.5 rounded-xl" style={DARK}>
                      <span style={{ color: "rgba(255,255,255,0.3)" }}>Tech Stack: </span>
                      <span style={{ color: "#aa44ff" }}>{selectedAsset.techStack.join(", ")}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* IOCs */}
              {getAssetIocs(selectedAsset).length > 0 && (
                <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(255,170,68,0.04)", border: "1px solid rgba(255,170,68,0.2)", borderRadius: 16 }}>
                  <h4 className="font-black text-sm flex items-center gap-2" style={{ color: "#ffaa44" }}>
                    <Target className="w-4 h-4" />IOCs مرتبطة ({getAssetIocs(selectedAsset).length})
                  </h4>
                  <div className="space-y-1.5">
                    {getAssetIocs(selectedAsset).map(ioc => (
                      <div key={ioc.id} className="flex items-center gap-2 p-2 rounded-xl"
                        style={{ background: "rgba(255,170,68,0.05)", border: "1px solid rgba(255,170,68,0.12)", borderRadius: 10 }}>
                        <span className="text-[9px] font-black font-mono px-1 rounded"
                          style={{ color: "#ffaa44", border: "1px solid rgba(255,170,68,0.3)" }}>{ioc.iocType}</span>
                        <code className="text-[10px] font-mono flex-1 truncate" style={{ color: "rgba(255,255,255,0.6)" }}>{ioc.value}</code>
                        <span className="text-[9px] font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>{ioc.severity}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Evidence */}
              {getAssetEvidence(selectedAsset).length > 0 && (
                <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(255,136,68,0.04)", border: "1px solid rgba(255,136,68,0.2)", borderRadius: 16 }}>
                  <h4 className="font-black text-sm flex items-center gap-2" style={{ color: "#ff8844" }}>
                    <Shield className="w-4 h-4" />أدلة الفحص ({getAssetEvidence(selectedAsset).length})
                  </h4>
                  <div className="space-y-1.5">
                    {getAssetEvidence(selectedAsset).map(ev => (
                      <div key={ev.id} className="flex items-center gap-2 p-2 rounded-xl"
                        style={{ background: "rgba(255,136,68,0.05)", border: "1px solid rgba(255,136,68,0.12)", borderRadius: 10 }}>
                        <span style={{ color: SEV_COLOR[ev.severity] ?? "#888" }} className="text-[9px] font-black font-mono">{ev.severity}</span>
                        <span className="text-[10px] flex-1 truncate" style={{ color: "rgba(255,255,255,0.6)" }}>{ev.title}</span>
                        {ev.cveId && <span className="text-[9px] font-mono" style={{ color: "#ff4444" }}>{ev.cveId}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {getAssetIocs(selectedAsset).length === 0 && getAssetEvidence(selectedAsset).length === 0 && (
                <div className="rounded-2xl p-6 text-center space-y-2" style={NEON_CARD}>
                  <Shield className="w-8 h-8 mx-auto" style={{ color: "#44ff88" }} />
                  <p className="font-black text-sm font-mono" style={{ color: "#44ff88" }}>لا توجد مخاطر معروفة لهذا الأصل</p>
                  <button onClick={() => navigate("/active-scanner")} className="text-[10px] font-black font-mono px-3 py-1.5 rounded-xl mt-2 transition-all"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.35)" }}>
                    ابدأ فحصاً للتحقق
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="rounded-2xl flex items-center justify-center h-64" style={NEON_CARD}>
              <p className="font-mono text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>اختر أصلاً لرؤية سطح الهجوم المرتبط به</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
