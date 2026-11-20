#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# إصلاح الأدوات العنيدة — قياس حي 2026-11-20 05:1xZ: بعد 261/266 فضل 4
# (maskprocessor · vulners · ettercap · fern) السبب المقاس:
#   • apt في الجست بيفشل بـ"E: Unmet dependencies" (حالة dpkg مكسورة معروفة)
#   • مسار /kali-env/install بيتوجه ساعات لجست بلا root (exit 2 فوري)
# الحل هنا: بدائل مستقلة 100% — apt-get download + dpkg-deb -x (من غير dpkg db)،
# pip، وclone + wrapper. كل خطوة مقاسة بcommand -v حقيقي.
# التشغيل: من العقدة → bash scripts/kali-fix-tools.sh
# أو من الهَب عبر exec-stream — idempotent: المتوفر يتخطى بسلام.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
R="$HOME/xFREEDOLLARHACHx/scripts/kali-exec.sh"
[ -f "$R" ] || R="$(cd "$(dirname "$0")" && pwd)/kali-exec.sh"
ROOTFS="$HOME/kali-rootfs/rootfs"

echo "== حالة قبل =="
for t in vulners ettercap mp fern; do
  p="$(bash "$R" bash -lc "command -v $t" 2>/dev/null || true)"
  echo "  $t -> ${p:-MISSING}"
done

echo "== 1) vulners (pip) =="
bash "$R" bash -lc 'pip3 install --break-system-packages -q vulners 2>&1 | tail -1; command -v vulners || echo "vulners: no CLI (module only)"' 2>/dev/null | grep -v proot || true

echo "== 2) maskprocessor (deb مستقل — من غير dpkg db) =="
bash "$R" bash -lc 'command -v mp' 2>/dev/null | grep -q . || {
  bash "$R" bash -lc 'apt-get download maskprocessor 2>&1 | tail -1; ls maskprocessor*.deb 2>/dev/null' 2>/dev/null | grep -v proot || true
  # الdeb اتنزل جوه الجست في /root — نستخرجه بالdpkg-deb بتاع الجست نفسه في الrootfs
  bash "$R" bash -lc 'for d in maskprocessor*.deb; do dpkg-deb -x "$d" / 2>&1 | tail -1; done; command -v mp' 2>/dev/null | grep -v proot || true
}

echo "== 3) ettercap-text-only (apt — لو فشل: download + extract) =="
bash "$R" bash -lc 'command -v ettercap' 2>/dev/null | grep -q . || {
  bash "$R" bash -lc 'apt-get install -y ettercap-text-only 2>&1 | tail -2' 2>/dev/null | grep -v proot || true
  bash "$R" bash -lc 'command -v ettercap' 2>/dev/null | grep -q . || {
    bash "$R" bash -lc 'apt-get download ettercap-common ettercap-text-only 2>&1 | tail -1; for d in ettercap*.deb; do dpkg-deb -x "$d" / 2>&1 | tail -1; done; command -v ettercap' 2>/dev/null | grep -v proot || true
  }
}

echo "== 4) fern-wifi-cracker (clone + wrapper — مستقل عن apt) =="
bash "$R" bash -lc 'command -v fern' 2>/dev/null | grep -q . || {
  bash "$R" bash -lc 'git clone --depth 1 https://github.com/savio-code/fern-wifi-cracker.git /opt/fern 2>&1 | tail -1; printf "#!/bin/sh\nexec python3 /opt/fern/Fern.py \"$@\"\n" > /usr/local/bin/fern && chmod +x /usr/local/bin/fern; command -v fern' 2>/dev/null | grep -v proot || true
}

echo "== الحالة بعد =="
for t in vulners ettercap mp fern; do
  p="$(bash "$R" bash -lc "command -v $t" 2>/dev/null || true)"
  echo "  $t -> ${p:-MISSING}"
done
echo "KALI-FIX-TOOLS-DONE"
