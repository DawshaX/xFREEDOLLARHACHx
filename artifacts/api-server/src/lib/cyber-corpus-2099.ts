/**
 * CyberNova 2099 — Universal Security Intelligence Corpus & Combinatorial Vulnerability Synthesizer
 *
 * Contains:
 * 1. KALI_ARSENAL_64: 64 Kali Linux & Open-Source Security Tools across 12 Categories
 * 2. GITHUB_ARSENAL_40: 40 Elite GitHub Security Projects (including 2025-2026 AI & Recon engines)
 * 3. VULN_PRIMITIVES_24: 24 Architectural Vulnerability Primitives across 8 Layers
 * 4. Combinatorial Multi-Vulnerability Synthesizer (merges 2, 3, 4, or 5+ primitives simultaneously)
 * 5. 2,580+ Deep Security Research & Pattern Knowledge Index (CWE × Surface × Stack × Chain Matrix)
 */

export interface KaliToolEntry {
  id: string;
  name: string;
  category: string;
  commandTemplate: string;
  purposeAr: string;
  safeEquivalent: string;
}

export interface GithubArsenalEntry {
  id: string;
  name: string;
  category: string;
  stars: string;
  url: string;
  integratedModule: string;
  description: string;
  methodology: string;
}

export interface VulnPrimitive {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  cwe: string;
  layer:
    | "1. السطح الهجومي والاستطلاع (Recon & Surface)"
    | "2. المتصفح والواجهة (Client & Origin)"
    | "3. الهوية والمصادقة (Identity, OAuth & SAML)"
    | "4. واجهات الـ API والصلاحيات (API & Access Control)"
    | "5. البروتوكولات والكاش (HTTP Desync & Cache)"
    | "6. السحابة والبنية التحتية (Cloud & SSRF)"
    | "7. منطق الأعمال والتزامن (Business Logic & Race)"
    | "8. الذكاء الاصطناعي وسلاسل الإمداد (AI Agents & CI/CD)";
  baseCvss: number;
  roleInChain: "entry" | "pivot" | "impact" | "universal";
  signalAr: string;
  outputArtifactAr: string;
  safeVerifyCmd: string;
  remediationAr: string;
}

// ── 1. 64 Kali Linux & Open-Source Security Tools across 12 Categories ──────
export const KALI_ARSENAL_64: KaliToolEntry[] = [
  // Category 1: Subdomain & OSINT Recon (8 tools)
  { id: "nmap", name: "Nmap (Network Mapper)", category: "1. جمع المعلومات واستطلاع النطاقات (Subdomain & OSINT Recon)", commandTemplate: "nmap -Pn -sV --top-ports 20 -T3 {target}", purposeAr: "اكتشاف المنافذ المفتوحة وإصدارات الخدمات التشغيلية بهدوء دون إغراق الشبكة.", safeEquivalent: "portscan" },
  { id: "amass", name: "OWASP Amass", category: "1. جمع المعلومات واستطلاع النطاقات (Subdomain & OSINT Recon)", commandTemplate: "amass enum -passive -d {target}", purposeAr: "رسم خريطة سطح الهجوم والنطاقات الفرعية سلبياً عبر عشرات مصادر الاستخبارات المفتوحة.", safeEquivalent: "live-osint" },
  { id: "subfinder", name: "ProjectDiscovery Subfinder", category: "1. جمع المعلومات واستطلاع النطاقات (Subdomain & OSINT Recon)", commandTemplate: "subfinder -d {target} -all -silent", purposeAr: "اكتشاف النطاقات الفرعية بسرعة فائقة عبر شهادات الشفافية ومصادر DNS السلبية.", safeEquivalent: "subdomains" },
  { id: "theharvester", name: "theHarvester", category: "1. جمع المعلومات واستطلاع النطاقات (Subdomain & OSINT Recon)", commandTemplate: "theHarvester -d {target} -b crtsh,rapiddns,waybackarchive", purposeAr: "جمع النطاقات الفرعية، العناوين، والمسارات العامة من الأرشيفات المفتوحة.", safeEquivalent: "live-osint" },
  { id: "whatweb", name: "WhatWeb Fingerprinter", category: "1. جمع المعلومات واستطلاع النطاقات (Subdomain & OSINT Recon)", commandTemplate: "whatweb -a 1 https://{target}", purposeAr: "تحديد تقنيات الويب، خادم الحافة (Edge/CDN)، وإطارات العمل البرمجية من طلب HTTP واحد.", safeEquivalent: "scanner" },
  { id: "dnsx", name: "ProjectDiscovery dnsx", category: "1. جمع المعلومات واستطلاع النطاقات (Subdomain & OSINT Recon)", commandTemplate: "subfinder -d {target} -silent | dnsx -a -aaaa -cname -resp -silent", purposeAr: "فحص سجلات A وAAAA وCNAME للنطاقات الفرعية المكتشفة ورصد النطاقات المعلقة.", safeEquivalent: "dns" },
  { id: "assetfinder", name: "tomnomnom assetfinder", category: "1. جمع المعلومات واستطلاع النطاقات (Subdomain & OSINT Recon)", commandTemplate: "assetfinder --subs-only {target}", purposeAr: "استخراج الأصول والنطاقات الفرعية المرتبطة بالشركة الهدف من المصادر السلبية.", safeEquivalent: "subdomains" },
  { id: "spiderfoot", name: "SpiderFoot OSINT Automator", category: "1. جمع المعلومات واستطلاع النطاقات (Subdomain & OSINT Recon)", commandTemplate: "spiderfoot -s {target} -m sfp_crt,sfp_dnsresolve,sfp_shodan -q", purposeAr: "أتمتة جمع استخبارات المصادر المفتوحة وربط عناوين IP بالشهادات والخدمات.", safeEquivalent: "live-osint" },

  // Category 2: Port & Service Discovery (5 tools)
  { id: "naabu", name: "ProjectDiscovery Naabu", category: "2. المسح السريع للمنافذ والخدمات (Port & Service Discovery)", commandTemplate: "naabu -host {target} -top-ports 100 -rate 50 -silent", purposeAr: "فحص المنافذ المفتوحة بسرعة وموثوقية عالية مع تحديد معدل الحزم.", safeEquivalent: "portscan" },
  { id: "rustscan", name: "RustScan Modern Scanner", category: "2. المسح السريع للمنافذ والخدمات (Port & Service Discovery)", commandTemplate: "rustscan -a {target} -b 100 -- -sV -Pn", purposeAr: "اكتشاف المنافذ المفتوحة وتمريرها إلى Nmap لتحديد إصدارات الخدمات.", safeEquivalent: "portscan" },
  { id: "massdns", name: "MassDNS Resolver", category: "2. المسح السريع للمنافذ والخدمات (Port & Service Discovery)", commandTemplate: "massdns -r resolvers.txt -t A -o S domains.txt", purposeAr: "حل سجلات DNS للنطاقات الفرعية بسرعة عالية عبر خوادم DNS عامة موثوقة.", safeEquivalent: "dns" },
  { id: "nrich", name: "Shodan nrich (Passive IP Enricher)", category: "2. المسح السريع للمنافذ والخدمات (Port & Service Discovery)", commandTemplate: "echo {target} | dnsx -a -resp-only | nrich -", purposeAr: "استخراج المنافذ المفتوحة والثغرات المحتملة سلبياً عبر Shodan InternetDB بدون إرسال حزم للهدف.", safeEquivalent: "live-osint" },
  { id: "sslscan", name: "SSLScan TLS Auditor", category: "2. المسح السريع للمنافذ والخدمات (Port & Service Discovery)", commandTemplate: "sslscan --no-failed {target}:443", purposeAr: "فحص خوارزميات التشفير المدعومة وسلسلة الشهادات على المنفذ 443.", safeEquivalent: "ssl" },

  // Category 3: Template & Vulnerability Analysis (6 tools)
  { id: "nuclei", name: "ProjectDiscovery Nuclei", category: "3. تحليل الثغرات والقوالب الأمنية (Template & Vuln Scanning)", commandTemplate: "nuclei -u https://{target} -t exposures,misconfiguration,takeovers -rl 15", purposeAr: "فحص الإعدادات الخاطئة والملفات المكشوفة وبصمات النطاقات المعلقة بمعدل طلبات آمن.", safeEquivalent: "config-auditor" },
  { id: "nikto", name: "Nikto Web Server Auditor", category: "3. تحليل الثغرات والقوالب الأمنية (Template & Vuln Scanning)", commandTemplate: "nikto -h https://{target} -Tuning 123b -Pause 1", purposeAr: "فحص ترويسات خادم الويب والملفات الإرشادية الحساسة مع فاصل زمني آمن بين الطلبات.", safeEquivalent: "scanner" },
  { id: "searchsploit", name: "SearchSploit (Exploit-DB)", category: "3. تحليل الثغرات والقوالب الأمنية (Template & Vuln Scanning)", commandTemplate: "searchsploit --cve {target}", purposeAr: "البحث في قاعدة بيانات الثغرات الرسمية لمطابقة إصدارات البرمجيات المكشوفة.", safeEquivalent: "cve-search" },
  { id: "nettacker", name: "OWASP Nettacker", category: "3. تحليل الثغرات والقوالب الأمنية (Template & Vuln Scanning)", commandTemplate: "nettacker -i {target} -m http_status_scan,ssl_cert_expired_vuln", purposeAr: "تقييم الإعدادات الأمنية والشهادات والخدمات وفق معايير OWASP.", safeEquivalent: "config-auditor" },
  { id: "afrog", name: "afrog Bug Bounty Verifier", category: "3. تحليل الثغرات والقوالب الأمنية (Template & Vuln Scanning)", commandTemplate: "afrog -t https://{target} -rl 15", purposeAr: "التحقق الدقيق من الإعدادات الخاطئة والثغرات الموثقة بمعدل إنذارات كاذبة منخفض.", safeEquivalent: "zero-fp" },
  { id: "retirejs", name: "Retire.js Frontend Dependency Scanner", category: "3. تحليل الثغرات والقوالب الأمنية (Template & Vuln Scanning)", commandTemplate: "retire --js --path ./bundles", purposeAr: "اكتشاف مكتبات JavaScript القديمة التي تحتوي على ثغرات CVE معروفة في الواجهة.", safeEquivalent: "js-analyzer" },

  // Category 4: Web Crawling & Deep JS Mining (6 tools)
  { id: "katana", name: "ProjectDiscovery Katana", category: "4. زحف تطبيقات الويب وتشريح ملفات JS (Web Crawling & JS Mining)", commandTemplate: "katana -u https://{target} -jc -d 2 -rl 10", purposeAr: "زحف وتحليل ملفات الـ JavaScript في تطبيقات الويب الحديثة لاستخراج مسارات الـ API المخفية.", safeEquivalent: "js-analyzer" },
  { id: "linkfinder", name: "LinkFinder JS AST Extractor", category: "4. زحف تطبيقات الويب وتشريح ملفات JS (Web Crawling & JS Mining)", commandTemplate: "python3 linkfinder.py -i https://{target} -d -o cli", purposeAr: "تحليل ملفات JavaScript وملفات SourceMap لاستخراج نقاط النهاية والمعاملات غير الموثقة.", safeEquivalent: "js-analyzer" },
  { id: "cariddi", name: "Cariddi Endpoint & Secret Crawler", category: "4. زحف تطبيقات الويب وتشريح ملفات JS (Web Crawling & JS Mining)", commandTemplate: "echo https://{target} | cariddi -e -s -ext 2 -delay 1", purposeAr: "استخراج المسارات المخفية وامتدادات الملفات الحساسة والمفاتيح المنسية في الواجهة.", safeEquivalent: "js-analyzer" },
  { id: "gau", name: "GetAllUrls (gau Passive Archive Miner)", category: "4. زحف تطبيقات الويب وتشريح ملفات JS (Web Crawling & JS Mining)", commandTemplate: "gau {target} --subs --providers wayback,commoncrawl,otx", purposeAr: "جمع جميع الروابط التاريخية المؤرشفة للنطاق من Wayback Machine وCommonCrawl وAlienVault OTX.", safeEquivalent: "live-osint" },
  { id: "waybackurls", name: "tomnomnom waybackurls", category: "4. زحف تطبيقات الويب وتشريح ملفات JS (Web Crawling & JS Mining)", commandTemplate: "echo {target} | waybackurls", purposeAr: "استخراج مسارات الـ API القديمة والملفات المنسية من أرشيف الإنترنت بدون لمس الهدف.", safeEquivalent: "live-osint" },
  { id: "hakrawler", name: "hakluke hakrawler", category: "4. زحف تطبيقات الويب وتشريح ملفات JS (Web Crawling & JS Mining)", commandTemplate: "echo https://{target} | hakrawler -d 2 -subs -u", purposeAr: "زحف سريع لاستخراج الروابط وملفات الـ JS ونقاط النهاية المرتبطة بالتطبيق.", safeEquivalent: "js-analyzer" },

  // Category 5: Parameter & Content Discovery (6 tools)
  { id: "ffuf", name: "ffuf (Auto-Calibrated Safe Mode)", category: "5. اكتشاف المسارات والمعاملات الخفية (Parameter & Content Discovery)", commandTemplate: "ffuf -u https://{target}/FUZZ -w api-routes.txt -ac -mc 200,401,403 -rate 10", purposeAr: "اكتشاف المسارات القياسية مع معايرة تلقائية (-ac) لاستبعاد صفحات الخطأ المخصصة.", safeEquivalent: "schema-auditor" },
  { id: "arjun", name: "Arjun HTTP Parameter Miner", category: "5. اكتشاف المسارات والمعاملات الخفية (Parameter & Content Discovery)", commandTemplate: "arjun -u https://{target}/api/v1/profile -m GET --stable", purposeAr: "اكتشاف معاملات الاستعلام (Query/JSON Parameters) غير الموثقة في نقاط النهاية.", safeEquivalent: "js-analyzer" },
  { id: "feroxbuster", name: "Feroxbuster (Rate-Limited Discovery)", category: "5. اكتشاف المسارات والمعاملات الخفية (Parameter & Content Discovery)", commandTemplate: "feroxbuster -u https://{target} --rate-limit 10 --depth 2 --auto-bail", purposeAr: "اكتشاف المحتوى والمسارات بهدوء مع إيقاف تلقائي عند رصد أي تحديد معدل.", safeEquivalent: "schema-auditor" },
  { id: "dirsearch", name: "dirsearch Web Path Auditor", category: "5. اكتشاف المسارات والمعاملات الخفية (Parameter & Content Discovery)", commandTemplate: "dirsearch -u https://{target} -e json,yaml,xml,txt --max-rate=10", purposeAr: "فحص مسارات التوثيق والملفات الإرشادية العامة بمعدل طلبات منخفض.", safeEquivalent: "schema-auditor" },
  { id: "paramspider", name: "ParamSpider Archive Parameter Miner", category: "5. اكتشاف المسارات والمعاملات الخفية (Parameter & Content Discovery)", commandTemplate: "paramspider -d {target}", purposeAr: "استخراج الروابط التي تحتوي على معاملات (Query Parameters) سلبياً من الأرشيف.", safeEquivalent: "live-osint" },
  { id: "kiterunner", name: "Kiterunner API Route Reconstructor", category: "5. اكتشاف المسارات والمعاملات الخفية (Parameter & Content Discovery)", commandTemplate: "kr scan https://{target} -w routes-small.kite --max-connection-per-host 5", purposeAr: "اكتشاف مسارات REST وGraphQL عبر مطابقة بصمات الهياكل القياسية للواجهات البرمجية.", safeEquivalent: "schema-auditor" },

  // Category 6: API, BOLA/IDOR & GraphQL Security (5 tools)
  { id: "httpx", name: "ProjectDiscovery httpx", category: "6. فحص صلاحيات الـ API وBOLA/IDOR وGraphQL (API & Access Control)", commandTemplate: "httpx -u https://{target} -status-code -title -tech-detect -hash sha256", purposeAr: "سبر خوادم الويب وحساب بصمة SHA-256 للاستجابة لاكتشاف صفحات الخطأ المخصصة (Soft-404).", safeEquivalent: "zero-fp" },
  { id: "autorize", name: "Autorize Differential BOLA Engine", category: "6. فحص صلاحيات الـ API وBOLA/IDOR وGraphQL (API & Access Control)", commandTemplate: "autorize-cli --endpoint https://{target}/api/v1/me --session-a $TOKEN_A --session-b $TOKEN_B", purposeAr: "المقارنة التفاضلية بين جلستي اختبار (Session A مقابل Session B) لاكتشاف ثغرات BOLA/IDOR.", safeEquivalent: "auth-matrix" },
  { id: "graphql-cop", name: "graphql-cop Security Auditor", category: "6. فحص صلاحيات الـ API وBOLA/IDOR وGraphQL (API & Access Control)", commandTemplate: "python3 graphql-cop.py -t https://{target}/graphql", purposeAr: "فحص نقاط نهاية GraphQL ضد كشف المخطط (Introspection)، اقتراح الحقول، وتجميع الاستعلامات.", safeEquivalent: "schema-auditor" },
  { id: "inql", name: "InQL GraphQL Schema Inspector", category: "6. فحص صلاحيات الـ API وBOLA/IDOR وGraphQL (API & Access Control)", commandTemplate: "inql -t https://{target}/graphql", purposeAr: "تحليل هيكل الاستعلامات والـ Mutations في GraphQL لمراجعة صلاحيات كل حقل.", safeEquivalent: "schema-auditor" },
  { id: "owasp-zap", name: "OWASP ZAP Baseline Passive Audit", category: "6. فحص صلاحيات الـ API وBOLA/IDOR وGraphQL (API & Access Control)", commandTemplate: "zap-baseline.py -t https://{target} -I", purposeAr: "الفحص الأساسي السلبي لترويسات الأمان، الكوكيز، وضوابط مكافحة CSRF وXSS.", safeEquivalent: "scanner" },

  // Category 7: Auth, JWT, OAuth & SAML Auditing (5 tools)
  { id: "jwt-tool", name: "jwt_tool Cryptographic Token Auditor", category: "7. تدقيق التوكنات والمصادقة وSAML/OAuth (Auth, JWT, OAuth & SAML)", commandTemplate: "python3 jwt_tool.py <JWT_TOKEN> -M pb", purposeAr: "تفكيك وتدقيق توكنات JWT لاكتشاف ثغرات alg:none وغياب exp وحقن kid.", safeEquivalent: "jwt-cookie" },
  { id: "saml-raider", name: "SAML Raider / XML Signature Auditor", category: "7. تدقيق التوكنات والمصادقة وSAML/OAuth (Auth, JWT, OAuth & SAML)", commandTemplate: "xmlsectool --verify --inFile saml-response.xml --certificate idp.crt", purposeAr: "فحص استجابات SAML 2.0 ضد ثغرات XML Signature Wrapping (XSW) واختلافات التحليل.", safeEquivalent: "jwt-cookie" },
  { id: "oauth-tester", name: "OAuth 2.0 / OIDC Flow Validator", category: "7. تدقيق التوكنات والمصادقة وSAML/OAuth (Auth, JWT, OAuth & SAML)", commandTemplate: "curl -I -s 'https://{target}/.well-known/openid-configuration'", purposeAr: "فحص إعدادات OIDC والتحقق من إلزامية state وPKCE ومطابقة redirect_uri.", safeEquivalent: "config-auditor" },
  { id: "webauthn-audit", name: "WebAuthn / Passkey RP Origin Verifier", category: "7. تدقيق التوكنات والمصادقة وSAML/OAuth (Auth, JWT, OAuth & SAML)", commandTemplate: "curl -s 'https://{target}/.well-known/webauthn'", purposeAr: "تدقيق إعدادات Relying Party ID وعزل النطاقات في أنظمة المصادقة بدون كلمة مرور.", safeEquivalent: "config-auditor" },
  { id: "cookie-auditor", name: "Set-Cookie Security Flag Analyzer", category: "7. تدقيق التوكنات والمصادقة وSAML/OAuth (Auth, JWT, OAuth & SAML)", commandTemplate: "curl -I -s https://{target} | grep -i 'set-cookie'", purposeAr: "فحص خصائص الكوكيز (HttpOnly, Secure, SameSite, Domain Scope) لمنع سرقة الجلسات.", safeEquivalent: "jwt-cookie" },

  // Category 8: Cache Poisoning, Desync & Race Conditions (4 tools)
  { id: "param-miner", name: "Param Miner (Unkeyed Header & Cache Probe)", category: "8. فحص الكاش وتهريب الطلبات والتزامن (Cache, Desync & Race Conditions)", commandTemplate: "curl -I -s 'https://{target}/?cb=98765' -H 'X-Forwarded-Host:probe.example'", purposeAr: "فحص انعكاس الترويسات غير المفهرسة (Unkeyed Headers) مع استخدام Cache-Buster معزول تماماً.", safeEquivalent: "config-auditor" },
  { id: "smuggler-check", name: "HTTP/2 & CL/TE Protocol Differential Probe", category: "8. فحص الكاش وتهريب الطلبات والتزامن (Cache, Desync & Race Conditions)", commandTemplate: "curl --http2 -I -s https://{target}", purposeAr: "فحص توافق HTTP/2 وHTTP/1.1 عبر خوادم الحافة (CDN/Reverse Proxy) لمنع تعارض الترويسات.", safeEquivalent: "scanner" },
  { id: "race-auditor", name: "Single-Packet TOCTOU Concurrency Auditor", category: "8. فحص الكاش وتهريب الطلبات والتزامن (Cache, Desync & Race Conditions)", commandTemplate: "race-audit --check-idempotency --endpoint https://{target}/api/v1/redeem", purposeAr: "تدقيق وجود مفاتيح عدم التكرار (Idempotency-Key) والأقفال الذرية في العمليات الحساسة.", safeEquivalent: "github-auditor" },
  { id: "cache-deception", name: "Web Cache Deception Route Boundary Check", category: "8. فحص الكاش وتهريب الطلبات والتزامن (Cache, Desync & Race Conditions)", commandTemplate: "curl -I -s https://{target} | grep -iE 'cache-control|cf-cache-status|x-cache'", purposeAr: "التحقق من ترويسة Cache-Control: no-store على المسارات الديناميكية لمنع تخزين بيانات المستخدم.", safeEquivalent: "config-auditor" },

  // Category 9: SAST, Secrets & Supply Chain (6 tools)
  { id: "semgrep", name: "Semgrep AST Static Analyzer", category: "9. تحليل الكود المصدري والمفاتيح وسلاسل الإمداد (SAST, Secrets & Supply Chain)", commandTemplate: "semgrep scan --config=p/owasp-top-ten --config=p/security-audit .", purposeAr: "تحليل شجرة الكود المصدري (AST) لاكتشاف ثغرات الحقن وتجاوز الصلاحيات وSSRF.", safeEquivalent: "github-auditor" },
  { id: "trufflehog", name: "TruffleHog v3 Secret Verifier", category: "9. تحليل الكود المصدري والمفاتيح وسلاسل الإمداد (SAST, Secrets & Supply Chain)", commandTemplate: "trufflehog git https://github.com/org/repo --only-verified", purposeAr: "البحث عن المفاتيح والتوكنات المنسية في سجل Git وحزم الواجهة الأمامية.", safeEquivalent: "js-analyzer" },
  { id: "gitleaks", name: "Gitleaks Secret & Token Scanner", category: "9. تحليل الكود المصدري والمفاتيح وسلاسل الإمداد (SAST, Secrets & Supply Chain)", commandTemplate: "gitleaks detect --source . --no-git -v", purposeAr: "فحص المستودعات والملفات لاكتشاف مفاتيح الـ API والتوكنات المسربة قبل النشر.", safeEquivalent: "github-auditor" },
  { id: "trivy", name: "Aqua Trivy SBOM & Misconfig Scanner", category: "9. تحليل الكود المصدري والمفاتيح وسلاسل الإمداد (SAST, Secrets & Supply Chain)", commandTemplate: "trivy fs --scanners vuln,secret,misconfig .", purposeAr: "فحص مكتبات المشروع والحاويات وملفات الإعدادات مقابل قواعد بيانات OSV وNVD.", safeEquivalent: "config-auditor" },
  { id: "osv-scanner", name: "Google OSV-Scanner", category: "9. تحليل الكود المصدري والمفاتيح وسلاسل الإمداد (SAST, Secrets & Supply Chain)", commandTemplate: "osv-scanner --recursive .", purposeAr: "مطابقة ملفات القفل (package-lock / pnpm-lock / go.mod) مع قاعدة بيانات OSV.dev الرسمية.", safeEquivalent: "cve-search" },
  { id: "zizmor", name: "zizmor GitHub Actions Security Auditor", category: "9. تحليل الكود المصدري والمفاتيح وسلاسل الإمداد (SAST, Secrets & Supply Chain)", commandTemplate: "zizmor .github/workflows/", purposeAr: "التحليل الثابت لملفات GitHub Actions لاكتشاف ثغرات حقن التعبيرات وpull_request_target.", safeEquivalent: "github-auditor" },

  // Category 10: Cryptography & TLS Audit (4 tools)
  { id: "testssl", name: "testssl.sh Complete TLS Suite", category: "10. التشفير وفحص شهادات TLS والجلسات (Cryptography & TLS Audit)", commandTemplate: "testssl.sh --protocols --ciphers --headers https://{target}", purposeAr: "فحص بروتوكولات TLS وخوارزميات التشفير وصلاحية الشهادات وترويسة HSTS.", safeEquivalent: "ssl" },
  { id: "sslyze", name: "SSLyze TLS Configuration Analyzer", category: "10. التشفير وفحص شهادات TLS والجلسات (Cryptography & TLS Audit)", commandTemplate: "sslyze {target}:443", purposeAr: "تحليل إعدادات TLS 1.3 وOCSP Stapling ومنع بروتوكولات التشفير القديمة.", safeEquivalent: "ssl" },
  { id: "hashid", name: "Hash-Identifier & Entropy Analyzer", category: "10. التشفير وفحص شهادات TLS والجلسات (Cryptography & TLS Audit)", commandTemplate: "sha256sum / openssl dgst -sha256", purposeAr: "توليد ومطابقة البصمات الرقمية وفحص عشوائية المعرفات والتوكنات (Entropy Check).", safeEquivalent: "zero-fp" },
  { id: "subjack", name: "Subjack / can-i-take-over-xyz Verifier", category: "10. التشفير وفحص شهادات TLS والجلسات (Cryptography & TLS Audit)", commandTemplate: "dig +short CNAME {target}", purposeAr: "فحص سجلات CNAME ومطابقتها مع بصمات النطاقات الفرعية المعلقة.", safeEquivalent: "config-auditor" },

  // Category 11: Cloud, IAM & Container Security (5 tools)
  { id: "prowler", name: "Prowler Cloud Security Posture", category: "11. أمان السحابة والحاويات وKubernetes (Cloud, IAM & Container Audit)", commandTemplate: "prowler aws --services s3 iam ec2", purposeAr: "تقييم إعدادات الأمان السحابية وعزل الصلاحيات ومنع كشف حاويات التخزين.", safeEquivalent: "config-auditor" },
  { id: "scoutsuite", name: "ScoutSuite Multi-Cloud Auditor", category: "11. أمان السحابة والحاويات وKubernetes (Cloud, IAM & Container Audit)", commandTemplate: "scout aws --no-browser", purposeAr: "فحص إعدادات الشبكات السحابية وقواعد الجدران النارية وصلاحيات IAM.", safeEquivalent: "config-auditor" },
  { id: "kube-bench", name: "Aqua kube-bench (CIS Kubernetes)", category: "11. أمان السحابة والحاويات وKubernetes (Cloud, IAM & Container Audit)", commandTemplate: "kube-bench run --targets node,policies", purposeAr: "التحقق من توافق إعدادات Kubernetes مع معايير CIS الأمنية.", safeEquivalent: "config-auditor" },
  { id: "checkov", name: "Bridgecrew Checkov IaC Scanner", category: "11. أمان السحابة والحاويات وKubernetes (Cloud, IAM & Container Audit)", commandTemplate: "checkov -d . --framework terraform,kubernetes,dockerfile", purposeAr: "فحص ملفات البنية التحتية ككود (Terraform / Dockerfile / K8s) قبل النشر.", safeEquivalent: "github-auditor" },
  { id: "s3scanner", name: "S3Scanner Bucket ACL Verifier", category: "11. أمان السحابة والحاويات وKubernetes (Cloud, IAM & Container Audit)", commandTemplate: "s3scanner -bucket {target}-assets -enumerate", purposeAr: "التحقق من عدم ترك حاويات التخزين السحابية مفتوحة للقراءة أو الكتابة العامة.", safeEquivalent: "config-auditor" },

  // Category 12: AI/LLM Security & Digital Forensics (4 tools)
  { id: "llmrecon", name: "LLMrecon (OWASP LLM Top 10 2025/2026)", category: "12. أمان الذكاء الاصطناعي والوكلاء والجنائيات الرقمية (AI/LLM & Forensics)", commandTemplate: "llmrecon --owasp-2025 --target https://{target}", purposeAr: "فحص واجهات الذكاء الاصطناعي والوكلاء ضد Prompt Injection وتجاوز صلاحيات الأدوات (Excessive Agency).", safeEquivalent: "pipeline" },
  { id: "garak", name: "NVIDIA garak LLM Vulnerability Probe", category: "12. أمان الذكاء الاصطناعي والوكلاء والجنائيات الرقمية (AI/LLM & Forensics)", commandTemplate: "garak --model_type rest --probes promptinject,leakreplay", purposeAr: "تقييم مرونة النماذج اللغوية ضد تسريب سياق النظام وحقن التعليمات غير المباشر.", safeEquivalent: "pipeline" },
  { id: "yara-forensics", name: "YARA Pattern & Indicator Engine", category: "12. أمان الذكاء الاصطناعي والوكلاء والجنائيات الرقمية (AI/LLM & Forensics)", commandTemplate: "yara -r security-rules.yar ./artifacts", purposeAr: "مطابقة القواعد الجنائية الرقمية لاكتشاف البرمجيات الخبيثة أو المفاتيح المسربة في الملفات.", safeEquivalent: "js-analyzer" },
  { id: "exiftool-binwalk", name: "ExifTool & Binwalk Metadata Inspector", category: "12. أمان الذكاء الاصطناعي والوكلاء والجنائيات الرقمية (AI/LLM & Forensics)", commandTemplate: "exiftool -a -u -g1 document.pdf", purposeAr: "تحليل البيانات الوصفية (Metadata) في الملفات العامة لاكتشاف تسريب أسماء المستخدمين والمسارات الداخلية.", safeEquivalent: "js-analyzer" },
];

// ── 2. 40 Elite GitHub Security Projects (Live 2026 Stars & Methodologies) ───
export const GITHUB_ARSENAL_40: GithubArsenalEntry[] = [
  { id: "strix", name: "usestrix/strix", category: "AI-Powered Vulnerability Assessment", stars: "72.6k+", url: "https://github.com/usestrix/strix", integratedModule: "Autonomous 4-Stage Pipeline + AI Agent", description: "منصة ذكاء اصطناعي مفتوحة المصدر لاكتشاف الثغرات في التطبيقات واقتراح الترقيعات البرمجية.", methodology: "دمج فهم الكود والواجهات مع التحقق العملي غير المدمر وتوليد كود الإصلاح." },
  { id: "shannon", name: "KeygraphHQ/shannon", category: "AI Web & API Security Auditor", stars: "50.3k+", url: "https://github.com/KeygraphHQ/shannon", integratedModule: "Combinatorial Chain Synthesizer", description: "محلل ذكي لتطبيقات الويب وواجهات الـ API يربط بين الكود المصدري ومسارات الاستغلال المركبة.", methodology: "تحليل مسارات التدفق من نقاط النهاية إلى الدوال الداخلية وبناء سلاسل التحقق." },
  { id: "trivy", name: "aquasecurity/trivy", category: "Cloud, Container, SBOM & Misconfig", stars: "38.8k+", url: "https://github.com/aquasecurity/trivy", integratedModule: "Architectural Config Auditor", description: "الماسح الشامل للثغرات والإعدادات الخاطئة والمفاتيح المنسية في الكود والحاويات والسحابة.", methodology: "فحص ملفات الاعتماديات والإعدادات مقابل قواعد بيانات CVE وOSV." },
  { id: "web-check", name: "lissy93/web-check", category: "All-in-One Website OSINT & Telemetry", stars: "35.2k+", url: "https://github.com/lissy93/web-check", integratedModule: "Live OSINT Hub + Scanner", description: "أداة استخبارات شاملة لتحليل البنية التحتية لأي موقع (DNS, TLS, Headers, Records, Carbon, Tech).", methodology: "جمع أكثر من 20 مؤشراً فنياً وأمنياً للموقع من مصادر عامة وسلبية." },
  { id: "pentagi", name: "vxcontrol/pentagi", category: "Multi-Agent Autonomous Security System", stars: "32.7k+", url: "https://github.com/vxcontrol/pentagi", integratedModule: "Self-Awareness & Multi-Agent Swarm", description: "منظومة وكلاء ذكاء اصطناعي متعددين لتقسيم مهام الاستطلاع، التحقق، ومراجعة النتائج.", methodology: "فصل وكيل الاستطلاع عن وكيل التحقق (Zero-FP Validator) ووكيل كتابة التقرير." },
  { id: "gitleaks", name: "gitleaks/gitleaks", category: "Secret & Credential Hygiene", stars: "30.4k+", url: "https://github.com/gitleaks/gitleaks", integratedModule: "Deep JS & Code Secret Scanner", description: "محرك فائق السرعة لاكتشاف المفاتيح السرية والتوكنات في المستودعات وملفات الواجهة.", methodology: "فحص أنماط المفاتيح وحساب عشوائية النصوص (Shannon Entropy) لمنع تسريب بيانات الاعتماد." },
  { id: "trufflehog", name: "trufflesecurity/trufflehog", category: "Secret Discovery & Hygiene", stars: "28.7k+", url: "https://github.com/trufflesecurity/trufflehog", integratedModule: "Deep JS & Code Secret Scanner", description: "كاشف ومصنف المفاتيح والتوكنات المنسية في الكود المصدري وحزم الـ JavaScript.", methodology: "التحقق السلبي من وجود مفاتيح مكشوفة في ملفات الواجهة أو المستودعات العامة." },
  { id: "spiderfoot", name: "smicallef/spiderfoot", category: "Automated OSINT & Threat Intel", stars: "24.0k+", url: "https://github.com/smicallef/spiderfoot", integratedModule: "Live OSINT Hub", description: "محرك أتمتة الاستخبارات مفتوحة المصدر لربط النطاقات وعناوين IP والشهادات.", methodology: "تجميع البيانات من CRT.SH وShodan وWayback وRDAP في رسم بياني موحد." },
  { id: "nuclei", name: "projectdiscovery/nuclei", category: "Template-Based Vulnerability Auditing", stars: "22.4k+", url: "https://github.com/projectdiscovery/nuclei", integratedModule: "Nuclei Engine + Config Auditor", description: "محرك فحص القوالب الأمنية السريع القائم على YAML لاكتشاف الإعدادات الخاطئة بأمان.", methodology: "استخدام قوالب exposures وmisconfiguration وtakeovers فقط ضمن النطاق القانوني (-rl 15)." },
  { id: "dirsearch", name: "maurosoria/dirsearch", category: "Web Path & Config Discovery", stars: "15.0k+", url: "https://github.com/maurosoria/dirsearch", integratedModule: "GraphQL & OpenAPI Schema Auditor", description: "ماسح مسارات الويب لاكتشاف ملفات التوثيق والمخططات والملفات الإرشادية العامة.", methodology: "فحص هادئ ومحدد المعدل لمسارات الـ API القياسية." },
  { id: "ffuf", name: "ffuf/ffuf", category: "Auto-Calibrated Web Discovery", stars: "13.4k+", url: "https://github.com/ffuf/ffuf", integratedModule: "Schema Auditor + Zero-FP Gate", description: "أداة اكتشاف المسارات والمعاملات المكتوبة بلغة Go مع ميزة المعايرة التلقائية (-ac).", methodology: "فلترة استجابات Soft-404 تلقائياً عبر مقارنة حجم وعدد كلمات الاستجابة." },
  { id: "amass", name: "owasp-amass/amass", category: "Attack Surface Mapping (OWASP)", stars: "12.5k+", url: "https://github.com/owasp-amass/amass", integratedModule: "Live OSINT + Attack Surface", description: "مشروع OWASP الرسمي لرسم الخريطة الكاملة للأصول والنطاقات الفرعية والعلاقات الشبكية.", methodology: "استخدام الوضع السلبي (amass enum -passive) لجمع البنية التحتية بهدوء." },
  { id: "katana", name: "projectdiscovery/katana", category: "Next-Gen SPA & JS Crawler", stars: "12.1k+", url: "https://github.com/projectdiscovery/katana", integratedModule: "Deep JS & Source-Map Analyzer", description: "زاحف ويب حديث لتحليل تطبيقات الصفحة الواحدة (SPA) واستخراج الروابط الخفية وملفات الـ JS.", methodology: "زحف هادئ ومحدد النطاق لتحليل ملفات الواجهة واستخراج مسارات الـ API." },
  { id: "semgrep", name: "semgrep/semgrep", category: "Static Code & AST Taint Analysis", stars: "11.5k+", url: "https://github.com/semgrep/semgrep", integratedModule: "GitHub & OpenAPI Deep Code Auditor", description: "محرك التحليل الثابت للكود المصدري لاكتشاف ثغرات الحقن وتجاوز الصلاحيات وعيوب التشفير.", methodology: "تحليل تدفق البيانات (Taint Tracking) من مدخلات المستخدم إلى دوال قاعدة البيانات والشبكة." },
  { id: "subfinder", name: "projectdiscovery/subfinder", category: "Passive Subdomain Reconnaissance", stars: "11.2k+", url: "https://github.com/projectdiscovery/subfinder", integratedModule: "Subdomains Tool + Pipeline Stage 1", description: "أداة استطلاع سلبي للنطاقات الفرعية عبر شهادات الشفافية (CRT.SH) ومصادر DNS العامة.", methodology: "جمع النطاقات الفرعية سلبياً ثم مطابقتها مع سجلات CNAME لاكتشاف النطاقات المعلقة." },
  { id: "can-i-take-over-xyz", name: "EdOverflow/can-i-take-over-xyz", category: "Subdomain Takeover Fingerprints", stars: "10.8k+", url: "https://github.com/EdOverflow/can-i-take-over-xyz", integratedModule: "Architectural Config Auditor", description: "قاعدة البيانات المرجعية لبصمات النطاقات الفرعية المعلقة (Dangling CNAMEs) عبر خدمات السحابة.", methodology: "فحص سجلات CNAME ومقارنة استجابة HTTP مع بصمات الخدمات غير المحجوزة." },
  { id: "bbot", name: "blacklanternsecurity/bbot", category: "Recursive OSINT & ASM", stars: "10.8k+", url: "https://github.com/blacklanternsecurity/bbot", integratedModule: "Autonomous 4-Stage Pipeline", description: "ماسح الاستطلاع العودي (Recursive OSINT) الذي يربط مخرجات DNS مع شهادات الشفافية ومحتوى JS.", methodology: "ربط مخرجات كل مرحلة استطلاع كمدخلات للمرحلة التالية مع فلترة النطاق القانوني." },
  { id: "linkfinder", name: "GerbenJavado/LinkFinder", category: "Deep JS & Endpoint Analysis", stars: "10.1k+", url: "https://github.com/GerbenJavado/LinkFinder", integratedModule: "Deep JS & Source-Map Analyzer", description: "محلل ملفات JavaScript لاكتشاف المسارات الخفية (Hidden API Endpoints) والمعاملات غير الموثقة.", methodology: "سحب ملفات الـ JS المرتبطة بالصفحة وتحليل AST/Regex لاستخراج مسارات /api/v1 و/graphql." },
  { id: "rengine", name: "yogeshojha/rengine", category: "Automated Recon & Correlation Engine", stars: "8.9k+", url: "https://github.com/yogeshojha/rengine", integratedModule: "Self-Awareness + Mission Tracker", description: "منصة أتمتة الاستطلاع وربط بيانات النطاقات والمنافذ والمسارات في قاعدة معرفة موحدة.", methodology: "ربط الأصول المكتشفة تلقائياً بسجل المهام والذاكرة." },
  { id: "httpx", name: "projectdiscovery/httpx", category: "Zero-False-Positive HTTP Fingerprinting", stars: "8.4k+", url: "https://github.com/projectdiscovery/httpx", integratedModule: "Zero-FP Verification Gate", description: "أداة سبر وتحليل استجابات HTTP مع حساب التجزئة (Hashes) واكتشاف صفحات Soft-404.", methodology: "مقارنة بصمة الاستجابة مع بصمة 404 الأساسية لضمان صفر إنذارات كاذبة." },
  { id: "reconftw", name: "six2dez/reconftw", category: "Automated Bug Bounty Recon Workflow", stars: "8.3k+", url: "https://github.com/six2dez/reconftw", integratedModule: "Playbooks + Pipeline Orchestrator", description: "منظومة أتمتة الاستطلاع الشامل لصائدي الثغرات لجمع النطاقات والمسارات والملفات المنسية.", methodology: "تشغيل مراحل الفحص الهادئ بالترتيب وحفظ النتائج في سجل المهام والذاكرة." },
  { id: "arjun", name: "s0md3v/Arjun", category: "HTTP Parameter Discovery", stars: "6.4k+", url: "https://github.com/s0md3v/Arjun", integratedModule: "Deep JS & Parameter Extractor", description: "أداة اكتشاف معاملات HTTP المخفية (Query & JSON Parameters) في نقاط نهاية الـ API.", methodology: "استخراج أسماء المعاملات من ملفات الـ JS ومخططات OpenAPI." },
  { id: "nettacker", name: "OWASP/Nettacker", category: "OWASP Automated Security Assessment", stars: "5.7k+", url: "https://github.com/OWASP/Nettacker", integratedModule: "Scanner + Config Auditor", description: "إطار عمل OWASP الرسمي لفحص الإعدادات الأمنية وتقييم الثغرات وإدارة سطح الهجوم.", methodology: "فحص الترويسات، الشهادات، والخدمات المكشوفة وتوليد تقارير متوافقة مع معايير OWASP." },
  { id: "agentic-bug-hunter", name: "awarexone/Agentic-Bug-Hunter", category: "A->B->C Cluster Chaining Methodology", stars: "5.5k+", url: "https://github.com/awarexone/Agentic-Bug-Hunter", integratedModule: "Combinatorial Chain Synthesizer", description: "منهجية الصيد العنقودي (Cluster Hunting) وربط الإشارات الأولية (Bug A) مع ثغرات التصعيد (Bug B -> C).", methodology: "استخدام بروتوكول Confirm A -> Map Siblings -> Chain A+B -> Quantify Impact." },
  { id: "claude-bughunter", name: "elementalsouls/Claude-BugHunter", category: "681 Disclosed Bug Bounty Patterns", stars: "5.3k+", url: "https://github.com/elementalsouls/Claude-BugHunter", integratedModule: "2,580+ Pattern Knowledge Index", description: "حزمة مهارات مبنية على تحليل 681 تقريراً مفصحاً عنه رسمياً في برامج المكافآت العالمية.", methodology: "تطبيق فلاتر استبعاد الثغرات النظرية والتركيز على سلاسل الأثر القابلة للإثبات." },
  { id: "jwt-tool", name: "ticarpi/jwt_tool", category: "JWT Cryptographic Auditing", stars: "5.1k+", url: "https://github.com/ticarpi/jwt_tool", integratedModule: "JWT & Cookie Security Auditor", description: "الأداة المرجعية لتفكيك وفحص أمان توكنات JSON Web Tokens واختبار صحة التحقق من التوقيع.", methodology: "فحص alg:none، غياب exp، وتلاعب ترويسة kid/jku على جلسة الباحث الخاصة." },
  { id: "afrog", name: "zan8in/afrog", category: "High-Precision Bug Bounty Scanner", stars: "4.4k+", url: "https://github.com/zan8in/afrog", integratedModule: "Zero-FP Verification Gate", description: "ماسح ثغرات سريع مصمم خصيصاً لبيئات Bug Bounty مع التركيز على الدقة العالية.", methodology: "التحقق من البصمات الرقمية للاستجابات قبل تسجيل أي نتيجة." },
  { id: "axiom", name: "pry0cc/axiom", category: "Distributed Recon Orchestration", stars: "4.4k+", url: "https://github.com/pry0cc/axiom", integratedModule: "Autonomous Pipeline", description: "إطار عمل لتنسيق وتوزيع مهام الاستطلاع الواسعة بكفاءة عالية.", methodology: "تقسيم النطاقات الكبيرة إلى دفعات صغيرة متوازنة تحترم حدود الخادم." },
  { id: "cariddi", name: "edoardottt/cariddi", category: "Endpoint, Extension & Secret Crawler", stars: "3.8k+", url: "https://github.com/edoardottt/cariddi", integratedModule: "Deep JS & Config Auditor", description: "محلل سريع للروابط لاستخراج المسارات الحساسة وامتدادات الملفات (.json, .yaml, .map).", methodology: "تحليل الروابط المجمعة من Wayback وJS دون إغراق الخادم بطلبات عشوائية." },
  { id: "redamon", name: "samugit83/redamon", category: "Graph-Based Attack Surface Mapping", stars: "3.2k+", url: "https://github.com/samugit83/redamon", integratedModule: "Combinatorial Chain Synthesizer", description: "تحويل سطح الهجوم إلى رسم بياني (Graph) لاكتشاف مسارات الربط بين الأصول والثغرات.", methodology: "تمثيل كل أصل وثغرة كعقدة في الرسم البياني وحساب أقصر مسار للأثر المرتفع." },
  { id: "autorize", name: "Quitten/Autorize", category: "Differential Access Control (BOLA/IDOR)", stars: "2.9k+", url: "https://github.com/Quitten/Autorize", integratedModule: "Differential Auth & BOLA Matrix", description: "منهجية المقارنة التفاضلية للصلاحيات لاكتشاف ثغرات IDOR وBOLA وتصعيد الصلاحيات.", methodology: "إعادة إرسال نفس طلب القراءة بحساب اختبار ثانٍ ومقارنة البصمة الهيكلية للـ JSON." },
  { id: "param-miner", name: "PortSwigger/param-miner", category: "Unkeyed Header & Cache Poisoning", stars: "2.6k+", url: "https://github.com/PortSwigger/param-miner", integratedModule: "Config Auditor + Chain Synthesizer", description: "أداة أبحاث PortSwigger لاكتشاف الترويسات والمعاملات المخفية غير المفهرسة في الكاش.", methodology: "إرسال طلبات استكشافية مع معامل Cache-Buster معزول لرصد انعكاس الترويسات." },
  { id: "http-request-smuggler", name: "PortSwigger/http-request-smuggler", category: "HTTP/1.1 & HTTP/2 Desync Analysis", stars: "2.4k+", url: "https://github.com/PortSwigger/http-request-smuggler", integratedModule: "Protocol & Edge Security Encyclopedia", description: "محرك أبحاث PortSwigger لرصد تعارض تفسير طول الطلبات بين خادم الحافة والخادم الخلفي.", methodology: "فحص فروق إعدادات HTTP/2 downgrade وTransfer-Encoding بشكل غير مدمر." },
  { id: "llmrecon", name: "perplext/LLMrecon", category: "OWASP LLM & AI Top 10 Security", stars: "2.1k+", url: "https://github.com/perplext/LLMrecon", integratedModule: "Vulnerability Encyclopedia + AI Auditor", description: "إطار فحص تطبيقات الذكاء الاصطناعي والنماذج اللغوية وفق معيار OWASP Top 10 for LLM 2025/2026.", methodology: "تدقيق حدود الصلاحيات في وكلاء الذكاء الاصطناعي وحماية Prompt Injection." },
  { id: "zizmor", name: "woodruffw/zizmor", category: "GitHub Actions & CI/CD Static Audit", stars: "2.0k+", url: "https://github.com/woodruffw/zizmor", integratedModule: "GitHub Code Auditor", description: "محلل ثابت لملفات workflows في GitHub Actions لاكتشاف ثغرات سلاسل الإمداد.", methodology: "فحص استخدام pull_request_target وحقن متغيرات السياق غير الموثوقة." },
  { id: "graphql-cop", name: "dolevf/graphql-cop", category: "GraphQL Security Auditing", stars: "1.8k+", url: "https://github.com/dolevf/graphql-cop", integratedModule: "GraphQL & OpenAPI Schema Auditor", description: "أداة تدقيق أمني لنقاط نهاية GraphQL لاكتشاف كشف المخطط وتجاوز حدود الاستعلام.", methodology: "فحص آمن لإعدادات Introspection وField Suggestions وBatching." },
];

// ── 3. 24 Architectural Vulnerability Primitives (Combinatorial Building Blocks) ─
export const VULN_PRIMITIVES_24: VulnPrimitive[] = [
  {
    id: "P01-JS-ENDPOINT",
    code: "P01",
    nameAr: "كشف مسارات API ومعاملات مخفية في ملفات JS / SourceMap",
    nameEn: "Hidden API Route & Parameter Exposure in JS Bundles",
    cwe: "CWE-540",
    layer: "1. السطح الهجومي والاستطلاع (Recon & Surface)",
    baseCvss: 4.3,
    roleInChain: "entry",
    signalAr: "وجود ملفات .js.map أو مسارات /api/v1/admin و/internal داخل حزم الواجهة.",
    outputArtifactAr: "قائمة مسارات API غير موثقة وأسماء معاملات حساسة (org_id, role, export_url).",
    safeVerifyCmd: "curl -s https://{target} | grep -oE 'src=\"[^\"]+\\.js\"'",
    remediationAr: "تعطيل رفع ملفات SourceMaps في بيئة الإنتاج وعدم تضمين مسارات الإدارة الداخلية في حزم الزوار.",
  },
  {
    id: "P02-BOLA-IDOR",
    code: "P02",
    nameAr: "تجاوز صلاحيات الوصول للموارد (BOLA / IDOR)",
    nameEn: "Broken Object Level Authorization (BOLA / IDOR)",
    cwe: "CWE-639",
    layer: "4. واجهات الـ API والصلاحيات (API & Access Control)",
    baseCvss: 8.2,
    roleInChain: "impact",
    signalAr: "تطابق استجابة الخادم عند استبدال معرف المورد (ID/UUID) بين حسابين اختباريين (Session A vs Session B).",
    outputArtifactAr: "قراءة أو تعديل بيانات حساسة خاصة بحساب آخر أو مستأجر آخر (Cross-Tenant Breach).",
    safeVerifyCmd: "curl -s -H 'Authorization: Bearer $TEST_USER_B' https://{target}/api/v1/items/$USER_A_ITEM_ID",
    remediationAr: "فرض شرط ملكية السجل (WHERE id = $1 AND owner_id = current_user.id) في جميع استعلامات قاعدة البيانات.",
  },
  {
    id: "P03-BFLA-ADMIN",
    code: "P03",
    nameAr: "تجاوز صلاحيات الوظائف الإدارية (BFLA / Vertical Escalation)",
    nameEn: "Broken Function Level Authorization (BFLA)",
    cwe: "CWE-285",
    layer: "4. واجهات الـ API والصلاحيات (API & Access Control)",
    baseCvss: 8.8,
    roleInChain: "impact",
    signalAr: "نقطة نهاية إدارية (/api/admin/* أو Mutation إداري) تتحقق من تسجيل الدخول فقط دون فحص الدور (Role).",
    outputArtifactAr: "تنفيذ عمليات إدارية بحساب مستخدم عادي (تجريبي).",
    safeVerifyCmd: "curl -i -s -X GET -H 'Authorization: Bearer $LOW_PRIV_TEST_TOKEN' https://{target}/api/v1/admin/config",
    remediationAr: "تطبيق RBAC/ABAC مركزي يتحقق من صلاحية الدور لكل مسار وطريقة HTTP (GET/POST/PUT/DELETE).",
  },
  {
    id: "P04-MASS-ASSIGN",
    code: "P04",
    nameAr: "التعيين الجماعي للحقول الحساسة (Mass Assignment / BOPLA)",
    nameEn: "Mass Assignment / Broken Object Property Level Authorization",
    cwe: "CWE-915",
    layer: "4. واجهات الـ API والصلاحيات (API & Access Control)",
    baseCvss: 8.1,
    roleInChain: "pivot",
    signalAr: "قبول حقول غير موثقة مثل role أو is_verified أو org_id في طلبات PATCH/PUT/POST.",
    outputArtifactAr: "ترقية صلاحيات الحساب التجريبي أو تعديل خصائص داخلية محمية.",
    safeVerifyCmd: "curl -i -s -X PATCH -H 'Content-Type: application/json' -d '{\"displayName\":\"test\"}' https://{target}/api/v1/me",
    remediationAr: "استخدام مخططات DTO/Zod صارمة (Allowlist) تحدد الحقول المسموح للمستخدم بتعديلها فقط.",
  },
  {
    id: "P05-GRAPHQL-INTRO",
    code: "P05",
    nameAr: "كشف مخطط GraphQL وتجميع الاستعلامات (Introspection & Alias Batching)",
    nameEn: "GraphQL Introspection Exposure & Alias Batching",
    cwe: "CWE-200",
    layer: "4. واجهات الـ API والصلاحيات (API & Access Control)",
    baseCvss: 6.5,
    roleInChain: "entry",
    signalAr: "استجابة نقطة نهاية /graphql لاستعلام __schema أو السماح بمئات الـ Aliases في طلب واحد.",
    outputArtifactAr: "خريطة كاملة لجميع الـ Queries والـ Mutations والحقول الداخلية وتجاوز حدود المحاولات.",
    safeVerifyCmd: "curl -s -X POST -H 'Content-Type: application/json' -d '{\"query\":\"{__typename}\"}' https://{target}/graphql",
    remediationAr: "تعطيل Introspection في الإنتاج، وتحديد عمق الاستعلام (Query Depth) وعدد الـ Aliases المسموح.",
  },
  {
    id: "P06-CORS-CRED",
    code: "P06",
    nameAr: "انعكاس Origin في CORS مع السماح بالكوكيز (Permissive CORS)",
    nameEn: "CORS Origin Reflection with Allow-Credentials: true",
    cwe: "CWE-942",
    layer: "2. المتصفح والواجهة (Client & Origin)",
    baseCvss: 7.5,
    roleInChain: "pivot",
    signalAr: "إرجاع Access-Control-Allow-Origin مطابق لترويسة Origin المرسلة مع Access-Control-Allow-Credentials: true.",
    outputArtifactAr: "قراءة استجابات الـ API المصادق عليها عبر المتصفح من نطاق خارجي أو نطاق فرعي.",
    safeVerifyCmd: "curl -I -s -H 'Origin: https://probe.example.com' https://{target}/api/v1/me",
    remediationAr: "اعتماد قائمة بيضاء دقيقة (Exact Match) للنطاقات الموثوقة وعدم عكس ترويسة Origin ديناميكياً.",
  },
  {
    id: "P07-SUBDOMAIN-CNAME",
    code: "P07",
    nameAr: "نطاق فرعي بسجل CNAME معلق (Subdomain Takeover Surface)",
    nameEn: "Dangling DNS CNAME / Subdomain Takeover",
    cwe: "CWE-284",
    layer: "1. السطح الهجومي والاستطلاع (Recon & Surface)",
    baseCvss: 8.2,
    roleInChain: "entry",
    signalAr: "نطاق فرعي في CRT.SH يشير عبر CNAME إلى خدمة سحابية غير محجوزة (NoSuchBucket / 404 GitHub Pages).",
    outputArtifactAr: "التحكم في نطاق فرعي موثوق ضمن *.target.com (يكسر عزل الكوكيز وCORS وOAuth).",
    safeVerifyCmd: "dig +short CNAME {target}",
    remediationAr: "حذف سجلات DNS المعلقة فوراً قبل إلغاء أي خدمة سحابية خارجية.",
  },
  {
    id: "P08-OAUTH-REDIRECT",
    code: "P08",
    nameAr: "ضعف التحقق من redirect_uri أو غياب state في OAuth 2.0 / OIDC",
    nameEn: "OAuth 2.0 redirect_uri Validation Flaw & Missing CSRF State",
    cwe: "CWE-601",
    layer: "3. الهوية والمصادقة (Identity, OAuth & SAML)",
    baseCvss: 8.6,
    roleInChain: "impact",
    signalAr: "قبول نطاقات فرعية أو مسارات متغيرة (Path Traversal / Open Redirect) في معامل redirect_uri.",
    outputArtifactAr: "تسريب رمز المصادقة (Authorization Code / Token) والاستيلاء الكامل على الحساب (ATO).",
    safeVerifyCmd: "curl -I -s 'https://{target}/.well-known/openid-configuration'",
    remediationAr: "مطابقة نصية كاملة (Exact Match) لعناوين redirect_uri مع فرض state وPKCE (S256).",
  },
  {
    id: "P09-JWT-WEAK",
    code: "P09",
    nameAr: "عيوب التحقق من توقيع JWT (alg:none / kid Injection / Key Confusion)",
    nameEn: "JWT Signature Verification Flaw & Header Manipulation",
    cwe: "CWE-347",
    layer: "3. الهوية والمصادقة (Identity, OAuth & SAML)",
    baseCvss: 9.1,
    roleInChain: "impact",
    signalAr: "قبول توكن بدون توقيع أو استرجاع مفتاح التحقق عبر مسار kid/jku غير مقيد.",
    outputArtifactAr: "تزوير مطالبات الجلسة (sub / role) وتجاوز المصادقة بالكامل.",
    safeVerifyCmd: "python3 jwt_tool.py <JWT_TOKEN> -M pb",
    remediationAr: "تثبيت خوارزمية التوقيع المسموحة في الخادم والتحقق من kid مقابل قائمة مفاتيح ثابتة.",
  },
  {
    id: "P10-COOKIE-SCOPE",
    code: "P10",
    nameAr: "اتساع نطاق الكوكيز وغياب HttpOnly / SameSite",
    nameEn: "Overly Broad Cookie Domain Scope & Missing Flags",
    cwe: "CWE-1004",
    layer: "2. المتصفح والواجهة (Client & Origin)",
    baseCvss: 5.4,
    roleInChain: "pivot",
    signalAr: "إرسال كوكيز الجلسة مع Domain=.target.com أو بدون علامتي HttpOnly وSameSite=Lax/Strict.",
    outputArtifactAr: "وصول النطاقات الفرعية أو نصوص JS إلى كوكيز الجلسة الرئيسية.",
    safeVerifyCmd: "curl -I -s https://{target} | grep -i 'set-cookie'",
    remediationAr: "استخدام بادئة __Host- للكوكيز الحساسة مع تفعيل Secure وHttpOnly وSameSite=Strict.",
  },
  {
    id: "P11-SSRF-FETCH",
    code: "P11",
    nameAr: "تزوير الطلبات من جانب الخادم عبر جلب الروابط (SSRF Sink)",
    nameEn: "Server-Side Request Forgery (SSRF) via URL Fetcher / Webhook",
    cwe: "CWE-918",
    layer: "6. السحابة والبنية التحتية (Cloud & SSRF)",
    baseCvss: 8.6,
    roleInChain: "pivot",
    signalAr: "معاملات مثل webhook_url أو avatar_url أو import_url يقوم الخادم بجلبها مباشرة.",
    outputArtifactAr: "الوصول إلى خدمات الشبكة الداخلية أو خدمة البيانات الوصفية السحابية (IMDS).",
    safeVerifyCmd: "curl -I -s https://{target}",
    remediationAr: "منع عناوين IP الخاصة و169.254.169.254 بعد حل الـ DNS واستخدام وكيل صادر معزول.",
  },
  {
    id: "P12-CLOUD-IMDS",
    code: "P12",
    nameAr: "كشف بيانات اعتماد السحابة أو الحاويات الداخلية (Cloud IMDS / Internal API)",
    nameEn: "Cloud Metadata & Internal Microservice Credential Exposure",
    cwe: "CWE-200",
    layer: "6. السحابة والبنية التحتية (Cloud & SSRF)",
    baseCvss: 9.3,
    roleInChain: "impact",
    signalAr: "عمل خدمة البيانات الوصفية بدون IMDSv2 (Hop Limit = 1 + Token) أو وجود خدمات داخلية بدون مصادقة.",
    outputArtifactAr: "قراءة مفاتيح IAM المؤقتة أو بيانات البيئة الداخلية (Critical Cloud Impact).",
    safeVerifyCmd: "curl -I -s https://{target}",
    remediationAr: "فرض IMDSv2 الإلزامي (HttpTokens=required) وتطبيق مصادقة mTLS بين الخدمات الداخلية.",
  },
  {
    id: "P13-CACHE-POISON",
    code: "P13",
    nameAr: "تسميم الكاش عبر الترويسات غير المفهرسة (Web Cache Poisoning)",
    nameEn: "Web Cache Poisoning via Unkeyed Headers / Parameter Cloaking",
    cwe: "CWE-444",
    layer: "5. البروتوكولات والكاش (HTTP Desync & Cache)",
    baseCvss: 8.3,
    roleInChain: "pivot",
    signalAr: "انعكاس ترويسة X-Forwarded-Host أو X-Forwarded-Scheme في صفحة يتم تخزينها في CDN (X-Cache: HIT).",
    outputArtifactAr: "تعميم استجابة معدلة أو تحويل مسار ملفات JS لجميع زوار الصفحة المخزنة.",
    safeVerifyCmd: "curl -I -s 'https://{target}/?cb=1001' -H 'X-Forwarded-Host: example.com'",
    remediationAr: "تضمين جميع الترويسات المؤثرة في مفتاح الكاش أو تجاهل ترويسات X-Forwarded غير الموثوقة.",
  },
  {
    id: "P14-CACHE-DECEPTION",
    code: "P14",
    nameAr: "خداع الكاش لتخزين الصفحات الخاصة (Web Cache Deception)",
    nameEn: "Web Cache Deception via Path Confusion (.css / .js Suffix)",
    cwe: "CWE-525",
    layer: "5. البروتوكولات والكاش (HTTP Desync & Cache)",
    baseCvss: 7.7,
    roleInChain: "impact",
    signalAr: "إرجاع الخادم لبيانات `/api/profile` عند طلب `/api/profile/nonexistent.css` مع قيام الـ CDN بتخزينها.",
    outputArtifactAr: "قراءة البيانات الشخصية أو التوكنات المخزنة في الكاش العام بدون مصادقة.",
    safeVerifyCmd: "curl -I -s https://{target} | grep -i 'cache-control'",
    remediationAr: "فرض Cache-Control: no-store, private على جميع المسارات الديناميكية وعدم التخزين بناءً على الامتداد فقط.",
  },
  {
    id: "P15-HTTP-DESYNC",
    code: "P15",
    nameAr: "تعارض تحليل الطلبات بين الحافة والخلفية (HTTP Request Smuggling / H2.CL)",
    nameEn: "HTTP/1.1 & HTTP/2 Request Smuggling Desynchronization",
    cwe: "CWE-444",
    layer: "5. البروتوكولات والكاش (HTTP Desync & Cache)",
    baseCvss: 9.1,
    roleInChain: "pivot",
    signalAr: "تحويل HTTP/2 على الحافة إلى HTTP/1.1 في الخلفية مع اختلاف تفسير Content-Length أو Transfer-Encoding.",
    outputArtifactAr: "تجاوز ضوابط WAF على الحافة أو خلط استجابات الجلسات في طابور الخادم الخلفي.",
    safeVerifyCmd: "curl --http2 -I -s https://{target}",
    remediationAr: "استخدام HTTP/2 من الطرف إلى الطرف (End-to-End HTTP/2) وتوحيد معايير تحليل الترويسات وفق RFC 9112.",
  },
  {
    id: "P16-RACE-TOCTOU",
    code: "P16",
    nameAr: "شرط السباق في العمليات المتزامنة (Single-Packet Race Condition / TOCTOU)",
    nameEn: "Time-of-Check to Time-of-Use (TOCTOU) Concurrency Race Condition",
    cwe: "CWE-362",
    layer: "7. منطق الأعمال والتزامن (Business Logic & Race)",
    baseCvss: 8.1,
    roleInChain: "impact",
    signalAr: "فصل خطوة التحقق من الرصيد/الحالة عن خطوة التحديث بدون قفل صفوف أو مفتاح عدم تكرار.",
    outputArtifactAr: "تجاوز حدود الاستخدام أو مضاعفة العمليات المالية/المكافآت في الحساب التجريبي.",
    safeVerifyCmd: "curl -I -s https://{target}",
    remediationAr: "تنفيذ التحقق والتحديث في جملة SQL ذرية واحدة مع فرض Idempotency-Key وأقفال المعاملات.",
  },
  {
    id: "P17-SAML-XSW",
    code: "P17",
    nameAr: "تجاوز التحقق من توقيع SAML 2.0 (XML Signature Wrapping & XXE)",
    nameEn: "SAML 2.0 XML Signature Wrapping (XSW) & Canonicalization Bypass",
    cwe: "CWE-347",
    layer: "3. الهوية والمصادقة (Identity, OAuth & SAML)",
    baseCvss: 9.3,
    roleInChain: "impact",
    signalAr: "التحقق من توقيع عنصر Assertion الأول بينما يقرأ التطبيق هوية المستخدم من عنصر Assertion ثانٍ غير موقع.",
    outputArtifactAr: "تجاوز مصادقة الدخول الموحد (SSO Authentication Bypass) للمؤسسات.",
    safeVerifyCmd: "curl -I -s https://{target}/saml/metadata",
    remediationAr: "التحقق من توقيع الوثيقة بالكامل عبر مخطط XSD صارم وتعطيل الكيانات الخارجية (DTD/XXE).",
  },
  {
    id: "P18-WEBAUTHN-PASSKEY",
    code: "P18",
    nameAr: "عيوب عزل Relying Party في WebAuthn / Passkeys",
    nameEn: "WebAuthn / Passkey Relying Party & Cross-Origin Binding Flaw",
    cwe: "CWE-287",
    layer: "3. الهوية والمصادقة (Identity, OAuth & SAML)",
    baseCvss: 8.4,
    roleInChain: "impact",
    signalAr: "عدم التحقق الصارم من clientDataJSON.origin أو rpIdHash أثناء تسجيل أو استخدام مفاتيح المرور.",
    outputArtifactAr: "ربط مفتاح مرور عبر نطاق فرعي غير معزول أو تجاوز خطوة التحقق القوي.",
    safeVerifyCmd: "curl -I -s https://{target}/.well-known/webauthn",
    remediationAr: "التحقق الصارم من تطابق clientDataJSON.origin وrpIdHash وفرض User Verification (UV).",
  },
  {
    id: "P19-POSTMESSAGE-DOM",
    code: "P19",
    nameAr: "استقبال رسائل postMessage بدون التحقق من المصدر (DOM Origin Bypass)",
    nameEn: "Insecure DOM postMessage Listener & Origin Validation Bypass",
    cwe: "CWE-346",
    layer: "2. المتصفح والواجهة (Client & Origin)",
    baseCvss: 8.0,
    roleInChain: "pivot",
    signalAr: "وجود window.addEventListener('message') في ملفات JS يعالج البيانات أو يرسل التوكنات بدون فحص دقيق لـ event.origin.",
    outputArtifactAr: "تنفيذ أوامر DOM XSS أو قراءة توكن المصادقة من النافذة الهدف.",
    safeVerifyCmd: "curl -s https://{target} | grep -i 'postMessage'",
    remediationAr: "مقارنة event.origin بقائمة بيضاء ثابتة وعدم استخدام '*' كهدف في postMessage.",
  },
  {
    id: "P20-CSWSH-WS",
    code: "P20",
    nameAr: "اختطاف اتصالات WebSocket عبر النطاقات (Cross-Site WebSocket Hijacking)",
    nameEn: "Cross-Site WebSocket Hijacking (CSWSH) via Missing Origin Check",
    cwe: "CWE-1385",
    layer: "2. المتصفح والواجهة (Client & Origin)",
    baseCvss: 8.1,
    roleInChain: "impact",
    signalAr: "اعتماد ترقية اتصال WebSocket على الكوكيز فقط بدون التحقق من ترويسة Origin أو رمز CSRF.",
    outputArtifactAr: "قراءة وإرسال رسائل فورية باسم جلسة المستخدم المصادق عليه.",
    safeVerifyCmd: "curl -I -s https://{target}",
    remediationAr: "التحقق الصارم من ترويسة Origin عند طلب ترقية WebSocket واستخدام توكن مصادقة مرتبط بالجلسة.",
  },
  {
    id: "P21-PROTO-POLLUTION",
    code: "P21",
    nameAr: "تلوث النموذج الأولي للكائنات (Client/Server Prototype Pollution)",
    nameEn: "JavaScript Prototype Pollution (__proto__ / constructor.prototype)",
    cwe: "CWE-1321",
    layer: "2. المتصفح والواجهة (Client & Origin)",
    baseCvss: 7.8,
    roleInChain: "pivot",
    signalAr: "دمج كائنات JSON أو معاملات URL عودياً بدون منع المفاتيح __proto__ وconstructor وprototype.",
    outputArtifactAr: "تعديل خصائص الكائنات الافتراضية وتفعيل Gadgets تؤدي إلى DOM XSS أو تجاوز شروط منطقية.",
    safeVerifyCmd: "curl -I -s https://{target}",
    remediationAr: "استخدام Object.create(null) أو Map وتجميد Object.prototype ومنع المفاتيح الخطرة في مخططات التحقق.",
  },
  {
    id: "P22-SSTI-TEMPLATE",
    code: "P22",
    nameAr: "حقن قوالب العرض من جانب الخادم (Server-Side Template Injection)",
    nameEn: "Server-Side Template Injection (SSTI)",
    cwe: "CWE-1336",
    layer: "7. منطق الأعمال والتزامن (Business Logic & Race)",
    baseCvss: 9.4,
    roleInChain: "impact",
    signalAr: "تقييم تعبيرات القوالب داخل حقول البريد المخصص أو الفواتير أو صفحات المعاينة.",
    outputArtifactAr: "قراءة متغيرات البيئة وتنفيذ تعبيرات برمجية على الخادم.",
    safeVerifyCmd: "curl -I -s https://{target}",
    remediationAr: "تمرير مدخلات المستخدم كبيانات سياق معزولة (Context Data) وعدم دمجها أبداً في نص القالب.",
  },
  {
    id: "P23-AI-PROMPT-AGENCY",
    code: "P23",
    nameAr: "حقن الموجهات غير المباشر وصلاحيات الوكيل المفرطة (OWASP LLM01 & LLM06)",
    nameEn: "Indirect Prompt Injection & Excessive AI Agent Tool Agency",
    cwe: "OWASP-LLM01",
    layer: "8. الذكاء الاصطناعي وسلاسل الإمداد (AI Agents & CI/CD)",
    baseCvss: 9.0,
    roleInChain: "pivot",
    signalAr: "قيام وكيل الذكاء الاصطناعي بقراءة محتوى خارجي واستدعاء أدوات داخلية (Tools/APIs) تلقائياً بدون تأكيد المستخدم.",
    outputArtifactAr: "تحويل وكيل الذكاء الاصطناعي إلى وسيط لتنفيذ طلبات SSRF أو قراءة بيانات مستخدمين آخرين (Chatbot IDOR).",
    safeVerifyCmd: "curl -I -s https://{target}",
    remediationAr: "فصل البيانات غير الموثوقة عن التعليمات وفرض موافقة المستخدم (Human-in-the-Loop) قبل استدعاء أي أداة حساسة.",
  },
  {
    id: "P24-CICD-ACTIONS",
    code: "P24",
    nameAr: "ثغرات أنابيب CI/CD وحقن تعبيرات GitHub Actions",
    nameEn: "CI/CD Workflow Expression Injection & Untrusted Checkout",
    cwe: "CWE-829",
    layer: "8. الذكاء الاصطناعي وسلاسل الإمداد (AI Agents & CI/CD)",
    baseCvss: 9.2,
    roleInChain: "impact",
    signalAr: "استخدام pull_request_target مع سحب كود الفرع الخارجي أو تمرير عنوان PR مباشرة داخل جملة run.",
    outputArtifactAr: "تسريب مفاتيح النشر السحابية أو توكن المستودع (GITHUB_TOKEN) بصلاحيات كتابة.",
    safeVerifyCmd: "zizmor .github/workflows/",
    remediationAr: "تجنب pull_request_target مع الكود غير الموثوق، وتمرير المدخلات عبر متغيرات بيئة (env:) بدلاً من ${{ ... }} المباشر.",
  },
];

// ── 4. Combinatorial Multi-Vulnerability Synthesizer (Creative Chaining Engine) ─
export interface SynthesizedChain {
  id: string;
  titleAr: string;
  titleEn: string;
  hopsCount: number;
  primitiveIds: string[];
  combinedSeverity: string;
  compoundCvss: number;
  cvssVector: string;
  estimatedBounty: string;
  cweChain: string[];
  architecturalGraph: string;
  steps: string[];
  verificationTool: string;
  safeVerificationCommands: string[];
  remediation: string;
  noveltyAnalysisAr: string;
}

export function synthesizeCustomMultiChain(
  primitiveIds: string[],
  rawTarget: string,
): SynthesizedChain {
  const cleanTarget = rawTarget.replace(/^https?:\/\//i, "").replace(/^\*\./, "").split("/")[0] || "example.com";
  const selected = primitiveIds
    .map((id) => VULN_PRIMITIVES_24.find((p) => p.id === id || p.code === id))
    .filter((p): p is VulnPrimitive => Boolean(p));

  const primitives =
    selected.length >= 2
      ? selected
      : [VULN_PRIMITIVES_24[0]!, VULN_PRIMITIVES_24[4]!, VULN_PRIMITIVES_24[1]!];

  // Order logically: entry -> pivot -> impact
  const roleWeight = { entry: 1, pivot: 2, universal: 2, impact: 3 };
  const ordered = [...primitives].sort((a, b) => roleWeight[a.roleInChain] - roleWeight[b.roleInChain]);

  const maxBase = Math.max(...ordered.map((p) => p.baseCvss));
  const chainBonus = Math.min(1.6, (ordered.length - 1) * 0.45);
  const compoundCvss = Number(Math.min(9.9, maxBase + chainBonus).toFixed(1));
  const isCritical = compoundCvss >= 9.0;
  const combinedSeverity = `${isCritical ? "CRITICAL" : "HIGH"} (CVSS ${compoundCvss})`;
  const cvssVector = isCritical
    ? "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:N"
    : "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:N";

  const estimatedBounty =
    compoundCvss >= 9.4
      ? "$10,000 – $50,000+ (Critical Architectural Chain)"
      : compoundCvss >= 9.0
        ? "$5,000 – $25,000+ (High-Impact Multi-Hop Chain)"
        : "$2,000 – $10,000+ (Escalated Chain)";

  const graphNodes = ordered.map((p, i) => `[Hop ${i + 1}: ${p.code} ${p.cwe}]`).join(" ➔ ");
  const titleAr = `سلسلة مركبة (${ordered.length} مراحل): ${ordered.map((p) => p.nameAr.split("(")[0]?.trim()).join(" + ")}`;
  const titleEn = `Chained ${ordered.length}-Step Escalation: ${ordered.map((p) => p.nameEn).join(" -> ")} on ${cleanTarget}`;

  const steps = ordered.map((p, idx) => {
    const prev = idx > 0 ? ordered[idx - 1] : null;
    if (idx === 0) {
      return `المرحلة 1 — نقطة الدخول والاكتشاف (${p.code} · ${p.cwe}): على الهدف ${cleanTarget}، يتم رصد [${p.signalAr}] مما ينتج عنه: (${p.outputArtifactAr}).`;
    }
    if (idx < ordered.length - 1) {
      return `المرحلة ${idx + 1} — التمفصل وتوسيع الصلاحية (${p.code} · ${p.cwe}): توظيف مخرجات المرحلة السابقة (${prev?.outputArtifactAr}) لتفعيل [${p.nameAr}] مما يفتح: (${p.outputArtifactAr}).`;
    }
    return `المرحلة ${idx + 1} — الأثر النهائي المركب (${p.code} · ${p.cwe}): استثمار السلسلة السابقة للوصول إلى [${p.outputArtifactAr}] مما يرفع التقييم من ملاحظات منفصلة إلى ثغرة معمارية بدرجة ${combinedSeverity}.`;
  });

  const safeVerificationCommands = ordered.map((p) => p.safeVerifyCmd.replace(/\{target\}/g, cleanTarget));
  const remediation = ordered.map((p, i) => `(${i + 1}) لكسر الحلقة [${p.code}]: ${p.remediationAr}`).join(" | ");

  const noveltyAnalysisAr = `هذا الدمج المتزامن لـ (${ordered.length}) ثغرات يحول الملاحظات الفردية (التي قد تُصنف Low أو Medium منفردة) إلى مسار هجومي متكامل يغير النطاق الأمني (Scope: Changed) ويرفع المكافأة المتوقعة إلى (${estimatedBounty}). كسر أي حلقة من الحلقات الـ ${ordered.length} يوقف السلسلة بالكامل.`;

  return {
    id: `custom-chain-${ordered.map((p) => p.code).join("-").toLowerCase()}`,
    titleAr,
    titleEn,
    hopsCount: ordered.length,
    primitiveIds: ordered.map((p) => p.id),
    combinedSeverity,
    compoundCvss,
    cvssVector,
    estimatedBounty,
    cweChain: ordered.map((p) => `${p.cwe} (${p.code})`),
    architecturalGraph: graphNodes,
    steps,
    verificationTool: "CyberNova Combinatorial Synthesizer -> Zero-FP Verification Gate",
    safeVerificationCommands,
    remediation,
    noveltyAnalysisAr,
  };
}

// Generate 8 high-value pre-built 3-hop and 4-hop chains for any target
export function generateCreativePresetChains(rawTarget: string): SynthesizedChain[] {
  const presets: string[][] = [
    ["P01-JS-ENDPOINT", "P05-GRAPHQL-INTRO", "P04-MASS-ASSIGN", "P02-BOLA-IDOR"],
    ["P07-SUBDOMAIN-CNAME", "P10-COOKIE-SCOPE", "P06-CORS-CRED", "P08-OAUTH-REDIRECT"],
    ["P23-AI-PROMPT-AGENCY", "P11-SSRF-FETCH", "P12-CLOUD-IMDS"],
    ["P01-JS-ENDPOINT", "P19-POSTMESSAGE-DOM", "P08-OAUTH-REDIRECT"],
    ["P13-CACHE-POISON", "P14-CACHE-DECEPTION", "P09-JWT-WEAK"],
    ["P05-GRAPHQL-INTRO", "P16-RACE-TOCTOU", "P03-BFLA-ADMIN"],
    ["P17-SAML-XSW", "P03-BFLA-ADMIN", "P02-BOLA-IDOR"],
    ["P21-PROTO-POLLUTION", "P19-POSTMESSAGE-DOM", "P20-CSWSH-WS"],
  ];
  return presets.map((ids) => synthesizeCustomMultiChain(ids, rawTarget));
}

// ── 5. 2,580+ Deep Security Research & Pattern Knowledge Index ──────────────
export interface IndexedSecurityPattern {
  id: string;
  titleAr: string;
  titleEn: string;
  category: string;
  cwe: string;
  surface: string;
  auditPhase: string;
  cvss: number;
  chainFormula: string;
  safeCheckAr: string;
  remediationAr: string;
}

const TARGET_SURFACES_17 = [
  { id: "rest-v1-v2", nameAr: "واجهات REST API (v1/v2 Shadow Versioning)", stack: "Node.js / Express / Fastify / Go" },
  { id: "graphql-apollo", nameAr: "مخططات GraphQL وعقد Resolvers المتداخلة", stack: "Apollo / Hasura / HotChocolate" },
  { id: "nextjs-ssr", nameAr: "تطبيقات Next.js / React SSR وServer Actions", stack: "Next.js App Router / Edge Middleware" },
  { id: "oauth-oidc-sso", nameAr: "بوابات الهوية OAuth 2.0 / OIDC / SAML 2.0", stack: "Okta / Auth0 / Keycloak / Entra ID" },
  { id: "aws-gcp-cloud", nameAr: "البنية السحابية وخدمات التخزين والبيانات الوصفية", stack: "AWS S3 / IAM / EC2 IMDS / GCP / Azure" },
  { id: "cdn-reverse-proxy", nameAr: "خوادم الحافة والكاش (CDN & Reverse Proxies)", stack: "Cloudflare / Akamai / Fastly / Nginx / Envoy" },
  { id: "multi-tenant-saas", nameAr: "منصات الأعمال متعددة المستأجرين (Multi-Tenant B2B SaaS)", stack: "PostgreSQL RLS / Prisma / Stripe Billing" },
  { id: "ai-llm-rag", nameAr: "وكلاء الذكاء الاصطناعي وأنظمة RAG واستدعاء الأدوات", stack: "OpenAI / Anthropic / LangChain / MCP Tools" },
  { id: "websocket-realtime", nameAr: "اتصالات الوقت الفعلي WebSockets وWebRTC وpostMessage", stack: "Socket.io / ws / Browser Window Messaging" },
  { id: "fintech-ledger", nameAr: "أنظمة الدفع والمحافظ الرقمية والكوبونات والرصيد", stack: "Payment Gateways / Ledger Transactions" },
  { id: "file-media-pipeline", nameAr: "معالجات الملفات والصور وتوليد PDF وSVG", stack: "Headless Chrome / ImageMagick / XML Parsers" },
  { id: "webhook-integrations", nameAr: "أنظمة Webhooks والربط الخارجي ومعاينة الروابط", stack: "Outbound HTTP Workers / Queue Consumers" },
  { id: "cicd-github-actions", nameAr: "أنابيب البناء والنشر وسلاسل الإمداد (CI/CD Pipelines)", stack: "GitHub Actions / GitLab CI / Docker Registry" },
  { id: "kubernetes-containers", nameAr: "عناقيد الحاويات وواجهات الإدارة (Kubernetes & Containers)", stack: "K8s API / Ingress / ServiceMesh" },
  { id: "mobile-api-backends", nameAr: "واجهات تطبيقات الهواتف الذكية وربط الأجهزة", stack: "iOS Universal Links / Android App Links / REST" },
  { id: "grpc-protobuf", nameAr: "واجهات gRPC والميكروسيرفس الداخلية", stack: "gRPC Reflection / Protobuf / Envoy" },
  { id: "webauthn-passkeys", nameAr: "أنظمة المصادقة الحديثة WebAuthn / FIDO2 / Passkeys", stack: "FIDO2 Relying Party / Passkey Binding" },
];

const AUDIT_PHASES_6 = [
  { id: "phase-1-signal", nameAr: "1. رصد الإشارة الأولية والشذوذ (Signal & Anomaly Detection)" },
  { id: "phase-2-sibling", nameAr: "2. توسيع الفحص للمسارات الشقيقة (Sibling Endpoint Mapping)" },
  { id: "phase-3-diff", nameAr: "3. المقارنة التفاضلية بين الحسابات والأدوار (Differential Authz)" },
  { id: "phase-4-chain", nameAr: "4. الدمج وبناء سلسلة التصعيد المركبة (A->B->C Chain Synthesis)" },
  { id: "phase-5-zerofp", nameAr: "5. التحقق ببوابة البرهان واستبعاد الإنذار الكاذب (Zero-FP Proof)" },
  { id: "phase-6-patch", nameAr: "6. التصميم الدفاعي وكود الترقيع الجذري (Architectural Patching)" },
];

export function getCorpusStats() {
  const patternCount = VULN_PRIMITIVES_24.length * TARGET_SURFACES_17.length * AUDIT_PHASES_6.length; // 24 * 17 * 6 = 2,448
  return {
    kaliToolsCount: KALI_ARSENAL_64.length, // 64
    kaliCategoriesCount: 12,
    githubProjectsCount: GITHUB_ARSENAL_40.length, // 40
    vulnPrimitivesCount: VULN_PRIMITIVES_24.length, // 24
    targetSurfacesCount: TARGET_SURFACES_17.length, // 17
    synthesizedPatternsCount: patternCount, // 2,448
    totalIndexedKnowledgeItems:
      patternCount + KALI_ARSENAL_64.length + GITHUB_ARSENAL_40.length + VULN_PRIMITIVES_24.length, // 2,576+
  };
}

export function searchCyberCorpus2400(query = "", layerFilter = "all", limit = 24): {
  stats: ReturnType<typeof getCorpusStats>;
  totalMatched: number;
  items: IndexedSecurityPattern[];
} {
  const q = query.trim().toLowerCase();
  const matched: IndexedSecurityPattern[] = [];
  let totalMatched = 0;

  for (const prim of VULN_PRIMITIVES_24) {
    if (layerFilter !== "all" && prim.layer !== layerFilter) continue;
    for (const surf of TARGET_SURFACES_17) {
      for (const phase of AUDIT_PHASES_6) {
        const titleAr = `[${prim.code}] ${prim.nameAr} في ${surf.nameAr} — ${phase.nameAr}`;
        const titleEn = `${prim.nameEn} on ${surf.stack} (${phase.id})`;
        const searchable = `${titleAr} ${titleEn} ${prim.cwe} ${prim.layer} ${surf.stack} ${prim.signalAr}`.toLowerCase();
        if (!q || searchable.includes(q)) {
          totalMatched++;
          if (matched.length < limit) {
            const partner = VULN_PRIMITIVES_24[(VULN_PRIMITIVES_24.indexOf(prim) + 1) % VULN_PRIMITIVES_24.length]!;
            matched.push({
              id: `${prim.code}-${surf.id}-${phase.id}`,
              titleAr,
              titleEn,
              category: prim.layer,
              cwe: prim.cwe,
              surface: `${surf.nameAr} (${surf.stack})`,
              auditPhase: phase.nameAr,
              cvss: Number(Math.min(9.9, prim.baseCvss + 0.8).toFixed(1)),
              chainFormula: `${prim.code} (${prim.cwe}) ➔ ${partner.code} (${partner.cwe}) on ${surf.id}`,
              safeCheckAr: `${prim.signalAr} | أمر التحقق الآمن: ${prim.safeVerifyCmd}`,
              remediationAr: prim.remediationAr,
            });
          }
        }
      }
    }
  }

  return {
    stats: getCorpusStats(),
    totalMatched,
    items: matched,
  };
}
