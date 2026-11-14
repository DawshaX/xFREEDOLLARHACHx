#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# تشغيل أي أمر داخل كالي الحقيقي المدمجة (rootfs مستخرجة) — بproot من داخلها
# نفسها (self-hosting) لأن السانبوكس بلا root فchroot ممنوع. كل التنفيذ حقيقي.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${NOVA_KALI_ROOT:-${HOME:-/home/user}/kali-rootfs/rootfs}"
[ -f "$ROOT/etc/os-release" ] || ROOT="$REPO_DIR/.cache/kali/rootfs"

if [ ! -f "$ROOT/etc/os-release" ]; then
  echo "kali-rootfs-missing: $ROOT"
  echo "شغّل: scripts/kali-rootfs-fetch.sh  (بيسحب فرع kali-rootfs من جيت هب)"
  exit 3
fi

# ترتيب المحرك: proot-static (مضاف من CI إن وجد) → proot بتاع كالي → proot المضيف
PROOT=""
[ -x "$ROOT/usr/local/bin/proot-static" ] && PROOT="$ROOT/usr/local/bin/proot-static"
[ -z "$PROOT" ] && [ -x "$ROOT/usr/bin/proot" ] && PROOT="$ROOT/usr/bin/proot"
[ -z "$PROOT" ] && PROOT="$(command -v proot || true)"
if [ -z "$PROOT" ]; then
  echo "no-proot: مفيش محرك تشغيل (الrootfs لازم تحتوي proot)"
  exit 4
fi

ENV_I="/usr/bin/env -i HOME=/root TERM=${TERM:-xterm} PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin LANG=C.UTF-8 SHELL=/bin/bash"

if [ $# -eq 0 ]; then
  exec "$PROOT" -R "$ROOT" $ENV_I /bin/bash -l
fi
exec "$PROOT" -R "$ROOT" $ENV_I /bin/bash -lc "$*"
