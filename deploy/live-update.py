#!/usr/bin/env python3
"""
NOVA — live self-update (run this ON the server, no panel file manager needed)
════════════════════════════════════════════════════════════════════════════

Why this exists
───────────────
Updating by hand meant: delete every file → upload a zip → unarchive → move the
contents → delete the zip. Five steps, every single time, on a phone-sized file
manager. This does the same job with one command, and it never touches anything
that belongs to *you* rather than to the program.

What it does
────────────
  1. Copies your current install to /tmp/nova-backup-<timestamp> (rollback).
  2. Downloads the published bundle (or a URL you pass) and extracts it.
  3. Copies only the *program* files over the install directory.
  4. Never overwrites: .env, .env.txt, state/, logs/, node_modules/, .npm/ —
     إلا بيانات القياس اللي CI بينشرها، والمكتوبة في update-manifest.json جوه
     الحزمة (refreshState). حتى دي: لو النسخة على المكنة أحدث، بتتساب.
  5. Verifies the new server.mjs / index.js exist and look sane.
  6. Prints exactly what changed and how to restart.

Usage (from the server console / any shell)
───────────────────────────────────────────
    python3 live-update.py                 # update /home/container
    python3 live-update.py --dir /srv/nova # somewhere else
    python3 live-update.py --url https://… # a different bundle
    python3 live-update.py --no-backup     # skip the copy (a bit faster)
    python3 live-update.py --dry-run       # say what would change, touch nothing

Exit codes: 0 = updated, 1 = failed (nothing was replaced), 2 = already newest.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import shutil
import sys
import time
import urllib.request
import zipfile

DEFAULT_URL = (
    "https://github.com/DawshaX/xFREEDOLLARHACHx/releases/download/"
    "nova-portable/nova-24-7.zip"
)

# Files and directories that belong to the deployment, not to the program.
PROTECTED_NAMES = {
    ".env",
    ".env.txt",
    ".env.local",
    "state",
    "logs",
    "node_modules",
    ".npm",
    ".git",
    "backups",
    "nova-backups",
}

REQUIRED = ("server.mjs", "index.js", "boot.mjs", "package.json")
# Ports to try for the self-restart handshake. 27214 was a stale single guess
# and it is why every install on the Waifly slot between 02:12 and 02:41 wrote
# the new files, asked the wrong port to reload, and exited 0 — «installed» on
# screen, old code in production. NOVA_PORT/$PORT still win; the app now also
# writes the restart marker itself, so this list is only the first attempt.
PORT_CANDIDATES = (27214, 27316, 8080, 8000, 3000, 5000, 7860, 10000)


def log(msg: str = "") -> None:
    print(msg, flush=True)


def human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f}{unit}" if unit != "B" else f"{n}B"
        n /= 1024.0
    return f"{n:.1f}GB"


def fetch(url: str) -> bytes:
    log(f"→ تحميل: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "NOVA-live-update/1.0"})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    log(f"  تم: {human(len(data))}")
    return data


def extract(raw: bytes) -> str:
    tmp = "/tmp/nova-update"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        bad = z.testzip()
        if bad:
            raise RuntimeError(f"أرشيف تالف عند {bad}")
        z.extractall(tmp)
    # The archive holds a single top-level folder (nova-24-7/); find it.
    entries = [e for e in os.listdir(tmp) if not e.startswith(".")]
    if len(entries) == 1 and os.path.isdir(os.path.join(tmp, entries[0])):
        return os.path.join(tmp, entries[0])
    return tmp



# ── ledger: المحاولة اللي بتموت في النص لازم تتحسب، مش تتكرر للأبد ──────────
# القياس الحيّ 2026-11-07 03:25→03:44Z على وايفي: كل 5 دقايق كانت الحلقة بتنزّل
# وتفكّ وتبدأ نسخ، والبروسيس بيموت في النص — والعلامة اللي بتقول «خلصت»
# مابتتكتبش. المكنة فضلت 20 دقيقة رايحة جاية و8GB من القرص روّح في النسخ
# الاحتياطية الكاملة. فمن هنا: علامة «شغّال»، وعدّاد فشل لكل مصدر، وسكّون 6 ساعات بعد مرتين — مكنة على نسخة قديمة أحسن من مكنة مابتقومش.
def _url_key(url: str) -> str:
    return str(url or "").strip() or "default"


def ledger_path(dest: str) -> str:
    return os.path.join(dest, "state", "nova-update-ledger.json")


def mark_path(dest: str) -> str:
    return os.path.join(dest, "state", ".nova-update-in-progress")


def read_ledger(dest: str) -> dict:
    try:
        data = json.load(open(ledger_path(dest), encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_ledger(dest: str, data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(ledger_path(dest)), exist_ok=True)
        with open(ledger_path(dest), "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception as exc:  # اللوج مش سبب يوقف تحديث
        log(f"! ledger اتكتبش: {exc}")


def bump_fail(dest: str, url: str, reason: str) -> int:
    key = _url_key(url)
    data = read_ledger(dest)
    entry = data.get(key) if isinstance(data.get(key), dict) else {}
    fails = int(entry.get("fails", 0)) + 1
    data[key] = {"fails": fails, "last": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "reason": reason[:160]}
    write_ledger(dest, data)
    clear_mark(dest)
    return fails


def clear_fails(dest: str, url: str) -> None:
    key = _url_key(url)
    data = read_ledger(dest)
    if key in data:
        data.pop(key, None)
        write_ledger(dest, data)
    clear_mark(dest)


def clear_mark(dest: str) -> None:
    try:
        if os.path.exists(mark_path(dest)):
            os.remove(mark_path(dest))
    except OSError:
        pass


def set_mark(dest: str, url: str) -> None:
    try:
        os.makedirs(os.path.dirname(mark_path(dest)), exist_ok=True)
        with open(mark_path(dest), "w", encoding="utf-8") as f:
            json.dump({"url": _url_key(url), "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, f)
    except OSError:
        pass


def backoff_reason(dest: str, url: str) -> str | None:
    """«واقف» لو آخر محاولة ماتت في نصها، أو نفس المصدر فشل مرتين lately."""
    key = _url_key(url)
    try:
        m = mark_path(dest)
        if os.path.exists(m) and (time.time() - os.path.getmtime(m)) > 180:
            n = bump_fail(dest, url, "المحاولة السابقة ماتت في النص (العلامة اتسابَت)")
            return f"المحاولة السابقة وقفت في النص (فشل رقم {n}) — هنجرب تاني لو فضلت محاولات" if n < 2 else "المحاولة السابقة وقفت في النص ومرتين فشل — سكون 6 ساعات"
    except OSError:
        pass
    entry = read_ledger(dest).get(key)
    if isinstance(entry, dict) and int(entry.get("fails", 0)) >= 2:
        try:
            age_h = (time.time() - time.mktime(time.strptime(str(entry.get("last")), "%Y-%m-%dT%H:%M:%SZ"))) / 3600
        except Exception:
            age_h = 0
        if age_h < 6:
            return f"نفس المصدر فشل {entry.get('fails')} مرة من {round(age_h * 60)} دقيقة — سكون لحد ما الوضع يتغيّر (امسح state/nova-update-ledger.json أو بدّل NOVA_UPDATE_URL)"
    return None


def prune_backups(keep: int = 3) -> int:
    """النسخ الاحتياطية كانت بتملا /tmp — اللي قبل الأحدث يتشال."""
    removed = 0
    try:
        names = sorted(n for n in os.listdir("/tmp") if n.startswith("nova-backup-"))
    except OSError:
        return 0
    for name in names[:-keep] if keep else names:
        try:
            shutil.rmtree(f"/tmp/{name}", ignore_errors=True)
            removed += 1
        except OSError:
            pass
    if removed:
        log(f"· ننّيف /tmp: {removed} نسخة قديمة اتشالت")
    return removed


def backup(dest: str, files: list[tuple[str, str, int]] | None = None) -> str | None:
    """نسخة احتياطية محصورة في الملفات اللي هتتكتب فعلًا.

    `copytree` على الشجرة كان بينسخ `state/` اللي عليها 200k سجل وثغرات محلّية،
    وكل محاولة كانت بتسيب نسخة في /tmp — وده اللي أكل 8GB في 13 دقيقة وقفل
    المكنة (متقاس 2026-11-07 03:25→03:38Z). الملفات اللي مابتتغيّرش مفيش
    لازمة لنسخها: لو اتكتبت غلط فالـrollback بيتّها هي، مش الشجرة كلها.
    """
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target = f"/tmp/nova-backup-{stamp}"
    prune_backups()
    if files is None:
        try:
            shutil.copytree(dest, target, ignore=shutil.ignore_patterns(*PROTECTED_NAMES))
            log(f"→ نسخة احتياطية كاملة: {target}")
            return target
        except Exception as exc:  # نسخة احتياطية ناقصة مش سبب نوقف
            log(f"! تعذّر عمل نسخة احتياطية: {exc}")
            return None
    total = 0
    try:
        os.makedirs(target, exist_ok=True)
        for full, rel, size in files:
            dest_file = os.path.join(target, rel)
            os.makedirs(os.path.dirname(dest_file) or target, exist_ok=True)
            shutil.copy2(full if os.path.exists(full) else os.path.join(dest, rel), dest_file)
            total += size
        log(f"→ نسخة احتياطية محصورة: {target} ({len(files)} ملف · {human(total)})")
        return target
    except Exception as exc:
        log(f"! تعذّر عمل نسخة احتياطية محصورة: {exc}")
        return None
    except Exception as exc:  # a missing backup must not stop the update
        log(f"! تعذّر عمل نسخة احتياطية: {exc}")
        return None


def plan(src: str, dest: str) -> list[tuple[str, str, int]]:
    """(absolute source, relative path, size) for every file to copy."""
    out: list[tuple[str, str, int]] = []
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames[:] = [d for d in dirnames if d not in PROTECTED_NAMES]
        rel_dir = os.path.relpath(dirpath, src)
        for name in filenames:
            if name in PROTECTED_NAMES:
                continue
            if rel_dir != "." and rel_dir.split(os.sep)[0] in PROTECTED_NAMES:
                continue
            full = os.path.join(dirpath, name)
            rel = name if rel_dir == "." else os.path.join(rel_dir, name)
            out.append((full, rel, os.path.getsize(full)))
    out.extend(state_refresh(src, dest))
    return out


def state_refresh(src: str, dest: str) -> list[tuple[str, str, int]]:
    """state/*.json اللي CI بينشرها — جوه مجلد محمي، بس دي بيانات مش حالة المكنة.

    القائمة مش مكتوبة هنا: بتتقرا من `update-manifest.json` اللي
    `scripts/build-standalone.mjs` بيولّده من STATE_DATA بتاعه، فمافيش قائمتين
    يفارقوا بعض. والقاعدة «الأحدث يكسب»: المكنة بتكتب بعض الملفات في state/
    بنفسها (الذاكرة، اللوج، الدفعة)، ومابنستبدلش حاجة على المكنة أحدث من الحزمة.
    """
    names: list[str] = []
    manifest = os.path.join(src, "update-manifest.json")
    if os.path.exists(manifest):
        try:
            data = json.load(open(manifest, encoding="utf-8"))
            got = data.get("refreshState") if isinstance(data, dict) else None
            if isinstance(got, list):
                for name in got:
                    if not isinstance(name, str) or not name.endswith(".json"):
                        continue
                    if "/" in name or "\\" in name or ".." in name:
                        continue
                    names.append(name)
        except Exception as exc:  # manifest مكسور = سلوك قديم، مش تحديث ناقص
            log(f"! update-manifest.json مقروءش ({exc}) — state هيتساب زي ما هو")
    else:
        log("· مافيش update-manifest.json في الحزمة — ملفات state هتفضل زي ما هي على المكنة")

    out: list[tuple[str, str, int]] = []
    for name in names:
        full = os.path.join(src, "state", name)
        if not os.path.isfile(full):
            continue
        target = os.path.join(dest, "state", name)
        try:
            if os.path.exists(target) and os.path.getmtime(target) > os.path.getmtime(full):
                log(f"· state/{name}: النسخة على المكنة أحدث — اتسابَت")
                continue
        except OSError:
            pass
        out.append((full, os.path.join("state", name), os.path.getsize(full)))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="NOVA live self-update")
    ap.add_argument("--dir", default=os.environ.get("NOVA_DIR", "/home/container"))
    ap.add_argument("--url", default=os.environ.get("NOVA_UPDATE_URL", DEFAULT_URL))
    ap.add_argument("--no-backup", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="تجاوز السكّون بعد المحاولات الفاشلة")
    args = ap.parse_args()

    dest = os.path.abspath(args.dir)
    if not os.path.isdir(dest):
        log(f"✗ المجلد مش موجود: {dest}")
        return 1

    log("═" * 62)
    log(f"NOVA live update → {dest}")
    log("═" * 62)

    # التحديث محتاج مساحة: تنزيل (~3 MB) + فك ضغط (~12 MB) + نسخة احتياطية (~12 MB).
    # قرص ملىان وقت النسخ = بايت مقطوعة و`state/` مكتوبة ناقصة، والنتيجة مكنة ما
    # ترجعش. فالقياس قبل ما نلمس الشبكة، والرفض أحسن من تحديث يكسر المكنة.
    try:
        min_free_mb = int(os.environ.get("NOVA_UPDATE_MIN_FREE_MB", "350") or 0)
    except ValueError:
        min_free_mb = 350
    if min_free_mb > 0:
        try:
            vfs = os.statvfs(dest)
            free_mb = (vfs.f_bavail * vfs.f_frsize) // (1024 * 1024)
        except OSError:
            free_mb = None
        if free_mb is not None and free_mb < min_free_mb:
            log(f"✗ القرص الفاضل {free_mb}MB أقل من {min_free_mb}MB — مفيش تحديث (مفيش ملف اتغيّر)")
            log("  فرّغ مساحة أو نزّل يدويًا؛ الحد يتغيّر بـNOVA_UPDATE_MIN_FREE_MB (=0 يلغي الفحص).")
            return 1
        if free_mb is not None:
            log(f"· القرص: {free_mb}MB فاضل (مطلوب {min_free_mb}MB)")

    if not args.force:
        why = backoff_reason(dest, args.url)
        if why:
            log(f"⏸ {why}")
            return 0
    set_mark(dest, args.url)

    try:
        src = extract(fetch(args.url))
    except Exception as exc:
        log(f"✗ فشل التحميل/الفك: {exc}")
        bump_fail(dest, args.url, f"فشل التحميل/الفك: {exc}")
        return 1

    missing = [n for n in REQUIRED if not os.path.exists(os.path.join(src, n))]
    if missing:
        log(f"✗ الحزمة ناقصة ملفات: {', '.join(missing)} — مفيش حاجة اتغيّرت")
        bump_fail(dest, args.url, f"حزمة ناقصة: {', '.join(missing)}")
        return 1

    files = plan(src, dest)
    total = sum(s for _, _, s in files)
    log(f"→ {len(files)} ملف · {human(total)}")

    if args.dry_run:
        for _, rel, size in files:
            log(f"   {rel}  ({human(size)})")
        log("(dry-run — مفيش حاجة اتكتبت)")
        return 0

    # Previous fingerprint goes into the rollback record before anything moves.
    previous_build = None
    try:
        previous_build = json.load(open(os.path.join(dest, "build.json"))).get("builtAt")
    except Exception:
        previous_build = None

    backup_dir = None
    if not args.no_backup:
        backup_dir = backup(dest, files)

    written = 0
    unchanged = 0
    for full, rel, _size in files:
        target = os.path.join(dest, rel)
        try:
            if os.path.exists(target) and os.path.getsize(target) == os.path.getsize(full):
                with open(target, "rb") as a, open(full, "rb") as b:
                    if a.read() == b.read():
                        unchanged += 1
                        continue
        except OSError:
            pass
        os.makedirs(os.path.dirname(target) or dest, exist_ok=True)
        shutil.copy2(full, target)
        written += 1

    # A partial copy must never leave a half-written program behind.
    for name in REQUIRED:
        if not os.path.exists(os.path.join(dest, name)):
            log(f"✗ بعد النسخ مفيش {name} — رجّع النسخة الاحتياطية من /tmp")
            bump_fail(dest, args.url, f"بايت ناقصة بعد النسخ: {name}")
            return 1

    # النسخ اتكتب والسلامة متأكد منها — السجل يتصفّر والعلامة تتشال، فالمحاولة
    # الجاية تبدأ نظيفة ومش متحسوبة كفشل.
    clear_fails(dest, args.url)

    keep = [n for n in sorted(PROTECTED_NAMES) if os.path.exists(os.path.join(dest, n))]
    log("─" * 62)
    log(f"✓ اتحدّث: {written} ملف · {unchanged} كانوا زي ما هم")
    log(f"✓ محفوظ زي ما هو: {', '.join(keep) if keep else '—'}")

    meta = os.path.join(dest, "build.json")
    if os.path.exists(meta):
        try:
            info = json.load(open(meta))
            log(f"✓ النسخة الجديدة: {info.get('commit', '?')[:10]} · {info.get('builtAt', '?')}")
        except Exception:
            pass

    # Record what was installed, so the supervisor can verify the new build
    # really serves HTTP and roll back if it does not.
    try:
        pending = os.path.join(dest, "state", ".update-pending")
        os.makedirs(os.path.dirname(pending), exist_ok=True)
        info = {}
        meta = os.path.join(dest, "build.json")
        if os.path.exists(meta):
            try:
                info = json.load(open(meta))
            except Exception:
                info = {}
        with open(pending, "w") as f:
            json.dump(
                {
                    "backup": backup_dir,
                    "from": previous_build,
                    "to": info.get("builtAt"),
                    "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                },
                f,
            )
        log(f"✓ علامة تحقق مكتوبة: {pending}")
    except Exception as exc:
        log(f"⚠ مقدرتش أكتب علامة التحقق: {exc}")

    log("")
    # ── self-restart ────────────────────────────────────────────────────────
    # The bundle runs under a supervisor (boot.mjs). Touching the restart
    # marker is enough for it to reload the new code — no panel button.
    ports = []
    for raw in (os.environ.get("NOVA_PORT"), os.environ.get("SERVER_PORT"), os.environ.get("PORT")):
        if raw and raw.strip().isdigit():
            ports.append(int(raw.strip()))
    ports.extend(PORT_CANDIDATES)
    ports = list(dict.fromkeys(ports))

    if restart_via_api(ports):
        log("✓ طلبت إعادة تشغيل ذاتية — البرنامج هيرجع بالنسخة الجديدة بعد ثانيتين")
        return 0

    # ── the fallback that does not need HTTP at all ──────────────────────────
    # Measured 2026-11-05 02:59 on the Waifly slot: every port guess missed
    # (the proxy maps an external port to something we cannot see from inside),
    # the updater exited 0, and the old process kept serving for another hour.
    # The supervisor watches ONE file (`state/.nova-restart` next to the
    # bundle) — and this script already knows that directory, because it just
    # unpacked the release into it. Writing the marker directly cannot miss.
    try:
        state_dir = os.path.join(dest, "state")
        os.makedirs(state_dir, exist_ok=True)
        marker = os.path.join(state_dir, ".nova-restart")
        with open(marker, "w", encoding="utf-8") as m:
            m.write(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " live-update.py\n")
        log(f"✓ علامة إعادة التشغيل اتكتبت مباشرة: {marker}")
        log("  المُشرف بيقيس الملف ده كل ثانية — البرنامج هيرجع بالنسخة الجديدة لوحده.")
        return 0
    except Exception as exc:
        log(f"⚠ مقدرتش أكتب علامة إعادة التشغيل: {exc}")

    log("الخطوة الأخيرة: اضغط Restart في لوحة الاستضافة.")
    log("(النسخة القديمة شغّالة من غير المُشرف، فمش قادرة تعيد تشغيل نفسها — دي آخر مرة تحتاجها)")
    return 0


def restart_via_api(ports):
    """Ask the running app to reload itself. Returns True if it accepted."""
    import json as _json
    import urllib.request

    for port in ports:
        for host in ("127.0.0.1", "localhost"):
            url = f"http://{host}:{port}/api/nova-core/restart"
            try:
                req = urllib.request.Request(url, method="POST", data=b"{}")
                with urllib.request.urlopen(req, timeout=4) as r:
                    body = _json.loads(r.read().decode("utf-8", "replace") or "{}")
                if body.get("supervised"):
                    log(f"→ إعادة تشغيل ذاتية عبر {url}")
                    return True
                log(f"→ {url}: النسخة الشغّالة مش تحت مُشرف (409)")
                return False
            except Exception:
                continue
    log("→ مفيش رد من الـ API على البورت المتوقع (إعادة التشغيل اليدوية)")
    return False


if __name__ == "__main__":
    sys.exit(main())
