#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# إصلاح الأدوات العنيدة v2 — قياس 05:2xZ: fern ✓ clone+wrapper. المتبقي:
# vulners (pip بلا CLI → wrapper للnmap --script vulners + تحميل الNSE)
# maskprocessor · ettercap (apt download + dpkg-deb -x — من غير dpkg db).
# idempotent: المتوفر يتخطى. كل خطوة تطبع الخطأ الحقيقي لو فشلت.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
R="$W/scripts/kali-exec.sh"
G() { bash "$R" bash -lc "$1" 2>/dev/null | grep -v proot; }

echo "== قبل =="
for t in vulners ettercap mp fern; do
  p="$(G "command -v $t" || true)"; echo "  $t -> ${p:-MISSING}"
done

echo "== 1) vulners: NSE script + CLI wrapper =="
if ! G 'command -v vulners' | grep -q .; then
  G 'mkdir -p /usr/share/nmap/scripts /usr/local/bin; curl -sf -m 60 -o /usr/share/nmap/scripts/vulners.nse https://raw.githubusercontent.com/vulnersCom/nmap-vulners/master/vulners.nse && echo NSE-DOWNLOADED || echo NSE-FAIL; printf "#!/bin/sh\nexec nmap --script vulners \"$@\"\n" > /usr/local/bin/vulners && chmod +x /usr/local/bin/vulners; command -v vulners' || true
fi

echo "== 2) maskprocessor: apt download + extract (verbose) =="
if ! G 'command -v mp' | grep -q .; then
  G 'apt-get download maskprocessor 2>&1 | tail -3; ls -la /root/maskprocessor*.deb 2>&1 | tail -2' || true
  G 'cd /root && for d in maskprocessor*.deb; do dpkg-deb -x "$d" / && echo EXTRACTED-$d; done; command -v mp' || true
fi

echo "== 3) ettercap-text-only: apt ثم download+extract (verbose) =="
if ! G 'command -v ettercap' | grep -q .; then
  G 'apt-get install -y ettercap-text-only 2>&1 | tail -4; command -v ettercap' || true
fi
if ! G 'command -v ettercap' | grep -q .; then
  G 'apt-get download ettercap-common 2>&1 | tail -2; apt-get download ettercap-text-only 2>&1 | tail -2; ls /root/ettercap*.deb 2>&1 | tail -3' || true
  G 'cd /root && for d in ettercap*.deb; do dpkg-deb -x "$d" / && echo EXTRACTED-$d; done; command -v ettercap' || true
fi

echo "== بعد =="
for t in vulners ettercap mp fern; do
  p="$(G "command -v $t" || true)"; echo "  $t -> ${p:-MISSING}"
done
echo "KALI-FIX-TOOLS-DONE"
