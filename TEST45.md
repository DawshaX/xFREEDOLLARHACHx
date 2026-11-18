# TEST45 — آخر 17 زر ميت بقوا حقيقية + الكاذب الأكبر اتنسف

## 1. العطل (حصر شامل مقاس 09:30-09:55Z)
مسح كل نداءات الواجهة (112) مقابل كل الراوترات (493) بمطابقة مقاطع صارمة →
**17 نداء ميت فعلًا** (كانت بترجع 404 أو بيلتقطها fallback وهمي):
registry×7 (محرر الريجستري كله) · files-manager×6 (FilesPage+AdvancedFileManager) ·
ai/history · ai/chat · autonomous/run · knowledge/upload+search · vulns CRUD · screenshot.

## 2. الكاشف الأكبر (مقاس في الكود)
app.ts فيه اعتراض بيستبدل أي 404/500 لـGETs خارج قايمة الnamespaces برد الstub
الوهمي (1px PNG «available:false») — يعني الأخطاء الصادقة كانت بتتشال!
**الإصلاح**: القايمة بقت تشمل system|registry|files|vulns|ai|agent|nova|knowledge —
كل namespace له راوتر حي. قياس بعد الفكس: screenshot بيرجع 503 صادق بالسبب ✓.

## 3. الباكند الحقيقي المبني (3 راوترات — بلا حذف أي حاجة)
- **registry.ts**: list/search/create/update/delete/backup/restore — طايرتين:
  عقدة ويندوز حقيقية (reg.exe عبر قناة الexec) أو بيئة رمل محفوظة (state/registry-sandbox.json)
  بنفس دلالات الريجستري · backup/restore بصيغة .reg حقيقية (writer+parser) ·
  كل رد فيه `plane` والواجهة بتعرضه (بطاقة أخضر). حرس أسماء صارم.
- **filesys.ts**: files/list|read|write|mkdir|delete|execute — fs حقيقي على الهَب
  (جذر المشروع افتراضيًا · NOVA_FM_UNLOCKED=1 للمشغل) · execute = أوامر حية بحد 30ث ·
  stats + permissions + showHidden.
- **extras.ts**: ai/history (نكسس + محفوظ) · ai/chat (**llmComplete حقيقي — قِيس:
  رد فعلي من المزود!**) · agent/autonomous/run (**tickAutonomousDaemon حقيقي**) ·
  knowledge/upload+search (state/knowledge/ فهرسة مقاطع + بحث مرجح حقيقي) ·
  vulns CRUD (state/vulns-page.json) · system/screenshot (التقاط حقيقي لو أداة
  موجودة وإلا 503 صادق).

## 4. القياس الحي (09:56-10:01Z — إقلاعان نظيفان، 13+8 قياس)
registry list=5/create→search=1/backup=.reg حقيقي/delete ✓ · files
list=15+stats/write/read/delete ✓ · execute=`Linux 6.1.158+` حي ✓ · vulns
CRUD ✓ · knowledge upload→search snippet مرجح ✓ · ai/history=رسائل نكسس حقيقية ✓ ·
ai/chat=رد مزود حي ✓ · autonomous/run=دورة مقاسة ✓ · screenshot=503 صادق ✓.
+ إصلاحات مقاس أثناء البناء: Buffer.split → splitBuf · ترتيب الماونتس قبل
stubs · دوبل-ماونت اتشال · static shim للكتالوج في التوأمين.

## 5. البوابات
gates محلي **43/43 (95.4s)** · tsc 0/0 · builds ✓ · audit-connections ✓.
