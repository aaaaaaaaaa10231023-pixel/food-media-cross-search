const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.BRAVE_API_KEY || "";
// Brave Search APIの無料クレジット相当を超えないためのアプリ側安全装置。
// 1,000リクエストを上限とし、到達したら検索を停止します。
const MAX_API_REQUESTS = Number(process.env.MAX_API_REQUESTS || 1000);
let apiRequestCount = Number(process.env.API_REQUEST_COUNT || 0);

const MEDIA = [
  { name: "食品新聞", domain: "shokuhin.net" },
  { name: "日本食糧新聞", domain: "nissyoku.co.jp" },
  { name: "日経クロストレンド", domain: "xtrend.nikkei.com" },
  { name: "料理王国", domain: "cuisine-kingdom.com" },
  { name: "dancyu", domain: "dancyu.jp" },
  { name: "オレンジページ", domain: "orangepage.net" },
  { name: "macaroni", domain: "macaro-ni.jp" },
  { name: "食べログマガジン", domain: "magazine.tabelog.com" },
  { name: "PR TIMES", domain: "prtimes.jp" },
  { name: "ELLEグルメ", domain: "elle.com/jp/gourmet" },
  { name: "ufu", domain: "ufu-sweets.jp" },
  { name: "ファッションプレス", domain: "fashion-press.net" }
];

const publicDir = path.join(__dirname, "public");

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(data));
}

async function searchBrave(query, count) {
  if (apiRequestCount >= MAX_API_REQUESTS) {
    throw new Error("無料利用枠の安全上限に達したため、検索を停止しました。Brave API側の利用状況を確認してください。");
  }
  apiRequestCount += 1;
  const endpoint = new URL("https://api.search.brave.com/res/v1/web/search");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("count", String(count));
  endpoint.searchParams.set("country", "JP");
  endpoint.searchParams.set("search_lang", "jp");
  endpoint.searchParams.set("safesearch", "moderate");

  const r = await fetch(endpoint, {
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": API_KEY
    }
  });

  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Brave API ${r.status}: ${body.slice(0, 300)}`);
  }
  return r.json();
}

function dedupe(items) {
  const seen = new Set();
  return items.filter(x => {
    const key = x.url.replace(/[?#].*$/, "").replace(/\/$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function handleSearch(req, res) {
  if (!API_KEY) {
    return json(res, 500, {
      error: "BRAVE_API_KEY が設定されていません。READMEの手順でAPIキーを設定してください。"
    });
  }

  const u = new URL(req.url, `http://${req.headers.host}`);
  const q = (u.searchParams.get("q") || "").trim();
  const limit = Math.min(Math.max(Number(u.searchParams.get("limit") || 5), 1), 10);
  const selected = (u.searchParams.get("sites") || "").split(",").filter(Boolean);
  const customDomains = (u.searchParams.get("custom") || "").split(",")
    .map(s => s.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .filter(Boolean)
    .map(domain => ({ name: domain, domain }));

  if (!q) return json(res, 400, { error: "検索キーワードを入力してください。" });

  let sites = selected.length
    ? MEDIA.filter(m => selected.includes(m.domain))
    : MEDIA;
  sites = [...sites, ...customDomains];

  // この検索で必要になるAPIリクエスト数を事前確認。
  if (apiRequestCount + sites.length > MAX_API_REQUESTS) {
    return json(res, 402, {
      error: `無料利用枠の安全上限を超えるため検索を停止しました。現在のアプリ内使用回数: ${apiRequestCount} / ${MAX_API_REQUESTS}。`
    });
  }

  const results = [];
  const errors = [];

  await Promise.all(sites.map(async media => {
    try {
      const data = await searchBrave(`site:${media.domain} "${q}"`, limit);
      const rows = (data.web?.results || []).map(item => ({
        media: media.name,
        domain: media.domain,
        title: item.title || "",
        url: item.url || "",
        description: item.description || "",
        age: item.age || ""
      }));
      results.push(...rows);
    } catch (e) {
      errors.push({ media: media.name, message: e.message });
    }
  }));

  const clean = dedupe(results).sort((a,b) => {
    if (a.media === b.media) return 0;
    return a.media.localeCompare(b.media, "ja");
  });

  json(res, 200, {
    query: q,
    searchedSites: sites.map(s => s.name),
    count: clean.length,
    results: clean,
    errors
  });
}

function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === "/") pathname = "/index.html";
  const safe = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, "");
  const file = path.join(publicDir, safe);

  if (!file.startsWith(publicDir)) {
    res.writeHead(403); return res.end("Forbidden");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404); return res.end("Not Found");
    }
    const ext = path.extname(file);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8"
    };
    res.writeHead(200, {"Content-Type": types[ext] || "application/octet-stream"});
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url.startsWith("/api/status")) {
    return json(res, 200, {
      apiRequestCount,
      maxApiRequests: MAX_API_REQUESTS,
      remaining: Math.max(0, MAX_API_REQUESTS - apiRequestCount)
    });
  }
  if (req.method === "GET" && req.url.startsWith("/api/search")) {
    return handleSearch(req, res);
  }
  if (req.method === "GET") return serveStatic(req, res);
  res.writeHead(405); res.end("Method Not Allowed");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Magazine Cross Search: http://localhost:${PORT}`);
  if (!API_KEY) console.log("WARNING: BRAVE_API_KEY is not set.");
});
