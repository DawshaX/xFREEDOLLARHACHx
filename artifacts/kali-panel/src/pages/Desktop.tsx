import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity, AlertTriangle, Archive, BarChart2, Bell, BellRing, Bookmark,
  Bot, Brain, BrainCircuit, Briefcase, Bug, ChevronRight, ClipboardList,
  Clock, Code, Command, Cpu, Database, Eye, FileSearch, FileText,
  Fingerprint, Folder, GitBranch, Globe, Globe2, HardDrive, Hash,
  KeyRound, LayoutDashboard, LayoutGrid, Layers, Lock, Map,
  Maximize2, MemoryStick, MessageSquare, Minimize2, Monitor, Music2,
  Network, Package, PanelLeft, Radio, RotateCw, Rocket,
  ScanLine, Search, Send, Server, Settings as SettingsIcon, Shield,
  ShieldAlert, Sparkles, Star, Target, Terminal as TerminalIcon,
  TerminalSquare, TrendingUp, Users, Webhook, Wifi, Wrench, X, Zap, Eye as EyeOff,
  BookMarked, Satellite, Plus, Play, ChevronLeft, ChevronUp, ChevronDown,
  Download, Palette,
} from "lucide-react";
import OllamaStatusPanel from "@/components/desktop/OllamaStatusPanel";
import { probeOllamaViaServer, getStoredOllamaBase, getStoredOllamaModel } from "@/lib/ollama-browser";
import { DraggableWindow, type WindowState } from "@/components/desktop/DraggableWindow";
import { TaskManager } from "@/components/desktop/TaskManager";
import { KeysWindow } from "@/components/desktop/KeysWindow";
import { AgentWindow, type ClientToolEvent } from "@/components/desktop/AgentWindow";
import { BrowserWindow } from "@/components/desktop/BrowserWindow";
import { FilesWindow } from "@/components/desktop/FilesWindow";
import { LiveAgentPanel } from "@/components/desktop/LiveAgentPanel";
import { LiveAgentPanel as NovaSentinelV8V9 } from "@/components/desktop/nova-sentinel-v8-v9-supreme-final";
import { LiveAgentPanel as NovaSentinelV8 } from "@/components/desktop/nova-sentinel-v8-extreme1";
import { LiveAgentPanel as NovaSentinelV9 } from "@/components/desktop/nova-sentinel-v9-supreme-single";
import { PdfReportsWindow } from "@/components/desktop/PdfReportsWindow";
import { NodesWindow } from "@/components/desktop/NodesWindow";
import { ScannerWindow } from "@/components/desktop/ScannerWindow";
import { TerminalWindow } from "@/components/desktop/TerminalWindow";
import { GpuParticleCanvas, PerformanceMonitor } from "@/components/desktop/DesktopGpuEngine";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API_URL = (p: string) => `/api${p}`;

// ─── Session persistence ──────────────────────────────────────────────────────
const SESSION_KEY = "cybernova_desktop_session_v2";

// ─── Window Kinds ─────────────────────────────────────────────────────────────
export type WinKind =
  // Basics
  | "browser" | "terminal" | "files" | "editor" | "keys" | "settings" | "tool-terminal" | "xdaw"
  // AI
  | "agent" | "live-agent" | "agent-v3" | "agent-v6" | "kaligpt"
  | "nova-intel" | "knowledge" | "chat" | "nova-modules" | "nova-sentinel" | "module-center"
  | "nova-sentinel-v8" | "nova-sentinel-v9"
  | "reverse-evolution" | "custom-build" | "dark-ml"
  // Security
  | "security-center" | "scanner" | "vulnerability-checker" | "threat-detector"
  | "malware-scanner" | "exploit-db" | "cves" | "cve-db" | "cve-live"
  | "mitre" | "cwe" | "github-search" | "forensics-tool" | "incident-response"
  | "audit" | "compliance-checker" | "risk-assessment" | "shodan"
  | "bookmarks" | "reports" | "steganography"
  | "poc-engine" | "ethical-hacking"
  // Network
  | "network-monitor" | "network-analyzer" | "port-scanner" | "ip-tracker"
  | "dns-lookup" | "whois-lookup" | "ssl-checker" | "subdomains"
  | "web-fetch" | "firewall-config" | "intrusion-detection"
  | "wifi-analyzer" | "bandwidth-tester" | "nodes"
  // System
  | "monitor" | "dashboard" | "system-monitor" | "process-manager" | "gpu-monitor"
  | "data-center" | "backup-manager" | "disk-analyzer" | "memory-optimizer"
  | "log-analyzer" | "hash-calculator" | "encryption-tool" | "service-manager"
  | "playbooks" | "memory" | "workspaces" | "jobs" | "cron" | "webhooks"
  | "installer" | "status";

interface WinInst extends WindowState {
  kind: WinKind;
  meta?: Record<string, unknown>;
}

// ─── APPS Registry ─────────────────────────────────────────────────────────────
const APPS: Array<{
  kind: WinKind; label: string; desc: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  hue: string;
  category: "basics" | "ai" | "security" | "network" | "system";
  defaultW: number; defaultH: number;
}> = [
  // ── Basics ──────────────────────────────────────────────────────────────
  { kind: "browser",      label: "المتصفح",           desc: "تصفح الإنترنت مع دعم الأمان",          icon: Globe,         hue: "from-indigo-500/20 to-blue-500/10",    category: "basics",   defaultW: 900, defaultH: 600 },
  { kind: "terminal",     label: "الطرفية",            desc: "تنفيذ الأوامر والبرمجة النصية",        icon: TerminalIcon,  hue: "from-slate-500/20 to-zinc-500/10",     category: "basics",   defaultW: 720, defaultH: 460 },
  { kind: "files",        label: "إدارة الملفات",      desc: "استعراض وإدارة الملفات والمجلدات",      icon: Folder,        hue: "from-amber-500/20 to-yellow-500/10",   category: "basics",   defaultW: 720, defaultH: 480 },
  { kind: "editor",       label: "محرر النصوص",        desc: "تحرير الملفات والأكواد البرمجية",       icon: Code,          hue: "from-violet-500/20 to-purple-500/10",  category: "basics",   defaultW: 820, defaultH: 560 },
  { kind: "keys",         label: "مدير المفاتيح",      desc: "إدارة مفاتيح API والبيانات الحساسة",   icon: KeyRound,      hue: "from-cyan-500/20 to-teal-500/10",      category: "basics",   defaultW: 720, defaultH: 520 },
  { kind: "settings",     label: "الإعدادات",           desc: "ضبط تفضيلات النظام وإعداد Ollama",     icon: SettingsIcon,  hue: "from-gray-500/20 to-slate-500/10",     category: "basics",   defaultW: 860, defaultH: 620 },
  { kind: "tool-terminal",label: "طرفية الأدوات",      desc: "أوامر متخصصة لأدوات الأمن السيبراني",   icon: TerminalSquare,hue: "from-lime-500/20 to-green-500/10",     category: "basics",   defaultW: 720, defaultH: 460 },
  { kind: "xdaw",         label: "Nova DAW",           desc: "محطة عمل صوتية وإبداعية متقدمة",       icon: Music2,        hue: "from-pink-500/20 to-rose-500/10",      category: "basics",   defaultW: 1000,defaultH: 640 },
  // ── AI ──────────────────────────────────────────────────────────────────
  { kind: "agent",        label: "العميل الرئيسي",     desc: "نوفا روت — المتحكم الرئيسي بالنظام",   icon: Bot,           hue: "from-primary/20 to-cyan-500/10",       category: "ai",       defaultW: 800, defaultH: 600 },
  { kind: "live-agent",   label: "الوكيل الحي",        desc: "وكيل حي للتحكم الفوري والأتمتة",       icon: Zap,           hue: "from-emerald-500/20 to-teal-500/10",   category: "ai",       defaultW: 800, defaultH: 600 },
  { kind: "agent-v3",     label: "عميل V3",            desc: "الجيل الثالث من نوفا AI",               icon: BrainCircuit,  hue: "from-purple-500/20 to-fuchsia-500/10", category: "ai",       defaultW: 800, defaultH: 600 },
  { kind: "agent-v6",     label: "عميل V6",            desc: "الجيل السادس — قدرات متقدمة جداً",     icon: Sparkles,      hue: "from-violet-500/20 to-indigo-500/10",  category: "ai",       defaultW: 800, defaultH: 600 },
  { kind: "kaligpt",      label: "كالي GPT",           desc: "ذكاء اصطناعي متخصص في الأمن السيبراني", icon: Brain,         hue: "from-red-500/20 to-orange-500/10",     category: "ai",       defaultW: 800, defaultH: 600 },
  { kind: "nova-intel",   label: "نوفا إنتل",          desc: "مركز الاستخبارات الأمنية المتكامل",     icon: Satellite,     hue: "from-blue-500/20 to-cyan-500/10",      category: "ai",       defaultW: 920, defaultH: 640 },
  { kind: "knowledge",    label: "قاعدة المعرفة",      desc: "مستودع المعرفة الأمنية وRAG",           icon: BookMarked,    hue: "from-teal-500/20 to-green-500/10",     category: "ai",       defaultW: 820, defaultH: 580 },
  { kind: "chat",         label: "المحادثة",            desc: "محادثة مباشرة مع نماذج Ollama",         icon: MessageSquare, hue: "from-pink-500/20 to-rose-500/10",      category: "ai",       defaultW: 780, defaultH: 560 },
  { kind: "nova-modules", label: "وحدات نوفا",         desc: "وحدات نوفا المخصصة والقابلة للتوسع",   icon: Layers,        hue: "from-indigo-500/20 to-violet-500/10",  category: "ai",       defaultW: 860, defaultH: 580 },
  { kind: "nova-sentinel",   label: "نوفا سنتينل V8+V9", desc: "محرك البوت المدمج — V8 الشديد + V9 المتقدم",icon: Shield,        hue: "from-red-500/20 to-rose-600/10",       category: "ai",       defaultW: 920, defaultH: 640 },
  { kind: "nova-sentinel-v8",label: "سنتينل V8 الشديد",  desc: "محرك V8 الشديد — تعلم ذاتي + توقع التهديدات",icon: ShieldAlert,   hue: "from-rose-600/20 to-red-700/10",       category: "ai",       defaultW: 920, defaultH: 640 },
  { kind: "nova-sentinel-v9",label: "سنتينل V9 المتفوق",  desc: "محرك V9 المتفوق — Ollama + رؤية + ذاكرة متجهة",icon: Brain,      hue: "from-fuchsia-500/20 to-purple-600/10", category: "ai",       defaultW: 920, defaultH: 640 },
  { kind: "module-center",   label: "مركز الوحدات",      desc: "إدارة وتشغيل جميع وحدات النظام",        icon: Package,       hue: "from-orange-500/20 to-amber-500/10",   category: "ai",       defaultW: 880, defaultH: 600 },
  // ── Security ────────────────────────────────────────────────────────────
  { kind: "security-center",label: "مركز الأمن",       desc: "لوحة التحكم الأمنية المركزية",          icon: ShieldAlert,   hue: "from-red-500/20 to-rose-500/10",       category: "security", defaultW: 920, defaultH: 640 },
  { kind: "scanner",      label: "الماسح الأمني",       desc: "فحص ثغرات الشبكة والأنظمة",           icon: ScanLine,      hue: "from-red-500/20 to-orange-500/10",     category: "security", defaultW: 780, defaultH: 540 },
  { kind: "vulnerability-checker",label: "فحص الثغرات",desc: "اكتشاف وتقييم نقاط الضعف",            icon: Bug,           hue: "from-orange-500/20 to-amber-500/10",   category: "security", defaultW: 840, defaultH: 580 },
  { kind: "threat-detector",label: "كاشف التهديدات",   desc: "رصد التهديدات الأمنية لحظياً",          icon: Eye,           hue: "from-rose-500/20 to-pink-500/10",      category: "security", defaultW: 840, defaultH: 580 },
  { kind: "malware-scanner",label: "فاحص البرمجيات",   desc: "اكتشاف وتحليل البرمجيات الخبيثة",      icon: Bug,           hue: "from-red-600/20 to-rose-600/10",       category: "security", defaultW: 780, defaultH: 540 },
  { kind: "exploit-db",   label: "قاعدة الاستغلال",    desc: "قاعدة بيانات الثغرات والاستغلالات",    icon: Database,      hue: "from-red-500/20 to-red-700/10",        category: "security", defaultW: 880, defaultH: 600 },
  { kind: "cves",         label: "CVEs",               desc: "قاعدة البيانات الوطنية للثغرات NVD",   icon: ShieldAlert,   hue: "from-orange-500/20 to-red-500/10",     category: "security", defaultW: 920, defaultH: 640 },
  { kind: "cve-db",       label: "CVE مخصص",           desc: "قاعدة CVEs المحلية والمخصصة",           icon: Database,      hue: "from-red-600/20 to-orange-700/10",     category: "security", defaultW: 880, defaultH: 600 },
  { kind: "cve-live",     label: "CVE مباشر",          desc: "الثغرات الأمنية الحديثة لحظياً",        icon: Radio,         hue: "from-rose-500/20 to-red-600/10",       category: "security", defaultW: 880, defaultH: 600 },
  { kind: "mitre",        label: "MITRE ATT&CK",       desc: "إطار تكتيكات الهجوم والدفاع الإلكتروني", icon: Target,       hue: "from-red-600/20 to-rose-500/10",       category: "security", defaultW: 920, defaultH: 640 },
  { kind: "cwe",          label: "CWE",                desc: "تصنيف نقاط ضعف البرمجيات",             icon: AlertTriangle, hue: "from-amber-600/20 to-orange-500/10",   category: "security", defaultW: 880, defaultH: 600 },
  { kind: "github-search",label: "بحث GitHub",         desc: "البحث في مستودعات كود المصدر الأمني",  icon: GitBranch,     hue: "from-gray-500/20 to-slate-600/10",     category: "security", defaultW: 880, defaultH: 600 },
  { kind: "forensics-tool",label: "الطب الشرعي",       desc: "تحليل الأدلة الرقمية الجنائية",         icon: Fingerprint,   hue: "from-purple-500/20 to-indigo-500/10",  category: "security", defaultW: 840, defaultH: 580 },
  { kind: "incident-response",label: "استجابة الحوادث",desc: "إدارة الحوادث الأمنية والطوارئ",        icon: AlertTriangle, hue: "from-red-500/20 to-rose-600/10",       category: "security", defaultW: 880, defaultH: 600 },
  { kind: "audit",        label: "التدقيق الأمني",      desc: "تقييم وتدقيق السياسات والأمن",          icon: ClipboardList, hue: "from-blue-500/20 to-indigo-500/10",    category: "security", defaultW: 880, defaultH: 600 },
  { kind: "compliance-checker",label: "الامتثال",       desc: "التحقق من الامتثال للمعايير الأمنية",   icon: Star,          hue: "from-yellow-500/20 to-amber-500/10",   category: "security", defaultW: 840, defaultH: 580 },
  { kind: "risk-assessment",label: "تقييم المخاطر",     desc: "تحديد وتحليل وتقييم المخاطر",          icon: BarChart2,     hue: "from-orange-600/20 to-amber-600/10",   category: "security", defaultW: 840, defaultH: 580 },
  { kind: "shodan",       label: "Shodan",              desc: "محرك بحث الأجهزة المتصلة بالإنترنت",   icon: Globe2,        hue: "from-red-500/20 to-orange-500/10",     category: "security", defaultW: 880, defaultH: 600 },
  { kind: "bookmarks",    label: "الإشارات المرجعية",   desc: "إدارة روابط ومواقع الأمن السيبراني",   icon: Bookmark,      hue: "from-blue-500/20 to-cyan-600/10",      category: "security", defaultW: 780, defaultH: 540 },
  { kind: "reports",      label: "التقارير",            desc: "تقارير الأمن والتحليلات والإحصاءات",   icon: FileText,      hue: "from-slate-500/20 to-gray-600/10",     category: "security", defaultW: 880, defaultH: 600 },
  { kind: "steganography",label: "إخفاء البيانات",      desc: "إخفاء وكشف البيانات في الملفات",        icon: EyeOff,        hue: "from-violet-600/20 to-purple-600/10",  category: "security", defaultW: 780, defaultH: 540 },
  // ── Network ─────────────────────────────────────────────────────────────
  { kind: "network-monitor",label: "مراقب الشبكة",     desc: "مراقبة حركة الشبكة في الوقت الفعلي",   icon: Activity,      hue: "from-blue-500/20 to-cyan-500/10",      category: "network",  defaultW: 880, defaultH: 600 },
  { kind: "network-analyzer",label: "محلل الشبكة",     desc: "تحليل بروتوكولات وحزم البيانات",        icon: Network,       hue: "from-cyan-500/20 to-blue-500/10",      category: "network",  defaultW: 880, defaultH: 600 },
  { kind: "port-scanner", label: "ماسح المنافذ",        desc: "فحص المنافذ المفتوحة والخدمات",         icon: ScanLine,      hue: "from-blue-600/20 to-indigo-500/10",    category: "network",  defaultW: 780, defaultH: 540 },
  { kind: "ip-tracker",   label: "تتبع IP",             desc: "تتبع وتحليل وتحديد موقع عناوين IP",    icon: Map,           hue: "from-green-500/20 to-emerald-500/10",  category: "network",  defaultW: 780, defaultH: 540 },
  { kind: "dns-lookup",   label: "DNS Lookup",          desc: "استعلامات DNS والبحث في السجلات",       icon: Server,        hue: "from-teal-500/20 to-cyan-600/10",      category: "network",  defaultW: 780, defaultH: 540 },
  { kind: "whois-lookup", label: "WHOIS",               desc: "معلومات تسجيل النطاقات وعناوين IP",     icon: Globe,         hue: "from-blue-500/20 to-teal-500/10",      category: "network",  defaultW: 780, defaultH: 540 },
  { kind: "ssl-checker",  label: "فحص SSL",             desc: "تحليل شهادات الأمان TLS/SSL",           icon: Lock,          hue: "from-emerald-500/20 to-green-500/10",  category: "network",  defaultW: 780, defaultH: 540 },
  { kind: "subdomains",   label: "النطاقات الفرعية",    desc: "اكتشاف وتعداد النطاقات الفرعية",        icon: GitBranch,     hue: "from-purple-500/20 to-violet-500/10",  category: "network",  defaultW: 780, defaultH: 540 },
  { kind: "web-fetch",    label: "جلب الويب",           desc: "استرجاع وتحليل محتوى صفحات الويب",     icon: Globe,         hue: "from-indigo-500/20 to-blue-600/10",    category: "network",  defaultW: 880, defaultH: 600 },
  { kind: "firewall-config",label: "جدار الحماية",      desc: "إدارة قواعد جدار الحماية وإعداده",     icon: Shield,        hue: "from-orange-500/20 to-red-500/10",     category: "network",  defaultW: 840, defaultH: 580 },
  { kind: "intrusion-detection",label: "كشف التسلل",    desc: "نظام كشف التسلل والإنذار المبكر",       icon: AlertTriangle, hue: "from-red-500/20 to-orange-500/10",     category: "network",  defaultW: 880, defaultH: 600 },
  { kind: "wifi-analyzer",label: "محلل Wi-Fi",          desc: "تحليل وفحص الشبكات اللاسلكية",         icon: Wifi,          hue: "from-blue-500/20 to-indigo-500/10",    category: "network",  defaultW: 780, defaultH: 540 },
  { kind: "bandwidth-tester",label: "اختبار النطاق",    desc: "قياس سرعة الشبكة وأدائها",              icon: BarChart2,     hue: "from-cyan-500/20 to-teal-600/10",      category: "network",  defaultW: 780, defaultH: 540 },
  { kind: "nodes",        label: "خريطة الشبكة",        desc: "مخطط العقد والاتصالات البصري التفاعلي", icon: Network,       hue: "from-emerald-500/20 to-cyan-500/10",   category: "network",  defaultW: 920, defaultH: 640 },
  // ── System ──────────────────────────────────────────────────────────────
  { kind: "monitor",      label: "مراقبة النظام",       desc: "لوحة مراقبة شاملة مع تنبيهات حية",     icon: Monitor,       hue: "from-emerald-500/20 to-teal-500/10",   category: "system",   defaultW: 880, defaultH: 600 },
  { kind: "dashboard",    label: "لوحة التحكم",         desc: "نظرة عامة على حالة المنصة والأمن",      icon: LayoutDashboard,hue: "from-blue-500/20 to-indigo-500/10",   category: "system",   defaultW: 960, defaultH: 660 },
  { kind: "system-monitor",label: "أداء النظام",        desc: "CPU · RAM · قرص · شبكة لحظياً",         icon: Cpu,           hue: "from-emerald-500/20 to-green-500/10",  category: "system",   defaultW: 840, defaultH: 580 },
  { kind: "process-manager",label: "مدير العمليات",     desc: "إدارة ومراقبة عمليات النظام",           icon: Layers,        hue: "from-teal-500/20 to-cyan-600/10",      category: "system",   defaultW: 840, defaultH: 580 },
  { kind: "gpu-monitor",  label: "مراقبة GPU",          desc: "مراقبة أداء معالج الرسوميات",           icon: MemoryStick,   hue: "from-purple-500/20 to-violet-500/10",  category: "system",   defaultW: 780, defaultH: 540 },
  { kind: "data-center",  label: "مركز البيانات",       desc: "إدارة قواعد البيانات والتخزين",          icon: Database,      hue: "from-blue-600/20 to-indigo-600/10",    category: "system",   defaultW: 880, defaultH: 600 },
  { kind: "backup-manager",label: "إدارة النسخ الاحتياطية",desc: "نسخ احتياطي واستعادة البيانات",      icon: Archive,       hue: "from-amber-500/20 to-orange-500/10",   category: "system",   defaultW: 800, defaultH: 560 },
  { kind: "disk-analyzer",label: "محلل القرص",          desc: "تحليل استخدام مساحة التخزين",           icon: HardDrive,     hue: "from-slate-500/20 to-gray-600/10",     category: "system",   defaultW: 800, defaultH: 560 },
  { kind: "memory-optimizer",label: "محسّن الذاكرة",    desc: "تحسين وإدارة ذاكرة الوصول العشوائي",    icon: MemoryStick,   hue: "from-blue-500/20 to-cyan-600/10",      category: "system",   defaultW: 800, defaultH: 560 },
  { kind: "log-analyzer", label: "محلل السجلات",        desc: "تحليل وفلترة سجلات النظام",              icon: FileSearch,    hue: "from-gray-500/20 to-slate-600/10",     category: "system",   defaultW: 840, defaultH: 580 },
  { kind: "hash-calculator",label: "حاسب Hash",         desc: "حساب وتحقق من بصمات الملفات",           icon: Hash,          hue: "from-violet-500/20 to-purple-500/10",  category: "system",   defaultW: 780, defaultH: 540 },
  { kind: "encryption-tool",label: "التشفير",           desc: "أدوات تشفير وفك تشفير البيانات",         icon: Lock,          hue: "from-emerald-600/20 to-teal-600/10",   category: "system",   defaultW: 780, defaultH: 540 },
  { kind: "service-manager",label: "مدير الخدمات",      desc: "التحكم في خدمات النظام وتشغيلها",       icon: Server,        hue: "from-cyan-600/20 to-blue-600/10",      category: "system",   defaultW: 820, defaultH: 560 },
  { kind: "playbooks",    label: "قواعد اللعب",         desc: "إدارة وتشغيل قواعد الأتمتة الأمنية",   icon: ClipboardList, hue: "from-orange-500/20 to-amber-500/10",   category: "system",   defaultW: 840, defaultH: 580 },
  { kind: "memory",       label: "ذاكرة الوكيل",        desc: "مستودع الذاكرة طويلة الأمد للوكيل",     icon: BrainCircuit,  hue: "from-violet-600/20 to-purple-600/10",  category: "system",   defaultW: 820, defaultH: 560 },
  { kind: "workspaces",   label: "مساحات العمل",        desc: "إدارة والتنقل بين مساحات العمل",         icon: LayoutGrid,    hue: "from-indigo-500/20 to-blue-600/10",    category: "system",   defaultW: 840, defaultH: 580 },
  { kind: "jobs",         label: "الوظائف",             desc: "جدول المهام والوظائف المجدولة",          icon: Briefcase,     hue: "from-teal-500/20 to-green-500/10",     category: "system",   defaultW: 800, defaultH: 560 },
  { kind: "cron",         label: "المهام الدورية",       desc: "إدارة المهام الدورية والمجدولة",         icon: Clock,         hue: "from-blue-600/20 to-indigo-600/10",    category: "system",   defaultW: 820, defaultH: 560 },
  { kind: "webhooks",     label: "Webhooks",            desc: "إدارة نقاط ربط الأحداث الخارجية",       icon: Webhook,       hue: "from-purple-500/20 to-violet-600/10",  category: "system",   defaultW: 820, defaultH: 560 },
  { kind: "installer",    label: "المثبِّت",             desc: "تثبيت وإدارة وحدات وأدوات النظام",      icon: Package,       hue: "from-emerald-500/20 to-teal-500/10",   category: "system",   defaultW: 840, defaultH: 580 },
  { kind: "status",       label: "حالة الخدمات",        desc: "مراقبة حالة جميع خدمات المنصة",         icon: Activity,      hue: "from-green-500/20 to-emerald-500/10",  category: "system",   defaultW: 840, defaultH: 580 },
  // ── NEW: AI Evolution ────────────────────────────────────────────────────
  { kind: "reverse-evolution", label: "التطور العكسي",  desc: "اختبر الإصدارات القديمة ضد هجمات حديثة — للأغراض التعليمية", icon: RotateCw,      hue: "from-violet-600/20 to-indigo-600/10",  category: "ai",       defaultW: 860, defaultH: 620 },
  { kind: "custom-build",      label: "بناء AI مخصص",   desc: "ادمج ميزات من إصدارات مختلفة في إصدار باسمك الخاص",         icon: Layers,        hue: "from-fuchsia-500/20 to-pink-600/10",   category: "ai",       defaultW: 900, defaultH: 640 },
  { kind: "dark-ml",           label: "التعلم المظلم",   desc: "Dark Adaptive ML — محاكاة سلوك المخترقين مع تحديث أسبوعي",  icon: BrainCircuit,  hue: "from-rose-600/20 to-red-800/10",       category: "ai",       defaultW: 860, defaultH: 620 },
  // ── NEW: Pentest Arsenal ─────────────────────────────────────────────────
  { kind: "poc-engine",        label: "محرك الإثبات",   desc: "AI يحلل الثغرة فوراً ويولّد Proof-of-Concept تلقائياً",      icon: Rocket,        hue: "from-orange-500/20 to-red-600/10",     category: "security", defaultW: 920, defaultH: 660 },
  { kind: "ethical-hacking",   label: "ترسانة البنتست", desc: "Ethical Hacking Edition — كل أدوات الاختراق في مكان واحد",   icon: Target,        hue: "from-red-600/20 to-rose-700/10",       category: "security", defaultW: 980, defaultH: 700 },
];

// ─── Desktop Folders ──────────────────────────────────────────────────────────
const DESKTOP_FOLDERS: Array<{
  name: string; icon: React.ComponentType<{ className?: string }>;
  color: string; bg: string; apps: WinKind[];
}> = [
  { name: "AI",       icon: Bot,        color: "text-violet-400", bg: "bg-violet-500/15 border-violet-400/30", apps: ["agent","live-agent","agent-v3","agent-v6","kaligpt","nova-intel","knowledge","chat","nova-modules","nova-sentinel","nova-sentinel-v8","nova-sentinel-v9","module-center","reverse-evolution","custom-build","dark-ml"] },
  { name: "Security", icon: Shield,     color: "text-red-400",    bg: "bg-red-500/15 border-red-400/30",       apps: ["security-center","scanner","vulnerability-checker","threat-detector","malware-scanner","exploit-db","cves","cve-db","cve-live","forensics-tool","incident-response","audit","compliance-checker","risk-assessment","poc-engine","ethical-hacking"] },
  { name: "Intel",    icon: ShieldAlert,color: "text-rose-400",   bg: "bg-rose-500/15 border-rose-400/30",     apps: ["mitre","cwe","shodan","github-search","bookmarks","reports","steganography"] },
  { name: "Network",  icon: Network,    color: "text-green-400",  bg: "bg-green-500/15 border-green-400/30",   apps: ["nodes","network-monitor","network-analyzer","port-scanner","ip-tracker","dns-lookup","whois-lookup","ssl-checker","subdomains","web-fetch","firewall-config","intrusion-detection","wifi-analyzer","bandwidth-tester"] },
  { name: "System",   icon: Cpu,        color: "text-blue-400",   bg: "bg-blue-500/15 border-blue-400/30",     apps: ["monitor","dashboard","system-monitor","process-manager","gpu-monitor","data-center","backup-manager","disk-analyzer","memory-optimizer","log-analyzer","service-manager","status"] },
  { name: "Tools",    icon: Wrench,     color: "text-orange-400", bg: "bg-orange-500/15 border-orange-400/30", apps: ["hash-calculator","encryption-tool","tool-terminal","keys","editor","xdaw","playbooks","installer","workspaces","webhooks","cron","jobs","memory"] },
  { name: "Files",    icon: Folder,     color: "text-amber-400",  bg: "bg-amber-500/15 border-amber-400/30",   apps: ["files","backup-manager","log-analyzer","reports","data-center"] },
  { name: "Browser",  icon: Globe,      color: "text-cyan-400",   bg: "bg-cyan-500/15 border-cyan-400/30",     apps: ["browser","shodan","github-search","web-fetch","exploit-db","cves"] },
  { name: "Basics",   icon: LayoutGrid, color: "text-emerald-400",bg: "bg-emerald-500/15 border-emerald-400/30",apps: ["browser","terminal","files","editor","keys","settings","tool-terminal"] },
  { name: "Pentest",  icon: Target,     color: "text-red-300",    bg: "bg-red-600/15 border-red-500/30",       apps: ["poc-engine","ethical-hacking","exploit-db","cve-live","scanner","subdomains","port-scanner","mitre","github-search","audit"] },
];

const QUICK_TIPS = [
  { id: "dashboard",       title: "DASHBOARD",   desc: "لوحة المراقبة الحية",         icon: Activity,    hue: "from-emerald-500/15 to-cyan-500/5 border-emerald-400/30 text-emerald-300",   kind: "dashboard"       as WinKind },
  { id: "terminal",        title: "TERMINAL",    desc: "الطرفية ونفّذ أوامراً",        icon: TerminalIcon,hue: "from-cyan-500/15 to-sky-500/5 border-cyan-400/30 text-cyan-300",             kind: "terminal"        as WinKind },
  { id: "browser",         title: "BROWSER",     desc: "تصفح الإنترنت والمواقع",       icon: Globe,       hue: "from-indigo-500/15 to-blue-500/5 border-indigo-400/30 text-indigo-300",     kind: "browser"         as WinKind },
  { id: "agent",           title: "AI AGENT",    desc: "ابدأ recon مع نوفا AI",         icon: Sparkles,    hue: "from-fuchsia-500/15 to-purple-500/5 border-fuchsia-400/30 text-fuchsia-300", kind: "agent"           as WinKind },
  { id: "poc-engine",      title: "PoC ENGINE",  desc: "توليد Proof-of-Concept تلقائي", icon: Rocket,      hue: "from-orange-500/15 to-red-500/5 border-orange-400/30 text-orange-300",       kind: "poc-engine"      as WinKind },
  { id: "ethical-hacking", title: "PENTEST",     desc: "ترسانة الاختراق الأخلاقي",     icon: Target,      hue: "from-red-600/15 to-rose-500/5 border-red-500/30 text-red-300",               kind: "ethical-hacking" as WinKind },
];

// ─── Z-counter + cascade tracker ──────────────────────────────────────────────
let zCounter = 10;
let cascadeIdx = 0;

function newInst(kind: WinKind, meta?: Record<string, unknown>): WinInst {
  const app = APPS.find((a) => a.kind === kind) ?? APPS[0];
  zCounter += 1;
  const W = typeof window !== "undefined" ? window.innerWidth  : 1280;
  const H = typeof window !== "undefined" ? window.innerHeight : 720;
  const w = Math.min(app.defaultW, W - 140);
  const h = Math.min(app.defaultH, H - 130);
  // Cascade from left, 28px offset per window, max 10 steps before wrapping
  const step   = 28;
  const maxCas = 10;
  const off    = (cascadeIdx % maxCas) * step;
  cascadeIdx++;
  // Start at left (after sidebar ~60px) with cascade offset
  const x = Math.min(70 + off, W - w - 20);
  const y = Math.min(58 + off, H - h - 70);
  return {
    id: `${kind}-${Date.now()}`,
    kind, title: app.label,
    x, y, w, h,
    z: zCounter,
    minimized: false, maximized: false, meta,
  };
}

// ─── PageWin — iframe helper ──────────────────────────────────────────────────
function PageWin({ path, title }: { path: string; title: string }) {
  return (
    <iframe
      src={`${BASE}${path}`}
      className="w-full h-full border-0 bg-[#080808]"
      title={title}
      allow="clipboard-read; clipboard-write"
    />
  );
}

// ─── Inline MonitorWin ────────────────────────────────────────────────────────
function MonitorWin() {
  const [m, setM] = useState({ cpu: 25, ram: 42, disk: 58, net: 12 });
  useEffect(() => {
    const t = setInterval(() => setM({
      cpu:  25 + Math.random() * 40,
      ram:  38 + Math.random() * 30,
      disk: 50 + Math.random() * 20,
      net:  5  + Math.random() * 30,
    }), 1500);
    return () => clearInterval(t);
  }, []);
  const bar = (v: number, color: string) => (
    <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${v}%`, background: color }} />
    </div>
  );
  return (
    <div className="p-4 grid grid-cols-2 gap-4 bg-[#080808] h-full">
      {([
        ["CPU",  m.cpu,  "#00d4ff"],
        ["RAM",  m.ram,  "#a855f7"],
        ["DISK", m.disk, "#22d3ee"],
        ["NET",  m.net,  "#10b981"],
      ] as [string, number, string][]).map(([l, v, c]) => (
        <div key={l} className="bg-white/3 border border-white/8 rounded-xl p-4 space-y-2.5">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-white/40">{l}</span>
            <span className="font-bold" style={{ color: c }}>{v.toFixed(0)}%</span>
          </div>
          {bar(v, c)}
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: c }} />
            <span className="text-[9px] text-white/30 font-mono">Active</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── DraggableDesktopIcon ──────────────────────────────────────────────────────
interface IconPos { x: number; y: number }

const CAT_COLORS: Record<string, { hex: string; rgb: string }> = {
  basics:   { hex: "#44eebb", rgb: "68,238,187" },
  ai:       { hex: "#aa44ff", rgb: "170,68,255" },
  security: { hex: "#ff5555", rgb: "255,85,85" },
  network:  { hex: "#4488ff", rgb: "68,136,255" },
  system:   { hex: "#44ff88", rgb: "68,255,136" },
};

function DraggableDesktopIcon({
  app, pos, onMove, onOpen, isRunning, isFavorite, onToggleFavorite, cveBadge,
}: {
  app: typeof APPS[number];
  pos: IconPos;
  onMove: (x: number, y: number) => void;
  onOpen: () => void;
  isRunning: boolean;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  cveBadge?: number;
}) {
  const [hover, setHover] = useState(false);
  const drag = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false });
  const cat   = CAT_COLORS[app.category] ?? { hex: "#888", rgb: "136,136,136" };

  const onPtrDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { active: true, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
  };
  const onPtrMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d.active) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    onMove(Math.max(0, d.ox + dx), Math.max(0, d.oy + dy));
  };
  const onPtrUp = (e: React.PointerEvent) => {
    const d = drag.current; if (!d.active) return;
    d.active = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d.moved) onOpen();
  };

  const glowStrong = `0 0 0 1px rgba(${cat.rgb},0.25), 0 0 12px rgba(${cat.rgb},0.4), 0 0 32px rgba(${cat.rgb},0.2)`;
  const glowSoft   = `0 0 6px rgba(${cat.rgb},0.15)`;
  const runningRing = isRunning ? `0 0 0 2px rgba(${cat.rgb},0.5), 0 0 16px rgba(${cat.rgb},0.4)` : "";

  return (
    <div
      onPointerDown={onPtrDown}
      onPointerMove={onPtrMove}
      onPointerUp={onPtrUp}
      onPointerCancel={onPtrUp}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: "absolute", left: pos.x, top: pos.y,
        width: 76, textAlign: "center",
        cursor: drag.current.active ? "grabbing" : "grab",
        zIndex: drag.current.active ? 800 : 5,
        userSelect: "none", touchAction: "none",
        filter: hover ? `drop-shadow(0 0 10px rgba(${cat.rgb},0.5))` : "none",
        transition: "filter 0.2s",
      }}
    >
      {/* Outer glow ring on hover/running */}
      {(hover || isRunning) && (
        <div style={{
          position: "absolute", inset: -3, borderRadius: 22, pointerEvents: "none",
          border: `1px solid rgba(${cat.rgb},${isRunning ? "0.5" : "0.35"})`,
          boxShadow: `0 0 0 1px rgba(${cat.rgb},0.12), 0 0 18px rgba(${cat.rgb},${isRunning ? "0.3" : "0.18"})`,
          zIndex: -1,
        }} />
      )}
      {/* Icon container */}
      <div style={{
        position: "relative",
        width: 60, height: 60, margin: "0 auto",
        borderRadius: 20,
        background: hover
          ? `linear-gradient(140deg, rgba(${cat.rgb},0.22) 0%, rgba(${cat.rgb},0.10) 100%)`
          : isRunning
          ? `linear-gradient(140deg, rgba(${cat.rgb},0.18) 0%, rgba(${cat.rgb},0.08) 100%)`
          : `linear-gradient(140deg, rgba(${cat.rgb},0.10) 0%, rgba(4,5,16,0.8) 100%)`,
        border: `1px solid rgba(${cat.rgb},${hover ? "0.55" : isRunning ? "0.40" : "0.18"})`,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: hover ? glowStrong : isRunning ? runningRing : glowSoft,
        transform: hover ? "scale(1.12) translateY(-4px)" : "scale(1)",
        transition: "all 0.2s cubic-bezier(0.34,1.56,0.64,1)",
        willChange: "transform",
        backdropFilter: "blur(12px) saturate(140%)",
      }}>
        {/* Top-left corner accent */}
        <div style={{
          position: "absolute", top: 3, left: 3,
          width: 10, height: 10, borderRadius: "50%",
          background: `radial-gradient(circle, rgba(${cat.rgb},0.5), transparent 70%)`,
          pointerEvents: "none",
        }} />
        {/* Inner shimmer on hover */}
        {hover && (
          <div style={{
            position: "absolute", inset: 0, borderRadius: 20,
            background: `radial-gradient(circle at 28% 28%, rgba(${cat.rgb},0.25), transparent 65%)`,
            pointerEvents: "none",
          }} />
        )}
        {/* Category indicator stripe */}
        <div style={{
          position: "absolute", top: 0, left: "20%", right: "20%", height: 2,
          borderRadius: "0 0 3px 3px",
          background: `linear-gradient(90deg, transparent, rgba(${cat.rgb},${hover ? "0.9" : isRunning ? "0.7" : "0.35"}), transparent)`,
          pointerEvents: "none",
        }} />
        <app.icon style={{
          width: 28, height: 28, color: cat.hex,
          filter: hover
            ? `drop-shadow(0 0 6px ${cat.hex}) drop-shadow(0 0 12px rgba(${cat.rgb},0.4))`
            : isRunning
            ? `drop-shadow(0 0 4px ${cat.hex})`
            : "none",
          transition: "filter 0.15s",
        }} />
        {/* Running indicator dot */}
        {isRunning && (
          <div style={{
            position: "absolute", bottom: 5, width: "100%", display: "flex", justifyContent: "center", gap: 3,
            pointerEvents: "none",
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#44ff88", boxShadow: "0 0 8px #44ff88, 0 0 14px #44ff8860", animation: "pulse 1.8s ease-in-out infinite" }} />
          </div>
        )}
        {/* CVE badge — shows critical count on security/cve icons */}
        {cveBadge !== undefined && cveBadge > 0 && (
          <div style={{
            position: "absolute", top: -4, right: -4,
            minWidth: 16, height: 16, borderRadius: 8,
            background: "linear-gradient(135deg,#ef4444,#dc2626)",
            border: "1.5px solid rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "0 3px",
            fontFamily: "monospace", fontSize: 7, fontWeight: 900, color: "#fff",
            boxShadow: "0 0 8px rgba(239,68,68,0.6), 0 0 16px rgba(239,68,68,0.3)",
            zIndex: 10, pointerEvents: "none",
          }}>
            {cveBadge > 999 ? "999+" : cveBadge}
          </div>
        )}
        {/* Favorite star — show on hover */}
        {hover && onToggleFavorite && (
          <button
            onClick={e => { e.stopPropagation(); onToggleFavorite(); }}
            onPointerDown={e => e.stopPropagation()}
            style={{
              position: "absolute", top: -5, left: -5,
              width: 16, height: 16, borderRadius: 6,
              background: isFavorite ? "rgba(250,204,21,0.25)" : "rgba(0,0,0,0.6)",
              border: `1px solid ${isFavorite ? "rgba(250,204,21,0.5)" : "rgba(255,255,255,0.15)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", zIndex: 20, padding: 0,
              boxShadow: isFavorite ? "0 0 6px rgba(250,204,21,0.4)" : "none",
              transition: "all 0.15s",
            }}>
            <Star style={{ width: 9, height: 9, color: isFavorite ? "#fbbf24" : "rgba(255,255,255,0.4)", fill: isFavorite ? "#fbbf24" : "none" }} />
          </button>
        )}
        {/* Persistent favorite indicator when not hovering */}
        {isFavorite && !hover && (
          <div style={{
            position: "absolute", top: -3, left: -3,
            width: 12, height: 12, borderRadius: 4,
            background: "rgba(251,191,36,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none", zIndex: 10,
          }}>
            <Star style={{ width: 7, height: 7, color: "#fbbf24", fill: "#fbbf24" }} />
          </div>
        )}
        {/* Hover tooltip */}
        {hover && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 8px)", left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(3,4,15,0.95)",
            border: `1px solid rgba(${cat.rgb},0.35)`,
            borderRadius: 9, padding: "4px 10px",
            fontSize: 9, fontFamily: "monospace", fontWeight: 900,
            color: cat.hex, whiteSpace: "nowrap",
            boxShadow: `0 6px 20px rgba(0,0,0,0.7), 0 0 12px rgba(${cat.rgb},0.15)`,
            pointerEvents: "none", zIndex: 1000,
            letterSpacing: "0.06em",
          }}>
            {app.label}
            {/* Arrow */}
            <div style={{ position: "absolute", bottom: -5, left: "50%", transform: "translateX(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: `5px solid rgba(${cat.rgb},0.35)` }} />
          </div>
        )}
      </div>
      {/* Label */}
      <div style={{
        marginTop: 6, fontSize: 9, fontFamily: "monospace", fontWeight: 900,
        color: hover ? cat.hex : isRunning ? `rgba(${cat.rgb},0.85)` : "rgba(255,255,255,0.38)",
        textShadow: hover ? `0 0 10px ${cat.hex}` : isRunning ? `0 0 6px rgba(${cat.rgb},0.5)` : "none",
        lineHeight: 1.3, padding: "2px 4px",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        transition: "color 0.15s, text-shadow 0.15s",
        letterSpacing: "0.02em",
        background: hover ? `rgba(${cat.rgb},0.08)` : "transparent",
        borderRadius: 6,
      }}>
        {app.label}
      </div>
    </div>
  );
}

// ─── ParticleCanvas (now GPU-powered via WebGL) ───────────────────────────────
// Keeping name for compatibility — wraps GpuParticleCanvas
function ParticleCanvas() {
  return <GpuParticleCanvas color="0,212,255" speed={0.35} connectionDist={110} />;
}

// ─── DesktopFoldersSidebar ────────────────────────────────────────────────────
function DesktopFoldersSidebar({ openWindow, wins, setWins, showTaskManager, setShowTaskManager }: {
  openWindow: (k: WinKind) => void;
  wins: WinInst[]; setWins: React.Dispatch<React.SetStateAction<WinInst[]>>;
  showTaskManager: boolean; setShowTaskManager: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [pos, setPos] = useState({ x: 8, y: 120 });
  const [dragging, setDragging] = useState(false);
  const [popupTop, setPopupTop] = useState(120);
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault(); setDragging(true);
    const sx = e.clientX, sy = e.clientY, sl = pos.x, st = pos.y;
    const onMove = (ev: MouseEvent) => setPos({ x: Math.max(0, Math.min(window.innerWidth - 100, sl + ev.clientX - sx)), y: Math.max(60, Math.min(window.innerHeight - 200, st + ev.clientY - sy)) });
    const onUp = () => { setDragging(false); window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  };

  const handleExpand = (name: string) => {
    if (expanded === name) { setExpanded(null); return; }
    const btn = btnRefs.current[name];
    if (btn) setPopupTop(btn.getBoundingClientRect().top);
    setExpanded(name);
  };

  if (hidden) return (
    <button onClick={() => setHidden(false)} className="fixed left-3 top-16 z-40 w-10 h-10 rounded-xl bg-emerald-500/20 backdrop-blur-xl border border-emerald-400/30 flex items-center justify-center hover:bg-emerald-500/30 transition-all shadow-lg" title="إظهار الشريط">
      <PanelLeft className="w-5 h-5 text-emerald-400" />
    </button>
  );

  return (
    <>
      <div
        className={`fixed z-40 ${dragging ? "duration-0" : "duration-300"} ${collapsed ? "w-12" : "w-16"} bg-emerald-950/60 backdrop-blur-xl border border-emerald-400/25 rounded-2xl flex flex-col items-center py-3 gap-1.5 shadow-[4px_0_24px_rgba(0,200,100,0.12)] transition-all`}
        style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
      >
        <div className="flex items-center gap-1 mb-1">
          <div onMouseDown={startDrag} className="w-6 h-6 rounded-md bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 cursor-grab" title="سحب">
            <ChevronRight className="w-3 h-3 text-white/40" />
          </div>
          <button onClick={() => setCollapsed(!collapsed)} className="w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center hover:bg-emerald-500/25 transition-all">
            <PanelLeft className={`w-3 h-3 text-emerald-400 transition-transform duration-300 ${collapsed ? "rotate-180" : ""}`} />
          </button>
          <button onClick={() => setHidden(true)} className="w-6 h-6 rounded-md bg-rose-500/10 border border-rose-400/20 flex items-center justify-center hover:bg-rose-500/20 transition-all">
            <X className="w-3 h-3 text-rose-400" />
          </button>
        </div>
        <div className="w-8 h-px bg-gradient-to-r from-transparent via-emerald-400/30 to-transparent" />

        {DESKTOP_FOLDERS.map((folder) => {
          const Icon = folder.icon;
          const isOpen = expanded === folder.name;
          const running = folder.apps.filter((k) => wins.some((w) => w.kind === k)).length;
          return (
            <div key={folder.name} className="relative w-full flex flex-col items-center">
              <button
                ref={(el) => { btnRefs.current[folder.name] = el; }}
                onClick={() => handleExpand(folder.name)}
                className={`relative ${collapsed ? "w-9 h-9" : "w-12 h-12"} rounded-xl flex items-center justify-center transition-all duration-200 group ${isOpen ? `${folder.bg} shadow-lg scale-110` : "hover:bg-primary/10 border border-transparent hover:border-primary/30"}`}
                title={folder.name}
              >
                <Icon className={`${collapsed ? "w-4 h-4" : "w-6 h-6"} ${folder.color} transition-transform group-hover:scale-110`} />
                {running > 0 && <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-emerald-400 text-[7px] text-white font-bold ring-1 ring-card">{running}</span>}
                {isOpen && <span className="absolute -right-0.5 top-1/2 -translate-y-1/2 w-1 h-6 rounded-full bg-primary" />}
              </button>
              {!collapsed && <span className={`text-[8px] mt-0.5 truncate w-full text-center px-0.5 ${isOpen ? "text-primary font-bold" : "text-white/30"}`}>{folder.name}</span>}
              {isOpen && <div className="fixed inset-0 z-40" onClick={() => setExpanded(null)} />}
            </div>
          );
        })}

        <div className="w-8 h-px bg-gradient-to-r from-transparent via-emerald-400/30 to-transparent" />
        <button onClick={() => setShowTaskManager(!showTaskManager)}
          className={`relative ${collapsed ? "w-9 h-9" : "w-12 h-12"} rounded-xl flex items-center justify-center transition-all group ${showTaskManager ? "bg-primary/20 border border-primary/40" : "hover:bg-primary/10 border border-transparent hover:border-primary/30"}`} title="Task Manager">
          <Activity className={`${collapsed ? "w-4 h-4" : "w-6 h-6"} text-cyan-400 group-hover:scale-110 transition-transform`} />
          {wins.length > 0 && <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-cyan-400 text-[7px] text-white font-bold ring-1 ring-card">{wins.length}</span>}
        </button>
        {wins.length > 0 && (
          <button onClick={() => setWins([])}
            className={`${collapsed ? "w-9 h-9" : "w-12 h-12"} rounded-xl flex items-center justify-center bg-rose-500/20 border border-rose-400/30 hover:bg-rose-500/30 transition-all group`} title="إغلاق الكل">
            <X className={`${collapsed ? "w-3.5 h-3.5" : "w-4 h-4"} text-rose-400 group-hover:scale-110 transition-transform`} />
          </button>
        )}
      </div>

      {expanded && (() => {
        const folder = DESKTOP_FOLDERS.find((f) => f.name === expanded);
        if (!folder) return null;
        const Icon = folder.icon;
        return (
          <div className="fixed z-50 w-76 bg-card/98 backdrop-blur-2xl border border-primary/30 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.7)] overflow-hidden"
            style={{ top: Math.max(48, Math.min(popupTop - 20, window.innerHeight - 500)), left: collapsed ? 56 : 72 }}>
            <div className={`px-4 py-3 ${folder.bg} border-b border-primary/20 flex items-center justify-between`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-card/60 backdrop-blur flex items-center justify-center"><Icon className={`w-5 h-5 ${folder.color}`} /></div>
                <div><span className="text-sm font-bold block">{folder.name}</span><span className="text-[10px] text-white/40">{folder.apps.length} أدوات</span></div>
              </div>
              <button onClick={() => setExpanded(null)} className="w-7 h-7 rounded-lg hover:bg-rose-500/20 flex items-center justify-center"><X className="w-4 h-4 text-rose-400" /></button>
            </div>
            <div className="p-2 space-y-0.5 max-h-[60vh] overflow-y-auto">
              {folder.apps.map((kind) => {
                const app = APPS.find((a) => a.kind === kind); if (!app) return null;
                const AppIcon = app.icon;
                const isRunning = wins.some((w) => w.kind === kind);
                return (
                  <button key={kind} onClick={() => { openWindow(kind); setExpanded(null); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-primary/10 transition-all text-left group/item border border-transparent hover:border-primary/20">
                    <div className={`w-8 h-8 rounded-lg ${isRunning ? "bg-primary/20 border border-primary/30" : "bg-white/5 border border-white/10"} flex items-center justify-center`}>
                      <AppIcon className={`w-4 h-4 ${isRunning ? "text-primary" : "text-white/40 group-hover/item:text-primary"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-medium block truncate">{app.label}</span>
                      <span className="text-[10px] text-white/30 block truncate">{app.desc}</span>
                    </div>
                    {isRunning && <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse" />}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}
    </>
  );
}

// ─── Ollama Status Mini Panel (inline in header) ────────────────────────────
function OllamaStatusMiniPanel() {
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<"unknown" | "ok" | "cors" | "error">("unknown");
  const [model, setModel] = useState(getStoredOllamaModel());

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const result = await probeOllamaViaServer();
      if (active) {
        setStatus(result.connected ? "ok" : result.runningButNoCors ? "cors" : "error");
        setModel(getStoredOllamaModel());
      }
    };
    void tick(); const t = setInterval(tick, 30000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const color = status === "ok" ? "#00ffb4" : status === "cors" ? "#ffc800" : "#ff5555";
  const bg = status === "ok" ? "rgba(0,255,180,0.08)" : status === "cors" ? "rgba(255,200,0,0.08)" : "rgba(255,85,85,0.08)";
  const border = status === "ok" ? "rgba(0,255,180,0.2)" : status === "cors" ? "rgba(255,200,0,0.2)" : "rgba(255,85,85,0.2)";

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setExpanded(v => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "4px 8px", borderRadius: 8,
          background: bg, border: `1px solid ${border}`,
          cursor: "pointer", transition: "all 0.12s",
        }}
      >
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 4px ${color}` }} />
        <span style={{ fontFamily: "monospace", fontSize: 8, fontWeight: 900, color }}>{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0,
          background: "rgba(4,5,16,0.95)", border: `1px solid ${border}`,
          borderRadius: 8, padding: "6px 8px", minWidth: 160, zIndex: 2000,
          boxShadow: `0 4px 12px rgba(0,0,0,0.8)`,
        }}>
          <div style={{ fontFamily: "monospace", fontSize: 8, fontWeight: 900, color, marginBottom: 3 }}>OLLAMA</div>
          <div style={{ fontFamily: "monospace", fontSize: 7, color }}>
            {status === "ok" ? "✓ جاهز" : status === "cors" ? "⚠ CORS مطلوب" : "✗ غير شغّال"}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 7, color: "rgba(255,255,255,0.3)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model}</div>
          {status === "cors" && (
            <div style={{ fontFamily: "monospace", fontSize: 6.5, color: "#ffc800", marginTop: 4, lineHeight: 1.5, userSelect: "text", direction: "ltr" }}>
              OLLAMA_ORIGINS="*" ollama serve
            </div>
          )}
          {status === "error" && (
            <div style={{ fontFamily: "monospace", fontSize: 6.5, color: "rgba(255,85,85,0.7)", marginTop: 4, lineHeight: 1.5 }}>
              شغّل: ollama serve
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Ollama Engine Widget (bottom-right) ──────────────────────────────────────
function OllamaEnginePanel({ onSettings }: { onSettings: () => void }) {
  const [available, setAvailable] = useState(false);
  const [model, setModel] = useState(getStoredOllamaModel());
  const [loading, setLoading] = useState(true);
  const [panelPos, setPanelPos] = useState<{ x: number; y: number } | null>(null);
  const [minimized, setMinimized] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const dragRef = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0 });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPanelPos({ x: window.innerWidth - 234, y: window.innerHeight - 170 });
  }, []);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const result = await probeOllamaViaServer();
      if (active) {
        setAvailable(result.connected);
        setModel(getStoredOllamaModel());
        setLoading(false);
      }
    };
    void tick(); const t = setInterval(tick, 30000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const onHdrDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = panelPos ?? { x: window.innerWidth - 234, y: window.innerHeight - 170 };
    dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
  };
  const onHdrMove = (e: React.PointerEvent) => {
    const d = dragRef.current; if (!d.active) return;
    const nx = Math.max(0, Math.min(window.innerWidth - 220, d.ox + (e.clientX - d.sx)));
    const ny = Math.max(46, Math.min(window.innerHeight - 60, d.oy + (e.clientY - d.sy)));
    setPanelPos({ x: nx, y: ny });
  };
  const onHdrUp = (e: React.PointerEvent) => {
    dragRef.current.active = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  if (!panelPos) return null;

  return (
    <div ref={panelRef} style={{
      position: "fixed", left: panelPos.x, top: panelPos.y,
      zIndex: 900, width: 218,
      background: "rgba(4,5,16,0.95)",
      border: `1px solid ${available ? "rgba(0,255,180,0.3)" : "rgba(255,85,85,0.25)"}`,
      borderRadius: 14,
      backdropFilter: "blur(24px) saturate(160%)",
      boxShadow: `0 0 30px ${available ? "rgba(0,255,180,0.08)" : "rgba(255,85,85,0.06)"}, 0 12px 40px rgba(0,0,0,0.7)`,
      overflow: "hidden",
      transition: "border-color 0.3s, box-shadow 0.3s",
    }}>
      {/* Title bar (draggable) */}
      <div
        onPointerDown={onHdrDown} onPointerMove={onHdrMove} onPointerUp={onHdrUp} onPointerCancel={onHdrUp}
        style={{
          padding: "7px 10px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          background: `linear-gradient(90deg, ${available ? "rgba(0,255,180,0.06)" : "rgba(255,85,85,0.06)"}, transparent)`,
          borderBottom: `1px solid ${available ? "rgba(0,255,180,0.1)" : "rgba(255,85,85,0.1)"}`,
          cursor: "grab", userSelect: "none", touchAction: "none",
        }}
        className="draggable-panel-header"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Cpu style={{ width: 12, height: 12, color: available ? "#00ffb4" : "#ff5555", filter: `drop-shadow(0 0 3px ${available ? "rgba(0,255,180,0.6)" : "rgba(255,85,85,0.6)"})` }} />
          <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 10, color: available ? "#00ffb4" : "#ff5555", letterSpacing: "0.1em", textShadow: `0 0 6px ${available ? "rgba(0,255,180,0.4)" : "rgba(255,85,85,0.4)"}` }}>
            OLLAMA ENGINE
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setMinimized(v => !v)}
            style={{ width: 16, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.12)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
          >
            <span style={{ fontSize: 8 }}>{minimized ? "▲" : "▼"}</span>
          </button>
          <button onClick={() => setAdvancedOpen((v) => !v)}
            style={{ width: 16, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0,200,255,0.12)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
          >
            <span style={{ fontSize: 8 }}>{advancedOpen ? "●" : "○"}</span>
          </button>
          <button onClick={onSettings}
            style={{ width: 16, height: 16, borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0,255,180,0.12)"}
            onMouseLeave={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
          >
            <span style={{ fontSize: 8 }}>⚙</span>
          </button>
        </div>
      </div>

      {/* Content */}
      {!minimized && (
        <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
          {/* Status row */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "7px 10px", borderRadius: 10,
            background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: loading ? "#888" : available ? "#00ffb4" : "#ff5555",
              boxShadow: loading ? "none" : available ? "0 0 8px #00ffb4" : "0 0 8px #ff5555",
              animation: loading ? "none" : "pulse 1.5s ease-in-out infinite",
              flexShrink: 0,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 900, color: loading ? "rgba(255,255,255,0.4)" : available ? "#00ffb4" : "#ff5555" }}>
                {loading ? "جارٍ الفحص..." : available ? "متصل · جاهز" : "غير متصل"}
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 8, color: "rgba(255,255,255,0.3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{model}</div>
            </div>
          </div>

          {/* Model badge / CORS guide */}
          {available ? (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "5px 10px", borderRadius: 8,
              background: "rgba(0,255,180,0.06)", border: "1px solid rgba(0,255,180,0.15)",
            }}>
              <span style={{ fontFamily: "monospace", fontSize: 8, fontWeight: 900, color: "#00ffb4", letterSpacing: "0.08em" }}>OLLAMA LOCAL ONLY</span>
              <span style={{ fontFamily: "monospace", fontSize: 7, color: "rgba(255,255,255,0.2)" }}>NO API KEY</span>
            </div>
          ) : (
            <div style={{
              padding: "7px 10px", borderRadius: 8,
              background: "rgba(255,200,0,0.06)", border: "1px solid rgba(255,200,0,0.2)",
            }}>
              <div style={{ fontFamily: "monospace", fontSize: 8, fontWeight: 900, color: "#ffc800", marginBottom: 4 }}>تفعيل Ollama:</div>
              <div style={{ fontFamily: "monospace", fontSize: 7.5, color: "rgba(255,200,0,0.8)", lineHeight: 1.6, direction: "ltr", userSelect: "text" }}>
                OLLAMA_ORIGINS="*" ollama serve
              </div>
              <div style={{ fontFamily: "monospace", fontSize: 7, color: "rgba(255,255,255,0.3)", marginTop: 3 }}>
                ثم أعد تحميل الصفحة
              </div>
            </div>
          )}
          {advancedOpen && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <button onClick={onSettings} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(0,255,180,0.16)", background: "rgba(0,255,180,0.06)", color: "#00ffb4", fontFamily: "monospace", fontSize: 8, cursor: "pointer" }}>Settings</button>
              <button onClick={() => setMinimized(true)} style={{ padding: "6px 8px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.7)", fontFamily: "monospace", fontSize: 8, cursor: "pointer" }}>Hide</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Services Status Window (inline — 169 services) ──────────────────────────
const DESKTOP_SERVICES = {
  "ذكاء اصطناعي": [
    { id:"nova-agent",        name:"Nova Agent V1"              }, { id:"nova-agent-v2",     name:"Nova Agent V2"              },
    { id:"nova-agent-v3",     name:"Nova Agent V3"              }, { id:"nova-agent-v6",     name:"Nova Agent V6 Ultimate"     },
    { id:"live-agent",        name:"Live Agent"                 }, { id:"kaligpt",            name:"KaliGPT Engine"             },
    { id:"chat-bot",          name:"Chat Bot"                   }, { id:"nova-intel",         name:"Nova Intelligence V1"       },
    { id:"nova-intel-v3",     name:"Nova Intelligence V3"       }, { id:"nova-rag",           name:"Nova RAG Engine"            },
    { id:"nova-rag-v2",       name:"Nova RAG V2"                }, { id:"nova-modules",       name:"Nova Modules"               },
    { id:"nova-sentinel",     name:"Nova Sentinel"              }, { id:"knowledge-builder",  name:"Knowledge Builder"          },
    { id:"root-agent",        name:"Root Agent"                 }, { id:"module-center",      name:"Module Center"              },
    { id:"agent-tools",       name:"Agent Tools Engine"         }, { id:"nova-knowledge",     name:"Nova Knowledge Base"        },
    { id:"ai-router",         name:"AI Router Engine"           }, { id:"watchdog",           name:"AI Provider Watchdog"       },
  ],
  "أمن سيبراني": [
    { id:"cve-sync",           name:"CVE Daily Sync"            }, { id:"cisa-monitor",       name:"CISA KEV Monitor"           },
    { id:"github-intel",       name:"GitHub Threat Intel"       }, { id:"sec-knowledge",      name:"Security Knowledge Builder" },
    { id:"nvd-scanner",        name:"NVD Scanner"               }, { id:"cisa-feed",          name:"CISA Feed"                  },
    { id:"exploit-db",         name:"Exploit-DB Search"         }, { id:"web-fetch",          name:"Web Fetch Proxy"            },
    { id:"scan-engine",        name:"Security Scan Engine"      }, { id:"cve-db",             name:"CVE Database"               },
    { id:"cwe-db",             name:"CWE Database"              }, { id:"mitre-attack",       name:"MITRE ATT&CK"               },
    { id:"shodan",             name:"Shodan Search"             }, { id:"vuln-checker",       name:"Vulnerability Checker"      },
    { id:"threat-detector",    name:"Threat Detector"           }, { id:"malware-scanner",    name:"Malware Scanner"            },
    { id:"forensics",          name:"Forensics Engine"          }, { id:"audit-system",       name:"Audit System"               },
    { id:"incident-response",  name:"Incident Response"         }, { id:"compliance",         name:"Compliance Checker"         },
    { id:"risk-assessment",    name:"Risk Assessment"           }, { id:"steganography",      name:"Steganography Engine"       },
    { id:"bookmarks-db",       name:"Bookmarks DB"              }, { id:"reports-engine",     name:"Reports Engine"             },
    { id:"scanner-engine",     name:"Scanner Engine"            }, { id:"nmap",               name:"Nmap"                       },
    { id:"sqlmap",             name:"SQLMap"                    }, { id:"nikto",              name:"Nikto"                      },
    { id:"nuclei",             name:"Nuclei"                    }, { id:"hydra",              name:"Hydra"                      },
  ],
  "شبكات وأدوات": [
    { id:"dns-lookup",         name:"DNS Lookup"                }, { id:"ssl-checker",        name:"SSL Checker"                },
    { id:"whois-lookup",       name:"Whois Lookup"              }, { id:"subdomain-finder",   name:"Subdomain Finder"           },
    { id:"network-monitor",    name:"Network Monitor"           }, { id:"network-analyzer",   name:"Network Analyzer"           },
    { id:"ip-tracker",         name:"IP Tracker"                }, { id:"web-search",         name:"Web Search Engine"          },
    { id:"github-search",      name:"GitHub Search"             }, { id:"proxy-server",       name:"Proxy Server"               },
    { id:"bandwidth-tester",   name:"Bandwidth Tester"          }, { id:"wifi-analyzer",      name:"WiFi Analyzer"              },
    { id:"nodes-manager",      name:"Network Nodes Manager"     }, { id:"header-analyzer",    name:"Header Analyzer"            },
    { id:"masscan",            name:"Masscan"                   }, { id:"subfinder",          name:"Subfinder"                  },
    { id:"traceroute",         name:"Traceroute"                }, { id:"tshark",             name:"Wireshark CLI"              },
    { id:"tcpdump",            name:"TCPDump"                   }, { id:"netcat",             name:"Netcat"                     },
    { id:"port-scanner",       name:"Port Scanner"              }, { id:"firewall-config",    name:"Firewall Config"            },
    { id:"intrusion-detect",   name:"Intrusion Detection"       }, { id:"httpx",              name:"HTTPx Multi-Probe"          },
    { id:"scapy",              name:"Scapy"                     },
  ],
  "النظام والبنية": [
    { id:"file-system",        name:"File System Manager"       }, { id:"process-monitor",    name:"Process Monitor"            },
    { id:"memory-manager",     name:"Memory Manager"            }, { id:"log-analyzer",       name:"Log Analyzer"               },
    { id:"system-monitor",     name:"System Monitor"            }, { id:"dashboard-stats",    name:"Dashboard Analytics"        },
    { id:"cron-scheduler",     name:"Cron Scheduler"            }, { id:"job-manager",        name:"Job Manager"                },
    { id:"webhook-manager",    name:"Webhook Manager"           }, { id:"workspaces",         name:"Workspaces Manager"         },
    { id:"settings-manager",   name:"Settings Manager"          }, { id:"key-manager",        name:"Key Manager"                },
    { id:"bot-memory",         name:"Bot Memory System"         }, { id:"bot-alerts",         name:"Bot Alerts Engine"          },
    { id:"watchdog-svc",       name:"Watchdog Service"          }, { id:"health-monitor",     name:"Health Monitor"             },
    { id:"installer",          name:"Module Installer"          }, { id:"shell-executor",     name:"Shell Executor"             },
    { id:"hash-calculator",    name:"Hash Calculator"           }, { id:"encrypt-engine",     name:"Encryption Engine"          },
    { id:"terminal-emulator",  name:"Terminal Emulator"         }, { id:"backup-manager",     name:"Backup Manager"             },
    { id:"data-center",        name:"Data Center"               }, { id:"disk-analyzer",      name:"Disk Analyzer"              },
    { id:"service-manager",    name:"Service Manager"           }, { id:"gpu-monitor",        name:"GPU Monitor"                },
    { id:"process-manager",    name:"Process Manager"           }, { id:"john-ripper",        name:"John the Ripper"            },
    { id:"hashcat",            name:"Hashcat"                   }, { id:"impacket",           name:"Impacket"                   },
  ],
  "قاعدة البيانات": [
    { id:"postgres",           name:"PostgreSQL Database"       }, { id:"cves-table",         name:"CVEs Table"                 },
    { id:"cwe-table",          name:"CWE Table"                 }, { id:"bot-memory-table",   name:"Bot Memory Table"           },
    { id:"bot-alerts-table",   name:"Bot Alerts Table"          }, { id:"cron-jobs-table",    name:"Cron Jobs Table"            },
    { id:"files-table",        name:"Files Table"               }, { id:"conversations",      name:"Conversations Table"        },
    { id:"agent-tasks",        name:"Agent Tasks Table"         }, { id:"settings-table",     name:"Settings Table"             },
    { id:"notifications",      name:"Notifications Table"       }, { id:"playbooks-table",    name:"Playbooks Table"            },
    { id:"reports-table",      name:"Reports Table"             }, { id:"agent-sessions",     name:"Agent Sessions Table"       },
    { id:"workspaces-table",   name:"Workspaces Table"          },
  ],
  "مسارات API": [
    { id:"api-health",         name:"Health Route"              }, { id:"api-stats",          name:"Stats Dashboard"            },
    { id:"api-agent",          name:"Agent Route"               }, { id:"api-ai",             name:"AI Route"                   },
    { id:"api-anthropic",      name:"Anthropic Route"           }, { id:"api-audit",          name:"Audit Route"                },
    { id:"api-bookmarks",      name:"Bookmarks Route"           }, { id:"api-bot",            name:"Bot Route"                  },
    { id:"api-cve",            name:"CVE Route"                 }, { id:"api-cwe",            name:"CWE Route"                  },
    { id:"api-files",          name:"Files Route"               }, { id:"api-installer",      name:"Installer Route"            },
    { id:"api-jobs",           name:"Jobs Route"                }, { id:"api-kaligpt",        name:"KaliGPT Route"              },
    { id:"api-keys",           name:"Keys Route"                }, { id:"api-knowledge",      name:"Knowledge Route"            },
    { id:"api-live-agent",     name:"Live Agent Route"          }, { id:"api-memory",         name:"Memory Route"               },
    { id:"api-mitre",          name:"MITRE Route"               }, { id:"api-modules",        name:"Modules Route"              },
    { id:"api-monitor",        name:"Monitor Route"             }, { id:"api-nodes",          name:"Nodes Route"                },
    { id:"api-novaagent",      name:"Nova Agent Route"          }, { id:"api-novaagentv3",    name:"Nova Agent V3 Route"        },
    { id:"api-playbooks",      name:"Playbooks Route"           }, { id:"api-processes",      name:"Processes Route"            },
    { id:"api-providers",      name:"Providers Route"           }, { id:"api-proxy",          name:"Proxy Route"                },
    { id:"api-reports",        name:"Reports Route"             }, { id:"api-rootagent",      name:"Root Agent Route"           },
    { id:"api-scanner",        name:"Scanner Route"             }, { id:"api-search",         name:"Search Route"               },
    { id:"api-settings",       name:"Settings Route"            }, { id:"api-shell",          name:"Shell Route"                },
    { id:"api-system",         name:"System Route"              }, { id:"api-tools",          name:"Tools Route"                },
    { id:"api-webhooks",       name:"Webhooks Route"            }, { id:"api-workspaces",     name:"Workspaces Route"           },
    { id:"sec-nvd",            name:"Security/NVD Route"        }, { id:"sec-cisa",           name:"Security/CISA Route"        },
    { id:"sec-github",         name:"Security/GitHub Route"     }, { id:"sec-exploitdb",      name:"Security/ExploitDB"         },
    { id:"sec-fetch",          name:"Security/Fetch Route"      }, { id:"sec-scan",           name:"Security/Scan Route"        },
  ],
} as const;
type DsvcKey = keyof typeof DESKTOP_SERVICES;
const DSVC_ALL = Object.values(DESKTOP_SERVICES).flat();
const DSVC_TOTAL = DSVC_ALL.length;

function isServiceActive(id: string, apiOnline: boolean): boolean {
  if (!apiOnline) return false;
  if (id.startsWith("api-") || id.startsWith("sec-")) return true;
  const DB_IDS = ["postgres","cves-table","cwe-table","bot-memory-table","bot-alerts-table",
    "cron-jobs-table","files-table","conversations","agent-tasks","settings-table",
    "notifications","playbooks-table","reports-table","agent-sessions","workspaces-table"];
  if (DB_IDS.includes(id)) return true;
  const ALWAYS_ON = ["watchdog","watchdog-svc","bot-memory","bot-alerts","health-monitor",
    "dashboard-stats","file-system","process-monitor","memory-manager","log-analyzer",
    "system-monitor","job-manager","webhook-manager","workspaces","settings-manager","key-manager",
    "ai-router","nova-agent","nova-agent-v2","nova-agent-v3","nova-agent-v6","live-agent",
    "kaligpt","chat-bot","nova-intel","nova-intel-v3","nova-rag","nova-rag-v2","nova-modules",
    "nova-sentinel","knowledge-builder","root-agent","module-center","agent-tools","nova-knowledge"];
  return ALWAYS_ON.includes(id);
}

function ServicesStatusWin({ apiOnline }: { apiOnline: boolean }) {
  const [activeCat, setActiveCat] = useState<DsvcKey>("ذكاء اصطناعي");
  const cats = Object.keys(DESKTOP_SERVICES) as DsvcKey[];
  const catArr = DESKTOP_SERVICES[activeCat] as readonly { id: string; name: string }[];
  const activeTotal = DSVC_ALL.filter(s => isServiceActive(s.id, apiOnline)).length;
  const catActive = catArr.filter(s => isServiceActive(s.id, apiOnline)).length;

  return (
    <div className="flex flex-col h-full bg-[#060a0f] text-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/8">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] font-black font-mono text-emerald-400 uppercase tracking-widest">حالة الخدمات</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-mono text-white/40">{activeTotal} / {DSVC_TOTAL} نشط</span>
          <div className="w-24 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all duration-700"
              style={{ width: `${Math.round((activeTotal / DSVC_TOTAL) * 100)}%` }} />
          </div>
          <span className="text-[10px] font-mono text-emerald-400 font-bold">{Math.round((activeTotal / DSVC_TOTAL) * 100)}%</span>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex items-center px-3 py-2 gap-1 border-b border-white/5 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {cats.map(cat => {
          const arr = DESKTOP_SERVICES[cat] as readonly { id: string }[];
          const act = arr.filter(s => isServiceActive(s.id, apiOnline)).length;
          return (
            <button key={cat} onClick={() => setActiveCat(cat)}
              className={`text-[9px] font-mono px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors shrink-0 ${
                activeCat === cat
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                  : "text-white/30 hover:text-white/55 hover:bg-white/5"
              }`}>
              {cat}
              <span className="ml-1 opacity-60">({act}/{arr.length})</span>
            </button>
          );
        })}
      </div>

      {/* Service list */}
      <div className="flex-1 overflow-y-auto p-3" style={{ scrollbarWidth: "thin" }}>
        <div className="grid grid-cols-2 gap-0.5">
          {catArr.map((s) => {
            const active = isServiceActive(s.id, apiOnline);
            return (
              <div key={s.id} className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-all ${active ? "hover:bg-white/5" : "opacity-35"}`}>
                <span className="text-[10px] font-mono text-white/60 truncate">{s.name}</span>
                <div className={`w-2 h-2 rounded-full shrink-0 ml-2 ${active ? "bg-emerald-400" : "bg-red-500/50"}`} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/8 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-[9px] font-mono text-white/40">{catActive} نشط</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500/50" />
            <span className="text-[9px] font-mono text-white/40">{catArr.length - catActive} متوقف</span>
          </div>
        </div>
        <span className="text-[9px] font-mono text-white/20">{DSVC_TOTAL} خدمة إجمالي</span>
      </div>
    </div>
  );
}

// ─── renderBody ───────────────────────────────────────────────────────────────
function renderBody(w: WinInst, handleClientTool: (e: ClientToolEvent) => void, openWindow: (k: WinKind) => void, apiOnline: boolean) {
  const page = (path: string, title: string) => <PageWin path={path} title={title} />;
  switch (w.kind) {
    // Native components
    case "browser":     return <BrowserWindow initialUrl="https://duckduckgo.com" />;
    case "terminal":    return <TerminalWindow />;
    case "files":       return <FilesWindow />;
    case "nodes":       return <NodesWindow />;
    case "scanner":     return <ScannerWindow />;
    case "keys":        return <KeysWindow />;
    case "agent":       return <AgentWindow onClientTool={handleClientTool} />;
    case "live-agent":  return <LiveAgentPanel onClientTool={handleClientTool} onOpenAgentWindow={() => openWindow("agent")} />;
    // Monitor (inline)
    case "monitor": case "system-monitor": case "process-manager":
    case "gpu-monitor": case "network-monitor": case "network-analyzer":
    case "memory-optimizer": case "disk-analyzer": case "bandwidth-tester":
    case "wifi-analyzer": case "log-analyzer":
      return <MonitorWin />;
    // System pages
    case "dashboard":    case "security-center": case "risk-assessment": case "data-center":
      return page("/dashboard", "Dashboard");
    case "settings":    case "firewall-config":   return page("/settings", "Settings");
    case "status":      case "service-manager":   return <ServicesStatusWin apiOnline={apiOnline} />;
    case "playbooks":   case "backup-manager":    return page("/playbooks", "Playbooks");
    case "workspaces":  return page("/workspaces", "Workspaces");
    case "memory":      return page("/memory", "Agent Memory");
    case "jobs":        return page("/jobs", "Jobs");
    case "cron":        return page("/cron", "Cron Jobs");
    case "webhooks":    return page("/webhooks", "Webhooks");
    case "installer":   return page("/installer", "Installer");
    case "module-center": return page("/module-center", "Module Center");
    case "editor":      return page("/files", "File Editor");
    case "tool-terminal": return page("/terminal", "Tool Terminal");
    // AI pages
    case "agent-v3":    return page("/nova-agent-v3", "Nova Agent V3");
    case "agent-v6":    return page("/nova-agent-v6", "Nova Agent V6");
    case "kaligpt":     return page("/kaligpt", "Kali GPT");
    case "nova-intel":  case "threat-detector":  return page("/nova-intelligence", "Nova Intelligence");
    case "knowledge":   return page("/knowledge", "Knowledge Base");
    case "chat":        return page("/chat", "AI Chat");
    case "nova-modules": return page("/nova-modules", "Nova Modules");
    case "nova-sentinel":    return <NovaSentinelV8V9 onClientTool={handleClientTool} onOpenAgentWindow={() => openWindow("agent")} />;
    case "nova-sentinel-v8": return <NovaSentinelV8  onClientTool={handleClientTool} onOpenAgentWindow={() => openWindow("agent")} />;
    case "nova-sentinel-v9": return <NovaSentinelV9  onClientTool={handleClientTool} onOpenAgentWindow={() => openWindow("agent")} />;
    // Security pages
    case "cves":        case "vulnerability-checker": return page("/cve-search", "CVEs");
    case "cve-db":      return page("/cve-db", "CVE Database");
    case "cve-live":    case "malware-scanner":   return page("/cve-live", "CVE Live");
    case "exploit-db":  return page("/exploit-db", "Exploit DB");
    case "mitre":       return page("/mitre", "MITRE ATT&CK");
    case "cwe":         return page("/cwe", "CWE");
    case "shodan":      case "ip-tracker":        return page("/shodan", "Shodan");
    case "github-search": return page("/github-search", "GitHub Search");
    case "audit":       case "forensics-tool":    case "compliance-checker":
      return page("/audit", "Audit");
    case "incident-response":
    case "reports":     return <PdfReportsWindow />;
    case "bookmarks":   return page("/bookmarks", "Bookmarks");
    case "steganography": return (
      <div className="flex flex-col items-center justify-center h-full opacity-40">
        <EyeOff className="w-16 h-16 mb-4 text-primary/50" />
        <h3 className="text-lg font-bold">إخفاء البيانات</h3>
        <p className="text-sm text-muted-foreground">قيد التطوير</p>
      </div>
    );
    // Network tools
    case "port-scanner": return page("/port-scanner", "Port Scanner");
    case "dns-lookup":  return page("/dns-lookup", "DNS Lookup");
    case "whois-lookup": return page("/whois-lookup", "WHOIS");
    case "ssl-checker": return page("/ssl-checker", "SSL Checker");
    case "subdomains":  return page("/subdomains", "Subdomains");
    case "web-fetch":   return page("/web-search", "Web Search");
    case "intrusion-detection": return page("/monitor", "Monitor");
    // System tools
    case "hash-calculator": return page("/hash-calculator", "Hash Calculator");
    case "encryption-tool": return page("/encryption-tool", "Encryption");
    case "xdaw":        return (
      <div className="flex flex-col items-center justify-center h-full opacity-40">
        <Music2 className="w-16 h-16 mb-4 text-primary/50" />
        <h3 className="text-lg font-bold">Nova DAW</h3>
        <p className="text-sm text-muted-foreground">محطة العمل الصوتية</p>
      </div>
    );
    // ── NEW: AI Evolution windows ──────────────────────────────────────────
    case "reverse-evolution": return (
      <div className="flex flex-col h-full bg-[#050510] overflow-auto" dir="rtl">
        <div className="p-5 border-b border-violet-500/20 bg-gradient-to-r from-violet-900/20 to-indigo-900/10">
          <div className="flex items-center gap-3 mb-1">
            <RotateCw className="w-6 h-6 text-violet-400" />
            <h2 className="text-lg font-bold text-violet-200">التطور العكسي — Reverse Evolution</h2>
          </div>
          <p className="text-xs text-violet-400/60">اختبر كيف كانت الإصدارات القديمة تواجه هجمات العصر الحديث</p>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          {[
            { v:"v1.0.0", date:"2020", attacks:["XSS Basic","SQLi Simple","CSRF"], color:"#a855f7" },
            { v:"v2.0.0", date:"2021", attacks:["RCE Via Log4j","SSRF","XXE"], color:"#7c3aed" },
            { v:"v3.5.0", date:"2022", attacks:["Supply Chain","OAuth Bypass","JWT Forging"], color:"#6d28d9" },
            { v:"v8.0.0", date:"2023", attacks:["AI Prompt Injection","LLM Jacking","Deepfake Auth"], color:"#5b21b6" },
          ].map(item => (
            <div key={item.v} className="rounded-2xl border p-4" style={{ borderColor: item.color+"33", background: item.color+"0a" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="font-mono text-sm font-bold" style={{ color: item.color }}>{item.v}</div>
                <div className="text-[10px] text-white/30 font-mono">{item.date}</div>
              </div>
              <div className="space-y-1.5">
                {item.attacks.map(a => (
                  <div key={a} className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: item.color }} />
                    <span className="text-[11px] text-white/50">{a}</span>
                    <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: item.color+"20", color: item.color }}>محاكاة</span>
                  </div>
                ))}
              </div>
              <button className="mt-3 w-full py-1.5 rounded-lg text-[10px] font-bold font-mono transition-all hover:opacity-80"
                style={{ background: item.color+"20", color: item.color, border: `1px solid ${item.color}30` }}>
                ▶ تشغيل المحاكاة
              </button>
            </div>
          ))}
        </div>
        <div className="mx-5 mb-5 p-4 rounded-2xl border border-violet-500/20 bg-violet-950/20">
          <div className="text-xs font-mono text-violet-400/60 mb-2">📚 الهدف التعليمي</div>
          <p className="text-xs text-white/40">هذه الوحدة تُظهر كيف تطورت التهديدات عبر الزمن وكيف كانت الأنظمة القديمة تفشل أمام الهجمات الحديثة — مفيد لأبحاث الأمن السيبراني والتدريب.</p>
        </div>
      </div>
    );
    case "custom-build": return (
      <div className="flex flex-col h-full bg-[#050510] overflow-auto" dir="rtl">
        <div className="p-5 border-b border-fuchsia-500/20 bg-gradient-to-r from-fuchsia-900/20 to-pink-900/10">
          <div className="flex items-center gap-3 mb-1">
            <Layers className="w-6 h-6 text-fuchsia-400" />
            <h2 className="text-lg font-bold text-fuchsia-200">بناء AI مخصص — Custom AI Build</h2>
          </div>
          <p className="text-xs text-fuchsia-400/60">ادمج ميزات من إصدارات مختلفة وأنشئ إصداراً باسمك الخاص</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="p-4 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-950/10">
            <div className="text-xs font-mono text-fuchsia-400 mb-3">اسم الإصدار المخصص</div>
            <div className="flex items-center gap-3 bg-black/40 rounded-xl px-4 py-2 border border-fuchsia-500/20">
              <span className="text-fuchsia-400 font-mono text-sm">User_AI_</span>
              <input placeholder="v1.0_custom" className="flex-1 bg-transparent outline-none text-sm text-white font-mono placeholder:text-white/20" />
            </div>
          </div>
          <div className="text-xs font-mono text-white/40 mb-2">اختر الميزات من كل إصدار:</div>
          <div className="grid grid-cols-1 gap-3">
            {[
              { version: "V3 Agent", features: ["Multi-step reasoning","Tool chaining","Context memory"], color: "#a855f7" },
              { version: "V6 Neural", features: ["Deep vulnerability analysis","Auto PoC generation","EPSS scoring"], color: "#f43f5e" },
              { version: "V8 Sentinel", features: ["Real-time CVE monitoring","Proactive alerts","MITRE mapping"], color: "#f97316" },
              { version: "V9 Supreme", features: ["Vector memory","Ollama vision","Autonomous mode"], color: "#06b6d4" },
            ].map(item => (
              <div key={item.version} className="rounded-xl border p-3" style={{ borderColor: item.color+"25", background: item.color+"08" }}>
                <div className="font-mono text-xs font-bold mb-2" style={{ color: item.color }}>{item.version}</div>
                <div className="flex flex-wrap gap-2">
                  {item.features.map(f => (
                    <label key={f} className="flex items-center gap-1.5 cursor-pointer group">
                      <input type="checkbox" defaultChecked className="rounded" />
                      <span className="text-[10px] text-white/50 group-hover:text-white/80">{f}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button className="w-full py-3 rounded-xl font-bold text-sm font-mono transition-all hover:opacity-80"
            style={{ background: "linear-gradient(135deg,#7c3aed,#ec4899)", color: "#fff", boxShadow: "0 0 20px rgba(124,58,237,0.3)" }}>
            ⚡ بناء الإصدار المخصص
          </button>
        </div>
      </div>
    );
    case "dark-ml": return (
      <div className="flex flex-col h-full bg-[#050510] overflow-auto" dir="rtl">
        <div className="p-5 border-b border-rose-500/20 bg-gradient-to-r from-rose-900/20 to-red-900/10">
          <div className="flex items-center gap-3 mb-1">
            <BrainCircuit className="w-6 h-6 text-rose-400" />
            <h2 className="text-lg font-bold text-rose-200">التعلم الآلي المظلم — Dark Adaptive ML</h2>
          </div>
          <p className="text-xs text-rose-400/60">محاكاة سلوك المخترقين الحقيقيين بناءً على أحدث نماذج التهديد</p>
        </div>
        <div className="p-5 grid grid-cols-2 gap-4">
          {[
            { label:"نماذج التهديد", value:"247", sub:"نموذج محدّث", color:"#f43f5e" },
            { label:"دقة المحاكاة", value:"94.3%", sub:"آخر اختبار", color:"#f97316" },
            { label:"إصدار النموذج", value:"v3.7", sub:"أسبوعي", color:"#a855f7" },
            { label:"التهديدات الحية", value:"1,797", sub:"CRITICAL", color:"#ef4444" },
          ].map(stat => (
            <div key={stat.label} className="rounded-2xl p-4 border" style={{ borderColor: stat.color+"30", background: stat.color+"08" }}>
              <div className="text-xl font-black font-mono" style={{ color: stat.color }}>{stat.value}</div>
              <div className="text-xs font-bold text-white/60 mt-1">{stat.label}</div>
              <div className="text-[9px] text-white/30 mt-0.5 font-mono">{stat.sub}</div>
            </div>
          ))}
        </div>
        <div className="px-5 space-y-3">
          {[
            { name:"APT-41 Simulation", status:"ready", desc:"محاكاة مجموعة APT صينية متقدمة", color:"#ef4444" },
            { name:"Ransomware Pattern", status:"running", desc:"نمط هجوم الفدية الحديث 2025", color:"#f97316" },
            { name:"Social Engineering ML",status:"ready", desc:"نموذج هندسة اجتماعية بالذكاء الاصطناعي", color:"#a855f7" },
          ].map(sim => (
            <div key={sim.name} className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: sim.color+"25", background: sim.color+"08" }}>
              <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: sim.status==="running" ? sim.color : sim.color+"60" }} />
              <div className="flex-1">
                <div className="text-xs font-bold" style={{ color: sim.color }}>{sim.name}</div>
                <div className="text-[10px] text-white/35">{sim.desc}</div>
              </div>
              <button className="px-3 py-1 rounded-lg text-[10px] font-mono font-bold transition-all"
                style={{ background: sim.color+"20", color: sim.color, border: `1px solid ${sim.color}30` }}>
                {sim.status==="running" ? "⏸ إيقاف" : "▶ تشغيل"}
              </button>
            </div>
          ))}
        </div>
      </div>
    );
    // ── NEW: Pentest Arsenal windows ───────────────────────────────────────
    case "poc-engine": return (
      <div className="flex flex-col h-full bg-[#050510] overflow-auto" dir="rtl">
        <div className="p-5 border-b border-orange-500/20 bg-gradient-to-r from-orange-900/15 to-red-900/10">
          <div className="flex items-center gap-3 mb-1">
            <Rocket className="w-6 h-6 text-orange-400" />
            <h2 className="text-lg font-bold text-orange-200">محرك الإثبات التلقائي — PoC Engine</h2>
          </div>
          <p className="text-xs text-orange-400/60">AI يحلل نتيجة الأداة فوراً ويولّد Proof-of-Concept تلقائياً ويحفظه في التقارير</p>
        </div>
        <div className="p-5 space-y-4">
          <div className="p-4 rounded-2xl border border-orange-500/20 bg-orange-950/10">
            <div className="text-xs font-mono text-orange-400 mb-2">أدخل هدف التحليل</div>
            <div className="flex gap-3">
              <input placeholder="https://target.com أو IP أو CVE-ID"
                className="flex-1 bg-black/40 rounded-xl px-4 py-2 border border-orange-500/20 text-sm text-white outline-none placeholder:text-white/20 font-mono" />
              <button className="px-5 py-2 rounded-xl font-bold text-sm font-mono transition-all"
                style={{ background:"linear-gradient(135deg,#f97316,#ef4444)", color:"#fff", boxShadow:"0 0 16px rgba(249,115,22,0.3)" }}>
                🔍 تحليل
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-mono text-white/30">آخر تقارير PoC المولّدة:</div>
            {[
              { id:"POC-001", cve:"CVE-2025-8572", type:"RCE", severity:"CRITICAL", status:"مكتمل", color:"#ef4444" },
              { id:"POC-002", cve:"CVE-2026-1306", type:"File Upload",severity:"HIGH",    status:"قيد التحليل", color:"#f97316" },
              { id:"POC-003", cve:"CVE-2025-69633",type:"SQLi",   severity:"CRITICAL", status:"مكتمل", color:"#ef4444" },
            ].map(poc => (
              <div key={poc.id} className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: poc.color+"25", background: poc.color+"08" }}>
                <div className="text-[9px] font-mono text-white/30 w-14 shrink-0">{poc.id}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold" style={{ color: poc.color }}>{poc.cve}</div>
                  <div className="text-[9px] text-white/35 font-mono">{poc.type}</div>
                </div>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded shrink-0" style={{ background: poc.color+"20", color: poc.color }}>
                  {poc.severity}
                </span>
                <span className="text-[9px] text-white/40 shrink-0">{poc.status}</span>
                <button className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 hover:bg-white/10 transition-colors">
                  <Download style={{ width:11, height:11, color:"rgba(255,255,255,0.4)" }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
    case "ethical-hacking": return (
      <div className="flex flex-col h-full bg-[#050510] overflow-auto" dir="rtl">
        <div className="p-5 border-b border-red-500/20 bg-gradient-to-r from-red-900/20 to-rose-900/10">
          <div className="flex items-center gap-3 mb-1">
            <Target className="w-6 h-6 text-red-400" />
            <h2 className="text-lg font-bold text-red-200">ترسانة الاختراق الأخلاقي — Ethical Hacking Edition</h2>
          </div>
          <p className="text-xs text-red-400/60">كل أدوات الاختراق الأخلاقي في مكان واحد — مشحونة مسبقاً للـ Pentester</p>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          {[
            { cat:"Recon & OSINT",  tools:["Subdomains","WHOIS","Shodan","GitHub Search","DNS Lookup"], color:"#f59e0b", icon:"🔭" },
            { cat:"Scanning",       tools:["Port Scanner","CVE Live Sync","NVD Search","SSL Checker","Active Scanner"], color:"#ef4444", icon:"🔍" },
            { cat:"Exploitation",   tools:["Exploit-DB","PoC Engine","SQL Injection","XSS Tester","RCE Lab"], color:"#dc2626", icon:"💥" },
            { cat:"Post-Exploit",   tools:["Audit Log","Reports","Evidence","Memory Dump","Timeline"], color:"#7c3aed", icon:"📋" },
            { cat:"AI Assistance",  tools:["KaliGPT","Nova Agent V6","Live Agent","Dark ML","MITRE Mapper"], color:"#06b6d4", icon:"🤖" },
            { cat:"Templates",      tools:["Nuclei Templates","Playbooks","Custom Scripts","Wordlists","PoC Vault"], color:"#10b981", icon:"📦" },
          ].map(section => (
            <div key={section.cat} className="rounded-2xl border p-3" style={{ borderColor: section.color+"25", background: section.color+"08" }}>
              <div className="flex items-center gap-2 mb-2">
                <span>{section.icon}</span>
                <div className="text-[11px] font-bold font-mono" style={{ color: section.color }}>{section.cat}</div>
              </div>
              <div className="space-y-1">
                {section.tools.map(tool => (
                  <button key={tool} onClick={() => openWindow(APPS.find(a => a.label === tool || a.kind.includes(tool.toLowerCase().replace(/ /g,"-")))?.kind ?? "scanner")}
                    className="w-full text-right px-2 py-1 rounded-lg text-[10px] text-white/50 hover:text-white hover:bg-white/5 transition-all font-mono flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: section.color+"80" }} />
                    {tool}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="mx-4 mb-4 p-3 rounded-xl border border-emerald-500/20 bg-emerald-950/10 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[11px] text-emerald-400 font-mono">CVE Live Sync: نشط · 8,315 ثغرة · آخر تحديث منذ دقيقتين</span>
        </div>
      </div>
    );
    default: return (
      <div className="flex flex-col items-center justify-center h-full opacity-40">
        <Wrench className="w-16 h-16 mb-4 text-primary/50" />
        <h3 className="text-lg font-bold">{w.title}</h3>
        <p className="text-sm text-muted-foreground">قيد التطوير</p>
      </div>
    );
  }
}

// ─── Notification type ────────────────────────────────────────────────────────
type Notif = { id: string; title: string; body: string; level: "info" | "warning" | "critical"; createdAt: number; read: boolean };
const mkNotif = (title: string, body: string, level: Notif["level"]): Notif => ({ id: Math.random().toString(36).slice(2), title, body, level, createdAt: Date.now(), read: false });

// ─── DockBar — full bottom taskbar covering ALL apps ──────────────────────────
const DOCK_CATEGORIES: Array<{
  id: "basics" | "ai" | "security" | "network" | "system";
  label: string;
  color: string;
  rgb: string;
}> = [
  { id: "basics",   label: "أساسيات", color: "#44eebb", rgb: "68,238,187" },
  { id: "ai",       label: "الذكاء",  color: "#aa44ff", rgb: "170,68,255" },
  { id: "security", label: "الأمن",   color: "#ff5555", rgb: "255,85,85"  },
  { id: "network",  label: "شبكات",   color: "#4488ff", rgb: "68,136,255" },
  { id: "system",   label: "النظام",  color: "#44ff88", rgb: "68,255,136" },
];

function DockBar({ wins, openWindow }: { wins: WinInst[]; openWindow: (k: WinKind) => void }) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  const pinnedApps: WinKind[] = [
    "browser","terminal","agent","nova-sentinel","scanner","dashboard","status","keys","files","cves",
  ];

  return (
    <div style={{
      background: "rgba(4,0,10,0.92)",
      borderTop: "1px solid rgba(0,212,255,0.15)",
      backdropFilter: "blur(24px)",
      boxShadow: "0 -4px 30px rgba(0,0,0,0.6), 0 -1px 0 rgba(0,212,255,0.08)",
      position: "relative",
    }}>
      {/* Category popup */}
      {openCat && (() => {
        const cat = DOCK_CATEGORIES.find(c => c.id === openCat);
        if (!cat) return null;
        const catApps = APPS.filter(a => a.category === cat.id);
        return (
          <>
            <div style={{ position: "fixed", inset: 0, zIndex: 49 }} onClick={() => setOpenCat(null)} />
            <div style={{
              position: "absolute", bottom: "100%",
              left: "50%", transform: "translateX(-50%)",
              marginBottom: 8, zIndex: 200,
              background: "rgba(4,0,10,0.97)",
              border: `1px solid ${cat.color}30`,
              borderRadius: 20,
              boxShadow: `0 0 30px rgba(${cat.rgb},0.15), 0 -8px 40px rgba(0,0,0,0.7)`,
              padding: "12px 12px 10px",
              width: Math.min(window.innerWidth - 32, 820),
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, paddingBottom: 8,
                borderBottom: `1px solid rgba(${cat.rgb},0.12)` }}>
                <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 11, color: cat.color, letterSpacing: "0.1em" }}>
                  {cat.label} — {catApps.length} أداة
                </span>
                <button onClick={() => setOpenCat(null)}
                  style={{ width: 20, height: 20, borderRadius: 6, background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <X style={{ width: 11, height: 11 }} />
                </button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {catApps.map(app => {
                  const running = wins.some(w => w.kind === app.kind);
                  return (
                    <button key={app.kind} onClick={() => { openWindow(app.kind); setOpenCat(null); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 7,
                        padding: "6px 10px", borderRadius: 12,
                        background: running ? `rgba(${cat.rgb},0.1)` : "rgba(255,255,255,0.02)",
                        border: `1px solid ${running ? cat.color + "35" : "rgba(255,255,255,0.06)"}`,
                        cursor: "pointer", transition: "all 0.15s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = `rgba(${cat.rgb},0.08)`)}
                      onMouseLeave={e => (e.currentTarget.style.background = running ? `rgba(${cat.rgb},0.1)` : "rgba(255,255,255,0.02)")}>
                      <app.icon style={{ width: 13, height: 13, color: running ? cat.color : "rgba(255,255,255,0.4)", flexShrink: 0 }} />
                      <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 10, color: running ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
                        {app.label}
                      </span>
                      {running && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#44ff88", boxShadow: "0 0 4px #44ff88", flexShrink: 0 }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}

      <div style={{ display: "flex", alignItems: "center", height: 48, padding: "0 12px", gap: 8, overflowX: "auto", scrollbarWidth: "none" }}>
        {/* Pinned apps */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0 }}>
          {pinnedApps.map(kind => {
            const app = APPS.find(a => a.kind === kind);
            if (!app) return null;
            const running = wins.some(w => w.kind === kind);
            const catColor = DOCK_CATEGORIES.find(c => c.id === app.category)?.color ?? "#888";
            const isHov = hovered === kind;
            return (
              <button key={kind} onClick={() => openWindow(kind)} title={app.label}
                onMouseEnter={() => setHovered(kind)} onMouseLeave={() => setHovered(null)}
                style={{
                  position: "relative", width: 36, height: 36, borderRadius: 12, flexShrink: 0,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  background: running ? `${catColor}12` : isHov ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${running ? catColor + "30" : "rgba(255,255,255,0.06)"}`,
                  cursor: "pointer", transition: "all 0.15s",
                  transform: isHov ? "translateY(-4px) scale(1.12)" : "none",
                  boxShadow: running ? `0 0 12px ${catColor}30` : "none",
                }}>
                <app.icon style={{ width: 16, height: 16, color: running ? catColor : "rgba(255,255,255,0.45)" }} />
                {running && <div style={{ position: "absolute", bottom: 2, width: 4, height: 4, borderRadius: "50%",
                  background: catColor, boxShadow: `0 0 4px ${catColor}` }} />}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

        {/* Category groups */}
        <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1 }}>
          {DOCK_CATEGORIES.map(cat => {
            const catApps = APPS.filter(a => a.category === cat.id);
            const runningCount = catApps.filter(a => wins.some(w => w.kind === a.kind)).length;
            const isOpen = openCat === cat.id;
            return (
              <button key={cat.id} onClick={() => setOpenCat(isOpen ? null : cat.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "5px 10px", borderRadius: 12, flexShrink: 0,
                  background: isOpen ? `rgba(${cat.rgb},0.15)` : "rgba(255,255,255,0.02)",
                  border: `1px solid ${isOpen ? cat.color + "40" : "rgba(255,255,255,0.06)"}`,
                  cursor: "pointer", transition: "all 0.15s",
                  boxShadow: isOpen ? `0 0 12px rgba(${cat.rgb},0.2)` : "none",
                }}>
                <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 10, color: isOpen ? cat.color : "rgba(255,255,255,0.45)" }}>
                  {cat.label}
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 9, color: isOpen ? cat.color : "rgba(255,255,255,0.25)" }}>
                  ({catApps.length})
                </span>
                {runningCount > 0 && (
                  <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 8,
                    padding: "1px 4px", borderRadius: 6, background: cat.color + "20",
                    color: cat.color, border: `1px solid ${cat.color}30` }}>{runningCount}</span>
                )}
                <ChevronUp style={{ width: 8, height: 8, color: isOpen ? cat.color : "rgba(255,255,255,0.2)",
                  transform: isOpen ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 0.2s" }} />
              </button>
            );
          })}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

        {/* Running + Minimized windows strip */}
        {wins.length > 0 && (
          <div style={{ display: "flex", gap: 4, alignItems: "center", overflow: "hidden", maxWidth: 380 }}>
            {/* Active (non-minimized) windows */}
            {wins.filter(w => !w.minimized).slice(0, 5).map(w => {
              const app = APPS.find(a => a.kind === w.kind);
              const catColor = app ? (DOCK_CATEGORIES.find(c => c.id === app.category)?.color ?? "#44eebb") : "#44eebb";
              return (
                <button key={w.id} onClick={() => openWindow(w.kind)} title={w.title}
                  onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px) scale(1.1)"; e.currentTarget.style.boxShadow = `0 0 14px ${catColor}50`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = `0 0 8px ${catColor}20`; }}
                  style={{
                    width: 32, height: 32, borderRadius: 11, flexShrink: 0,
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    background: `linear-gradient(135deg, rgba(${DOCK_CATEGORIES.find(c=>c.id===app?.category)?.rgb ?? "68,238,187"},0.15), rgba(${DOCK_CATEGORIES.find(c=>c.id===app?.category)?.rgb ?? "68,238,187"},0.06))`,
                    border: `1px solid ${catColor}40`,
                    cursor: "pointer", transition: "all 0.15s", position: "relative",
                    boxShadow: `0 0 8px ${catColor}20`,
                  }}>
                  {app && <app.icon style={{ width: 14, height: 14, color: catColor, filter: `drop-shadow(0 0 3px ${catColor}80)` }} />}
                  {/* Active dot */}
                  <div style={{ position: "absolute", bottom: 2, width: 4, height: 4, borderRadius: "50%", background: catColor, boxShadow: `0 0 5px ${catColor}` }} />
                </button>
              );
            })}

            {/* Minimized windows — amber indicator, click to restore */}
            {wins.filter(w => w.minimized).length > 0 && (
              <>
                {wins.filter(w => w.minimized).length > 0 && (
                  <div style={{ width: 1, height: 20, background: "rgba(255,170,50,0.2)", flexShrink: 0 }} />
                )}
                {wins.filter(w => w.minimized).slice(0, 4).map(w => {
                  const app = APPS.find(a => a.kind === w.kind);
                  const catColor = app ? (DOCK_CATEGORIES.find(c => c.id === app.category)?.color ?? "#ffaa44") : "#ffaa44";
                  return (
                    <button key={w.id} onClick={() => openWindow(w.kind)} title={`استعادة: ${w.title}`}
                      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.background = "rgba(255,170,44,0.18)"; e.currentTarget.style.borderColor = "rgba(255,170,44,0.6)"; }}
                      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.background = "rgba(255,170,44,0.08)"; e.currentTarget.style.borderColor = "rgba(255,170,44,0.3)"; }}
                      style={{
                        width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "rgba(255,170,44,0.08)",
                        border: "1px solid rgba(255,170,44,0.3)",
                        cursor: "pointer", transition: "all 0.15s", position: "relative",
                        opacity: 0.75,
                      }}>
                      {app && <app.icon style={{ width: 12, height: 12, color: "#ffaa44" }} />}
                      {/* Minimized indicator dot (amber) */}
                      <div style={{ position: "absolute", bottom: 1, width: 3, height: 3, borderRadius: "50%", background: "#ffaa44", boxShadow: "0 0 4px #ffaa44" }} />
                    </button>
                  );
                })}
                {wins.filter(w => w.minimized).length > 4 && (
                  <span style={{ fontFamily: "monospace", fontSize: 8, color: "rgba(255,170,44,0.6)", fontWeight: 900 }}>+{wins.filter(w=>w.minimized).length - 4}</span>
                )}
              </>
            )}

            {wins.filter(w => !w.minimized).length > 5 && (
              <span style={{ fontFamily: "monospace", fontSize: 8, color: "rgba(255,255,255,0.25)", flexShrink: 0 }}>+{wins.filter(w=>!w.minimized).length - 5}</span>
            )}
          </div>
        )}

        {/* Task counter badge */}
        <div style={{ marginRight: 0, marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <div style={{
            fontFamily: "monospace", fontSize: 9, fontWeight: 900,
            color: wins.length > 0 ? "rgba(0,255,180,0.7)" : "rgba(255,255,255,0.2)",
            letterSpacing: "0.08em",
            textShadow: wins.length > 0 ? "0 0 6px rgba(0,255,180,0.4)" : "none",
          }}>
            {wins.length} نافذة · {wins.filter(w=>w.minimized).length} مصغّر
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── WindowsTaskbar — open windows row above dock ────────────────────────────
function WindowsTaskbar({ wins, openWindow, minimize, closeWindow }: {
  wins: WinInst[];
  openWindow: (k: WinKind) => void;
  minimize: (id: string) => void;
  closeWindow: (id: string) => void;
}) {
  const [hov, setHov] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  if (wins.length === 0) return null;

  return (
    <div onMouseEnter={() => setShowAll(true)} onMouseLeave={() => setShowAll(false)} style={{
      background: "linear-gradient(180deg, rgba(2,0,8,0.88) 0%, rgba(4,1,14,0.96) 100%)",
      borderTop: "1px solid rgba(0,200,255,0.12)",
      backdropFilter: "blur(24px) saturate(160%)",
      boxShadow: "0 -2px 18px rgba(0,0,0,0.55)",
      padding: "0 12px",
      display: "flex", alignItems: "center", gap: 5,
      overflowX: "auto", scrollbarWidth: "none",
      height: 42,
      position: "relative",
    }}>
      {/* Top shimmer line */}
      <div style={{ position:"absolute", top:0, left:0, right:0, height:1, background:"linear-gradient(90deg, transparent, rgba(0,200,255,0.4) 30%, rgba(0,255,180,0.5) 50%, rgba(0,200,255,0.4) 70%, transparent)", pointerEvents:"none" }} />

      {/* Badge */}
      <div style={{
        fontFamily:"monospace", fontSize:8, fontWeight:900,
        color:"rgba(0,200,255,0.45)", letterSpacing:"0.18em",
        whiteSpace:"nowrap", flexShrink:0, textTransform:"uppercase",
        textShadow:"0 0 8px rgba(0,200,255,0.3)",
      }}>TASKS · {wins.length}</div>

      <div style={{ width:1, height:22, background:"rgba(255,255,255,0.07)", flexShrink:0 }} />

      {/* Window chips */}
      {(showAll ? wins : wins.slice(0, 8)).map(w => {
        const app = APPS.find(a => a.kind === w.kind);
        const dc = DOCK_CATEGORIES.find(c => c.id === app?.category);
        const col = w.minimized ? "#ffaa44" : (dc?.color ?? "#44eebb");
        const rgb = w.minimized ? "255,170,68" : (dc?.rgb ?? "68,238,187");
        const isH = hov === w.id;
        return (
          <div key={w.id} onMouseEnter={() => setHov(w.id)} onMouseLeave={() => setHov(null)}
            style={{
              display:"flex", alignItems:"center", gap:6,
              padding:"5px 8px 5px 7px", borderRadius:9, flexShrink:0,
              background: isH ? `rgba(${rgb},0.14)` : w.minimized ? "rgba(255,170,44,0.07)" : `rgba(${rgb},0.07)`,
              border:`1px solid ${isH ? `rgba(${rgb},0.45)` : `rgba(${rgb},0.22)`}`,
              cursor:"pointer", transition:"all 0.14s",
              transform: isH ? "translateY(-2px)" : "none",
              boxShadow: isH ? `0 4px 18px rgba(${rgb},0.22)` : "none",
              maxWidth:170, position:"relative",
            }}>
            {/* Icon */}
            <div onClick={() => openWindow(w.kind)} style={{ display:"flex", alignItems:"center", flexShrink:0 }}>
              {app && <app.icon style={{ width:13, height:13, color:col, filter:`drop-shadow(0 0 4px ${col}99)`, transition:"color 0.14s" }} />}
            </div>
            {/* Title */}
            <span onClick={() => openWindow(w.kind)} style={{
              fontFamily:"monospace", fontSize:9.5, fontWeight:800,
              color: isH ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.6)",
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
              flex:1, minWidth:0, cursor:"pointer", letterSpacing:"0.01em",
              transition:"color 0.14s",
            }}>{w.title}</span>
            {/* Minimized dot */}
            {w.minimized && <div style={{ width:5, height:5, borderRadius:"50%", background:"#ffaa44", boxShadow:"0 0 6px #ffaa44", flexShrink:0 }} />}
            {/* Close on hover */}
            {isH && (
              <button onClick={e => { e.stopPropagation(); closeWindow(w.id); }}
                style={{
                  width:14, height:14, borderRadius:4, flexShrink:0, cursor:"pointer",
                  background:"rgba(255,85,85,0.15)", border:"1px solid rgba(255,85,85,0.35)",
                  color:"#ff5555", fontSize:10, fontWeight:900, lineHeight:1,
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>×</button>
            )}
            {/* Active bottom dot */}
            {!w.minimized && (
              <div style={{ position:"absolute", bottom:2, left:"50%", transform:"translateX(-50%)", width:3, height:3, borderRadius:"50%", background:col, boxShadow:`0 0 5px ${col}`, pointerEvents:"none" }} />
            )}
          </div>
        );
      })}

      {/* Minimize all / restore all */}
      <div style={{ marginLeft:"auto", flexShrink:0, display:"flex", gap:4 }}>
        <button onClick={() => setShowAll(v => !v)}
          title={showAll ? "إخفاء الكل" : "إظهار الكل"}
          style={{
            height:26, width:26, borderRadius:7,
            background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
            fontFamily:"monospace", fontSize:9, color:"rgba(255,255,255,0.3)",
            cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.12s",
          }}
        >
          <ChevronUp style={{ width:9, height:9, transform: showAll ? "rotate(0deg)" : "rotate(180deg)" }} />
        </button>
        <button onClick={() => wins.forEach(w => minimize(w.id))}
          title="تصغير الكل"
          style={{
            height:26, padding:"0 8px", borderRadius:7,
            background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
            fontFamily:"monospace", fontSize:9, color:"rgba(255,255,255,0.3)",
            cursor:"pointer", display:"flex", alignItems:"center", gap:4, transition:"all 0.12s",
          }}
          onMouseEnter={e=>{ e.currentTarget.style.background="rgba(255,170,0,0.08)"; e.currentTarget.style.borderColor="rgba(255,170,0,0.2)"; e.currentTarget.style.color="#ffaa00"; }}
          onMouseLeave={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.07)"; e.currentTarget.style.color="rgba(255,255,255,0.3)"; }}
        >
          <Minimize2 style={{ width:9, height:9 }} />
          <span>تصغير الكل</span>
        </button>
        <button onClick={() => wins.forEach(w => openWindow(w.kind))}
          title="استعادة الكل"
          style={{
            height:26, padding:"0 8px", borderRadius:7,
            background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
            fontFamily:"monospace", fontSize:9, color:"rgba(255,255,255,0.3)",
            cursor:"pointer", display:"flex", alignItems:"center", gap:4, transition:"all 0.12s",
          }}
          onMouseEnter={e=>{ e.currentTarget.style.background="rgba(0,255,180,0.08)"; e.currentTarget.style.borderColor="rgba(0,255,180,0.2)"; e.currentTarget.style.color="#00ffb4"; }}
          onMouseLeave={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.07)"; e.currentTarget.style.color="rgba(255,255,255,0.3)"; }}
        >
          <Maximize2 style={{ width:9, height:9 }} />
          <span>استعادة الكل</span>
        </button>
      </div>
    </div>
  );
}

// ─── Main Desktop ─────────────────────────────────────────────────────────────
export default function Desktop() {
  const [, navigate] = useLocation();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [wins, setWins] = useState<WinInst[]>([]);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<"all" | "basics" | "ai" | "security" | "network" | "system">("all");
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>([
    mkNotif("مرحباً بك في CyberNova", "منصة الأمن السيبراني المتكاملة جاهزة.", "info"),
    mkNotif("Ollama فقط", "هذه النسخة تعمل بـ Ollama محلياً — لا تحتاج مفاتيح API.", "info"),
  ]);
  const [showTaskManager, setShowTaskManager] = useState(false);
  const [leftSidebarExpanded, setLeftSidebarExpanded] = useState(true);
  const [novaMenuOpen, setNovaMenuOpen] = useState(false);
  const [dockScale, setDockScale] = useState(1);
  const [dockExpanded, setDockExpanded] = useState(false);
  const [sysStats, setSysStats] = useState({ cpu: 0, ram: 0, services: 0 });
  const [sysDetails, setSysDetails] = useState<{ cpu: { model: string; cores: number; usage: number }; memory: { total: number; used: number; usagePercent: number } } | null>(null);
  const [apiStatus, setApiStatus] = useState<"checking" | "online" | "offline">("checking");
  const [now, setNow] = useState(new Date());
  const [liveProgress, setLiveProgress] = useState(72);
  const [brainPower, setBrainPower] = useState<number>(() => {
    try { return Math.min(99, Number(localStorage.getItem("cybernova_brain_power") ?? "15")); } catch { return 15; }
  });
  // ── Theme switcher ─────────────────────────────────────────────────────
  const [desktopTheme, setDesktopTheme] = useState<"green"|"red"|"blue"|"purple">(() => {
    try { return (localStorage.getItem("cybernova_theme") as "green"|"red"|"blue"|"purple") ?? "green"; } catch { return "green"; }
  });
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const THEMES = {
    green:  { label:"أخضر", col:"#00ffb4", rgb:"0,255,180",   glow:"rgba(0,255,180,0.06)"  },
    red:    { label:"أحمر", col:"#ff4466", rgb:"255,68,102",  glow:"rgba(255,68,102,0.06)" },
    blue:   { label:"أزرق", col:"#00ccff", rgb:"0,204,255",   glow:"rgba(0,204,255,0.06)"  },
    purple: { label:"بنفسجي",col:"#aa55ff", rgb:"170,85,255", glow:"rgba(170,85,255,0.06)" },
  };
  const theme = THEMES[desktopTheme];
  // ── Favorites/Pinning system ───────────────────────────────────────────
  const [favorites, setFavorites] = useState<Set<WinKind>>(() => {
    try {
      const saved = localStorage.getItem("cybernova_favorites");
      return new Set(saved ? JSON.parse(saved) as WinKind[] : []);
    } catch { return new Set(); }
  });
  const toggleFavorite = useCallback((kind: WinKind) => {
    setFavorites(prev => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind); else next.add(kind);
      try { localStorage.setItem("cybernova_favorites", JSON.stringify([...next])); } catch { /**/ }
      return next;
    });
  }, []);
  // ── CVE critical count badge ───────────────────────────────────────────
  const [cveCriticalCount, setCveCriticalCount] = useState(0);
  useEffect(() => {
    const fetchCveCount = async () => {
      try {
        const r = await fetch(API_URL("/stats/dashboard"), { signal: AbortSignal.timeout(5000) });
        if (r.ok) { const d = await r.json(); setCveCriticalCount(d.criticalCves ?? d.critical ?? 0); }
      } catch { /**/ }
    };
    void fetchCveCount();
    const t = setInterval(() => void fetchCveCount(), 60000);
    return () => clearInterval(t);
  }, []);
  const CVE_BADGE_KINDS: WinKind[] = ["cves", "cve-live", "cve-db", "mitre", "vulnerability-checker"];
  // ── Draggable desktop icon positions ───────────────────────────────────
  const [iconPositions, setIconPositions] = useState<Record<string, IconPos>>(() => {
    try {
      const saved = localStorage.getItem("cybernova_icon_positions_v2");
      if (saved) return JSON.parse(saved) as Record<string, IconPos>;
    } catch { /* ignore */ }
    // Default grid: columns from RIGHT edge going left, 10 per column
    const positions: Record<string, IconPos> = {};
    APPS.forEach((app, i) => {
      const col = Math.floor(i / 10);
      const row = i % 10;
      // Right-side icons, move them left with each column
      positions[app.kind] = { x: window.innerWidth - 88 - col * 90, y: 18 + row * 84 };
    });
    return positions;
  });

  // ── Save icon positions ────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem("cybernova_icon_positions_v2", JSON.stringify(iconPositions)); } catch { /* ignore */ }
  }, [iconPositions]);

  const moveIcon = useCallback((kind: string, x: number, y: number) => {
    setIconPositions(prev => ({ ...prev, [kind]: { x, y } }));
  }, []);

  // ── Session restore ────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as WinInst[];
        setWins(parsed.map((w) => ({ ...w, minimized: false })));
      }
    } catch { /* ignore */ }
  }, []);

  // ── Session save ───────────────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(wins)); } catch { /* ignore */ }
  }, [wins]);

  // ── Brain Power: grows with each tool activation ───────────────────────
  useEffect(() => {
    if (wins.length > 0) {
      setBrainPower(prev => {
        const next = Math.min(99, prev + 0.5);
        try { localStorage.setItem("cybernova_brain_power", String(next)); } catch { /**/ }
        return next;
      });
    }
  }, [wins.length]);

  // ── Clock ──────────────────────────────────────────────────────────────
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  // ── System metrics (real API) ───────────────────────────────────────────
  useEffect(() => {
    const fetchSys = async () => {
      try {
        const r = await fetch(API_URL("/monitor/system"), { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
          const d = await r.json();
          setSysStats({ cpu: d.cpu?.usage ?? 0, ram: d.memory?.usagePercent ?? 0, services: 0 });
          setSysDetails(d);
        }
      } catch { /* offline */ }
      setLiveProgress(55 + Math.random() * 35);
    };
    void fetchSys();
    const t = setInterval(() => void fetchSys(), 8000);
    return () => clearInterval(t);
  }, []);

  // ── API health ─────────────────────────────────────────────────────────
  useEffect(() => {
    const check = async () => {
      try { const r = await fetch(API_URL("/healthz"), { signal: AbortSignal.timeout(3000) }); setApiStatus(r.ok ? "online" : "offline"); }
      catch { setApiStatus("offline"); }
    };
    void check(); const t = setInterval(check, 15000); return () => clearInterval(t);
  }, []);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      // Global launcher
      if (ctrl && e.key === "k") { e.preventDefault(); setLauncherOpen((v) => !v); }
      // Quick open tools
      if (ctrl && e.key === "t") { e.preventDefault(); openWindow("terminal"); }
      if (ctrl && e.key === "b") { e.preventDefault(); openWindow("browser"); }
      if (ctrl && e.key === "d") { e.preventDefault(); openWindow("dashboard"); }
      if (ctrl && e.key === "n") { e.preventDefault(); openWindow("nova-sentinel"); }
      if (ctrl && e.key === "s") { e.preventDefault(); openWindow("scanner"); }
      if (ctrl && e.key === "p") { e.preventDefault(); openWindow("reports"); }
      // Nova menu
      if (ctrl && e.key === "m") { e.preventDefault(); setNovaMenuOpen((v) => !v); }
      // Close active / hide all
      if (ctrl && e.key === "w") { e.preventDefault(); setWins((p) => { const top = [...p].sort((a,b)=>b.z-a.z)[0]; return top ? p.filter(w=>w.id!==top.id) : p; }); }
      if (ctrl && e.shiftKey && e.key === "W") { e.preventDefault(); setWins([]); }
      // Minimize all / restore all
      if (ctrl && e.key === "h") { e.preventDefault(); setWins((p) => p.map(w=>({...w, minimized:true}))); }
      // Escape closes overlays
      if (e.key === "Escape") { setLauncherOpen(false); setNotifOpen(false); setNovaMenuOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Window management ──────────────────────────────────────────────────
  const openWindow = useCallback((kind: WinKind, meta?: Record<string, unknown>) => {
    const existing = wins.find((w) => w.kind === kind);
    if (existing) {
      zCounter += 1;
      setWins((prev) => prev.map((w) => w.id === existing.id ? { ...w, z: zCounter, minimized: false } : w));
      return;
    }
    setWins((prev) => [...prev, newInst(kind, meta)]);
  }, [wins]);

  const focusWindow  = useCallback((id: string) => { zCounter += 1; setWins((p) => p.map((w) => w.id === id ? { ...w, z: zCounter } : w)); }, []);
  const closeWindow  = useCallback((id: string) => setWins((p) => {
    const next = p.filter((w) => w.id !== id);
    if (next.length === 0) cascadeIdx = 0; // reset cascade when all windows closed
    return next;
  }), []);
  const minimize     = useCallback((id: string) => setWins((p) => p.map((w) => w.id === id ? { ...w, minimized: true } : w)), []);
  const maximize     = useCallback((id: string) => setWins((p) => p.map((w) => w.id === id ? { ...w, maximized: !w.maximized } : w)), []);
  const moveWin      = useCallback((id: string, x: number, y: number) => setWins((p) => p.map((w) => w.id === id ? { ...w, x, y } : w)), []);
  const resizeWin    = useCallback((id: string, ww: number, hh: number) => setWins((p) => p.map((w) => w.id === id ? { ...w, w: ww, h: hh } : w)), []);

  const handleClientTool = useCallback((e: ClientToolEvent) => {
    if (e.name === "open_window" && e.input?.kind) openWindow(e.input.kind as WinKind);
  }, [openWindow]);

  const unreadCount = notifs.filter((n) => !n.read).length;

  const CATEGORIES = [
    { id: "all",      label: "الكل",             icon: LayoutDashboard, color: "text-white",       glow: "shadow-[0_0_15px_rgba(255,255,255,0.1)]" },
    { id: "basics",   label: "الأساسيات",        icon: Command,         color: "text-cyan-400",    glow: "shadow-[0_0_15px_rgba(34,211,238,0.2)]"  },
    { id: "ai",       label: "الذكاء الاصطناعي", icon: Brain,           color: "text-purple-400",  glow: "shadow-[0_0_15px_rgba(192,132,252,0.2)]" },
    { id: "security", label: "الأمن",            icon: Shield,          color: "text-red-400",     glow: "shadow-[0_0_15px_rgba(248,113,113,0.2)]" },
    { id: "network",  label: "الشبكات",           icon: Network,         color: "text-blue-400",    glow: "shadow-[0_0_15px_rgba(96,165,250,0.2)]"  },
    { id: "system",   label: "النظام",            icon: Cpu,             color: "text-emerald-400", glow: "shadow-[0_0_15px_rgba(52,211,153,0.2)]"  },
  ] as const;

  const filteredApps = APPS.filter((a) =>
    (selectedCategory === "all" || a.category === selectedCategory) &&
    (searchQuery === "" || a.label.includes(searchQuery) || a.desc.includes(searchQuery) || a.kind.includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="w-screen h-screen text-white flex flex-col overflow-hidden relative" dir="rtl" style={{
      background: `radial-gradient(ellipse 80% 60% at 50% 0%, rgba(${theme.rgb},0.04) 0%, transparent 70%), radial-gradient(ellipse 60% 80% at 80% 100%, rgba(100,0,255,0.05) 0%, transparent 70%), #020408`,
    }}>
      <ParticleCanvas />

      {/* ── HACKER DESKTOP BACKGROUND ── */}
      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        {/* Hex grid pattern */}
        <div style={{
          position:"absolute", inset:0,
          backgroundImage:`
            linear-gradient(rgba(0,255,180,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,255,180,0.03) 1px, transparent 1px)
          `,
          backgroundSize:"48px 48px",
        }} />
        {/* Diagonal circuit traces */}
        <div style={{
          position:"absolute", inset:0,
          backgroundImage:`
            repeating-linear-gradient(45deg, transparent, transparent 60px, rgba(0,180,255,0.015) 60px, rgba(0,180,255,0.015) 61px),
            repeating-linear-gradient(-45deg, transparent, transparent 80px, rgba(0,255,100,0.012) 80px, rgba(0,255,100,0.012) 81px)
          `,
        }} />
        {/* Ambient glow orbs */}
        <div style={{ position:"absolute", top:"15%", left:"25%", width:700, height:700, background:"radial-gradient(circle, rgba(0,255,180,0.045), transparent 70%)", borderRadius:"50%", filter:"blur(60px)", animation:"pulse 9s ease-in-out infinite" }} />
        <div style={{ position:"absolute", bottom:"20%", right:"15%", width:500, height:500, background:"radial-gradient(circle, rgba(120,0,255,0.04), transparent 70%)", borderRadius:"50%", filter:"blur(80px)", animation:"pulse 13s ease-in-out infinite reverse" }} />
        <div style={{ position:"absolute", top:"55%", left:"50%", width:350, height:350, background:"radial-gradient(circle, rgba(255,50,50,0.03), transparent 70%)", borderRadius:"50%", filter:"blur(60px)", animation:"pulse 7s ease-in-out infinite" }} />
        <div style={{ position:"absolute", top:"30%", right:"40%", width:250, height:250, background:"radial-gradient(circle, rgba(0,150,255,0.04), transparent 70%)", borderRadius:"50%", filter:"blur(50px)", animation:"pulse 11s ease-in-out infinite" }} />
        {/* Scan lines */}
        <div style={{
          position:"absolute", inset:0,
          backgroundImage:"repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,180,0.014) 2px, rgba(0,255,180,0.014) 4px)",
          backgroundSize:"100% 4px",
        }} />
        {/* Vignette */}
        <div style={{
          position:"absolute", inset:0,
          background:"radial-gradient(ellipse 100% 100% at 50% 50%, transparent 50%, rgba(0,0,0,0.5) 100%)",
        }} />
        {/* Top neon bar */}
        <div style={{ position:"absolute", top:0, left:0, right:0, height:1, background:"linear-gradient(90deg, transparent, rgba(0,255,180,0.4) 20%, rgba(0,180,255,0.6) 50%, rgba(0,255,180,0.4) 80%, transparent)", pointerEvents:"none" }} />
        {/* Bottom neon bar */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:1, background:"linear-gradient(90deg, transparent, rgba(0,255,180,0.3) 30%, rgba(120,0,255,0.4) 50%, rgba(0,255,180,0.3) 70%, transparent)", pointerEvents:"none" }} />
      </div>

      {/* CyberNova Comprehensive Dropdown */}
      {novaMenuOpen && (
        <div style={{
          position:"fixed", inset:0, zIndex:4000,
        }}>
          <div style={{ position:"absolute", inset:0 }} onClick={() => setNovaMenuOpen(false)} />
          <div style={{
            position:"absolute", top:44, right:"auto", left:12,
            width:520, maxHeight:"calc(100vh - 60px)",
            background:"rgba(4,5,16,0.98)",
            border:"1px solid rgba(0,255,180,0.25)",
            borderRadius:20, overflow:"hidden",
            boxShadow:"0 0 60px rgba(0,255,180,0.1), 0 24px 80px rgba(0,0,0,0.9)",
            backdropFilter:"blur(32px)",
            display:"flex", flexDirection:"column",
            animation:"fadeIn 0.15s ease",
          }}>
            {/* Nova menu header */}
            <div style={{
              padding:"14px 16px 12px",
              background:"linear-gradient(135deg, rgba(0,255,180,0.08), rgba(0,180,255,0.05))",
              borderBottom:"1px solid rgba(0,255,180,0.15)",
              display:"flex", alignItems:"center", justifyContent:"space-between",
            }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{
                  width:32, height:32, borderRadius:10,
                  background:"linear-gradient(135deg,rgba(0,255,180,0.2),rgba(0,180,255,0.15))",
                  border:"1px solid rgba(0,255,180,0.3)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                  boxShadow:"0 0 16px rgba(0,255,180,0.15)",
                }}>
                  <LayoutGrid style={{ width:16, height:16, color:"#00ffb4" }} />
                </div>
                <div>
                  <div style={{ fontFamily:"monospace", fontWeight:900, fontSize:13, color:"#00ffb4", letterSpacing:"0.1em", textShadow:"0 0 10px rgba(0,255,180,0.5)" }}>CYBERNOVA OS</div>
                  <div style={{ fontFamily:"monospace", fontSize:9, color:"rgba(0,255,180,0.4)", letterSpacing:"0.08em" }}>ULTIMATE HACKER PLATFORM v4.0</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:"monospace", fontSize:14, fontWeight:900, color: sysStats.cpu < 80 ? "#00ffb4" : "#ffaa00", textShadow:`0 0 8px ${sysStats.cpu < 80 ? "rgba(0,255,180,0.5)" : "rgba(255,170,0,0.5)"}` }}>{sysStats.cpu.toFixed(0)}%</div>
                  <div style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.3)" }}>CPU</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:"monospace", fontSize:14, fontWeight:900, color:"#aa44ff", textShadow:"0 0 8px rgba(170,68,255,0.5)" }}>{sysStats.ram.toFixed(0)}%</div>
                  <div style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.3)" }}>RAM</div>
                </div>
                <div style={{ textAlign:"center" }}>
                  <div style={{ fontFamily:"monospace", fontSize:14, fontWeight:900, color: apiStatus==="online"?"#44ff88":"#ff5555", textShadow:`0 0 8px ${apiStatus==="online"?"rgba(68,255,136,0.5)":"rgba(255,85,85,0.5)"}` }}>
                    {apiStatus==="online"?"LIVE":"OFF"}
                  </div>
                  <div style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.3)" }}>API</div>
                </div>
              </div>
            </div>

            {/* Nova menu shortcuts bar */}
            <div style={{ padding:"8px 12px", borderBottom:"1px solid rgba(255,255,255,0.05)", display:"flex", gap:6, flexWrap:"wrap" }}>
              {[
                { label:"⌘K قاذفة", action:()=>{setLauncherOpen(true);setNovaMenuOpen(false);} },
                { label:"⌘T ترمينال", action:()=>{openWindow("terminal");setNovaMenuOpen(false);} },
                { label:"⌘B متصفح", action:()=>{openWindow("browser");setNovaMenuOpen(false);} },
                { label:"⌘N سينتينل", action:()=>{openWindow("nova-sentinel");setNovaMenuOpen(false);} },
                { label:"⌘H اخفاء الكل", action:()=>{setWins(p=>p.map(w=>({...w,minimized:true})));setNovaMenuOpen(false);} },
                { label:"⌘W اغلاق الكل", action:()=>{setWins([]);setNovaMenuOpen(false);} },
              ].map(s => (
                <button key={s.label} onClick={s.action}
                  style={{
                    fontFamily:"monospace", fontSize:9, color:"rgba(0,255,180,0.6)",
                    background:"rgba(0,255,180,0.06)", border:"1px solid rgba(0,255,180,0.15)",
                    borderRadius:6, padding:"3px 8px", cursor:"pointer", transition:"all 0.12s",
                    whiteSpace:"nowrap",
                  }}
                  onMouseEnter={e=>(e.currentTarget.style.background="rgba(0,255,180,0.12)")}
                  onMouseLeave={e=>(e.currentTarget.style.background="rgba(0,255,180,0.06)")}
                >{s.label}</button>
              ))}
            </div>

            {/* Apps by category */}
            <div style={{ overflow:"auto", flex:1, padding:"8px 12px", scrollbarWidth:"thin", scrollbarColor:"rgba(0,255,180,0.2) transparent" }}>
              {[
                { id:"basics",   label:"الأساسيات",        color:"#44eebb", rgb:"68,238,187" },
                { id:"ai",       label:"الذكاء الاصطناعي", color:"#aa44ff", rgb:"170,68,255" },
                { id:"security", label:"الأمن السيبراني",  color:"#ff5555", rgb:"255,85,85"  },
                { id:"network",  label:"الشبكات",           color:"#4488ff", rgb:"68,136,255" },
                { id:"system",   label:"النظام والأدوات",  color:"#44ff88", rgb:"68,255,136" },
              ].map(cat => {
                const catApps = APPS.filter(a => a.category === cat.id);
                return (
                  <div key={cat.id} style={{ marginBottom:12 }}>
                    <div style={{
                      fontFamily:"monospace", fontSize:10, fontWeight:900,
                      color:cat.color, letterSpacing:"0.08em",
                      marginBottom:6, display:"flex", alignItems:"center", gap:8,
                      textShadow:`0 0 8px rgba(${cat.rgb},0.4)`,
                    }}>
                      <div style={{ flex:1, height:1, background:`linear-gradient(90deg, rgba(${cat.rgb},0.4), transparent)` }} />
                      {cat.label}
                      <span style={{ fontSize:8, opacity:0.5 }}>({catApps.length})</span>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4 }}>
                      {catApps.map(app => {
                        const running = wins.some(w=>w.kind===app.kind);
                        return (
                          <button key={app.kind}
                            onClick={() => { openWindow(app.kind); setNovaMenuOpen(false); }}
                            style={{
                              display:"flex", alignItems:"center", gap:6,
                              padding:"6px 8px", borderRadius:10, cursor:"pointer",
                              background: running ? `rgba(${cat.rgb},0.1)` : "rgba(255,255,255,0.02)",
                              border:`1px solid ${running ? `rgba(${cat.rgb},0.3)` : "rgba(255,255,255,0.05)"}`,
                              transition:"all 0.12s", textAlign:"right",
                            }}
                            onMouseEnter={e=>{ e.currentTarget.style.background=`rgba(${cat.rgb},0.08)`; e.currentTarget.style.borderColor=`rgba(${cat.rgb},0.25)`; }}
                            onMouseLeave={e=>{ e.currentTarget.style.background=running?`rgba(${cat.rgb},0.1)`:"rgba(255,255,255,0.02)"; e.currentTarget.style.borderColor=running?`rgba(${cat.rgb},0.3)`:"rgba(255,255,255,0.05)"; }}
                          >
                            <app.icon style={{ width:12, height:12, color:running?cat.color:"rgba(255,255,255,0.4)", flexShrink:0 }} />
                            <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:700, color:running?"rgba(255,255,255,0.85)":"rgba(255,255,255,0.4)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {app.label}
                            </span>
                            {running && <div style={{ width:4, height:4, borderRadius:"50%", background:cat.color, boxShadow:`0 0 4px ${cat.color}`, flexShrink:0 }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Nova menu footer */}
            <div style={{
              padding:"8px 14px",
              borderTop:"1px solid rgba(0,255,180,0.1)",
              background:"rgba(0,0,0,0.3)",
              display:"flex", alignItems:"center", justifyContent:"space-between",
            }}>
              <span style={{ fontFamily:"monospace", fontSize:9, color:"rgba(0,255,180,0.3)" }}>
                {wins.length} نافذة مفتوحة · {wins.filter(w=>w.minimized).length} مصغّرة
              </span>
              <span style={{ fontFamily:"monospace", fontSize:9, color:"rgba(255,255,255,0.2)" }}>
                {now.toLocaleTimeString("ar-EG")}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── TOP HEADER ─────────────────────────────────────────────────── */}
      <header style={{
        height:46, flexShrink:0, display:"flex", alignItems:"center",
        padding:"0 10px", gap:8,
        background:"linear-gradient(90deg, rgba(0,255,180,0.04) 0%, rgba(0,0,0,0.85) 40%, rgba(0,0,0,0.85) 60%, rgba(0,180,255,0.04) 100%)",
        backdropFilter:"blur(32px) saturate(180%)",
        borderBottom:"1px solid rgba(0,255,180,0.12)",
        boxShadow:"0 1px 0 rgba(0,255,180,0.06), 0 2px 20px rgba(0,0,0,0.5)",
        position:"relative", zIndex:1200,
      }}>
        {/* Accent line */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:1, background:"linear-gradient(90deg,transparent,rgba(0,255,180,0.3) 25%,rgba(0,180,255,0.3) 50%,rgba(0,255,180,0.3) 75%,transparent)", pointerEvents:"none" }} />

        {/* ── LEFT: Nova button + stats ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          {/* CyberNova button */}
          <button
            onClick={() => setNovaMenuOpen(v => !v)}
            style={{
              display:"flex", alignItems:"center", gap:7,
              padding:"5px 12px", borderRadius:12,
              background: novaMenuOpen ? "rgba(0,255,180,0.18)" : "rgba(0,255,180,0.08)",
              border:`1px solid ${novaMenuOpen ? "rgba(0,255,180,0.5)" : "rgba(0,255,180,0.25)"}`,
              cursor:"pointer", transition:"all 0.15s",
              boxShadow: novaMenuOpen ? "0 0 20px rgba(0,255,180,0.2)" : "0 0 8px rgba(0,255,180,0.06)",
            }}
            onMouseEnter={e=>{ if(!novaMenuOpen){ e.currentTarget.style.background="rgba(0,255,180,0.14)"; e.currentTarget.style.borderColor="rgba(0,255,180,0.4)"; } }}
            onMouseLeave={e=>{ if(!novaMenuOpen){ e.currentTarget.style.background="rgba(0,255,180,0.08)"; e.currentTarget.style.borderColor="rgba(0,255,180,0.25)"; } }}
          >
            <div style={{ position:"relative", width:16, height:16 }}>
              <div style={{ position:"absolute", inset:0, background:"rgba(0,255,180,0.35)", borderRadius:"50%", filter:"blur(6px)", animation:"pulse 2s ease-in-out infinite" }} />
              <LayoutGrid style={{ width:16, height:16, color:"#00ffb4", position:"relative", zIndex:1, filter:"drop-shadow(0 0 4px rgba(0,255,180,0.7))" }} />
            </div>
            <span style={{ fontFamily:"monospace", fontWeight:900, fontSize:11, color:"#00ffb4", letterSpacing:"0.15em", textShadow:"0 0 10px rgba(0,255,180,0.5)" }}>CYBERNOVA</span>
            <span style={{ fontFamily:"monospace", fontSize:8, color:"rgba(0,255,180,0.4)" }}>⌘M</span>
          </button>

          {/* Launcher button */}
          <button onClick={() => setLauncherOpen(true)} title="قاذفة التطبيقات (⌘K)"
            style={{
              width:30, height:30, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center",
              background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)",
              cursor:"pointer", transition:"all 0.12s", color:"rgba(255,255,255,0.45)",
            }}
            onMouseEnter={e=>{ e.currentTarget.style.background="rgba(0,255,180,0.1)"; e.currentTarget.style.borderColor="rgba(0,255,180,0.25)"; (e.currentTarget.firstChild as HTMLElement).style.color="#00ffb4"; }}
            onMouseLeave={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.04)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.08)"; (e.currentTarget.firstChild as HTMLElement).style.color="rgba(255,255,255,0.45)"; }}
          >
            <Search style={{ width:13, height:13, color:"rgba(255,255,255,0.45)", transition:"color 0.12s" }} />
          </button>

          {/* Divider */}
          <div style={{ width:1, height:22, background:"rgba(255,255,255,0.08)" }} />

          {/* CPU */}
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <Cpu style={{ width:11, height:11, color: sysStats.cpu < 80 ? "#00ffb4" : "#ffaa00", filter:`drop-shadow(0 0 3px ${sysStats.cpu < 80 ? "rgba(0,255,180,0.6)" : "rgba(255,170,0,0.6)"})` }} />
            <span style={{ fontFamily:"monospace", fontSize:10, color:"rgba(255,255,255,0.25)" }}>CPU</span>
            <span style={{ fontFamily:"monospace", fontSize:10, fontWeight:900, color: sysStats.cpu < 80 ? "#00ffb4" : "#ffaa00", textShadow:`0 0 6px ${sysStats.cpu < 80 ? "rgba(0,255,180,0.5)" : "rgba(255,170,0,0.5)"}` }}>{sysStats.cpu.toFixed(0)}%</span>
          </div>

          {/* RAM */}
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <MemoryStick style={{ width:11, height:11, color:"#aa44ff", filter:"drop-shadow(0 0 3px rgba(170,68,255,0.6))" }} />
            <span style={{ fontFamily:"monospace", fontSize:10, color:"rgba(255,255,255,0.25)" }}>RAM</span>
            <span style={{ fontFamily:"monospace", fontSize:10, fontWeight:900, color:"#aa44ff", textShadow:"0 0 6px rgba(170,68,255,0.5)" }}>{sysStats.ram.toFixed(0)}%</span>
          </div>

          {/* Brain Power */}
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <Brain style={{ width:11, height:11, color:"#cc44ff", filter:"drop-shadow(0 0 3px rgba(200,68,255,0.6))" }} />
            <div style={{ width:36, height:4, background:"rgba(255,255,255,0.06)", borderRadius:4, overflow:"hidden", border:"1px solid rgba(200,68,255,0.2)" }}>
              <div style={{ height:"100%", width:`${brainPower}%`, background:"linear-gradient(90deg,#7722aa,#cc44ff)", borderRadius:4, boxShadow:"1px 0 6px rgba(200,68,255,0.6)", transition:"width 1s" }} />
            </div>
            <span style={{ fontFamily:"monospace", fontSize:10, fontWeight:900, color:"#cc44ff", textShadow:"0 0 6px rgba(200,68,255,0.5)" }}>{brainPower.toFixed(0)}%</span>
          </div>

          {/* ── Theme Switcher ── */}
          <div style={{ position:"relative" }}>
            <button onClick={() => setThemeMenuOpen(v => !v)} title="تغيير الثيم"
              style={{
                width:30, height:30, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center",
                background: themeMenuOpen ? `rgba(${theme.rgb},0.15)` : "rgba(255,255,255,0.04)",
                border: `1px solid ${themeMenuOpen ? `rgba(${theme.rgb},0.4)` : "rgba(255,255,255,0.08)"}`,
                cursor:"pointer", transition:"all 0.12s",
              }}>
              <Palette style={{ width:13, height:13, color: theme.col, filter:`drop-shadow(0 0 4px rgba(${theme.rgb},0.7))` }} />
            </button>
            {themeMenuOpen && (
              <>
                <div style={{ position:"fixed", inset:0, zIndex:2998 }} onClick={() => setThemeMenuOpen(false)} />
                <div style={{
                  position:"absolute", top:"calc(100% + 6px)", left:"50%", transform:"translateX(-50%)",
                  zIndex:2999, background:"rgba(4,5,16,0.97)", borderRadius:14,
                  border:`1px solid rgba(${theme.rgb},0.25)`,
                  boxShadow:`0 8px 32px rgba(0,0,0,0.8), 0 0 20px rgba(${theme.rgb},0.1)`,
                  padding:10, display:"flex", flexDirection:"column", gap:5, minWidth:120,
                }}>
                  <div style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.3)", letterSpacing:"0.1em", marginBottom:3, textAlign:"center" }}>لون النيون</div>
                  {(Object.entries(THEMES) as [typeof desktopTheme, typeof THEMES.green][]).map(([key, t]) => (
                    <button key={key} onClick={() => { setDesktopTheme(key); localStorage.setItem("cybernova_theme", key); setThemeMenuOpen(false); }}
                      style={{
                        display:"flex", alignItems:"center", gap:8, padding:"5px 10px", borderRadius:8, cursor:"pointer",
                        background: desktopTheme === key ? `rgba(${t.rgb},0.18)` : "rgba(255,255,255,0.03)",
                        border: `1px solid ${desktopTheme === key ? `rgba(${t.rgb},0.4)` : "transparent"}`,
                        transition:"all 0.12s",
                      }}>
                      <div style={{ width:10, height:10, borderRadius:"50%", background:t.col, boxShadow:`0 0 6px ${t.col}` }} />
                      <span style={{ fontFamily:"monospace", fontSize:10, fontWeight:desktopTheme===key?900:600, color: desktopTheme===key ? t.col : "rgba(255,255,255,0.45)" }}>{t.label}</span>
                      {desktopTheme === key && <span style={{ marginRight:"auto", fontSize:8, color:t.col }}>✓</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* CVE Live */}
          <button onClick={() => openWindow("cve-live")} title="CVE LIVE"
            style={{ display:"flex", alignItems:"center", gap:4, background:"transparent", border:"none", cursor:"pointer", padding:"2px 4px", borderRadius:6 }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,85,85,0.08)"}
            onMouseLeave={e=>e.currentTarget.style.background="transparent"}
          >
            <div style={{ width:5, height:5, borderRadius:"50%", background:"#ff5555", boxShadow:"0 0 6px #ff5555", animation:"pulse 1.5s ease-in-out infinite" }} />
            <ShieldAlert style={{ width:11, height:11, color:"#ff5555", filter:"drop-shadow(0 0 3px rgba(255,85,85,0.7))" }} />
            <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:900, color:"#ff5555", textShadow:"0 0 6px rgba(255,85,85,0.5)", letterSpacing:"0.06em" }}>CVE</span>
          </button>

          {/* ── Ollama Status Mini Panel ── */}
          <OllamaStatusMiniPanel />
        </div>

        {/* ── CENTER: Arabic scrolling ticker ── */}
        <div style={{
          flex:1, overflow:"hidden", position:"relative",
          height:30, display:"flex", alignItems:"center",
          margin:"0 8px",
        }}>
          {/* Left fade */}
          <div style={{ position:"absolute", left:0, top:0, bottom:0, width:40, background:"linear-gradient(90deg,rgba(0,0,0,0.8),transparent)", zIndex:2, pointerEvents:"none" }} />
          {/* Right fade */}
          <div style={{ position:"absolute", right:0, top:0, bottom:0, width:40, background:"linear-gradient(270deg,rgba(0,0,0,0.8),transparent)", zIndex:2, pointerEvents:"none" }} />

          <div style={{
            display:"flex", alignItems:"center",
            whiteSpace:"nowrap",
            animation:"ticker 50s linear infinite",
            direction:"rtl",
            gap:0,
          }}>
            {[1,2].map(rep => (
              <span key={rep} style={{
                fontFamily:"'Cairo','Tajawal','monospace',sans-serif",
                fontSize:13, fontWeight:700,
                color:"rgba(255,220,50,0.9)",
                textShadow:"0 0 10px rgba(255,220,50,0.6), 0 0 20px rgba(255,180,0,0.3)",
                letterSpacing:"0.05em",
                paddingLeft:60,
              }}>
                ★☆✦★ ☠ 🎯 ✦ · &nbsp;بسم الله&nbsp; · &nbsp;توكلت على الله&nbsp; · &nbsp;لا حول ولا قوة إلا بالله&nbsp; · &nbsp;الله أكبر&nbsp; 🎯 · &nbsp;رحلة المليار&nbsp; ⟶ 💰 ☠ 🎯 ^_^ ☠ · &nbsp;والفضل والحمد لله&nbsp; ★☆✦★
              </span>
            ))}
          </div>
        </div>

        {/* ── RIGHT: time + status + notifs ── */}
        <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
          {/* Progress bar */}
          <div style={{ display:"flex", alignItems:"center", gap:4 }}>
            <TrendingUp style={{ width:10, height:10, color:"#4488ff" }} />
            <div style={{ width:30, height:3, background:"rgba(255,255,255,0.06)", borderRadius:3, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${liveProgress}%`, background:"linear-gradient(90deg,#1144cc,#4488ff)", transition:"width 0.5s" }} />
            </div>
            <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:900, color:"#4488ff" }}>{liveProgress.toFixed(0)}%</span>
          </div>

          {/* API status */}
          <div style={{
            display:"flex", alignItems:"center", gap:5, padding:"3px 8px", borderRadius:8,
            background: apiStatus==="online" ? "rgba(68,255,136,0.08)" : apiStatus==="offline" ? "rgba(255,85,85,0.08)" : "rgba(255,255,255,0.04)",
            border:`1px solid ${apiStatus==="online" ? "rgba(68,255,136,0.2)" : apiStatus==="offline" ? "rgba(255,85,85,0.2)" : "rgba(255,255,255,0.08)"}`,
          }}>
            <div style={{
              width:5, height:5, borderRadius:"50%",
              background: apiStatus==="online" ? "#44ff88" : apiStatus==="offline" ? "#ff5555" : "#888",
              boxShadow: apiStatus==="online" ? "0 0 6px #44ff88" : apiStatus==="offline" ? "0 0 6px #ff5555" : "none",
              animation: apiStatus==="offline" ? "pulse 1s ease-in-out infinite" : "none",
            }} />
            <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:900, letterSpacing:"0.08em", color: apiStatus==="online" ? "#44ff88" : apiStatus==="offline" ? "#ff5555" : "rgba(255,255,255,0.3)" }}>
              {apiStatus==="online" ? "LIVE" : apiStatus==="offline" ? "OFF" : "..."}
            </span>
          </div>

          {/* Time */}
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:1 }}>
            <span style={{ fontFamily:"monospace", fontSize:12, fontWeight:900, color:"rgba(0,255,180,0.8)", letterSpacing:"0.08em", textShadow:"0 0 8px rgba(0,255,180,0.4)" }}>
              {now.toLocaleTimeString("en-US", { hour12:false, hour:"2-digit", minute:"2-digit", second:"2-digit" })}
            </span>
            <span style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.25)", letterSpacing:"0.04em" }}>
              {now.toLocaleDateString("ar-EG", { weekday:"short", day:"numeric", month:"short" })}
            </span>
          </div>

          {/* Notif bell */}
          <button onClick={() => setNotifOpen(!notifOpen)}
            style={{
              position:"relative", width:30, height:30, borderRadius:9,
              display:"flex", alignItems:"center", justifyContent:"center",
              background: notifOpen ? "rgba(0,255,180,0.15)" : "rgba(255,255,255,0.04)",
              border:`1px solid ${notifOpen ? "rgba(0,255,180,0.4)" : "rgba(255,255,255,0.08)"}`,
              cursor:"pointer", transition:"all 0.12s",
              color: notifOpen ? "#00ffb4" : "rgba(255,255,255,0.5)",
            }}
            onMouseEnter={e=>{ if(!notifOpen){ e.currentTarget.style.background="rgba(255,255,255,0.08)"; } }}
            onMouseLeave={e=>{ if(!notifOpen){ e.currentTarget.style.background="rgba(255,255,255,0.04)"; } }}
          >
            <BellRing style={{ width:14, height:14 }} />
            {unreadCount > 0 && (
              <div style={{ position:"absolute", top:-3, right:-3, width:14, height:14, borderRadius:"50%", background:"#ff3b30", border:"2px solid #050505", display:"flex", alignItems:"center", justifyContent:"center" }}>
                <span style={{ fontSize:7, fontWeight:900, color:"#fff" }}>{unreadCount}</span>
              </div>
            )}
          </button>

          {/* Close all windows */}
          {wins.length > 0 && (
            <button onClick={() => setWins([])} title="إغلاق كل النوافذ (⌘⇧W)"
              style={{
                display:"flex", alignItems:"center", gap:4, padding:"4px 8px", borderRadius:8,
                background:"rgba(255,85,85,0.08)", border:"1px solid rgba(255,85,85,0.2)",
                cursor:"pointer", transition:"all 0.12s", color:"#ff5555",
              }}
              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,85,85,0.16)"}
              onMouseLeave={e=>e.currentTarget.style.background="rgba(255,85,85,0.08)"}
            >
              <X style={{ width:11, height:11 }} />
              <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:900 }}>×{wins.length}</span>
            </button>
          )}

          {/* Home */}
          <button onClick={() => navigate("/")} title="الصفحة الرئيسية"
            style={{
              width:30, height:30, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center",
              background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)",
              cursor:"pointer", transition:"all 0.12s", color:"rgba(255,255,255,0.35)",
            }}
            onMouseEnter={e=>{ e.currentTarget.style.background="rgba(255,180,0,0.1)"; e.currentTarget.style.borderColor="rgba(255,180,0,0.3)"; e.currentTarget.style.color="#ffb400"; }}
            onMouseLeave={e=>{ e.currentTarget.style.background="rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor="rgba(255,255,255,0.07)"; e.currentTarget.style.color="rgba(255,255,255,0.35)"; }}
          >
            <LayoutDashboard style={{ width:13, height:13 }} />
          </button>
        </div>
      </header>

      {/* ── MAIN AREA ─────────────────────────────────────────────────── */}
      <main ref={surfaceRef} className="flex-1 relative z-10 flex overflow-hidden">
        {/* ── Left sidebar — COMMAND PANEL ────────────────────────────── */}
        <aside style={{
          width: leftSidebarExpanded ? 220 : 54,
          transition: "width 0.32s cubic-bezier(0.4,0,0.2,1)",
          flexShrink: 0, zIndex: 900, display: "flex", flexDirection: "column",
          overflow: "hidden", position: "relative",
          background: "linear-gradient(180deg, rgba(0,10,25,0.98) 0%, rgba(0,5,18,0.99) 60%, rgba(0,2,12,1) 100%)",
          borderRight: "1px solid rgba(0,255,180,0.14)",
          boxShadow: "4px 0 32px rgba(0,0,0,0.65), inset -1px 0 0 rgba(0,255,180,0.07)",
          paddingTop: 10, paddingBottom: 12,
        }}>
          {/* Ambient glow */}
          <div style={{ position:"absolute", top:0, left:0, right:0, height:200, background:"radial-gradient(ellipse 80% 40% at 50% 0%, rgba(0,255,180,0.05) 0%, transparent 100%)", pointerEvents:"none" }} />

          {/* ── Header / Toggle ── */}
          <div style={{ display:"flex", alignItems:"center", gap:8, padding:"0 11px", marginBottom:14 }}>
            <button onClick={() => setLeftSidebarExpanded(v => !v)}
              title={leftSidebarExpanded ? "طي الشريط" : "توسيع الشريط"}
              style={{
                width:32, height:32, borderRadius:9, flexShrink:0,
                background:"rgba(0,255,180,0.07)", border:"1px solid rgba(0,255,180,0.2)",
                display:"flex", alignItems:"center", justifyContent:"center",
                cursor:"pointer", transition:"all 0.18s",
              }}
              onMouseEnter={e=>{ e.currentTarget.style.background="rgba(0,255,180,0.14)"; e.currentTarget.style.borderColor="rgba(0,255,180,0.4)"; e.currentTarget.style.boxShadow="0 0 12px rgba(0,255,180,0.15)"; }}
              onMouseLeave={e=>{ e.currentTarget.style.background="rgba(0,255,180,0.07)"; e.currentTarget.style.borderColor="rgba(0,255,180,0.2)"; e.currentTarget.style.boxShadow="none"; }}
            >
              <PanelLeft style={{ width:14, height:14, color:"#00ffb4", transform: leftSidebarExpanded ? "none" : "rotate(180deg)", transition:"transform 0.3s", filter:"drop-shadow(0 0 4px rgba(0,255,180,0.5))" }} />
            </button>
            {leftSidebarExpanded && (
              <div style={{ overflow:"hidden" }}>
                <div style={{ fontFamily:"monospace", fontSize:9, fontWeight:900, color:"rgba(0,255,180,0.55)", textTransform:"uppercase", letterSpacing:"0.22em", whiteSpace:"nowrap", textShadow:"0 0 8px rgba(0,255,180,0.3)" }}>COMMAND PANEL</div>
                <div style={{ fontFamily:"monospace", fontSize:7.5, color:"rgba(0,255,180,0.25)", letterSpacing:"0.1em", marginTop:1 }}>{wins.length} نافذة نشطة</div>
              </div>
            )}
          </div>

          {/* Top separator */}
          <div style={{ margin:"0 10px 10px", height:1, background:"linear-gradient(90deg, rgba(0,255,180,0.18), rgba(0,255,180,0.06) 70%, transparent)" }} />

          {/* ── Category list ── */}
          <div style={{ flex:1, width:"100%", display:"flex", flexDirection:"column", gap:1, overflowY:"auto", overflowX:"hidden", scrollbarWidth:"none" }}>
            {CATEGORIES.map((cat) => {
              const active = selectedCategory === cat.id;
              const neonMap: Record<string, string> = {
                "text-cyan-400":"#22d3ee", "text-primary":"#00ffb4", "text-emerald-400":"#34d399",
                "text-violet-400":"#a78bfa", "text-rose-400":"#fb7185", "text-orange-400":"#fb923c",
                "text-yellow-400":"#facc15", "text-blue-400":"#60a5fa", "text-fuchsia-400":"#e879f9",
                "text-indigo-400":"#818cf8", "text-white":"#ffffff", "text-teal-400":"#2dd4bf",
              };
              const neonCol = Object.entries(neonMap).find(([k]) => cat.color.includes(k))?.[1] ?? "#00ffb4";
              const runningCount = cat.id === "all" ? wins.length : APPS.filter(a => a.category === cat.id).filter(a => wins.some(w => w.kind === a.kind)).length;
              const totalCount = cat.id === "all" ? APPS.length : APPS.filter(a => a.category === cat.id).length;

              return (
                <div key={cat.id} style={{ width:"100%", position:"relative" }} className="group/item">
                  <button onClick={() => setSelectedCategory(cat.id)} style={{
                    display:"flex", alignItems:"center", gap:10, width:"100%",
                    padding:"9px 11px", border:"none", cursor:"pointer", position:"relative", overflow:"hidden",
                    background: active
                      ? `linear-gradient(90deg, rgba(${neonCol.replace("#","").match(/../g)?.map(h=>parseInt(h,16)).join(",") ?? "0,255,180"},0.1) 0%, rgba(${neonCol.replace("#","").match(/../g)?.map(h=>parseInt(h,16)).join(",") ?? "0,255,180"},0.04) 100%)`
                      : "transparent",
                    borderLeft: active ? `2px solid ${neonCol}` : "2px solid transparent",
                    borderRight: "2px solid transparent",
                    transition:"all 0.16s",
                  }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background="rgba(255,255,255,0.03)"; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background="transparent"; }}
                  >
                    {active && <div style={{ position:"absolute", inset:0, background:`radial-gradient(ellipse 50% 100% at 0% 50%, ${neonCol}12, transparent)`, pointerEvents:"none" }} />}

                    {/* Icon */}
                    <div style={{
                      width:34, height:34, borderRadius:10, flexShrink:0,
                      display:"flex", alignItems:"center", justifyContent:"center",
                      background: active ? `rgba(${neonCol.replace("#","").match(/../g)?.map(h=>parseInt(h,16)).join(",") ?? "0,255,180"},0.12)` : "rgba(255,255,255,0.04)",
                      border:`1px solid ${active ? neonCol + "40" : "rgba(255,255,255,0.07)"}`,
                      boxShadow: active ? `0 0 12px rgba(${neonCol.replace("#","").match(/../g)?.map(h=>parseInt(h,16)).join(",") ?? "0,255,180"},0.2)` : "none",
                      transition:"all 0.16s",
                      position:"relative",
                    }}>
                      <cat.icon style={{ width:16, height:16, color: active ? neonCol : "rgba(255,255,255,0.35)", filter: active ? `drop-shadow(0 0 5px ${neonCol})` : "none", transition:"all 0.16s" }} />
                      {runningCount > 0 && (
                        <div style={{ position:"absolute", top:-4, right:-4, width:14, height:14, borderRadius:"50%", background:neonCol, display:"flex", alignItems:"center", justifyContent:"center", border:"2px solid rgba(0,2,12,1)", boxShadow:`0 0 6px ${neonCol}` }}>
                          <span style={{ fontFamily:"monospace", fontSize:7, fontWeight:900, color:"#000", lineHeight:1 }}>{runningCount}</span>
                        </div>
                      )}
                    </div>

                    {/* Label + count — only when expanded */}
                    {leftSidebarExpanded && (
                      <div style={{ flex:1, minWidth:0, display:"flex", flexDirection:"column", gap:1 }}>
                        <span style={{
                          fontSize:12, fontWeight:800, whiteSpace:"nowrap",
                          color: active ? neonCol : "rgba(255,255,255,0.55)",
                          textShadow: active ? `0 0 10px ${neonCol}70` : "none",
                          letterSpacing:"0.02em", transition:"color 0.16s",
                        }}>{cat.label}</span>
                        <span style={{
                          fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.2)", letterSpacing:"0.06em",
                        }}>{totalCount} أداة{runningCount > 0 ? ` · ${runningCount} شغّال` : ""}</span>
                      </div>
                    )}
                  </button>

                  {/* Flyout — shows on hover over the entire row */}
                  {cat.id !== "all" && (
                    <div className="group-hover/item:block" style={{
                      position:"absolute", left:"100%", top:0, marginLeft:8, width:272,
                      background:"rgba(2,4,18,0.98)", backdropFilter:"blur(24px) saturate(180%)",
                      border:`1px solid ${neonCol}28`, borderRadius:16,
                      padding:"12px 10px", display:"none",
                      boxShadow:`0 0 48px rgba(0,0,0,0.85), 0 0 24px ${neonCol}12`,
                      zIndex:960,
                    }}>
                      {/* Flyout header */}
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, padding:"0 4px" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          <div style={{ width:20, height:20, borderRadius:6, background:`rgba(${neonCol.replace("#","").match(/../g)?.map(h=>parseInt(h,16)).join(",") ?? "0,255,180"},0.12)`, border:`1px solid ${neonCol}30`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                            <cat.icon style={{ width:11, height:11, color:neonCol }} />
                          </div>
                          <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:900, color:neonCol, textTransform:"uppercase", letterSpacing:"0.14em", textShadow:`0 0 8px ${neonCol}60` }}>{cat.label}</span>
                        </div>
                        <span style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.2)", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.06)", borderRadius:6, padding:"2px 7px" }}>
                          {APPS.filter(a => a.category === cat.id).length} أداة
                        </span>
                      </div>
                      {/* Divider */}
                      <div style={{ height:1, background:`linear-gradient(90deg, ${neonCol}30, transparent)`, marginBottom:8 }} />
                      <div style={{ display:"flex", flexDirection:"column", gap:1, maxHeight:"60vh", overflowY:"auto", scrollbarWidth:"thin", scrollbarColor:`${neonCol}30 transparent` }}>
                        {APPS.filter(a => a.category === cat.id).map(app => {
                          const isRunning = wins.some(w => w.kind === app.kind);
                          return (
                            <button key={app.kind} onClick={() => openWindow(app.kind)} style={{
                              display:"flex", alignItems:"center", gap:9, padding:"7px 8px",
                              borderRadius:9, border:`1px solid ${isRunning ? neonCol + "25" : "transparent"}`,
                              background: isRunning ? `rgba(${neonCol.replace("#","").match(/../g)?.map(h=>parseInt(h,16)).join(",") ?? "0,255,180"},0.06)` : "transparent",
                              cursor:"pointer", flexDirection:"row-reverse", textAlign:"right",
                              transition:"all 0.12s",
                            }}
                              onMouseEnter={e => { e.currentTarget.style.background=`rgba(255,255,255,0.04)`; e.currentTarget.style.borderColor="rgba(255,255,255,0.07)"; }}
                              onMouseLeave={e => { e.currentTarget.style.background=isRunning?`rgba(${neonCol.replace("#","").match(/../g)?.map(h=>parseInt(h,16)).join(",") ?? "0,255,180"},0.06)`:"transparent"; e.currentTarget.style.borderColor=isRunning?neonCol+"25":"transparent"; }}
                            >
                              <div style={{ width:28, height:28, borderRadius:8, background:"rgba(255,255,255,0.04)", border:`1px solid ${isRunning ? neonCol+"30" : "rgba(255,255,255,0.07)"}`, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                                <app.icon style={{ width:13, height:13, color: isRunning ? neonCol : "rgba(255,255,255,0.5)" }} />
                              </div>
                              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", flex:1, overflow:"hidden", gap:1 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                                  <span style={{ fontSize:10.5, fontWeight:700, color: isRunning ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.65)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{app.label}</span>
                                  {isRunning && <div style={{ width:5, height:5, borderRadius:"50%", background:"#34d399", boxShadow:"0 0 6px #34d399", flexShrink:0 }} />}
                                </div>
                                <span style={{ fontSize:8.5, color:"rgba(255,255,255,0.2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:"100%" }}>{app.desc}</span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom separator */}
          <div style={{ margin:"10px 10px 8px", height:1, background:"linear-gradient(90deg, rgba(0,255,180,0.12), rgba(0,255,180,0.04) 70%, transparent)" }} />

          {/* ── Footer actions ── */}
          <div style={{ width:"100%", display:"flex", flexDirection:"column", gap:3, padding:"0 8px" }}>
            <button onClick={() => openWindow("settings")} style={{
              display:"flex", alignItems:"center", gap:10, width:"100%", padding:"8px 8px",
              borderRadius:9, border:"1px solid transparent", background:"transparent", cursor:"pointer",
              color:"rgba(255,255,255,0.35)", transition:"all 0.14s",
            }}
              onMouseEnter={e => { e.currentTarget.style.background="rgba(255,255,255,0.04)"; e.currentTarget.style.color="#fff"; e.currentTarget.style.borderColor="rgba(255,255,255,0.08)"; }}
              onMouseLeave={e => { e.currentTarget.style.background="transparent"; e.currentTarget.style.color="rgba(255,255,255,0.35)"; e.currentTarget.style.borderColor="transparent"; }}
            >
              <div style={{ width:32, height:32, borderRadius:9, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.07)" }}>
                <SettingsIcon style={{ width:15, height:15 }} />
              </div>
              {leftSidebarExpanded && <span style={{ fontSize:11, fontWeight:700, whiteSpace:"nowrap" }}>الإعدادات</span>}
            </button>

            <button onClick={() => openWindow("live-agent")} style={{
              display:"flex", alignItems:"center", gap:10, width:"100%", padding:"8px 8px",
              borderRadius:9, border:"1px solid rgba(0,255,180,0.25)", background:"rgba(0,255,180,0.07)",
              cursor:"pointer", color:"#00ffb4", position:"relative", overflow:"hidden", transition:"all 0.14s",
            }}
              onMouseEnter={e => { e.currentTarget.style.background="rgba(0,255,180,0.14)"; e.currentTarget.style.boxShadow="0 0 18px rgba(0,255,180,0.15)"; e.currentTarget.style.borderColor="rgba(0,255,180,0.45)"; }}
              onMouseLeave={e => { e.currentTarget.style.background="rgba(0,255,180,0.07)"; e.currentTarget.style.boxShadow="none"; e.currentTarget.style.borderColor="rgba(0,255,180,0.25)"; }}
            >
              <div style={{ position:"absolute", inset:0, background:"rgba(0,255,180,0.03)", animation:"pulse 2s ease-in-out infinite", pointerEvents:"none" }} />
              <div style={{ width:32, height:32, borderRadius:9, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,255,180,0.1)", border:"1px solid rgba(0,255,180,0.3)", position:"relative", zIndex:1 }}>
                <Bot style={{ width:16, height:16, filter:"drop-shadow(0 0 5px #00ffb4)" }} />
              </div>
              {leftSidebarExpanded && <span style={{ fontSize:11, fontWeight:900, whiteSpace:"nowrap", position:"relative", zIndex:1, letterSpacing:"0.04em", textShadow:"0 0 10px rgba(0,255,180,0.5)" }}>الوكيل الحي</span>}
            </button>
          </div>
        </aside>

        {/* Desktop surface */}
        <div className="flex-1 relative overflow-hidden">
          {/* ── Draggable desktop icons ────────────────────────────────── */}
          {APPS.filter((a) => selectedCategory === "all" || a.category === selectedCategory).map((app) => {
            const pos = iconPositions[app.kind] ?? { x: window.innerWidth - 100, y: 20 };
            return (
              <DraggableDesktopIcon
                key={app.kind}
                app={app}
                pos={pos}
                onMove={(x, y) => moveIcon(app.kind, x, y)}
                onOpen={() => openWindow(app.kind)}
                isRunning={wins.some(w => w.kind === app.kind)}
                isFavorite={favorites.has(app.kind)}
                onToggleFavorite={() => toggleFavorite(app.kind)}
                cveBadge={CVE_BADGE_KINDS.includes(app.kind) ? cveCriticalCount : undefined}
              />
            );
          })}

          {/* Empty desktop — hacker welcome screen */}
          {wins.length === 0 && (
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:32, zIndex:0, pointerEvents:"none" }}>

              {/* Title */}
              <div style={{ textAlign:"center" }}>
                <div style={{ fontFamily:"monospace", fontSize:28, fontWeight:900, letterSpacing:"0.3em", color:"rgba(0,255,180,0.09)", textTransform:"uppercase", userSelect:"none", lineHeight:1.1, textShadow:"0 0 60px rgba(0,255,180,0.15)" }}>CYBERNOVA</div>
                <div style={{ fontFamily:"monospace", fontSize:10, color:"rgba(0,255,180,0.25)", letterSpacing:"0.4em", marginTop:4, textTransform:"uppercase" }}>ULTIMATE HACKER PLATFORM</div>
                <div style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.1)", letterSpacing:"0.15em", marginTop:6 }}>
                  انقر مرتين على الأيقونات · اسحبها لإعادة ترتيبها
                </div>
                {/* ── Credits — حمو دوشة & كيمة العسلية ── */}
                <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:16, marginTop:14 }}>
                  <div style={{
                    display:"flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:30,
                    background:"rgba(255,180,0,0.06)", border:"1px solid rgba(255,180,0,0.18)",
                    backdropFilter:"blur(8px)",
                  }}>
                    <span style={{ width:5, height:5, borderRadius:"50%", background:"#ffb400", boxShadow:"0 0 8px #ffb400", flexShrink:0, display:"inline-block" }} />
                    <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:900, color:"rgba(255,180,0,0.65)", letterSpacing:"0.1em" }}>حمو دوشة</span>
                  </div>
                  <div style={{ width:1, height:14, background:"rgba(255,255,255,0.07)" }} />
                  <div style={{
                    display:"flex", alignItems:"center", gap:6, padding:"4px 12px", borderRadius:30,
                    background:"rgba(0,200,255,0.06)", border:"1px solid rgba(0,200,255,0.18)",
                    backdropFilter:"blur(8px)",
                  }}>
                    <span style={{ width:5, height:5, borderRadius:"50%", background:"#00c8ff", boxShadow:"0 0 8px #00c8ff", flexShrink:0, display:"inline-block" }} />
                    <span style={{ fontFamily:"monospace", fontSize:9, fontWeight:900, color:"rgba(0,200,255,0.65)", letterSpacing:"0.1em" }}>كيمة العسلية</span>
                  </div>
                </div>
              </div>

              {/* Quick launch grid */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, width:380, pointerEvents:"auto" }}>
                {QUICK_TIPS.map((t) => {
                  const catColor = CAT_COLORS[APPS.find(a=>a.kind===t.kind)?.category ?? "basics"] ?? { hex:"#44eebb", rgb:"68,238,187" };
                  return (
                    <button key={t.id} onClick={() => openWindow(t.kind)}
                      style={{
                        display:"flex", alignItems:"center", gap:12, padding:"12px 14px",
                        borderRadius:14, cursor:"pointer", textAlign:"right",
                        background:`linear-gradient(135deg, rgba(${catColor.rgb},0.09), rgba(${catColor.rgb},0.04))`,
                        border:`1px solid rgba(${catColor.rgb},0.2)`,
                        backdropFilter:"blur(12px)",
                        transition:"all 0.18s",
                      }}
                      onMouseEnter={e=>{ e.currentTarget.style.background=`linear-gradient(135deg, rgba(${catColor.rgb},0.16), rgba(${catColor.rgb},0.08))`; e.currentTarget.style.borderColor=`rgba(${catColor.rgb},0.4)`; e.currentTarget.style.transform="scale(1.02) translateY(-2px)"; e.currentTarget.style.boxShadow=`0 8px 24px rgba(${catColor.rgb},0.15)`; }}
                      onMouseLeave={e=>{ e.currentTarget.style.background=`linear-gradient(135deg, rgba(${catColor.rgb},0.09), rgba(${catColor.rgb},0.04))`; e.currentTarget.style.borderColor=`rgba(${catColor.rgb},0.2)`; e.currentTarget.style.transform="none"; e.currentTarget.style.boxShadow="none"; }}
                    >
                      <div style={{ width:36, height:36, borderRadius:12, background:`rgba(${catColor.rgb},0.12)`, border:`1px solid rgba(${catColor.rgb},0.25)`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <t.icon style={{ width:18, height:18, color:catColor.hex, filter:`drop-shadow(0 0 4px ${catColor.hex}80)` }} />
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:"monospace", fontSize:11, fontWeight:900, color:"rgba(255,255,255,0.8)", letterSpacing:"0.04em" }}>{t.title}</div>
                        <div style={{ fontFamily:"monospace", fontSize:9, color:"rgba(255,255,255,0.3)", marginTop:2 }}>{t.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Keyboard shortcuts panel */}
              <div style={{
                padding:"14px 20px", borderRadius:16,
                background:"rgba(0,0,0,0.35)", border:"1px solid rgba(0,255,180,0.08)",
                backdropFilter:"blur(8px)", pointerEvents:"none",
                maxWidth:560, width:"100%",
              }}>
                <div style={{ fontFamily:"monospace", fontSize:8, color:"rgba(0,255,180,0.35)", letterSpacing:"0.25em", textTransform:"uppercase", marginBottom:10, textAlign:"center" }}>اختصارات لوحة المفاتيح</div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"6px 20px" }}>
                  {[
                    ["⌘K","قاذفة التطبيقات"],   ["⌘M","قائمة CyberNova"],  ["⌘T","ترمينال جديد"],
                    ["⌘B","متصفح الإنترنت"],     ["⌘N","Nova Sentinel"],     ["⌘D","لوحة التحكم"],
                    ["⌘W","إغلاق النافذة"],       ["⌘H","تصغير الكل"],       ["⌘S","الماسح الشبكي"],
                    ["⌘A","الوكيل الحي"],          ["⌘I","الذكاء الاصطناعي"], ["⌘R","Recon سريع"],
                    ["⌘E","مستكشف الثغرات"],       ["⌘L","سجل الأحداث"],      ["⌘P","مراقب الأداء"],
                    ["⌘/","بحث سريع"],             ["⌘⇧W","إغلاق الكل"],      ["⌘⇧M","تصغير الكل"],
                  ].map(([key, label]) => (
                    <div key={key} style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <kbd style={{ fontFamily:"monospace", fontSize:8, fontWeight:900, color:"rgba(0,255,180,0.75)", background:"rgba(0,255,180,0.07)", border:"1px solid rgba(0,255,180,0.18)", borderRadius:5, padding:"1.5px 5px", whiteSpace:"nowrap", letterSpacing:"0.03em", flexShrink:0 }}>{key}</kbd>
                      <span style={{ fontFamily:"monospace", fontSize:8.5, color:"rgba(255,255,255,0.28)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</span>
                    </div>
                  ))}
                </div>
                {/* Double-click hint */}
                <div style={{ marginTop:10, paddingTop:8, borderTop:"1px solid rgba(255,255,255,0.04)", display:"flex", justifyContent:"center", gap:20 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <kbd style={{ fontFamily:"monospace", fontSize:8, fontWeight:900, color:"rgba(0,200,255,0.7)", background:"rgba(0,200,255,0.07)", border:"1px solid rgba(0,200,255,0.18)", borderRadius:5, padding:"1.5px 5px" }}>2× نقر</kbd>
                    <span style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.2)" }}>فتح الأيقونة</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <kbd style={{ fontFamily:"monospace", fontSize:8, fontWeight:900, color:"rgba(255,200,0,0.7)", background:"rgba(255,200,0,0.07)", border:"1px solid rgba(255,200,0,0.18)", borderRadius:5, padding:"1.5px 5px" }}>سحب</kbd>
                    <span style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.2)" }}>نقل النافذة / الأيقونة</span>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                    <kbd style={{ fontFamily:"monospace", fontSize:8, fontWeight:900, color:"rgba(180,100,255,0.7)", background:"rgba(180,100,255,0.07)", border:"1px solid rgba(180,100,255,0.18)", borderRadius:5, padding:"1.5px 5px" }}>↘ سحب</kbd>
                    <span style={{ fontFamily:"monospace", fontSize:8, color:"rgba(255,255,255,0.2)" }}>تغيير حجم النافذة</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Draggable windows */}
          {wins.map((w) => {
            const app = APPS.find((a) => a.kind === w.kind);
            return (
              <DraggableWindow
                key={w.id}
                state={{ ...w, icon: app ? <app.icon className="w-3.5 h-3.5 text-primary/80" /> : undefined }}
                onClose={() => closeWindow(w.id)}
                onFocus={() => focusWindow(w.id)}
                onMinimize={() => minimize(w.id)}
                onMaximize={() => maximize(w.id)}
                onMove={(x, y) => moveWin(w.id, x, y)}
                onResize={(ww, hh) => resizeWin(w.id, ww, hh)}
              >
                {renderBody(w, handleClientTool, openWindow, apiStatus === "online")}
              </DraggableWindow>
            );
          })}

          {/* Draggable folder sidebar */}
          <DesktopFoldersSidebar
            openWindow={openWindow} wins={wins} setWins={setWins}
            showTaskManager={showTaskManager} setShowTaskManager={setShowTaskManager}
          />

          {/* Task Manager */}
          {showTaskManager && (
            <TaskManager
              wins={wins}
              onClose={closeWindow}
              onFocus={focusWindow}
              onMinimize={minimize}
              onMaximize={maximize}
              onCloseAll={() => setWins([])}
            />
          )}
        </div>
      </main>

      {/* ── WINDOWS TASKBAR (above dock) ──────────────────────────────── */}
      <div className="fixed left-0 right-0 z-[999]" style={{ bottom: 48 }}>
        <WindowsTaskbar wins={wins} openWindow={openWindow} minimize={minimize} closeWindow={closeWindow} />
      </div>

      {/* ── DOCK ──────────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-[1000]">
        <DockBar wins={wins} openWindow={openWindow} />
      </div>

      {/* Ollama Engine bottom-right */}
      <OllamaEnginePanel onSettings={() => openWindow("settings")} />

      {/* GPU Performance Monitor (Ctrl+Shift+P) */}
      <PerformanceMonitor particleCount={120} activeWindows={wins.length} />

      {/* Notification panel */}
      {notifOpen && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[2000] w-96 bg-card/95 backdrop-blur-xl border border-primary/30 rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-primary/20">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Bell className="w-4 h-4 text-primary" />
              الإشعارات
              {unreadCount > 0 && <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[10px] font-mono">{unreadCount}</span>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setNotifs((n) => n.map((x) => ({ ...x, read: true })))} className="text-[10px] text-muted-foreground hover:text-primary">تحديد الكل</button>
              <button onClick={() => setNotifOpen(false)}><X className="w-4 h-4 text-muted-foreground hover:text-primary" /></button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-2 space-y-1">
            {notifs.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-6">لا توجد إشعارات</div>
            ) : notifs.map((n) => (
              <div key={n.id} onClick={() => setNotifs((p) => p.map((x) => x.id === n.id ? { ...x, read: true } : x))}
                className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors ${n.read ? "bg-white/2 hover:bg-white/5" : "bg-primary/10 hover:bg-primary/15 border border-primary/20"}`}>
                <div className={`w-2 h-2 rounded-full mt-1 shrink-0 ${n.level === "critical" ? "bg-red-500 animate-pulse" : n.level === "warning" ? "bg-amber-400" : "bg-emerald-400"}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold truncate">{n.title}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">{n.body}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setNotifs((p) => p.filter((x) => x.id !== n.id)); }} className="shrink-0 text-muted-foreground hover:text-rose-400 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* App Launcher (⌘K) */}
      {launcherOpen && (
        <div className="fixed inset-0 z-[3000] flex items-start justify-center pt-20 bg-black/60 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setLauncherOpen(false); }}>
          <div className="w-[680px] max-w-[95vw] bg-card/95 backdrop-blur-2xl border border-primary/30 rounded-3xl shadow-[0_20px_80px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="p-4 border-b border-primary/20">
              <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
                <Search className="w-5 h-5 text-primary/60 shrink-0" />
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { setLauncherOpen(false); setSearchQuery(""); } if (e.key === "Enter" && filteredApps.length > 0) { openWindow(filteredApps[0].kind); setLauncherOpen(false); setSearchQuery(""); } }}
                  className="flex-1 bg-transparent outline-none text-sm text-white placeholder:text-white/30"
                  placeholder="ابحث عن أداة أو قل ما تريد فعله..."
                  dir="rtl"
                />
                <kbd className="text-[9px] font-mono text-white/20 border border-white/10 rounded px-1.5 py-0.5">ESC</kbd>
              </div>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {[{ id: "all", label: "الكل", count: APPS.length }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label, count: APPS.filter((a) => a.category === c.id).length }))].map((cat) => (
                  <button key={cat.id} onClick={() => setSelectedCategory(cat.id as typeof selectedCategory)}
                    className={`px-3 py-1 rounded-full text-[10px] font-bold border transition-all ${selectedCategory === cat.id ? "bg-primary/20 border-primary/40 text-primary" : "bg-white/5 border-white/10 text-white/40 hover:text-white"}`}>
                    {cat.label} <span className="opacity-60">({cat.count})</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="p-3 grid grid-cols-3 gap-2 max-h-[55vh] overflow-y-auto">
              {filteredApps.map((app) => {
                const isRunning = wins.some((w) => w.kind === app.kind);
                return (
                  <button key={app.kind} onClick={() => { openWindow(app.kind); setLauncherOpen(false); setSearchQuery(""); }}
                    className="flex items-center gap-3 p-3 rounded-2xl hover:bg-white/8 transition-all group border border-transparent hover:border-white/8 text-right">
                    <div className={`p-2 rounded-xl bg-gradient-to-br ${app.hue} border border-white/10 group-hover:scale-110 transition-transform shrink-0`}>
                      <app.icon className="w-4 h-4 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-white/80 group-hover:text-white truncate flex items-center gap-1">
                        {app.label}
                        {isRunning && <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
                      </div>
                      <div className="text-[9px] text-white/30 truncate">{app.desc}</div>
                    </div>
                  </button>
                );
              })}
              {filteredApps.length === 0 && (
                <div className="col-span-3 text-center py-12 text-white/20 text-sm">
                  لا توجد أداة تطابق بحثك
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
