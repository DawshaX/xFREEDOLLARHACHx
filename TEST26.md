# TEST26 — «فين الأدوات؟»: القياس الكامل من النظام الحقيقي + عرض كل الأدوات مش عيّنة

**التاريخ:** 2026-11-15 · **الفرع:** `arena/38664c6e-xfreedollarhachx` من `51a7f5f`
**المطلب:** «حملنا كالي حقيقي فيها أكتر من 2000 أداة؟ المفروض كلهم موجودين والنظام كامل وشغال قادر يستخدم كل أداة — ازاي العرض فيه 6 بس وازاي مفيش الباقي؟»

---

## 1. الإجابة المقاسة من النظام الحقيقي (rootfs مركّبة فعليًا — تثبيت #7: 64/64 SHA256 · exit 0)

| السؤال | القياس الحي |
|---|---|
| النظام فيه كام أداة؟ | **2113 حزمة** (رقم الحزم الرسمي من dpkg) · **2946 أمر تنفيذي في PATH** · **16 مجموعة أدوات كالي الرسمية** كلها منصّبة (802-11 · bluetooth · database · exploitation · forensics · gpu · information-gathering · passwords · post-exploitation · reverse-engineering · rfid · sdr · social-engineering · vulnerability · web · wireless) |
| metasploit؟ | **موجود فعلاً** — msfconsole + msfvenom + /usr/share/metasploit-framework كامل. الـ✗ اللي شفته كان **قياس مقطوع**: `msfconsole --version` بيقلع الـframework بRuby (بطيء تحت proot) واتقطع بالـtimeout — الأداة ماكانتش ناقصة، القياس كان غلط |
| أشهر 50 أداة؟ | **38 من 50 أثبتوا بوجود التنفيذ الفعلي** (`command -v` جوه كالي): nmap · masscan · sqlmap · nikto · hydra · hashcat · wireshark · tcpdump · gobuster · dirb · feroxbuster · wpscan · whatweb · wafw00f · nuclei · dnsrecon · whois · dig · aircrack-ng · reaver · binwalk · impacket-smbclient · **msfconsole** · **msfvenom** · burpsuite · zaproxy · setoolkit · maltego · beef-xss · ophcrack · cewl · enum4linux · socat · searchsploit · proxychains · ssh · openssl |
| الباقي؟ | **12 أداة ناقصة فعلاً من rootfs الأساسية**: amass · ffuf · sublist3r · exiftool · steghide · volatility3 · responder · netexec · crackmapexec · sherlock · arp-scan · hping3 (+john بتنفيذ مش كامل) |

## 2. اللي اتصلح

- **العرض بقى الكل مش عيّنة**: بوابة القياس في `/api/ops/kali/nodes` بتعدي 50 أداة معروفة (وجود التنفيذ — أسرع وأصدق من `--version`) + عدّادات النظام من dpkg (حزم · تنفيذية · مجموعات). الصفحة بتعرض السطور كلها + سطر النظام الكامل فوقهم.
- **«كل الأدوات موجودة دايمًا»**: خطوة جديدة في pre-warm الأسطول بتكمّل الـ12 الناقصين بمرايا كالي على الـrunner (شبكته كاملة — مرايا كالي محجوبة عن السانبوكس بس مش عن جيت هب) جوه rootfs proot نفسها، وبعدها بتقيس وتقول «X/12» — `continue-on-error` والموجة ماتقفش.
- صادق: `PACKAGES.txt` المصدّر من البناء كان أقدم من الأجزاء المنشورة (بيفرق في 2-3 أسماء) — القياس الحي على النظام هو الحقيقة.

## 3. البوابات

tsc الاتنين ✓ · build الاتنين ✓ · YAML ✓ · البوابات الكاملة قبل الرفع. القياس الحي للمسار الكامل: هَب من غير كالي + عقدة بكالي → 38/50 + عدادات dpkg عبر قناة الأجينت ✓.
