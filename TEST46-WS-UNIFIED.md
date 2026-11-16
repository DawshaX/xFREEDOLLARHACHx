# TEST46 — البوابة الدائمة + طبقة WS موحدة + أرقام حية

**التاريخ:** 2026-11-16 · **الفرع:** `arena/a3e7e1ad-xfreedollarhachx` (من main `73d62e8`)
**الأمر المعتمد من المالك:** «كل حاجة حقيقة · كل الصفحات متصلة ببعض حقيقي زي نظام الكمبيوتر والكالي الحقيقي · كل زر يؤدي وظيفته · مافيش ولا خطأ 100%».

---

## 1) بوابة الوهم الدائمة — `scripts/audit-api-freshness.mjs` (جديدة، gate 44)

المشكلة المقاسة قبل التسجيل في gates: **3 أزواج حقيقية** كانت فلتت من الحصر اليدوي (112 نداء×493 راوتر) لطريقة استنتاج الmethod:

| الزر الميت المقاس | الصح المتصل |
|---|---|
| `POST /api/monitor/processes/${pid}/kill` (ProcessesPage) | `POST /api/processes/:id/kill` (راوتر موجود فعلاً) |
| `PATCH /api/webhooks/${id}` (webhooks.tsx) | **راوتر جديد**: PATCH webhook (DB حقيقية) |
| `DELETE /api/webhooks/${id}` (webhooks.tsx) | **راوتر جديد**: DELETE webhook (DB حقيقية) |

- الراوترات الجديدة على `routes/webhooks.ts` بطبقة الDB نفسها (`webhooksTable` · drizzle `eq`).
- **بغلطة عدل البوابة نفسها:** نافذة استنتاج method الثابتة (400حرف) كانت بتسرق POST من النداء اللي بعده وبتحرج GET حي كزر ميت — اتصلحت (النافذة تقفل عند أول نداء تاني).
- **النتيجة المقاسة:** `152 نداء في الواجهة كلها ليها راوتر حي (665 مسار) — مافيش زر ميت.`
- المسجلة في `STRUCTURAL_GATES` → **agent-gates: 44/44 green · 91.7s**.

## 2) طبقة WS موحدة — «ناقل واحد لكل الكل»

**الخلل المعماري المقاس:** رسائل السيرفر الواردة عبر `/api/ws` كانت بتوصل **لمالك السوكيت وحده** (`dispatchLocal` للinstance الفاتح) — أي شاشة/عداد تاني في نفس الصفحة كان أعمى عنها.

**التصحيح:**
1. `ws.onmessage` في `useWebSocket.ts` بيبعت أي رسالة واردة للباص العام (`emitPlatformWsEvent` → localListeners + BroadcastChannel + SSE hook) — **كل تاب/شاشة/عداد يسمع نفس الحدث**. (مفيش لوب — القنوات standalone فانكشنز بث نضيفة، قيس اللوب بالإطار).
2. `useLiveEvent(type, handler)` — اشتراك بحدث واحد من الناقل بلا سوكيت جديد.
3. `useLiveRefetch(types, refetch, fallbackMs)` — **العداد الحي الموحد**: حدث مطابق = جلب فوري (خنق 800ms) + عدّاد أمان بطيء (≥20ث) لو القناة وقعت. **مافيش اعتماد كلي على WS** — الاستطلاع بقى خطة أمان.

**بث جديد من السيرفر (مصدر الحقيقة):**
- `autonomous_status` — من `lib/autonomy-control.ts` عند كل `setAutonomy` (زر/boot pin) وكل `runAutonomyTickNow` ناجحة.
- `kali_tasks_changed` — من `routes/kali-command.ts` عند الـ7 مواضع `tasks.set` + `DELETE tasks` (clear).
- `notification` — من `lib/push-hub.ts` في `broadcast()` (الإشعار دلوقتي على SSE المخصوص **و** الناقل الموحد).

**العدادات المحوّلة (من 4-5ث استطلاع → لحظي + أمان 30ث):**
- `NovaCommanderPanel`: agent (`local_agent_status`, `agent_deep_profile`) · tasks (`kali_tasks_changed`) — الدوال طلعت لـuseCallback (scope صح للhook).
- `LiveAgentPanel` control board: `fleet_mesh_message` · `local_agent_status` · `notification` · `autonomous_status` · `autonomous_tick` (+ activeTabRef للتاب المفتوح).
- `SystemContext` (الوضع المستقل — القيد الحرجة «لا يتصفر»): استطلاع 20ث→60ث + تطبيق الحالة لحظيًا من `autonomous_status` مباشرة.
- `NovaAgentPro` (/agent-pro — عين النظام): 12ث→30ث أمان + جلب لحظي عند أي حدث من 9 أنواع (`local_agent_status` · `autonomous_status` · `autonomous_tick` · `notification` · `kali_tasks_changed` · `fleet_mesh_message` · `nexus_background` · `watch_note` · `agent_tool_result`).

## 3) تدقيق نصوص /kali-env حرفًا — كل رقم من قياس حي

- «11 تصنيف رسمي» ✓ صحيح (`KALI_CATEGORIES.length` = 11).
- «2,246 تنفيذية · 2,113 حزمة» ✓ مقاسة وموثقة (fleet-nodes.yml:197 · tools.ts:1011).
- **الكاذبة المكتشفة والمصلحة:** `KALI_ARSENAL_64` القائمة المحلية فيها **82 أداة فعليًا** والنصوص كانت بتقول 64/78:
  - `setup.ts`: «78 tools ready» → `${KALI_ARSENAL_64.length}` ديناميكي.
  - `ollama-browser.ts`: «و78 أداة» → نفس الحساب الحي.
  - `getCorpusStats()`: `kaliCategoriesCount: 13` حرفًا → حساب من الفئات الفعلية. **الفئات كانت مكررة نصيًا** (3/4/5/11 كل واحدة باسمين) — اتوحّدت، والاستغلال رجّع رقمها الصحيح 14. **القياس الموحد: 82 أداة · 14 فئة** — كل أرقام القاموس بتتحسب وقت التشغيل.
- التوأم `cyber-corpus-2099.ts` (panel→server) متزامن ✓ (audit-twins green).

## 4) القياس E2E الحي (سيرفر مبني + عميل WS حقيقي)

```
ws: connected
enable: 200
tasks-clear: 200
{"received":["autonomous_status@60ms","kali_tasks_changed@72ms","notification@77ms"],"code":0,"why":"الثلاثة وصلوا"}
```
**الثلاثة وصلت لحظة الإنتاج (≤80ms) عبر `/api/ws`.**

## 5) البوابات النهائية

- `agent-gates: 44/44 green · 91.7s` (شاملة البوابة الجديدة).
- `typecheck-ratchet`: At baseline — بلا أخطاء جديدة (غلطة UUID في webhooks اتصلحت).
- `audit-connections`: 0 gaps · `audit-twins`: متطابقة.
- بناء السيرفر: `build.mjs` ✓ · بناء البانل: `vite build` ✓ 12.89s.

## متبقٍ على المالك
- تدوير المفاتيح (معلق من الجولات السابقة — مرفقات env compromised).

---

## 6) جولة المالك على الموقع الحي — فكس أزواج /kali-env المكتشفة (2026-11-16 بعد الظهر)

شكوى المالك المقاسة بالسطر على الصفحة الحيّة (1181 سطر اتحرقت عين التدقيق):

| الزوج المكتشف | الحقيقة | الفكس |
|---|---|---|
| **أمر النسخ لعقدة كالية** كان بيطلع `/api/api/local-agent/...` (API نسبي + `/api` مكررة) → 404 — «باظ» | الراوتر نفسه (local-agent.ts:901) بيستخدم `${origin}/api/...` | `ORIGIN = window.location.origin` + مسار واحد صحيح — الأمر المنسوخ شغّال فعلًا دلوقتي |
| **عدّاد المخزن الكامل**: `Object.values(cat).flat().length` على مصفوفة فئات = عدد الفئات مرتين («11 حزمة في 11 فئة» وهم) | الكتالوج المقاس: 166 أداة/11 فئة من السيرفر | `cat.reduce((n,c) => n + c.tools.length, 0)` أداة في `cat.length` فئة |
| **الترقيمة العلوية** تقول «كالي شغالة فعليًا على عقد الأسطول» حتى لو صفر عقد متصلة | قياس العقد موجود في نفس الصفحة (`nodes`) | ثلاثة فروع مقاسة: هَب كالي (بالعدد الحقيقي) / عقدة كالية متصلة / ولا حاجة (يقول الحقيقة + الموجة) |
| **لستة المجموعات الثابتة** («كل مجموعات كالي» + 12 اسم) كانت إشهار غير مقاس | المجموعات الحقيقية metapackages kali-tools-* | صياغة مقاسة: متاحة عبر apt + القياس الفعلي في الكتالوج |

التحقق المقاس: بناء البانل ✓ 13s · typecheck baseline ✓ · api-freshness 152/665 ✓ · **gates 44/44 green (89.6s)** · cron fleet-nodes «كل 5 ساعات» متحقق بالحرف (0 */5 * * *).
