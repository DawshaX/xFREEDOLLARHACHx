import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Reverse-proxy a remote URL so the in-app browser can render it inside an iframe
// without being blocked by X-Frame-Options / CSP frame-ancestors. Best-effort —
// some sites still won't render correctly. Only for educational sandbox use.
router.get("/", async (req, res) => {
  const url = String(req.query["url"] ?? "").trim();
  if (!url) {
    res.status(400).type("text/html").send("missing url");
    return;
  }
  if (!/^https?:\/\//i.test(url)) {
    res.status(400).type("text/html").send("url must start with http(s)://");
    return;
  }
  try {
    const upstream = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 CyberNova/5.0",
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    const ct = upstream.headers.get("content-type") || "text/html; charset=utf-8";
    const buf = Buffer.from(await upstream.arrayBuffer());

    // For HTML, inject a <base> tag so relative URLs resolve back to the original
    // origin, and strip frame-blocking headers (we already discard those below).
    if (ct.toLowerCase().includes("html")) {
      let html = buf.toString("utf-8");
      const base = new URL(url);
      const baseTag = `<base href="${base.origin}${base.pathname.replace(/[^/]*$/, "")}">`;
      if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}`);
      } else {
        html = baseTag + html;
      }
      // Soften CSP that disallows inline scripts so basic JS still works
      html = html
        .replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "")
        .replace(/<meta[^>]+http-equiv=["']X-Frame-Options["'][^>]*>/gi, "");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
      return;
    }
    res.setHeader("Content-Type", ct);
    res.send(buf);
  } catch (e) {
    res
      .status(502)
      .type("text/html")
      .send(
        `<div style="font-family:monospace;color:#ff5577;padding:24px">⚠ Proxy failed for ${url}<br>${String(e)}</div>`,
      );
  }
});

export default router;
