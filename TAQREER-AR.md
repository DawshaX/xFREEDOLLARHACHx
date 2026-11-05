# تقرير الجرد والتفعيل — CyberNova / xFREEDOLLARHACHx

**التاريخ:** 2026-11-05 · **الفرع:** `fix/security-hardening-2026-11-05` · **PR:** #213

> هذا التقرير **إضافي بالكامل**. لم يُحذف أي ملف أو أي سطر من الكود في هذه الجولة.

---

## 1) جرد ما كان موجودًا لكنه غير مُفعَّل

| # | العنصر | الحالة قبل | الحالة بعد |
|---|---|---|---|
| 1 | `routes/ollama.ts` (6 مسارات: `/ollama/probe`, `/ollama/chat`, `/ollama/chat/stream`, …) | ملف موجود على القرص لكن **غير مستورد وغير مربوط** في `routes/index.ts` → كل المسارات ترجع 404 | ✅ مربوط الآن |
| 2 | `pages/nova-sentinel-dashboard.tsx` | صفحة موجودة لكن **غير مستوردة وغير مربوطة** في `App.tsx` → غير قابلة للوصول من الواجهة | ✅ مربوط على `/nova-sentinel-dashboard` |
| 3 | `pages/nova-sentinel-dashboard-v2.tsx` | نفس المشكلة | ✅ مربوط على `/nova-sentinel-dashboard-v2` |
| 4 | `FLEET_ENABLED` (متغيّر Actions) | **غير موجود** → `fleet-nodes.yml` كان يرفض إطلاق أي موجة أسطول | ✅ أُنشئ بقيمة `1` |
| 5 | `NOVA_HUB` (متغيّر Actions) | غير موجود → الـ workflow كان يعتمد على القيمة الافتراضية فقط | ✅ أُنشئ |
| 6 | `FLEET_NODES` (متغيّر Actions) | غير موجود → عدد العُقد كان افتراضيًا | ✅ أُنشئ بقيمة `4` |
| 7 | `ws` (حزمة WebSocket) | **غير موجودة** في `package.json` الجذر → `nova-agent.js` يفشل على Node < 22 برسالة «لا يوجد WebSocket» | ✅ أُضيفت `ws@^8.18.0` |
| 8 | ~100 متغيّر بيئة | مستخدمة في الكود لكن **غير موثّقة** في `.env.example` | ✅ وُثّقت كلها كقوالب فارغة |

### صفحات كانت موجودة لكن غير مربوطة (تم التحقق: مربوطة فعلاً)
`cve-db`, `cves`, `exploit-db`, `github`, `web-search` — كلها كانت **مربوطة بالفعل** كأسماء بديلة (aliases) لصفحات أخرى. لا حاجة لتعديل.

### مسارات `Placeholder` (49 مسارًا)
مسارات مثل `/perms`, `/firewall-config`, `/usb-monitor` … هي **stubs مقصودة** (صفحة عنوان فقط). لم تُبنَ بعد — مذكورة في «الخطوات القادمة».

---

## 2) ما تم تفعيله وربطه فعليًا في هذه الجولة

### أ) ربط المسارات المفقودة
- **`artifacts/api-server/src/routes/index.ts`** — استيراد وربط `ollamaRouter` بعد `ollamaStatusRouter` (حتى تبقى معالجات `ollama-status` الأغنى هي الفائزة على المسارات المشتركة، ويُضاف فقط ما كان ناقصًا).
- **`artifacts/kali-panel/src/App.tsx`** — استيراد كسول (lazy) للصفحتين + مسارين جديدين.

### ب) توثيق متغيّرات البيئة
- **`.env.example`** — أُضيف 131 سطرًا يوثّق كل متغيّر مستخدم في الكود ولم يكن موثّقًا، مقسّمًا إلى مجموعات: قاعدة البيانات، مزوّدو AI، الأسطول، بوابة التصريح، سلسلة الأدوات، كوربوس الثغرات، الذاكرة والأدلة، التشغيل الذاتي، الإشعارات. **كل القيم فارغة — لا سرّ واحد مكتوب.**

### ج) تفعيل الأسطول على GitHub Actions
- أُنشئت المتغيّرات الثلاثة عبر API.
- تم إطلاق `fleet-nodes.yml` و`nova-runner.yml` و`live-verify.yml` على الفرع (HTTP 204 = نجح الإطلاق).

### د) محاولة ربط عقدة حقيقية من الـ sandbox
- شُغّل `nova-agent.js` فعليًا واتصل بـ `wss://nova.waifly.com/api/local-agent/ws`.
- **النتيجة: 401 Unauthorized** — الـ hub الحيّ **محمي بـ `NOVA_EXEC_TOKEN`**، والتوكن غير موجود في بيئة الـ sandbox ولا يمكن قراءته من السيرفر.
- هذا **سلوك أمني صحيح** وليس خطأ: السيرفر يرفض أي عقدة بدون السر المشترك. تفعيل العُقد يحتاج ضبط `NOVA_EXEC_TOKEN` على السيرفر الحيّ (Waifly) وعلى GitHub Secrets بنفس القيمة.

---

## 3) ما تم التحقق منه (يعمل فعلاً — لا يحتاج إصلاحًا)

| البند | الدليل |
|---|---|
| `/api/health` | HTTP 200 · `{"status":"ok","mode":"standalone","wsConnected":true}` |
| الشات (SSE) | `POST /api/nova-core/chat` → 200 · مزوّد حقيقي `ovh-ai` · موديل `Qwen3.6-27B` · 49 أداة · ردّ فعلي «أهلاً» |
| `/api/fleet/mesh` | 200 · يعرض العُقد والحالة الحيّة |
| مصادر الثغرات الحقيقية | GitHub Advisories · NVD · CIRCL · OSV.dev · CISA KEV · Exploit-DB RSS · EPSS — كلها مربوطة في `live-vuln-ingestor.ts` و`cve-monitor.ts` |
| سلسلة الأدوات | `fetch-toolchain.mjs` ينزّل subfinder/httpx/nuclei/katana/dnsx/naabu/ffuf من إصدارات GitHub الرسمية |
| typecheck | api-server: **0 أخطاء** · kali-panel: **0 أخطاء** |
| build | api-server: ✅ Done in 2285ms · kali-panel: ✅ built in 21.38s |

---

## 4) ما يحتاج وصول المستخدم (لا يمكن تنفيذه من الـ sandbox)

| البند | السبب | المطلوب |
|---|---|---|
| **`NOVA_EXEC_TOKEN`** | الـ hub الحيّ يرفض تسجيل أي عقدة بدونه (401 مؤكَّد) | ضبط نفس القيمة على Waifly (env) وعلى GitHub Secrets |
| **إعادة نشر الموقع الحيّ** | الـ sandbox لا يملك وصول Waifly | نشر البناء الجديد على السلوت `53a7d0cb` |
| **`DATABASE_URL` / Supabase** | لا توجد بيانات اتصال حقيقية | connection string من Supabase أو Neon |
| **مفاتيح AI** | الـ keyless يعمل، لكن الحدود منخفضة | Groq / OpenRouter / Gemini (كلها مجانية) |
| **تشغيل عقدة دائمة** | الـ sandbox مؤقت وينتهي | VPS مجاني (Oracle Cloud Free Tier) أو Codespace |
| **دمج PR #213** | يحتاج مراجعتك | Review → Merge |

---

## 5) الخطوات القادمة (خارج نطاق هذه الجولة)

1. **بناء الـ 49 صفحة `Placeholder`** — كل واحدة تحتاج مكوّنًا حقيقيًا يقرأ من الـ API.
2. **تثبيت أدوات Kali على عقدة دائمة** — `deploy/oracle-setup.sh` جاهز، يحتاج جهازًا.
3. **تفعيل `NOVA_TOOLCHAIN_FETCH=1`** على السيرفر الحيّ — حاليًا `toolsPresent: []` (لا أدوات مثبّتة على Waifly).
4. **رفع `NOVA_OPS_AUTONOMY`** من `passive` إلى `assisted` بعد ضبط قائمة الأهداف المسموحة.
5. **إعادة تسمية المستودع** من `xFREEDOLLARHACHx` إلى اسم واضح.
6. **تدوير التوكنين** المستخدمين في هذه الجولة (انظر التنبيه أدناه).

---

## ⚠️ تنبيه أمني

التوكنان المستخدمان في هذه الجولة **مكشوفان** (أُرسلا في محادثة). يجب:
1. GitHub → Settings → Developer settings → Personal access tokens → **Revoke** الاثنين.
2. إنشاء توكنات جديدة بأضيق صلاحيات (Contents + Pull requests + Workflows فقط).
3. تفعيل Secret Scanning + Dependabot.

**لم يُكتب أي توكن في أي ملف داخل هذا المستودع** — استُخدمت في أوامر الشل فقط، وتم التحقق من الـ diff قبل الدفع.
