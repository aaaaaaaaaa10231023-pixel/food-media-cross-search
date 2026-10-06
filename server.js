const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const MAX_API_REQUESTS = Number(process.env.MAX_API_REQUESTS || 1000);

const DEFAULT_SITES = [
  { name: '食品新聞', domain: 'shokuhin.net' },
  { name: '日本食糧新聞', domain: 'nissyoku.co.jp' },
  { name: '日経クロストレンド', domain: 'xtrend.nikkei.com' },
  { name: '料理王国', domain: 'cuisine-kingdom.com' },
  { name: 'dancyu', domain: 'dancyu.jp' },
  { name: 'オレンジページ', domain: 'orangepage.net' },
  { name: 'macaroni', domain: 'macaro-ni.jp' },
  { name: '食べログマガジン', domain: 'magazine.tabelog.com' },
  { name: 'PR TIMES', domain: 'prtimes.jp' },
  { name: 'ELLEグルメ', domain: 'elle.com/jp/gourmet' },
  { name: 'ufu', domain: 'ufu-sweets.jp' },
  { name: 'ファッションプレス', domain: 'fashion-press.net' }
];

let apiRequestCount = 0;
let resetAt = Date.now() + 24 * 60 * 60 * 1000;

function maybeResetCounter() {
  // Safety counter is intentionally simple and in-memory.
  // It resets after 24h or when the service restarts.
  if (Date.now() >= resetAt) {
    apiRequestCount = 0;
    resetAt = Date.now() + 24 * 60 * 60 * 1000;
  }
}

function canUseApi() {
  maybeResetCounter();
  return apiRequestCount < MAX_API_REQUESTS;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();

  // ISO / RFC / common absolute dates.
  const direct = new Date(s);
  if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(s)) return direct;

  const now = new Date();
  const lower = s.toLowerCase();
  let m;
  if ((m = lower.match(/(\d+)\s*(minute|min|分)/))) return new Date(now - Number(m[1]) * 60 * 1000);
  if ((m = lower.match(/(\d+)\s*(hour|hr|時間)/))) return new Date(now - Number(m[1]) * 60 * 60 * 1000);
  if ((m = lower.match(/(\d+)\s*(day|days|日)/))) return new Date(now - Number(m[1]) * 24 * 60 * 60 * 1000);
  if ((m = lower.match(/(\d+)\s*(week|weeks|週)/))) return new Date(now - Number(m[1]) * 7 * 24 * 60 * 60 * 1000);
  if ((m = lower.match(/(\d+)\s*(month|months|か月|ヶ月)/))) return new Date(now - Number(m[1]) * 30 * 24 * 60 * 60 * 1000);
  if (lower.includes('yesterday') || s.includes('昨日')) return new Date(now - 24 * 60 * 60 * 1000);
  if (lower.includes('today') || s.includes('今日')) return new Date(now);
  return null;
}

function resultDate(result) {
  return parseDate(result.page_age || result.age || result.published || result.date || result.meta_url?.date);
}

function normalizeSite(name, domain) {
  const d = String(domain || '').trim().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return { name: String(name || d), domain: d };
}

async function braveSearch(query, site, freshness) {
  if (!BRAVE_API_KEY) throw new Error('BRAVE_API_KEY が設定されていません。');
  if (!canUseApi()) {
    const err = new Error('API_REQUEST_LIMIT');
    err.code = 'API_REQUEST_LIMIT';
    throw err;
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', `${query} site:${site.domain}`);
  url.searchParams.set('count', '20');
  url.searchParams.set('search_lang', 'ja');
  url.searchParams.set('country', 'JP');
  url.searchParams.set('safesearch', 'moderate');
  if (freshness && freshness !== 'all') url.searchParams.set('freshness', freshness);

  apiRequestCount += 1;
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': BRAVE_API_KEY
    }
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Brave API error ${response.status}: ${body.slice(0, 300)}`);
  }

  const data = await response.json();
  return (data.web?.results || []).map((r) => ({
    title: r.title || '(タイトルなし)',
    url: r.url,
    description: r.description || '',
    siteName: site.name,
    domain: site.domain,
    pageAge: r.page_age || r.age || '',
    publishedDate: resultDate(r)?.toISOString() || null,
    extraSnippets: r.extra_snippets || []
  }));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  maybeResetCounter();
  res.json({
    sites: DEFAULT_SITES,
    maxApiRequests: MAX_API_REQUESTS,
    apiRequestsUsed: apiRequestCount,
    note: 'アプリ側の安全上限です。Render再起動等でカウンターはリセットされます。'
  });
});

app.post('/api/search', async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    const sort = req.body?.sort === 'newest' ? 'newest' : 'relevance';
    const freshness = String(req.body?.freshness || 'all');
    const customDomains = Array.isArray(req.body?.customDomains) ? req.body.customDomains : [];

    if (!query) return res.status(400).json({ error: '検索キーワードを入力してください。' });
    if (!BRAVE_API_KEY) return res.status(500).json({ error: 'Brave APIキーがRenderに設定されていません。' });

    const customSites = customDomains
      .map((item) => normalizeSite(item.name || item.domain, item.domain || item.name))
      .filter((x) => x.domain && x.domain.includes('.'));

    const sites = [...DEFAULT_SITES, ...customSites];
    const seenSites = new Set();
    const uniqueSites = sites.filter((s) => {
      const key = s.domain.toLowerCase();
      if (seenSites.has(key)) return false;
      seenSites.add(key);
      return true;
    });

    if (uniqueSites.length > MAX_API_REQUESTS - apiRequestCount) {
      return res.status(429).json({
        error: `今回の検索対象サイト数（${uniqueSites.length}）が、残りのアプリ側安全上限（${Math.max(0, MAX_API_REQUESTS - apiRequestCount)}回）を超えます。対象サイトを減らしてください。`
      });
    }

    const settled = await Promise.allSettled(uniqueSites.map((site) => braveSearch(query, site, freshness)));
    const results = [];
    const errors = [];
    for (let i = 0; i < settled.length; i++) {
      const item = settled[i];
      if (item.status === 'fulfilled') results.push(...item.value);
      else errors.push({ site: uniqueSites[i].name, error: item.reason?.message || '検索エラー' });
    }

    // Same URL can appear from multiple site/domain queries. Keep one copy.
    const seenUrls = new Set();
    const deduped = results.filter((r) => {
      const key = r.url;
      if (!key || seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    });

    if (sort === 'newest') {
      deduped.sort((a, b) => {
        const ad = a.publishedDate ? Date.parse(a.publishedDate) : NaN;
        const bd = b.publishedDate ? Date.parse(b.publishedDate) : NaN;
        if (Number.isNaN(ad) && Number.isNaN(bd)) return 0;
        if (Number.isNaN(ad)) return 1;
        if (Number.isNaN(bd)) return -1;
        return bd - ad;
      });
    }

    res.json({
      query,
      sort,
      freshness,
      results: deduped,
      errors,
      apiRequestsUsed: apiRequestCount,
      maxApiRequests: MAX_API_REQUESTS,
      searchedSites: uniqueSites.length
    });
  } catch (error) {
    if (error.code === 'API_REQUEST_LIMIT') {
      return res.status(429).json({ error: 'アプリ側のAPI安全上限に達したため、検索を停止しました。' });
    }
    console.error(error);
    res.status(500).json({ error: error.message || '検索中にエラーが発生しました。' });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Food Media Cross Search running on port ${PORT}`);
});
