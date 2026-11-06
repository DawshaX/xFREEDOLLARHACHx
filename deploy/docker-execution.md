# NOVA — Docker execution plane (Kali tools)

## Why this exists

The platform host is a free PaaS container: **no root, no `apt`, no persistent
disk**. Measured on 2026-11-06 in the build sandbox:

```
$ docker --version
-bash: docker: command not found
$ ls /var/run/docker.sock
ls: cannot access '/var/run/docker.sock': No such file or directory
```

That is enough for the **vendored static binaries** — `subfinder`, `httpx`,
`nuclei`, `katana`, `dnsx`, `naabu`, `ffuf`, `amass`, `gobuster`, `dalfox`,
`gitleaks`, `trivy` — which `scripts/fetch-toolchain.mjs` downloads into
`vendor/bin` at build time. It is **not** enough for tools that need a package
manager or an interpreter.

So the split is explicit, not a bug report:

| Tool | How it runs | Why |
|---|---|---|
| subfinder, httpx, nuclei, katana, dnsx, naabu, ffuf | vendored static binary | single-file Go release |
| amass, gobuster, dalfox, gitleaks, trivy | vendored static binary | single-file Go release |
| **nmap** | Docker (`Dockerfile.kali`) | apt package, needs raw sockets |
| **sqlmap** | Docker | Python script |
| **nikto** | Docker | Perl script |
| **semgrep** | Docker | Python + rule packs |
| **whatweb** | Docker | Ruby script, no release assets |

`NOT_VENDORABLE` in `artifacts/api-server/src/lib/ops/toolchain.ts` and
`scripts/fetch-toolchain.mjs` declares that boundary in code, so the agent can
say *why* a tool is not on the host instead of reporting a permanent "missing"
that looks like a broken install.

## Run it

```bash
# build + start the tool container
docker compose --profile kali up -d nova-kali

# prove it
docker compose exec nova-kali nmap --version
docker compose exec nova-kali sqlmap --version
docker compose exec nova-kali semgrep --version
docker compose exec nova-kali nikto -Version
docker compose exec nova-kali whatweb --version

# the image also self-reports on a bare run
docker run --rm nova-kali:latest
```

## Wire it to the fleet

The container is an **execution target**, not a server — it opens no ports.
Point a fleet node at it:

```bash
export NOVA_EXEC_TOKEN=<the hub's token>   # never commit this
export NOVA_HUB=wss://nova.waifly.com/api/local-agent/ws
export NOVA_VENDOR_BIN=/usr/local/bin      # inside the kali container
node dist-node-kit/nova-agent.js
```

The node dials **out** to the hub over WebSocket, exactly like the embedded
self-node. No inbound surface is added, and the hub's gate still decides who
may register.

## Metasploit and Burp Suite

Both are **not** in this image, and that is deliberate:

- **Metasploit** — `apt install metasploit-framework` on Kali works, but it is
  ~1.5 GB and its `msfconsole` needs a database (`postgresql`) to be useful.
  Adding it to a free-tier image makes the image unbuildable on a 512 MB host.
  If you want it, add it to your own build:
  ```dockerfile
  RUN apt-get update && apt-get install -y --no-install-recommends \
        metasploit-framework postgresql && rm -rf /var/lib/apt/lists/*
  ```
- **Burp Suite** — commercial, GUI-first, and its headless mode needs a licence
  for the Pro features. There is no free redistributable to bake in. The
  open-source equivalents already in this image cover most of the same ground:
  `nuclei` + `dalfox` + `sqlmap` + `nikto` for web, `semgrep` for source.

Saying "it cannot" without saying "here is what covers it" is the failure mode
this document exists to avoid.
