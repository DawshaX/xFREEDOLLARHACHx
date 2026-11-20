#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# إصلاح الأدوات العنيدة v3 — التصحيح المقاس: kali-exec.sh بيلف الأمر في
# `bash -lc "$*"` أصلًا، فأي bash -lc إضافي بيبوظ التحليل (apt-get بيطبع
# help — قياس 05:2xZ). G يمرر الأمر كوسيط واحد مباشرة.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
R="$W/scripts/kali-exec.sh"
G() { bash "$R" "$1" 2>/dev/null | grep -v proot; }

echo "== قبل =="
for t in vulners ettercap mp fern; do
  p="$(G "command -v $t" || true)"; echo "  $t -> ${p:-MISSING}"
done

echo "== 1) vulners: NSE + wrapper (idempotent) =="
if ! G "command -v vulners" | grep -q .; then
  G 'mkdir -p /usr/share/nmap/scripts /usr/local/bin; curl -sf -m 60 -o /usr/share/nmap/scripts/vulners.nse https://raw.githubusercontent.com/vulnersCom/nmap-vulners/master/vulners.nse && echo NSE-OK || echo NSE-FAIL; printf "#!/bin/sh\nexec nmap --script vulners \"$@\"\n" > /usr/local/bin/vulners && chmod +x /usr/local/bin/vulners; command -v vulners' || true
fi

echo "== 2) maskprocessor: download + extract =="
if ! G "command -v mp" | grep -q .; then
  G 'apt-get download maskprocessor 2>&1 | tail -2; ls /root/maskprocessor*.deb 2>&1 | tail -1; cd /root && for d in maskprocessor*.deb; do dpkg-deb -x "$d" / && echo EXTRACTED; done; command -v mp' || true
fi

echo "== 3) ettercap: لو لسه ناقص → download + extract (الcommon + text-only) =="
if ! G "command -v ettercap" | grep -q .; then
  G 'apt-get download ettercap-common 2>&1 | tail -1; apt-get download ettercap-text-only 2>&1 | tail -1; cd /root && for d in ettercap*.deb; do dpkg-deb -x "$d" / && echo EXTRACTED-$d; done; command -v ettercap' || true
fi

echo "== 4) fern: wrapper لو ناقص =="
if ! G "command -v fern" | grep -q .; then
  G 'git clone --depth 1 https://github.com/savio-code/fern-wifi-cracker.git /opt/fern 2>&1 | tail -1; printf "#!/bin/sh\nexec python3 /opt/fern/Fern.py \"$@\"\n" > /usr/local/bin/fern && chmod +x /usr/local/bin/fern; command -v fern' || true
fi

echo "== بعد =="
for t in vulners ettercap mp fern; do
  p="$(G "command -v $t" || true)"; echo "  $t -> ${p:-MISSING}"
done
echo "KALI-FIX-TOOLS-DONE"
