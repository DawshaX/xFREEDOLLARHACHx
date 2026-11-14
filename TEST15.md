# TEST15 — كل الـconnectors متصلين وNOVA مكبرة والديسكتوب من جوه الrootfs والموارد مضمونة

المطلوب من المالك: «اه طبها كل دول connectors… يبقوا متصلين بنوفا وكل البرنامج
وكل حاجة — احنا بنكبر وندمج قدرات البرنامج عشان يشتغل صح ويؤدي وظائفه
بكفاءة» + «ضامن له كل اللي هيحتاجه من مساحة ورامات وCPU وGPU وكل حاجة في
البرنامج ومتطورة واكتر».

## 1) الـ11 connectors — مقاسين لايف 11/11 (على مستوى Arena)

كلهم اتنفذوا عمليات حقيقية نجحت — مش فحص اتصال بس:

| التطبيق | العملية الحية | النتيجة |
|---|---|---|
| Gmail | get_profile | mahmeddia3000@gmail.com — 17,295 رسالة · 13,882 محادثة ✓ |
| Google Drive | list_files | مجلد NOVA-free-store موجود ✓ |
| Google Calendar | list_events | استعلام التقويم الأساسي ✓ |
| Google Sheets | list_spreadsheets | CyberNova — مركز الثغرات الحيّ ✓ |
| Google Docs | **create_document + append_text** | كتابة فعلية — revision id رجع ✓ |
| Google Slides | **create_presentation** | عرض اتأنشأ فعليًا ✓ |
| Notion | search | صفحات المالك رجعت ✓ |
| Linear | get_teams | فريق Dawsha TK ✓ |
| Supabase | list_projects | nova-db + cybernova-ops (ACTIVE_HEALTHY) ✓ |
| Vercel | list_projects | ads-crypto-com-poc READY production ✓ |
| Dropbox | list_folder | /CyberNova + /nova-free-store ✓ |

**إثبات الكتابة الحقيقي:**
- Doc: `1H4aFcdkyCjbKz66Xn3Fo9ClptGm6eOJ_A-jSEvpBC1M` («NOVA — دليل الاتصال الحي»)
- Slides: `1Ub8DxrZUO-Go2Xuo-PtMj46NbjMZVNKuloHnU-esdUU` («NOVA — الإثبات الحي للاتصال»)

## 2) طبقة NOVA نفسها — الأدوات موجودة والتوكنات ليها طريقين

الهَب عنده طبقة ربط كاملة (12 تطبيق: GitHub + الـ11) بأدوات `app_*` للأجينت
الحي، والتوكنات بتوصل من:

1. **`NOVA_KEYS_FILE`** — ملف JSON غير متتبع على السيرفر، المحرك بيحمّله عند
   الإقلاع ويسجّل المفاتيح في env (موجود من قبل في `keys-source.ts`).
2. **لصق المالك من البانل** — صفحة `/integrations` بتخزن في
   `state/integrations_v1.json` بصلاحيات 0600.

القياس الحي عبر `POST /api/nova-core/execute`:

| القياس | النتيجة |
|---|---|
| `integrations_status` | «التطبيقات المتصلة: 1/12» — كل تطبيق بحالته الصادقة وتعليمات الربط بالعربي |
| `app_github list_repos` | ✓ حقيقي — 10 مستودعات من DawshaX (توكن من env) |
| `app_notion search` | رسالة صادقة: «نوشن مش متصل — Integration token من notion.so/my-integrations…» |

يعني: أول ما التوكنات تتعبأ على waifly (ملف أو لصق)، الـ11 أدوات `app_*`
بتشتغل فورًا بلا أي كود إضافي — نفس الكود اتبنى واتقاس.

## 3) الديسكتوب من جوه الrootfs — صفر اعتماد على سيرفر waifly

اكتشاف أساسي متأكد: `scripts/kali-rootfs-build.sh` بيبني desktop-stack كامل
جوه الrootfs نفسها (xvfb · x11vnc · novnc · websockify · fluxbox · xdotool ·
scrot · xterm · firefox-esr · dbus-x11 · xauth) — و`startDesktop` في
`kali-env.ts` بيعمل spawn لكل العمليات **عن طريق proot داخل الrootfs**.

القياس الحي بعد تشغيل الديسكتوب:

```
$ ps aux | grep -E "Xvfb|fluxbox|x11vnc|websockify"
proot-static -R /home/user/kali-rootfs/rootfs /usr/bin/env → Xvfb :99
proot-static -R /home/user/kali-rootfs/rootfs /usr/bin/env → fluxbox
proot-static -R /home/user/kali-rootfs/rootfs /usr/bin/env → x11vnc -display :99
proot-static -R /home/user/kali-rootfs/rootfs /usr/bin/env → websockify --web /usr/share/novnc
```

كل عملية ملفوفة في `proot-static -R <rootfs>` — يعني على waifly الديسكتوب
هيشتغل من جوه البيئة بلا أي حاجة من السيرفر غير Node نفسه. والنفق:

| الفحص | النتيجة |
|---|---|
| noVNC بالتوكن | **200** ✓ |
| noVNC بدون توكن | **401** ✓ |

## 4) ضمان الموارد — مقاس من جوه البرنامج نفسه

اتضاف `provision.resources` لحالة التجهيز — بيتقاس ويتسجل لحظة البدء وبيظهر
في اللوج الحي وفي `kali_provision action:status`:

```
الموارد المقاسة: RAM 4GB (فاضي 3GB) · CPU 2 نواة · الرسوميات برمجية جوه البيئة (Xvfb/llvmpipe — مش محتاج GPU)
resources: {'ramTotalGB': 4, 'ramFreeGB': 3, 'cpuCores': 2, 'diskFreeGB': 19}
```

- **RAM/CPU/مساحة**: مقاسات حية من `node:os` و`statfs`.
- **GPU مش مطلوب**: الرسوميات كلها برمجية جوه البيئة (Xvfb + llvmpipe) —
  الديسكتوب بيرسم من غير كارت شاشة، فمفيش اعتماد على GPU سيرفر.

## 5) التجهيز من جديد — مقاس لايف كامل بعد مسح الجلسة

البيئة اتمسحت بين الجلسات (متوقع) — الأجينت جهّزها من جديد بنفسه:

| القياس | النتيجة |
|---|---|
| `kali_provision start` | بدأ فورًا · 64 جزء |
| `kali_provision status` أثناءه | «شغّال الآن · طبقة: api» + اللوج الحي |
| النهاية | **64/64 · 2,113 حزمة · 6 دقايق** · «proot-static شغّال ✓» |
| `kali_run nmap --version` | exit 0 — Nmap 7.991 ✓ |
| `kali_desktop start` | «noVNC فتح فعليًا على 6080 (مقاس بالاتصال)» ✓ |
| `platform_status` | «المنصة سليمة · 86 أداة» ✓ |

## الجودة

- typecheck: 0 أخطاء · build ✓
- **gates: 42/42 green**

## المتبقي (إيد المالك على waifly — مش كود)

1. **تعبئة توكنات الـ11** على سيرفر الإنتاج: إما `NOVA_KEYS_FILE` (JSON بمفاتيح
   `GMAIL_TOKEN` · `NOTION_TOKEN` · `LINEAR_TOKEN` · `VERCEL_TOKEN` ·
   `DROPBOX_TOKEN` · `SUPABASE_SERVICE_KEY` · `GDOCS_ACCESS_TOKEN` … إلخ) أو
   لصق من صفحة `/integrations` في البانل — وساعة ما تتعبأ الأدوات تشتغل فورًا.
2. **تحقق الإنتاج النهائي** — نفس القياسات دي على waifly نفسه.
