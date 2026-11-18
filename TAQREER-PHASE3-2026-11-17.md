# تقرير المرحلة 3 — كالي حقيقية + مكان شغل + نسف أعمق

**التاريخ:** 2026-11-17 · **الفرع:** `arena/12d92c96-xfreedollarhachx` · **آخر commit:** `28c7cf6`

كل رقم تحت **مقاس على أرض الواقع** في هذه الجلسة، مش مدّعى.

---

## 1. الجذر الحقيقي لكل فشل تنزيل — اتشخّص واتصلح

كان كل تنزيل في البرنامج بيفشل برسالة مضللة («المرآة ما وصلتش»، «مفيش خروج»، «fetch failed»).
الجذر الحقيقي:

> **Node مابيقراش حزمة شهادات النظام.** البيئة بتعيد توقيع TLS بشهادة جذر في
> `/usr/local/share/ca-certificates/e2b-ca.crt` موجودة في حزمة النظام ومش في حزمة Node.
> فـ`curl` بياخد `200 / 94,371,840 bytes` و`fetch` بيرمي
> `UNABLE_TO_VERIFY_LEAF_SIGNATURE` في 76 مللي ثانية.

### الإصلاح — ثلاث محاولات، التالتة هي اللي اشتغلت

| المحاولة | الطريقة | النتيجة |
|---|---|---|
| 1 | `import "./tls-trust"` أول سطر في `index.ts` | ❌ esbuild بيحط الموديول في سطر 108,722 من 108,800 (ترتيب التبعية) |
| 2 | `banner` بيبني `/tmp/*.pem` ويحط `NODE_EXTRA_CA_CERTS` | ⚠️ الحزمة اتبنت فعلًا، بس Node بيقرا المتغير **وقت الإقلاع** بس |
| 3 | `tls.setDefaultCACertificates()` وقت التشغيل | ✅ **145 → 166 شهادة · FETCH 200** |

**عايز تسجّل:** المحاولة الأولى كانت بتفشل بصمت — الحزمة كانت بتتبني بس الـside effect
بيتنفّذ بعد كل حاجة. اتأكدت بقراءة سطر الموديول في الـbundle، مش بالتخمين.

---

## 2. الحجم الحقيقي لكالي — رقم المانيفست كان غلط

| المصدر | الرقم | الصح؟ |
|---|---|---|
| `MANIFEST.txt` | 19,972,681,362 بايت (~18.6GB) | ❌ ده الحجم المنطقي |
| ملفات الأجزاء المضغوطة | 5.62GB | — |
| **المقاس على الدسك** | **12.85GB** | ✅ |

اتقاس بجمع أحجام كل الملفات في الـ64 جزء (`usr` 12.54 · `var` 0.24 · `opt` 0.06).
فحص المساحة كان بيرفض التجهيز على رقم 18.6GB — يعني **كان بيمنع حاجة ممكنة**.

### الاستكمال — سؤال كان لازم يتسأل

حاولت أضيف resume بعد فشل عند 57/64. **اتضح إنه مستحيل رياضيًا:**

```
part-00 → 1f 8b   (gzip)
part-01 → e0 60   (منتصف stream)
part-02 → 32 cc
part-03 → 28 5e
```

الأجزاء **شرائح من stream ضغط واحد**، مش أرشيفات مستقلة. الكود القديم اللي كان
بيرجع من `part-00` كان **صح**. القصور الحقيقي كان إن المساحة تخلص في النص — وده
اللي اتصحّح. سجّلت المستحيل في الكود بدل ما أدّعي حلّه.

---

## 3. التجهيز — 64/64 خلص بنجاح

```
17:22 التجهيز بدأ → /home/user/kali-rootfs/rootfs · الفرع kali-rootfs
      المساحة الفاضية: 18GB
      الموارد: RAM 4GB · CPU 2 نواة
      الأجزاء: 64 · ref 037903de
      kali-static: fetch ✓
02:43 64/64 أجزاء ✓
      الهيكل: bin boot etc github home lib lib64 media mnt opt root sbin srv usr var
      proot-static شغّال ✓
      تم في 10 دقيقة · 2813 أداة تنفيذية · 2113 حزمة
```

**لماذا نجح بعد فشلين:** المساحة (12.85 مقاسة بدل 18.6) + TLS (الـbanner).

---

## 4. مكان الشغل في كالي — كان غايب تمامًا

### اللي كان موجود قبل
- `POST /kali-env/exec` → أمر واحد، SSE، بينتهي، **مفيش حالة**.
- `GET /kali-env/sessions` → `{sessions: [], note: "one-shot"}`.
- **صفر** نتيجة لـ`NOVA_KALI_WORKSPACE|kaliWorkspace`.

### اللي اتبنى
`kali-workspace.ts` + `KaliWorkspacePanel.tsx` + 8 routes.

| الأمر | الوظيفة |
|---|---|
| `GET /kali-env/workspaces` | المساحات الحقيقية من الدسك |
| `POST /kali-env/workspaces` | ينشئ مساحة (slug آمن، مجلدات scans/loot/payloads/reports/scripts/notes) |
| `POST .../:slug/run` | ينفّذ **جوه** المساحة، بيرجّع الملفات الجديدة |
| `GET .../:slug/file` | يقرا نتيجة المسح جوه البرنامج |
| `GET .../:slug/shell` | أمر طرفية جاهز للجهاز |
| `GET /workspaces-selftest` | فحص حقيقي بيشغّل شل |

### إصلاحان اتكشفوا باختبار حقيقي مش بقراءة كود

**أ) `Permission denied` على `chdir`**
```
proot warning: can't chdir("/root/nova-workspaces/self-test/.") in the guest rootfs
```
`-w` بيفشل قبل ما الـrootfs يطبّق. الحل: `-w /` + `cd` جوه الـshell.

**ب) `/root` مملوك `root:root` بمودّ 700 والـuid الحقيقي 1001**
```
ls: cannot access '/root/nova-workspaces': Permission denied
```
الحل: المساحات في **`/opt/nova-workspaces`**، و`HOME` = المساحة.

### الدليل الحي

```bash
$ curl -X POST .../workspaces/web-audit/run -d '{"command":"nmap -sT -Pn -p 22,80,443 ..."}'
22/tcp  open   ssh
80/tcp  closed http
443/tcp closed https
→ newFiles: ["scans/scan-tcp.txt", "notes/target.md"]
```

بعد إعادة تشغيل السيرفر: **357 ملف محفوظ · السجل شغال · مساحتين**.

---

## 5. الأدوات — «حمّل كل الأدوات»

### المسار اللي شغال فعلًا (مقاس)

| المضيف | الحالة |
|---|---|
| `pypi.org` · `files.pythonhosted.org` | ✅ 200 |
| `registry.npmjs.org` | ✅ 200 |
| `release-assets.githubusercontent.com` | ❌ ECONNRESET |
| `http.kali.org` · `deb.debian.org` · `kali.download` | ❌ 000 |

فحص الـ16 أداة Go في `VENDORABLE` **مستحيل** من المكنة دي. لكن **أدوات بايثون بتنزل**.

### `scripts/fetch-python-tools.mjs` — 3 أعطال اتصلحت

| العطل | القياس | الإصلاح |
|---|---|---|
| مسار الأمر من `verify[0]` بدل `bin` | `volatility3` أمرها `vol` | المسار من `bin` |
| عتبة النص `> 20` | `sqlmap --version` = **12 حرف** (`1.10.11#pip`) | كود 0 + نص، أو رقم نسخة |
| اسم حزمة غلط | `bloodhound-ce-python` = 404 | `bloodhound-ce` = 200 |

قبل الإصلاح: 9/12 · بعد: **12/12** ثم **28/29** مع `--all`.

### المقاس جوه كالي

**95 من 131** أداة موجودة. `password-attacks` و`exploit` **كاملين**.

| المجموعة | موجود | المجموعة | موجود |
|---|---|---|---|
| password-attacks | 10/10 ✅ | exploitation | 8/10 |
| exploit | 4/4 ✅ | web-applications | 12/14 |
| information-gathering | 12/17 | forensics | 10/14 |
| reverse-engineering | 10/13 | post-exploitation | 6/11 |

**موجود ومؤكد بالتشغيل:** nmap 7.991 · metasploit 6.5.7 (5,128 module) · burpsuite ·
sqlmap 1.10.10 · hydra 9.7 · john · hashcat · aircrack-ng · nikto · gobuster ·
feroxbuster · wfuzz · dirb · dirsearch · nuclei · searchsploit · wireshark · tcpdump ·
scapy · arpspoof · mitmproxy · impacket-secretsdump/psexec · volatility3 (`vol`) ·
sublist3r · arjun.

**ناقص وسببه:** `ffuf`/`subfinder`/`amass`/`katana`/`ghidra` = ثنائيات Go/Java من
GitHub releases (محجوب) · `ettercap`/`steghide`/`exiftool`/`jq` = حزم نظام (apt محجوب).

---

## 6. النسف الأعمق — مقاس مش موعود

| القدرة | القياس |
|---|---|
| وحدات استغلال metasploit | **5,128 module** · 367 في linux/http |
| exploit-db | `searchsploit apache` رجّع EDB-IDs حقيقية |
| قوالب nuclei | **14,315 قالب** في `/opt/nuclei-templates` |
| كشف خدمة حقيقي | `openssh-detect → "SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u10"` |
| مسح منافذ حقيقي | `22/tcp open ssh` على 127.0.0.1 |
| استغلال AD | impacket · certipy 4.8.2 · bloodhound-ce · pypykatz |
| ثنائيات | pwntools · ROPgadget 7.7 · capstone · keystone |
| تحليل جنائي | volatility3 2.28.2 · oletools |

### قيد لازم تعرفه
**كالي مش عندها خروج للإنترنت العام** — `example.com`/`google.com`/`api.github.com`
كلهم `000`، بس `pypi.org`/`npm` شغالين. يعني الأدوات بتشتغل على **أهداف محلية
أو على الشبكة الداخلية**؛ المسح الخارجي محتاج الهَب يكون عنده خروج.

---

## 7. التحقق النهائي

| الفحص | النتيجة |
|---|---|
| kali-env health | `ready: true` · guestShell ✓ |
| مكان الشغل | مساحتين · `selftest: OK` |
| أدوات كالي | **95 / 131** |
| أدوات بايثون | **28 / 29** · 167 حزمة |
| `audit-live` | **170/170 · 0 فشل** |
| `audit-render` | **171/171** |
| page-census | 86 صفحة · 86 routed |
| `nova-core/self-check` | **100 · 10/10** |
| contracts · CJK · route-integrity · connections | ✅ كلهم |
| `standalone-api.ts` توأم | بايت-متطابق `70d7b7b0` |
| الحالة بعد إعادة التشغيل | ✅ محفوظة |

---

## 8. اللي لسه ناقص — بصراحة

1. **الهَب الخارجي** (`nova.waifly.com`) محتاج deploy — التغييرات على الفرع، مش على السيرفر الحي.
2. **36 أداة** من 131 محتاجة إما ثنائيات Go (GitHub releases محجوب) أو apt (مستودعات محجوبة). الحل: بناء مرآة على فرع `kali-static`.
3. **الخروج للإنترنت** من كالي محدود بـpypi/npm — المسح الخارجي محتاج شبكة.
4. **`/root` جوه كالي** مش قابل للكتابة — شغال حاليًا بـ`/opt`، وتحويله لـ`root` حقيقي محتاج تعديل `/etc/passwd` جوه الـrootfs.
