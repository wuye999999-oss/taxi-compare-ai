import crypto from 'node:crypto';
import http from 'node:http';
import { URL } from 'node:url';
import { CATEGORIES, STORE_RULES } from './rules.js';
import { parseIntent, storeType } from './matcher.js';
import { parseSpec, priceOf } from './unit-price.js';

const DEFAULT_PORT = Number(process.env.PORT || 3000);

const env = name => String(process.env[name] || '').trim();
const asNumber = value => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const yuanFromFen = value => {
  const n = asNumber(value);
  return n === null ? null : n / 100;
};
const firstValue = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
const textOf = (...values) => values.filter(Boolean).join(' ');

function detectCategory(text = '') {
  const normalized = String(text).toLowerCase();
  for (const [category, terms] of Object.entries(CATEGORIES)) {
    if (terms.some(term => normalized.includes(String(term).toLowerCase()))) return category;
  }
  return '';
}

function detectShopType(text = '') {
  const item = { goods_name: '', shop_name: text, unified_tags: [] };
  const type = storeType(item);
  if (type === 'official') return 'official';
  if (type === 'channel') return 'channel';
  if (STORE_RULES.official.some(term => String(text).includes(term))) return 'official';
  if (STORE_RULES.channel.some(term => String(text).includes(term))) return 'channel';
  return 'normal';
}

function normalizeProvider(provider) {
  const p = String(provider || '').toLowerCase();
  if (['pdd', 'pinduoduo', '拼多多'].includes(p)) return 'pdd';
  if (['jd', 'jingdong', '京东'].includes(p)) return 'jd';
  if (['tb', 'taobao', 'tmall', '淘宝', '天猫'].includes(p)) return 'taobao';
  if (['dy', 'douyin', '抖音'].includes(p)) return 'douyin';
  return p;
}

export function standardizeItem(provider, item = {}, query = '') {
  const normalizedProvider = normalizeProvider(provider || item.provider || item.platform || item.source_platform);
  const title = firstValue(item.title, item.goods_name, item.goodsName, item.skuName, item.name, '');
  const price = firstValue(
    asNumber(item.price),
    asNumber(item.coupon_price_yuan),
    asNumber(item.final_price),
    asNumber(item.min_group_price_yuan),
    yuanFromFen(item.min_group_price),
    yuanFromFen(item.zk_final_price),
    yuanFromFen(item.price_cents),
    yuanFromFen(item.wlUnitPrice)
  );
  const originalPrice = firstValue(
    asNumber(item.originalPrice),
    asNumber(item.original_price),
    asNumber(item.market_price_yuan),
    yuanFromFen(item.market_price),
    yuanFromFen(item.min_normal_price),
    price
  );
  const shopName = firstValue(item.shopName, item.shop_name, item.mall_name, item.owner, item.shopInfo?.shopName, '');
  const brand = firstValue(item.brand, item.brand_name, item.brandName, '');
  const category = firstValue(item.category, item.category_name, item.categoryName, detectCategory(textOf(title, brand, query)));
  const shopType = firstValue(item.shopType, item.shop_type, detectShopType(textOf(shopName, title)));
  const specProbe = {
    goods_name: title,
    goods_desc: firstValue(item.desc, item.goods_desc, item.subTitle, ''),
    brand_name: brand,
    shop_name: shopName,
    coupon_price_yuan: price,
    price,
    unified_tags: item.unified_tags || item.tags || [],
  };
  const spec = parseSpec(specProbe, parseIntent(query || title));
  const volumeUnit = firstValue(item.volumeUnit, item.volume_unit, spec.kind === 'volume' ? 'ml' : spec.kind === 'weight' ? 'kg' : spec.kind === 'paper' ? 'sheet' : spec.kind === 'power' ? 'mAh' : '');
  const volumeValue = firstValue(asNumber(item.volumeValue), asNumber(item.volume_value), spec.total || null);
  const count = firstValue(asNumber(item.count), asNumber(item.quantity), 1);
  const unitPrice = firstValue(asNumber(item.unitPrice), asNumber(item.unit_price), spec.value || price || null);
  const itemUrl = firstValue(item.itemUrl, item.item_url, item.url, item.material_url, item.goods_url, item.mobile_url, '');
  const imageUrl = firstValue(item.imageUrl, item.image_url, item.goods_thumbnail_url, item.goods_image_url, item.picUrl, item.image, '');

  return {
    provider: normalizedProvider,
    title: String(title || ''),
    price,
    originalPrice,
    shopName: String(shopName || ''),
    shopType,
    brand: String(brand || ''),
    category: String(category || ''),
    specText: firstValue(item.specText, item.spec_text, spec.text, ''),
    volumeValue,
    volumeUnit,
    count,
    unitPrice,
    itemUrl: String(itemUrl || ''),
    imageUrl: String(imageUrl || ''),
    raw: item,
  };
}

function pddConfigured() {
  return Boolean(env('PDD_CLIENT_ID') && env('PDD_CLIENT_SECRET'));
}

function jdConfigured() {
  return Boolean(env('JD_ENTERPRISE_ENABLED') === 'true' && env('JD_SEARCH_API_URL'));
}

export function providerStatuses() {
  return [
    {
      provider: 'pdd',
      status: pddConfigured() ? 'configured' : 'not_configured',
      configured: pddConfigured(),
      search: pddConfigured(),
      link: pddConfigured(),
      mode: 'pdd.ddk.goods.search',
    },
    {
      provider: 'jd',
      status: jdConfigured() ? 'enterprise_enabled' : 'not_configured',
      configured: jdConfigured(),
      search: jdConfigured(),
      link: Boolean(env('JD_LINK_API_URL')),
      mode: env('JD_ENTERPRISE_ENABLED') === 'true' ? 'enterprise' : 'basic',
      advancedApi: jdConfigured(),
      message: jdConfigured() ? '京东企业接口已按环境变量启用。' : '京东企业接口未启用或缺少搜索地址，后端不会伪造高级接口状态。',
    },
    {
      provider: 'taobao',
      status: 'not_integrated',
      configured: false,
      search: false,
      link: false,
      message: '淘宝/天猫暂未接入，只返回平台状态，不返回伪造商品。',
    },
    {
      provider: 'douyin',
      status: 'not_integrated',
      configured: false,
      search: false,
      link: false,
      message: '抖音暂未接入，只返回平台状态，不返回伪造商品。',
    },
  ];
}

function signPdd(params, secret) {
  const base = Object.keys(params).sort().map(key => `${key}${params[key]}`).join('');
  return crypto.createHash('md5').update(`${secret}${base}${secret}`).digest('hex').toUpperCase();
}

async function fetchPdd(query) {
  if (!pddConfigured()) return { provider: 'pdd', status: 'not_configured', items: [] };
  const clientId = env('PDD_CLIENT_ID');
  const secret = env('PDD_CLIENT_SECRET');
  const params = {
    client_id: clientId,
    type: 'pdd.ddk.goods.search',
    timestamp: Math.floor(Date.now() / 1000),
    data_type: 'JSON',
    keyword: query,
    page_size: Number(env('PDD_PAGE_SIZE') || 20),
  };
  params.sign = signPdd(params, secret);
  const response = await fetch('https://gw-api.pinduoduo.com/api/router', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await response.json();
  const list = data.goods_search_response?.goods_list || data.goods_list || [];
  return { provider: 'pdd', status: response.ok ? 'ok' : 'error', items: list.map(item => standardizeItem('pdd', item, query)), raw: data };
}

async function fetchJd(query) {
  if (!jdConfigured()) return { provider: 'jd', status: 'not_configured', items: [] };
  const url = new URL(env('JD_SEARCH_API_URL'));
  url.searchParams.set(env('JD_QUERY_PARAM') || 'q', query);
  const headers = { accept: 'application/json' };
  if (env('JD_ACCESS_TOKEN')) headers.authorization = `Bearer ${env('JD_ACCESS_TOKEN')}`;
  if (env('JD_API_KEY')) headers['x-api-key'] = env('JD_API_KEY');
  const response = await fetch(url, { headers });
  const data = await response.json();
  const list = data.items || data.goods_list || data.result?.items || data.result || [];
  return { provider: 'jd', status: response.ok ? 'ok' : 'error', items: Array.isArray(list) ? list.map(item => standardizeItem('jd', item, query)) : [], raw: data };
}

export async function compare(query) {
  const q = String(query || '').trim();
  const statuses = providerStatuses();
  const providerResults = await Promise.allSettled([fetchPdd(q), fetchJd(q)]);
  const goods = [];
  const providers = statuses.map(status => ({ ...status }));

  for (const result of providerResults) {
    if (result.status === 'fulfilled') {
      const provider = result.value.provider;
      goods.push(...result.value.items);
      const target = providers.find(item => item.provider === provider);
      if (target) target.status = result.value.status;
    } else {
      const provider = result.reason?.provider || 'unknown';
      const target = providers.find(item => item.provider === provider);
      if (target) target.status = 'error';
    }
  }

  return {
    q,
    providers,
    goods,
    goods_list: goods.map(item => ({
      ...item,
      platform: item.provider === 'taobao' ? 'tb' : item.provider,
      goods_name: item.title,
      coupon_price_yuan: item.price,
      shop_name: item.shopName,
      brand_name: item.brand,
      item_url: item.itemUrl,
      image_url: item.imageUrl,
    })),
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-api-key',
  });
  res.end(JSON.stringify(payload));
}

export function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return sendJson(res, 204, {});
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'jiabibi-compare-api' });
      if (url.pathname === '/api/providers/status') return sendJson(res, 200, { providers: providerStatuses() });
      if (url.pathname === '/api/compare' || url.pathname === '/api/search') {
        const q = url.searchParams.get('q') || url.searchParams.get('keyword') || '';
        if (!q.trim()) return sendJson(res, 400, { error: 'missing q' });
        return sendJson(res, 200, await compare(q));
      }
      return sendJson(res, 404, { error: 'not_found' });
    } catch (error) {
      return sendJson(res, 500, { error: error.message });
    }
  });
}

export function startServer(port = DEFAULT_PORT) {
  const server = createServer();
  server.listen(port, () => {
    console.log(`jiabibi compare api listening on ${port}`);
  });
  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startServer();
}
