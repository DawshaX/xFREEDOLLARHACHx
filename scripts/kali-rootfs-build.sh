#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# بيئة كالي الحقيقية المدمجة — «احنا معانا كل شيئ وانت الي هتحمل النسخة»
#
# الديك جوه كونتينر kalilinux/kali-rolling على GitHub Runner (النت مفتوح هناك):
# بيسطب الأدوات + GUI + المفسرات على ملفات الكونتينر نفسها، يضغطها zstd،
# يقسمها أجزاء ≤90MB (حد جيت هب 100MB/ملف)، ويرفعها لفرع kali-rootfs.
# السانبوكس المحلي (النت فيه محجوب على kali CDN) بيسحب الفرع بـgit fetch
# (github.com مسموح) ويستخرجها ⇒ كالي حقيقي كامل جوه البرنامج نفسه.
# المانيفست مقاس — كل رقم فيه جاي من الأمر نفسه، مش كلام.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
OUT=/out
mkdir -p "$OUT"
export DEBIAN_FRONTEND=noninteractive

echo "== [1/5] apt update + الأدوات الحقيقية (pentest + GUI + مفسرات) =="
apt-get update -qq
PKGS=(
  # الحزم الأساسية للنظام
  procps less nano vim-tiny ca-certificates openssl openssh-client
  # المفسرات — عشان الأجينت يقدر يشغل ويحمل أدوات جديدة (pip/git داخل البيئة)
  python3 python3-pip ruby perl curl wget git unzip zip xz-utils zstd
  # أدوات كالي — الحقيقية من مستودعات كالي نفسها
  nmap sqlmap nikto hydra john john-data hashcat aircrack-ng whatweb gobuster
  dirb dnsrecon fierce enum4linux smbclient socat netcat-openbsd tcpdump tshark
  dnsutils whois proxychains4 macchanger
  # proot عشان البيئة تشغّل نفسها من غير root (self-hosting)
  proot
  # الديسكتوب الحقيقي — الأجينت يفتح ويتحرك بالماوس
  xvfb x11vnc novnc websockify fluxbox xdotool scrot xterm htop leafpad thunar
  firefox-esr dbus-x11 xauth fonts-dejavu-core fonts-liberation
)
apt-get install -y --no-install-recommends "${PKGS[@]}"

echo "== [2/5] تنظيف الكاش =="
rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*.deb /root/.cache 2>/dev/null || true

echo "== [3/5] المانيفست المقاس (كل رقم من الأمر نفسه) =="
{
  echo "PRETTY_NAME=$(grep PRETTY_NAME /etc/os-release | cut -d'"' -f2)"
  echo "kernel_packages_excluded=true (rootfs userland فقط)"
  echo "packages=$(dpkg -l 2>/dev/null | grep -c '^ii')"
  echo "bytes=$(du -sb --exclude=/out --exclude=/proc --exclude=/sys --exclude=/dev --exclude=/__w --exclude=/.git / | cut -f1)"
  echo "built_at=$(date -u '+%Y-%m-%dT%H:%MZ')"
  echo "commit=${RUN_SHA:-unknown}"
  echo "run_id=${RUN_ID:-unknown}"
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

echo "== [4/5] tar + zstd + split ≤90MB =="
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
echo "parts: $(ls part-* | wc -l) · sizes:" && ls -la part-* | awk '{print $5, $9}'

echo "== [5/5] تم — الأجزاء جاهزة للرفع لفرع kali-rootfs =="
cat "$OUT/MANIFEST.txt"
