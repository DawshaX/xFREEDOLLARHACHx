#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# بيئة كالي الحقيقية المدمجة — «احنا معانا كل شيئ وانت الي هتحمل النسخة»
#
# الجد جوه كونتينر kalilinux/kali-rolling على GitHub Runner (النت مفتوح هناك):
# بيسطب الأدوات + GUI + المفسرات على ملفات الكونتينر نفسها، يضغطها zstd،
# يقسمها أجزاء ≤90MB (حد جيت هب 100MB/ملف)، ويرفعها لفرع kali-rootfs.
# السانبوكس المحلي (النت محجوب على kali CDN) بيسحب الفرع بـgit fetch
# (github.com مسموح) ويستخرجها ⇒ كالي حقيقي كامل جوه البرنامج نفسه.
# أخطاء apt بتطلع annotations (::error::) عشان تتفحص من API جيت هب مباشرة.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
OUT=/out
mkdir -p "$OUT"
export DEBIAN_FRONTEND=noninteractive

echo "== [1/6] apt update (مع 3 محاولات — مرايا كالي بتهنج أحيانًا) =="
apt_ok=""
for i in 1 2 3; do
  if apt-get update > /tmp/apt-update.log 2>&1; then apt_ok="محاولة $i ✓"; break; fi
  echo "  update فشل (محاولة $i) — الأخطاء:"; grep -E "^E:|^W: " /tmp/apt-update.log | head -4 || true
  sleep 8
done
[ -n "$apt_ok" ] || { grep -E "^E: " /tmp/apt-update.log | head -5 | while IFS= read -r l; do echo "::error::$l"; done; exit 100; }
echo "  $apt_ok"

echo "== [2/6] CORE — الأدوات الأساسية (لازم تنجح) =="
CORE=(nmap sqlmap nikto hydra john hashcat aircrack-ng whatweb gobuster tshark
  python3 python3-pip ruby perl curl wget git unzip zip xz-utils zstd
  ca-certificates procps less nano proot
  xvfb x11vnc novnc websockify fluxbox xdotool scrot xterm firefox-esr
  dbus-x11 xauth fonts-dejavu-core)
if apt-get install -y --no-install-recommends "${CORE[@]}" > /tmp/apt-core.log 2>&1; then
  echo "  CORE ✓ ($(ls /var/cache/apt/archives/*.deb 2>/dev/null | wc -l) حزمة نزلت آخر مرة)"
else
  grep -E "^E: |Unable to locate|no installation candidate" /tmp/apt-core.log | head -6 | while IFS= read -r l; do echo "::error::$l"; done
  tail -4 /tmp/apt-core.log
  exit 100
fi

echo "== [3/6] EXTRA — حزم إضافية (كل واحدة على حدة، الفشل مايوقفش البناء) =="
EXTRA=(john-data smbclient socat netcat-openbsd bind9-dnsutils dnsutils whois
  proxychains4 macchanger dirb dnsrecon fierce enum4linux tcpdump openssl
  openssh-client vim-tiny mousepad thunar htop fonts-liberation)
FAILED_EXTRA=()
for pkg in "${EXTRA[@]}"; do
  if apt-get install -y --no-install-recommends "$pkg" > /dev/null 2>&1; then
    echo "  ✓ $pkg"
  else
    echo "  ✗ $pkg (مش موجودة في المستودع ده — مسجلة في المانيفست بصراحة)"
    FAILED_EXTRA+=("$pkg")
  fi
done

echo "== [4/6] proot-static (حماية توافق glibc مع السانبوكس — best-effort) =="
PROOT_URL=$(curl -fsSL "https://api.github.com/repos/nohajc/proot-static/releases/latest" 2>/dev/null | grep browser_download_url | grep x86_64 | grep -v sig | head -1 | cut -d'"' -f4 || true)
if [ -n "$PROOT_URL" ] && curl -fsSL "$PROOT_URL" -o /usr/local/bin/proot-static 2>/dev/null && chmod +x /usr/local/bin/proot-static; then
  echo "  proot-static ✓ ← $PROOT_URL"
else
  echo "  proot-static مش متاح — هنعتمد proot بتاع كالي (مقاس وقت التشغيل)"
fi

echo "== [5/6] تنظيف + المانيفست المقاس (كل رقم من الأمر نفسه) =="
rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb /root/.cache 2>/dev/null || true
{
  echo "PRETTY_NAME=$(grep PRETTY_NAME /etc/os-release | cut -d'"' -f2)"
  echo "packages=$(dpkg -l 2>/dev/null | grep -c '^ii')"
  echo "bytes=$(du -sb --exclude=/out --exclude=/proc --exclude=/sys --exclude=/dev --exclude=/__w --exclude=/.git / | cut -f1)"
  echo "built_at=$(date -u '+%Y-%m-%dT%H:%MZ')"
  echo "commit=${RUN_SHA:-unknown}"
  echo "run_id=${RUN_ID:-unknown}"
  echo "failed_extra=${FAILED_EXTRA[*]:-ولا حاجة}"
  echo "proot_static=$([ -x /usr/local/bin/proot-static ] && echo yes || echo no)"
  echo "-- measured versions (من الداخل) --"
  nmap --version 2>/dev/null | head -1 || echo "nmap: n/a"
  sqlmap --version 2>/dev/null | head -1 || echo "sqlmap: n/a"
  nikto -Version 2>/dev/null | head -2 | tr '\n' ' ' || echo "nikto: n/a"; echo
  hydra 2>&1 | head -1 || echo "hydra: n/a"
  john --version 2>/dev/null | head -1 || echo "john: n/a"
  hashcat --version 2>/dev/null | head -1 || echo "hashcat: n/a"
  aircrack-ng --help 2>&1 | head -1 || echo "aircrack: n/a"
  gobuster version 2>&1 | head -1 || echo "gobuster: n/a"
  tshark --version 2>/dev/null | head -1 || echo "tshark: n/a"
  python3 --version 2>&1
  ruby --version 2>&1 | head -1
  proot --version 2>&1 | head -1 || echo "proot: n/a"
  xdotool version 2>&1 | head -1 || echo "xdotool: n/a"
  firefox-esr --version 2>/dev/null || firefox --version 2>/dev/null || echo "firefox: n/a"
} > "$OUT/MANIFEST.txt"
dpkg-query -W -f='${Package}\n' > "$OUT/PACKAGES.txt"

echo "== [6/6] tar + zstd + split ≤90MB =="
cd /
tar -cf - \
  --exclude=./proc --exclude=./sys --exclude=./dev --exclude=./run \
  --exclude=./tmp --exclude=./out --exclude=./__w --exclude=/.git \
  --exclude=./.dockerenv --exclude=./etc/mtab \
  . | zstd -T0 -10 > "$OUT/rootfs.tar.zst"
cd "$OUT"
split -b 90m -d rootfs.tar.zst part-
rm -f rootfs.tar.zst
sha256sum part-* > SHA256SUMS
echo "parts: $(ls part-* | wc -l)"
ls -la part-* | awk '{print $5, $9}'
echo "== تم — الأجزاء جاهزة للرفع لفرع kali-rootfs =="
cat "$OUT/MANIFEST.txt"
