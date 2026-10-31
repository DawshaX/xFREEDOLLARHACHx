# NOVA — عقل منصة CyberNova (دليل سريع بالعربي)

> **باختصار:** دلوقتي بقى عندك شات حقيقي جوّه البرنامج. تكتبله بالعامية، هو يفهم، يعمل خطة،
> ينفّذ أدوات حقيقية على المنصة، وكل خطوة بتظهر قدامك لحظة بلحظة. مجاني 100% وملكك بالكامل.

---

## 1) فين ألاقيه؟

| الواجهة | الرابط | الاستخدام |
|---|---|---|
| **NOVA Core (الشات الجديد)** | `/nova-core` | الشات الأساسي + شريط تنفيذ حي (تايم لاين) |
| Live Agent Panel (الديسكتوب) | `/live-agent` | نفس العقل داخل نافذة الديسكتوب |
| API مباشر | `/api/nova-core/*` | للربط من أي أداة خارجية |

الشات الجديد موجود في القائمة الجانبية تحت **«العمليات العصبية»** باسم
**NOVA Core · المحادثة**.

---

## 2) التشغيل بأمر واحد (جهازك)

```bash
./scripts/nova-local.sh --ollama
```

بيعمل الآتي لوحده:
1. يتأكد من Node و pnpm (وينصّب لو ناقص).
2. يبني الـ API والواجهة لو مش مبنيين.
3. يشغّل السيرفر على `:8080` (ده العقل + 21 أداة حقيقية).
4. يشغّل الواجهة على `:3000` (أي `/api` بيتحوّل تلقائي للسيرفر).
5. يقولك Ollama شغال ولا لأ.

بعد كده افتح: <http://localhost:3000/nova-core>

للإيقاف: `Ctrl + C` (بيقفل الاتنين مع بعض).

---

## 3) تشغيل العقل المجاني (Ollama)

```bash
# 1. نصّب Ollama مرة واحدة من https://ollama.com/download
# 2. نزّل موديل مجاني
ollama pull llama3.1          # أو qwen2.5:7b أو mistral
# 3. اسمح للمتصفح يتكلم مع Ollama (مهم جدًا)
#    macOS / Linux:
OLLAMA_ORIGINS=* ollama serve
#    Windows (PowerShell):
setx OLLAMA_ORIGINS *
# 4. شغّل المنصة
./scripts/nova-local.sh --ollama
```

لو مفيش Ollama خالص؟ **المنصة بتشتغل برضه.** العقل المدمج (Built-in Planner) بيفهم العربي،
بيرتّب الخطة، وبينفّذ نفس الأدوات الحقيقية — الفرق بس إن الكلام بيكون قوالب جاهزة مش كتابة حرة.

### مفاتيح سحابية مجانية (اختياري)
لو حبيت جودة أعلى ببلاش، حطّ أي مفتاح من دول في البيئة، والمنصة هتستخدمه تلقائيًا لو Ollama مقفول:

```
GROQ_API_KEY=...        # الأسرع في الفري تير
OPENROUTER_API_KEY=...  # موديلات :free
GEMINI_API_KEY=...
MISTRAL_API_KEY=...
TOGETHER_API_KEY=...
```

شوف القالب: `artifacts/api-server/.env.nova.example`

---

## 4) هو بيعمل إيه فعليًا؟ (مش كلام)

**21 أداة حقيقية** على السيرفر:

- **استطلاع:** `recon_target` (DNS + TLS + ترويسات في نداء واحد)، `dns_lookup`، `tls_audit`، `http_headers_audit`
- **سطح الهجوم:** `port_scan` (محدود)، `subdomain_enum`، `web_fetch`
- **استخبارات:** `cve_lookup` (NVD)، `vuln_search`، `exploit_search` (Exploit-DB)، `github_search`، `knowledge_search` (فهرس المنصة 3,300+ نمط)، `kali_toolbox` (78 أداة)
- **ذاكرة ومهام:** `memory_save` / `memory_search` / `memory_list`، `set_active_target`، `record_finding`، `mission_status`
- **منصة:** `platform_status`، `hash_text`
- **اختياري (مقفول افتراضيًا):** `run_shell` — بيتفتح بس لو أنت حطيت `ENABLE_AGENT_SHELL=1`

كل نتيجة بترجع من الأداة نفسها — مفيش بيانات مخترعة. وكل أداة في التايم لاين ليها زر
**«افتح الصفحة»** بيوديك للشاشة الخاصة بيها جوه المنصة.

### حواجز الأمان
- أي أداة بتشتغل على نطاق **داخلي/خاص** (127.0.0.1، 10.x، 192.168.x…) بتترفض → حماية من SSRF.
- `run_shell` مش متاح غير بإذن صريح منك.
- الأدوات النشطة معلّمة بلون مختلف (`active` / `risky`) قبل التنفيذ.

---

## 5) لما مفيش سيرفر (GitHub Pages / فتح الملف مباشرة)

الشات بيشتغل برضه بالمخ المحلي، وبأدوات بتشتغل جوه المتصفح:

| الأداة | بتعمل إيه فعليًا |
|---|---|
| `dns_lookup` | استعلام DNS حقيقي عبر DNS-over-HTTPS (A / MX / TXT / NS) |
| `cve_lookup` | بحث حقيقي في **NVD** مباشرة |
| `github_search` | بحث حقيقي في GitHub API |
| `web_check` | اختبار وصول الموقع وزمن استجابته |
| `knowledge_search` | فهرس المنصة المحلي |
| `memory_save` / `memory_list` | ذاكرة دائمة على جهازك (localStorage) |
| `set_active_target` | تحديد الهدف النشط |

ولو عندك Ollama شغال، الرد نفسه بيتكتب بالموديل بشخصية NOVA.

**ليه مش نفس الـ 21؟** المتصفح مش بيقدر يعمل فحص منافذ أو TLS أو تعداد نطاقات — دي
محتاجة السيرفر. ولهذا الشات بيقولك بوضوح: «أنا بالمخ المحلي» ويقترح تشغيل السيرفر.

---

## 6) الـ API (لو حبيت تربط حاجة تانية)

```
GET  /api/nova-core/status    →  هوية نوفا + حالة العقل + عدد الأدوات
GET  /api/nova-core/tools     →  كتالوج الأدوات كامل (JSON Schema)
GET  /api/nova-core/persona   →  بطاقة الشخصية
POST /api/nova-core/chat      →  SSE stream: ready → thought → plan → tool_call → tool_result → delta → done
POST /api/nova-core/execute   →  تشغيل أداة واحدة مباشرة  { "tool": "dns_lookup", "args": {...} }
```

مثال سريع:

```bash
curl -N -X POST http://localhost:8080/api/nova-core/chat \
  -H 'content-type: application/json' \
  -d '{"message":"اعمل استطلاع على github.com"}'
```

---

## 7) الشخصية

الشخصية والعقل مكتوبين في `artifacts/api-server/src/lib/agent/persona.ts` —
هوية، بروتوكول تفكير، لغة (مصري بسيط)، خطوط حمراء (مفيش تخريب، مفيش اختراق بدون إذن،
مفيش اختراع بيانات). عدّل فيه وزوّد اللي تحبه، وبعدها أعد بناء السيرفر.

---

## 8) أول 3 أسئلة تجربها

1. `مين انت وممكن تعمل ايه؟`
2. `اعمل استطلاع على github.com`
3. `ابحث عن CVE-2024-3094 وقولي الخطورة والحل`
