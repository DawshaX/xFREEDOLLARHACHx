# تشغيل NOVA 24/7 مجاناً — من غير أي فيزا 💳🚫

> الهدف: البرنامج كله (شات + أسطول + تنفيذ + ذاكرة) يشتغل على سيرفر حقيقي، **مجاناً للأبد،
> ومن غير بطاقة بنكية**. الخطوات كلها من المتصفح، مفيش terminal مطلوب.

---

## ليه Render بالتحديد؟

في 2026 أغلب اللي كان مجاني بقى بيطلب فيزا. ده الوضع الحقيقي وقت كتابة الملف:

| المنصة | مجاني للأبد | فيزا؟ | بيغطي 24/7؟ | ملاحظة |
|---|---|---|---|---|
| **Render** | ✅ 750 ساعة/شهر | ❌ **مش مطلوب** | ✅ (بـkeep-alive) | أقصى حد 512MB RAM · بينام بعد 15 دقيقة سكون |
| Oracle Always Free | ✅ 12GB RAM | ✅ مطلوب | ✅ فعلاً | الأقوى، بس محتاج فيزا للتحقق |
| Hugging Face Spaces | ❌ | — | — | في 2026 إنشاء Docker Space بقى بخطة مدفوعة |
| Fly.io | ❌ | ✅ | — | مفيش فري تير من 2024 |
| Koyeb | ⚠️ | ✅ (hold $29) | — | بقى بيطلب كارت |
| SnapDeploy / Bonto | ⚠️ 100 / 75 ساعة شهرياً | ❌ | ❌ | الساعات مش كفاية لشهر كامل |

**750 ساعة** في الشهر مقابل **744 ساعة** في أطول شهر → سيرفر واحد شغّال على طول بيدخل في الحد
(بالظبط كده، فمتعملش خدمة تانية على نفس الحساب).

---

## الخطوات (10 دقايق، مرة واحدة)

### 1) حساب Render
1. افتح <https://dashboard.render.com/register>
2. اختار **GitHub** وسجّل بحسابك (نفس حساب GitHub بتاع المشروع) — **مفيش بيانات بنكية ولا كارت**.
3. فعّل الإيميل لو طلب منك.

### 2) النشر بضغطة (Blueprint)
1. من الداشبورد: **New +** → **Blueprint**
2. اختار المستودع `DawshaX/xFREEDOLLARHACHx`
3. Render هيقرا `render.yaml` ويوريك الخدمة `cybernova-nova` → اضغط **Apply**
4. استنى البناء (~3–6 دقايق أول مرة). هتلاقي في اللوج:
   - `pnpm install`
   - `api-server build`
   - `kali-panel build`
   - `Serving static frontend`

### 3) راقب إنه فعلاً صحي
لما يخلص، افتح رابطك:
```
https://cybernova-nova.onrender.com/api/health
```
لازم يرجع `200`. لو رجع 503 استنى دقيقة (لسه بيقلع).

### 4) خلّيه ما ينامش (أهم خطوة)
Render المجاني بينيم الخدمة بعد **15 دقيقة** من غير زيارات، وأول زيارة بعد النوم بتاخد ~30–60 ثانية.

**الطبقة الأولى — جاهزة في المستودع:**
GitHub → Settings → Secrets and variables → Actions → **New repository secret**
```
Name:  NOVA_URL
Value: https://cybernova-nova.onrender.com      (من غير / في الآخر)
```
الـworkflow `.github/workflows/keepalive.yml` هيضرب `/api/health` كل 10 دقايق.

**الطبقة الثانية — منصوح بيها جداً:**
جدولة GitHub أحياناً بتتأخر في أوقات الزحمة. اعمل حساب مجاني على <https://uptimerobot.com>
(مفيش كارت) وأضف **HTTP(s) monitor** على `https://cybernova-nova.onrender.com/api/health`
كل **5 دقايق**. الاتنين مع بعض = مفيش نوم تقريباً.

### 5) اربطه بالصفحة
افتح <https://dawshax.github.io/xFREEDOLLARHACHx/nova-fleet> → **«وسّع القدرات — سيرفر اختياري»**
→ حطّ `https://cybernova-nova.onrender.com` → **«اختبر واربط»**.
لو الفحص طلع ✓، كل الشات والأسطول والتنفيذ بيتحوّلوا للسيرفر تلقائياً (الـWebSocket كمان، عبر `wss://`).

---

## المفاتيح المجانية (اختياري — بيخلي الردود أذكى بكتير)

الـ512MB مينفعش عليها Ollama، فالعقل هيكون المدمج لحد ما تضيف مفتاح مجاني:

| المزوّد | الرابط | مجاني |
|---|---|---|
| **Google Gemini** | <https://aistudio.google.com/apikey> | تير مجاني سخي |
| **Groq** | <https://console.groq.com/keys> | سريع جداً |
| **OpenRouter** | <https://openrouter.ai/keys> | موديلات `:free` |
| **Mistral** | <https://console.mistral.ai/api-keys> | تير مجاني |
| **Together AI** | <https://api.together.ai/settings/api-keys> | موديلات `-Free` |
| **Cerebras** | <https://cloud.cerebras.ai> | سريع جداً + مجاني |
| **GitHub Models** | <https://github.com/settings/tokens> | مجاني بمحدودية يومية (`GITHUB_MODELS_TOKEN`) |

ضيفهم من: Render → الخدمة → **Environment** → Add Environment Variable
(`GEMINI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY`).
**متكتبهم في الكود ولا في Git أبداً.** لو مفتاح اتكشف → اعمله revoke فوراً.

---

## إزاي تعرف إنه شغّال فعلاً (مش كلام)
بعد النشر، افتح:
```
https://cybernova-nova.onrender.com/self-check
```
الصفحة دي بتشغّل 7 فحوصات حقيقية على السيرفر نفسه (ذاكرة، قرص، عقل، أدوات، إنترنت،
WebSocket، الدورة الذاتية) وبترجّع سكور وحكم بالعربي + حل جنب كل نقطة واقعة.

ومن أي جهاز، فحص خارجي كامل (15 فحص) من غير أي تثبيت:
```bash
AUDIT_URL=https://cybernova-nova.onrender.com node scripts/audit-live-server.mjs
```

وفيه كمان مراقبة تلقائية كل 6 ساعات على GitHub: `.github/workflows/live-audit.yml`
(بتشتغل لما تضيف `NOVA_URL` وتكتبلك جدول بالنتايج في Actions → Summary).

## اللي بتكسبه واللي بتخسره (بصراحة)

| الحاجة | Oracle Always Free | **Render Free** |
|---|---|---|
| كارت بنكي | مطلوب | **مش مطلوب** |
| RAM | 12 GB | 512 MB |
| Ollama على السيرفر | ✅ | ❌ (استخدم مفتاح مجاني) |
| شغل 24/7 | ✅ طبيعي | ✅ بشرط الـkeep-alive |
| نوم | ❌ ماينامش | 😴 بينام بعد 15 دقيقة سكون |
| قرص دائم | ✅ | ❌ الذاكرة بتضيع مع كل redeploy |
| سعر | مجاني للأبد | مجاني للأبد |

### الذاكرة طويلة الأمد على Render
ملف الذاكرة بيبقى في `state/nova-memory.json` جوه السيرفر:
- ✅ بتفضل مع إعادة التشغيل العادية.
- ❌ بتضيع مع أي **deploy جديد** (الخطة المجانية مفيهاش قرص دائم).

قبل أي تحديث مهم:
```bash
# اسحب نسخة
curl -s https://cybernova-nova.onrender.com/api/nova-core/memory/export > nova-memory.json

# بعد الـdeploy رجّعها
curl -X POST -H 'content-type: application/json' \
     --data @nova-memory.json \
     https://cybernova-nova.onrender.com/api/nova-core/memory/import
```
الذاكرة اللي في المتصفح (محادثاتك ومهماتك) **مالهاش علاقة بالسيرفر** — بتفضل زي ما هي.

---

## لو حصلت مشكلة

| العرض | السبب | الحل |
|---|---|---|
| `Build failed` عند `pnpm install` | نسخة pnpm | الـBlueprint بيثبّت `pnpm@10.34.9` — شوف اللوج وابعتلي أول 20 سطر |
| `503` بعد النشر | لسه بيقلع (cold start) | استنى 60 ثانية وحدّث |
| الشات بيرد من «عقل المتصفح» مش السيرفر | الرابط مش مربوط أو مش راد | جرّب `/api/health` من المتصفح، وأعد «اختبر واربط» |
| «mixed content» | بتحط رابط `http://` | Render بيدي `https://` — متغيّرهوش |
| الخدمة نامت أثناء الاستخدام | keep-alive متأخر | ضيف UptimeRobot كل 5 دقايق |

---

---

## «مكان واحد يدير البرنامج كله» — إيه اللي بيتشغّل على Render بالحقيقة

الخدمة الواحدة دي بتشغّل **كل حاجة ماعدا الحاجة اللي مافيش مضيف مجاني بيعملها**:

| الطبقة | على Render Free | ملاحظة |
|---|---|---|
| المحرك + `/api/*` (40+ مسار) | ✅ | `dist/index.mjs` |
| اللوحة على نفس العنوان (`/` + `/nova-fleet`) | ✅ | لازم `NODE_ENV=production` — من غيره `/` بيرجع 404 |
| المجلس (6 مصادر مفاتيح + بلا مفاتيح) | ✅ | 512 MB كافية، المجلس بيستدعي وقت الحاجة |
| قراية الوعي + عضو `freehosts` | ✅ | `/api/nova-core/awareness` |
| jobs/أدلة/تقارير على الملفات | ✅ | `state/jobs/…` — **مفيش DATABASE_URL محتاج** |
| الأدوات الحقيقية: nuclei/httpx/subfinder/katana/dnsx/naabu/ffuf | ✅ **وقت الـbuild** | `scripts/fetch-toolchain.mjs` بينزّلها في `vendor/bin`؛ `findBinary()` بيلاقيها من غير root ولا apt |
| `nmap` | ⚠️ لأ | مفيش `apt`؛ بديلها اللي بيزبط: `naabu` (static، بيتنزّل برضو) |
| ديسك دائم | ❌ | الذاكرة بتتصدّر لريبو جيت-هَب كل يوم (`keepalive.yml`) |
| 24/7 حقيقي | ❌ بينام بعد 15 دقيقة | keepalive ping كل 10 دقايق + UptimeRobot كل 5 |
| ضربة نشطة على هدف برنامج | ⚠️ مش هنا | IP داتا سنتر مشترك + شروط الاستخدام → على نود روت (freevps.edu.pl) |

**الفرق اللي عمله `vendor/bin`:** قبل كده كانت الإجابة «Render مابيشتغلمش أدوات»؛ دلوقتي الـbuild
بينزّل الـbinaries الثابتة (بايف من جيت-هَب ريليسات كل مشروع، مع قارئ ZIP نقّي بالنود فمفيش
اعتماد على `unzip` في بيئة البناء) و`/api/ops/kinds` بيردّ `present: true`. ده اتقاس على المحرك
هنا: حطينا ملف في `vendor/bin/nuclei` والـkinds قال `present:true` والـ`execPlane.nodeToolsPresent:
["nuclei"]`. والأهم: أول ما الأدوات بانت، `suggestPlan` بقى يخطّط مهام نشطة، وبوابة التصريح
**رفضت** على برنامج `passive_only` بالسطر ده: «لازم تأكيد إذن مكتوب» — يعني الأدوات اتضافت من غير
ما التصريح يتراخى ثانية.

**اللي مقدرناش نتحقق منه هنا:** التنزيل نفسه (صندوق التطوير مافيهوش خروج للإنترنت خالص،
والسكربت بيقول «api.github.com ماردّش» ويخرج 0 من غير ما يوقف النشر). أول build حقيقي على
Render هو اللي هيثبت؛ لو أداة وقعت، اللوج هيكون فيه سطر `::warning::` باسمها والتقرير في
`GITHUB_STEP_SUMMARY`.

## هل ده أحسن من Oracle؟
- **لو معاك فيزا:** Oracle أحسن بكتير (12GB + Ollama + ماينامش). استخدم `deploy/oracle-setup.sh`.
- **لو مفيش:** Render هو الأفضل المتاح من غير كارت، والمكسب الحقيقي إنه **https** —
  يعني الصفحة الثابتة على GitHub Pages تقدر تكلمه من غير مشاكل mixed content.
