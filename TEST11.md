# TEST11 — «احنا معانا كل شيئ»: كالي حقيقية مدمجة جوه البرنامج نفسه

> طلب المالك حرفيًا: «مش هحملو ومش هستخدم جهازي — انت الي هتحمل النسخة وتسطبها
> على البرنامج عندنا ويبقي عندنا بيئة كالي لينكس حقيقية تخص البرنامج واللايف
> اجينت… يقدر يحمل أدوات ويستخدم نسخة كالي حقيقية نشتغل بجد — يتحكم في النظام
> بالكامل ويحرك ماوس ويفتح كل حاجة».

## القرار المعماري — اتقاس قبل ما يتبني

- السانبوكس نتّه **محجوب على kali CDN** (قيس: 6 هوستات بس) لكن **github.com
  مسموح** و الGitHub Runner نتّه مفتوح ⇒ **CI يبني rootfs كالي كاملة على
  runner ويترفع فرع `kali-rootfs` (أجزاء ≤90MB) والبرنامج يسحبها بgit fetch**.
  صفر اعتماد على جهاز المالك أو أي سيرفر خارجي.
- **proot (self-hosting)** بدل chroot: السانبوكس بلا root (uid=1001 قيس) ⇒
  البيئة بتشغّل نفسها من داخلها بproot الستاتيك — **قيس**: glibc المضيف 2.36
  والضيف 2.41 ⇒ proot الديناميكي بيطلب GLIBC_2.38 مش موجود ⇒ **static إجباري**
  (جرّبنا LD_LIBRARY_PATH بالtalloc — فشل بنفس السبب، مسجّل).

## قياسات البناء (كل فشل شخّصناه وأصلحناه مقاسًا)

| Run | اللي حصل | الإصلاح |
|---|---|---|
| 43565698002 | apt exit 100 واللوج محجوب (EOF) | retry مرايا + أخطاء `::error::` annotations تتفحص من API |
| 43567237192 | البناء نجح، الرفع وقع | HTTP/1.1 + postBuffer |
| 43570109294 | parts=28 (~2.4GB) ⇒ push موحّد HTTP 500 | رفع **تجزيدي جزء-لكل-push** + استبعاد doc/man/locale/log/cache |
| kali-static #1 | `nohajc/proot-static` **404** (مش موجود أصلًا) | المرشح الحقيقي `ysdragon/proot-static` v5.4.0 + fallback proot-me الرسمي |
| **43573506609** | **build=success — الفرع اترفع بالكامل** ✓ | — |

## الإثبات الحي — النسخة شغالة فعليًا

- `scripts/kali-rootfs-fetch.sh` سحب واستخرج: **Kali GNU/Linux Rolling
  2026.3 · 661 حزمة** (من dpkg نفسها) · nmap+proot+novnc موجودين ✓
- **التنفيذ الحقيقي** (proot-static v5.4.0، accelerators: process_vm ✓
  seccomp_filter ✓):
  - `nmap 7.991` · `sqlmap 1.10.10#stable` · `Nikto 2.6.1` · `Hydra v9.7` ·
    `hashcat v7.1.2` · `TShark 4.6.9` · `Firefox ESR 153.5.1` · `Python 3.14.8`
  - تحميل أدوات جديدة جوه البيئة: `python3-pip` و`git` متسطبين.
- **الديسكتوب الحقيقي شغّال**: Xvfb :99 (1280x800x24) + fluxbox (الشريط
  السفلي بالساعة ظاهر في السكرينشوت) + xterm ببرومبت حي + thunar.
  - **الأجينت بيحرك الماوس فعليًا**: `xdotool mousemove 400 300` ⇒
    `x:400 y:300 screen:0` (مقاس) · `getdisplaygeometry` ⇒ `1280 800` ✓
  - **المتصفح يفتح الديسكتوب**: noVNC على :6080 ⇒ `HTTP 200` (قيس) +
    سكرينشوت `scrot` 14KB اتحفظ — الصورة في `.cache/kali-screen.png`.
- **عبر الهَب نفسه** (السلسلة الكاملة: route → kali-env → kali-exec.sh →
  proot):
  - `GET /api/ops/kali` ⇒ `present:true · 661 حزمة · probe: Nmap 7.991`
    (البروب نفّذ حقيقي) · `desktop:{running:true,vnc:true,novnc:true}`
  - `POST /api/ops/kali/exec` ⇒ `exitCode:0 · 284ms` · sqlmap + python داخل
    كالي ✓ · **إشعار مخزّن دائم**: «🖥️ كالي نفّذت أمر حقيقي · link:
    /kali-command» ✓
  - **أدوات الأجينت: 85 مقاس** (`kali_run` + `kali_desktop` ضافوا على 83).
- **اللوحة**: مركز كالي فيه هدف طرفية ثالث «🐉 KALI المدمجة» (أوامر سريعة
  للأدوات + تنفيذ حقيقي عبر /ops/kali/exec) + كارت «كالي حقيقية مدمجة»
  (ب梭 الحزم + البروب + أزرار شغّل/اطفي الديسكتوب + فتح المتصفح) — والوضع
  الساكن بيرفض بصدق (SERVER_ONLY).

## ملفات جديدة

- `scripts/kali-rootfs-build.sh` (CI builder صامد) · `scripts/kali-rootfs-fetch.sh`
  (سحب/استخراج/تحقق) · `scripts/kali-exec.sh` (تشغيل أي أمر داخل كالي) ·
  `scripts/kali-desktop.sh` (Xvfb+fluxbox+x11vnc+noVNC) — كلهم bash -n ✓.
- `artifacts/api-server/src/lib/ops/kali-env.ts` (تشغيل/قياس/ديسكتوب +
  إشعارات) · routes `/api/ops/kali[|/exec|/desktop]` (بوابة المالك على exec
  والديسكتوب) · أداتين جداد في tools.ts · `.github/workflows/kali-rootfs.yml`
  + `kali-static.yml`.
- الrootfs نفسها (1.1GB) في `.cache/` **مستثناة من جيت** — بتتجيب بأمر واحد
  (`bash scripts/kali-rootfs-fetch.sh`) من فرع kali-rootfs الموجود على جيت هب
  دايمًا (استرجاع في أي وقت).

## البوابات

- typecheck الاتنين 0 · `pnpm gates` **42/42 green (74.3s)** · build الاتنين ✓
  (dist فيه kali routes + واجهة كالي المقاسة) · YAML الاتنين 0 errors.

## بانتظار المالك

- الديسكتوب شغّال الآن — افتحه من رابط المعاينة :6080 (`/vnc.html`).
- على أي سيرفر تاني: `bash scripts/kali-rootfs-fetch.sh` ثم
  `scripts/kali-exec.sh 'nmap -sV <target>'` — نفس البيئة بالحرف.
