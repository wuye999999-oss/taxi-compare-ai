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

const JD_SEARCH_METHOD = env('JD_SEARCH_METHOD') || 'jd.union.open.goods.query';

function jdConfigured() {
  return Boolean((env('JD_APP_KEY') && env('JD_APP_SECRET')) || (env('JD_ENTERPRISE_ENABLED') === 'true' && env('JD_SEARCH_API_URL')));
}

function jdUnionConfigured() {
  return Boolean(env('JD_APP_KEY') && env('JD_APP_SECRET'));
}

function jdSiteId() {
  return env('JD_SITE_ID') || env('JD_UNION_SITE_ID') || env('JD_PID_SITE_ID');
}

function jdPositionId() {
  return env('JD_POSITION_ID') || env('JD_PID_POSITION_ID');
}

const DOUYIN_API_BASE = 'https://ecom.pangolin-sdk-toutiao.com';

function douyinAppId() {
  return env('DOUYIN_APP_ID') || env('PANGOLIN_APP_ID') || env('CSJ_APP_ID');
}

function douyinSecureKey() {
  return env('DOUYIN_SECURE_KEY') || env('DOUYIN_SECURITY_KEY') || env('PANGOLIN_SECURE_KEY') || env('CSJ_SECURE_KEY');
}

function douyinUserId() {
  return env('DOUYIN_USER_ID') || env('PANGOLIN_USER_ID') || env('CSJ_USER_ID');
}

function douyinRoleId() {
  return env('DOUYIN_ROLE_ID') || env('PANGOLIN_ROLE_ID') || env('CSJ_ROLE_ID') || douyinUserId();
}

function douyinConfigured() {
  return Boolean(douyinAppId() && douyinSecureKey() && douyinUserId() && douyinRoleId());
}

export function douyinSelfCheck() {
  const key = douyinSecureKey();
  return {
    configured: douyinConfigured(),
    enabled: douyinConfigured(),
    search: douyinConfigured(),
    link: douyinConfigured(),
    app_id_present: Boolean(douyinAppId()),
    user_id_present: Boolean(douyinUserId()),
    role_id_present: Boolean(douyinRoleId()),
    secure_key: key ? `[masked:${key.length}]` : '',
    security_key: key ? `[masked:${key.length}]` : '',
    sign_mode: 'sorted',
    endpoint: '/product/search',
  };
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
      mode: jdUnionConfigured() ? 'jd_union_open' : env('JD_ENTERPRISE_ENABLED') === 'true' ? 'enterprise' : 'basic',
      advancedApi: jdConfigured(),
      method: JD_SEARCH_METHOD,
      message: jdConfigured() ? '京东接口已按环境变量启用。' : '京东接口未配置，后端不会伪造高级接口状态。',
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
      status: douyinConfigured() ? 'configured' : 'not_configured',
      configured: douyinConfigured(),
      enabled: douyinConfigured(),
      search: douyinConfigured(),
      link: douyinConfigured(),
      mode: 'pangolin_cps',
      sign_mode: 'sorted',
      endpoint: '/product/search',
      message: douyinConfigured() ? '抖音/穿山甲 CPS 商品接口已按环境变量启用。' : '抖音/穿山甲 CPS 接口未配置，后端不会伪造商品。',
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

export async function searchPdd(query) {
  const result = await fetchPdd(String(query || '').trim());
  return {
    ok: result.status !== 'error',
    provider: 'pdd',
    platform: 'pdd',
    status: result.status,
    total_count: result.items.length,
    goods_list: result.items,
    raw: result.raw,
    error: result.status === 'error' ? 'pdd_api_error' : null,
  };
}

export async function searchTb() {
  return {
    ok: true,
    provider: 'tb',
    platform: 'tb',
    status: 'not_integrated',
    total_count: 0,
    goods_list: [],
    raw: {},
  };
}

function jdTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function signJd(params, secret) {
  const base = Object.keys(params).sort().map(key => `${key}${params[key]}`).join('');
  return crypto.createHash('md5').update(`${secret}${base}${secret}`).digest('hex').toUpperCase();
}

export async function jdRequest(method, paramJson = {}) {
  if (!jdUnionConfigured()) throw Object.assign(new Error('JD_APP_KEY/JD_APP_SECRET not configured'), { provider: 'jd' });
  const endpoint = env('JD_API_URL') || env('JD_ROUTER_URL') || 'https://api.jd.com/routerjson';
  const bodyParam = JSON.stringify(paramJson);
  const params = {
    app_key: env('JD_APP_KEY'),
    method,
    timestamp: jdTimestamp(),
    format: 'json',
    v: env('JD_API_VERSION') || '1.0',
    sign_method: 'md5',
    param_json: bodyParam,
  };
  if (env('JD_ACCESS_TOKEN')) params.access_token = env('JD_ACCESS_TOKEN');
  params.sign = signJd(params, env('JD_APP_SECRET'));

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', accept: 'application/json' },
    body: new URLSearchParams(params),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { parse_error: error.message, body: text };
  }
  return data;
}

function maskSensitiveValue(value) {
  const stringValue = String(value);
  const secrets = [env('JD_APP_SECRET'), env('JD_APP_KEY'), env('JD_ACCESS_TOKEN'), env('JD_API_KEY')].filter(Boolean);
  let masked = stringValue;
  for (const secret of secrets) masked = masked.split(secret).join('[REDACTED]');
  return masked;
}

function sanitizeJdRaw(value) {
  if (Array.isArray(value)) return value.map(sanitizeJdRaw);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
      if (['app_key', 'appKey', 'access_token', 'accessToken', 'token', 'authorization', 'sign'].includes(key)) return [key, '[REDACTED]'];
      return [key, sanitizeJdRaw(inner)];
    }));
  }
  if (typeof value === 'string') return maskSensitiveValue(value);
  return value;
}

const getFirst = (item, paths) => {
  for (const path of paths) {
    const value = path.split('.').reduce((obj, part) => {
      if (obj === undefined || obj === null) return undefined;
      if (/^\d+$/.test(part)) return obj[Number(part)];
      return obj[part];
    }, item);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

function firstImage(item) {
  const imageList = getFirst(item, ['imageInfo.imageList', 'image_info.imageList', 'image_info.image_list']);
  if (Array.isArray(imageList) && imageList.length > 0) return firstValue(imageList[0]?.url, imageList[0]?.imageUrl, imageList[0]?.picUrl, imageList[0]);
  return getFirst(item, ['imageInfo.imageList.0.url', 'imageInfo.imageList.0.imageUrl', 'imageUrl', 'image_url', 'image', 'picUrl', 'pic_url', 'goods_image_url', 'goodsThumbnailUrl']);
}

export function normalizeJd(item = {}, query = '') {
  const price = getFirst(item, ['priceInfo.price', 'price_info.price', 'price', 'lowestPrice', 'lowest_price', 'wlUnitPrice']);
  const couponDiscount = getFirst(item, ['couponInfo.discount', 'coupon_info.discount']);
  const normalized = {
    skuId: getFirst(item, ['skuId', 'sku_id', 'itemId', 'item_id']),
    skuName: getFirst(item, ['skuName', 'sku_name', 'goodsName', 'goods_name', 'name', 'title']),
    brandName: getFirst(item, ['brandName', 'brand_name', 'brand']),
    shopName: getFirst(item, ['shopName', 'shop_name', 'owner', 'shopInfo.shopName']),
    price,
    coupon_price_yuan: couponDiscount && asNumber(price) !== null ? Math.max(0, asNumber(price) - asNumber(couponDiscount)) : undefined,
    imageUrl: firstImage(item),
    itemUrl: getFirst(item, ['itemUrl', 'item_url', 'materialUrl', 'material_url', 'url', 'clickUrl', 'click_url']),
  };
  return standardizeItem('jd', { ...item, ...normalized }, query);
}

function isGoodsCandidate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['skuId', 'sku_id', 'itemId', 'item_id', 'skuName', 'sku_name', 'goodsName', 'goods_name', 'priceInfo', 'price_info', 'imageInfo', 'image_url', 'imageUrl', 'picUrl'].some(key => value[key] !== undefined);
}

function addCandidate(list, seen, item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return;
  const key = String(firstValue(
    getFirst(item, ['skuId', 'sku_id', 'itemId', 'item_id']),
    getFirst(item, ['skuName', 'sku_name', 'goodsName', 'goods_name', 'name', 'title']),
    JSON.stringify(item).slice(0, 120)
  ));
  if (seen.has(key)) return;
  seen.add(key);
  list.push(item);
}

function addArrayCandidates(list, seen, value) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (list.length >= 20) break;
    if (item && typeof item === 'object' && !Array.isArray(item)) addCandidate(list, seen, item);
  }
}

function parseMaybeJson(value, meta) {
  if (typeof value !== 'string') return value;
  meta.raw_result_is_string = true;
  try {
    return JSON.parse(value);
  } catch (error) {
    meta.parse_error = error.message;
    return value;
  }
}

export function extractJdGoods(raw = {}) {
  const meta = { raw_result_is_string: false, parse_error: null };
  const response = raw.jd_union_open_goods_query_response || raw.jdUnionOpenGoodsQueryResponse || raw;
  const rawResult = response?.result !== undefined ? response.result : raw.result;
  const parsed = parseMaybeJson(rawResult, meta);
  const roots = [parsed, response, raw].filter(value => value && typeof value === 'object');
  const candidates = [];
  const seen = new Set();

  for (const root of roots) {
    const containers = [
      root?.data,
      root?.data?.list,
      root?.data?.goods,
      root?.data?.result,
      root?.result,
      root?.result?.list,
      root?.goodsResp,
      root?.goodsResp?.goodsList,
      root?.queryResult,
      root?.queryResult?.goodsList,
      root?.goodsList,
      root?.list,
      root?.goods,
    ];
    for (const container of containers) {
      if (candidates.length >= 20) break;
      if (Array.isArray(container)) addArrayCandidates(candidates, seen, container);
      else if (isGoodsCandidate(container)) addCandidate(candidates, seen, container);
    }
  }

  function walk(value) {
    if (candidates.length >= 20 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (candidates.length >= 20) break;
        if (isGoodsCandidate(item)) addCandidate(candidates, seen, item);
        walk(item);
      }
      return;
    }
    if (isGoodsCandidate(value)) addCandidate(candidates, seen, value);
    for (const child of Object.values(value)) {
      if (candidates.length >= 20) break;
      walk(child);
    }
  }
  for (const root of roots) walk(root);

  const parsedCode = firstValue(parsed?.code, response?.code, raw?.code, raw?.error_response?.code);
  const parsedMessage = firstValue(parsed?.message, parsed?.msg, response?.message, response?.msg, raw?.message, raw?.msg, raw?.error_response?.zh_desc, raw?.error_response?.msg);
  return { parsed, parse_error: meta.parse_error, raw_result_is_string: meta.raw_result_is_string, code: parsedCode, message: parsedMessage, candidates: candidates.slice(0, 20) };
}

function isJdBusinessError(raw, extracted) {
  if (raw?.error_response) return true;
  const code = extracted.code;
  if (code === undefined || code === null || code === '') return false;
  return !['0', '200', 'OK', 'ok', 'success'].includes(String(code));
}

function jdDiagnostic(raw, extracted, goodsList) {
  return {
    jd_configured: jdConfigured(),
    jd_search_method: JD_SEARCH_METHOD,
    jd_site_id_present: Boolean(jdSiteId()),
    jd_position_id_present: Boolean(jdPositionId()),
    raw_has_error_response: Boolean(raw?.error_response),
    raw_result_is_string: Boolean(extracted.raw_result_is_string),
    parsed_code: extracted.code ?? null,
    parsed_message: extracted.message ?? null,
    parse_error: extracted.parse_error || null,
    candidate_count: extracted.candidates.length,
    normalized_count: goodsList.length,
  };
}

export async function searchJd(query) {
  const q = String(query || '').trim();
  if (!jdConfigured()) return { ok: true, provider: 'jd', platform: 'jd', status: 'not_configured', total_count: 0, goods_list: [], diagnostic: jdDiagnostic({}, { candidates: [] }, []) };

  if (!jdUnionConfigured()) {
    const legacy = await fetchJdEnterprise(q);
    return { ok: legacy.status === 'ok', provider: 'jd', platform: 'jd', status: legacy.status, total_count: legacy.items.length, goods_list: legacy.items, raw: sanitizeJdRaw(legacy.raw), diagnostic: { ...jdDiagnostic(legacy.raw || {}, { candidates: legacy.items }, legacy.items), reason: legacy.items.length ? undefined : 'jd_raw_ok_but_no_candidates' } };
  }

  const raw = await jdRequest(JD_SEARCH_METHOD, { goodsReq: { keyword: q, pageIndex: 1, pageSize: 20 } });
  const safeRaw = sanitizeJdRaw(raw);
  const extracted = extractJdGoods(raw);
  const goodsList = extracted.candidates.map(item => normalizeJd(item, q)).filter(item => item.title).slice(0, 20);
  const diagnostic = jdDiagnostic(raw, extracted, goodsList);

  if (isJdBusinessError(raw, extracted)) {
    return { ok: false, provider: 'jd', platform: 'jd', error: 'jd_api_error', message: extracted.message || '京东接口返回业务错误', code: extracted.code ?? raw?.error_response?.code ?? null, raw: safeRaw, parsed: extracted.parsed, candidates: sanitizeJdRaw(extracted.candidates), goods_list: goodsList, diagnostic };
  }

  if (goodsList.length === 0) diagnostic.reason = 'jd_raw_ok_but_no_candidates';
  return { ok: true, provider: 'jd', platform: 'jd', status: 'ok', total_count: goodsList.length, raw: safeRaw, parsed: extracted.parsed, candidates: sanitizeJdRaw(extracted.candidates), goods_list: goodsList, diagnostic };
}


function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signDouyin(params, secureKey) {
  const base = Object.keys(params)
    .filter(key => key !== 'sign' && params[key] !== undefined && params[key] !== null && params[key] !== '')
    .sort()
    .map(key => `${key}${params[key]}`)
    .join('');
  return crypto.createHash('md5').update(`${secureKey}${base}${secureKey}`, 'utf8').digest('hex');
}

function douyinRequestBody(path, data, requestId = crypto.randomUUID(), timestamp = Math.floor(Date.now() / 1000)) {
  const dataString = stableJson(data);
  const body = {
    app_id: douyinAppId(),
    timestamp,
    version: env('DOUYIN_API_VERSION') || '1',
    sign_type: 'MD5',
    req_id: requestId,
    data: dataString,
  };
  body.sign = signDouyin(body, douyinSecureKey());
  return { path, body, dataString };
}

function maskDouyinRaw(value) {
  const secrets = [douyinSecureKey(), douyinAppId()].filter(Boolean);
  if (Array.isArray(value)) return value.map(maskDouyinRaw);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => {
      if (['sign', 'secure_key', 'security_key'].includes(key)) return [key, '[REDACTED]'];
      return [key, maskDouyinRaw(inner)];
    }));
  }
  if (typeof value === 'string') {
    let masked = value;
    for (const secret of secrets) masked = masked.split(secret).join('[REDACTED]');
    return masked;
  }
  return value;
}

function normalizeDouyin(item = {}, query = '') {
  const finalFen = firstValue(item.coupon_price && asNumber(item.coupon_price) > 0 ? item.coupon_price : undefined, item.price);
  const normalized = {
    goods_name: firstValue(item.title, item.product_name, item.name),
    coupon_price_yuan: yuanFromFen(finalFen),
    market_price_yuan: yuanFromFen(item.price),
    shop_name: item.shop_name,
    goods_thumbnail_url: firstValue(item.cover, Array.isArray(item.imgs) ? item.imgs[0] : undefined),
    goods_url: firstValue(item.detail_url, item.public_plan_detail_url, item.share_link),
    brand_name: item.brand_name,
    goods_id: item.product_id,
  };
  return standardizeItem('douyin', { ...item, ...normalized }, query);
}

function extractDouyinProducts(raw = {}) {
  const data = raw?.data || raw?.result || raw;
  const products = data?.products || data?.product_list || raw?.products || [];
  return Array.isArray(products) ? products : [];
}

async function douyinRequest(path, data) {
  if (!douyinConfigured()) throw Object.assign(new Error('DOUYIN_APP_ID/DOUYIN_SECURE_KEY/DOUYIN_USER_ID/DOUYIN_ROLE_ID not configured'), { provider: 'douyin' });
  const endpoint = `${env('DOUYIN_API_BASE') || DOUYIN_API_BASE}${path}`;
  const { body } = douyinRequestBody(path, data);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    raw = { parse_error: error.message, body: text };
  }
  return { response, raw, request: maskDouyinRaw(body) };
}

export async function searchDouyin(query) {
  if (!douyinConfigured()) return { ok: true, provider: 'douyin', platform: 'douyin', status: 'not_configured', total_count: 0, goods_list: [], raw: {} };
  const data = {
    user_id: douyinUserId(),
    role_id: douyinRoleId(),
    page: 1,
    page_size: Math.min(Math.max(Number(env('DOUYIN_PAGE_SIZE') || 20), 1), 20),
    title: query,
  };
  const { response, raw, request } = await douyinRequest('/product/search', data);
  const products = extractDouyinProducts(raw);
  const goodsList = products.map(item => normalizeDouyin(item, query)).filter(item => item.title).slice(0, 20);
  const code = raw?.code;
  const ok = response.ok && (code === undefined || code === null || Number(code) === 0);
  return {
    ok,
    provider: 'douyin',
    platform: 'douyin',
    status: ok ? 'ok' : 'error',
    total_count: raw?.data?.total ?? products.length,
    goods_list: goodsList,
    raw: maskDouyinRaw(raw),
    request,
    error: ok ? null : 'douyin_api_error',
    message: ok ? null : raw?.desc || raw?.message || '抖音接口返回业务错误',
    code: ok ? null : code ?? null,
  };
}

async function fetchDouyin(query) {
  const result = await searchDouyin(query);
  return { provider: 'douyin', status: result.ok ? result.status || 'ok' : 'error', items: result.goods_list || [], raw: result.raw, error: result.ok ? null : { error: result.error, message: result.message, code: result.code, raw: result.raw, request: result.request } };
}

async function fetchJdEnterprise(query) {
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

async function fetchJd(query) {
  const result = await searchJd(query);
  return { provider: 'jd', status: result.ok ? result.status || 'ok' : 'error', items: result.goods_list || [], raw: result.raw, error: result.ok ? null : { error: result.error, message: result.message, code: result.code, raw: result.raw, diagnostic: result.diagnostic } };
}

function compareProviderStatus(platform, result) {
  return {
    provider: platform,
    platform,
    ok: Boolean(result?.ok),
    status: result?.status || (result?.ok ? 'ok' : 'error'),
    configured: platform === 'pdd' ? pddConfigured() : platform === 'jd' ? jdConfigured() : platform === 'douyin' ? douyinConfigured() : false,
    search: platform === 'tb' ? false : platform === 'pdd' ? pddConfigured() : platform === 'jd' ? jdConfigured() : douyinConfigured(),
    link: platform === 'tb' ? false : platform === 'pdd' ? pddConfigured() : platform === 'jd' ? Boolean(env('JD_LINK_API_URL')) : douyinConfigured(),
    total_count: result?.total_count ?? (result?.goods_list || []).length,
  };
}

function normalizeCompareGoods(item) {
  return {
    ...item,
    platform: item.provider === 'taobao' ? 'tb' : item.provider,
    goods_name: item.title,
    coupon_price_yuan: item.price,
    shop_name: item.shopName,
    brand_name: item.brand,
    item_url: item.itemUrl,
    image_url: item.imageUrl,
  };
}

function providerError(platform, error) {
  if (!error) return null;
  const base = {
    error: error.error || 'provider_error',
    message: error.message || String(error),
    code: error.code ?? null,
  };
  if (platform === 'douyin' && error.raw) base.raw = error.raw;
  if (platform === 'douyin' && error.request) base.request = error.request;
  if (error.raw && platform !== 'douyin') base.raw = error.raw;
  if (error.diagnostic) base.diagnostic = error.diagnostic;
  return base;
}

export async function compare(query) {
  const q = String(query || '').trim();
  const platformSearches = [
    ['pdd', () => searchPdd(q)],
    ['jd', () => searchJd(q)],
    ['tb', () => searchTb(q)],
    ['douyin', () => searchDouyin(q)],
  ];
  const entries = await Promise.all(platformSearches.map(async ([platform, search]) => {
    try {
      return { status: 'fulfilled', value: await search() };
    } catch (error) {
      return { status: 'rejected', reason: error, platform };
    }
  }));
  const platformOrder = platformSearches.map(([platform]) => platform);
  const providers = {};
  const counts = {};
  const providerErrors = {};
  const goodsList = [];

  entries.forEach((entry, index) => {
    const platform = platformOrder[index];
    let result;
    if (entry.status === 'fulfilled') {
      result = entry.value || { ok: true, goods_list: [] };
    } else {
      result = { ok: false, status: 'error', goods_list: [], error: 'provider_exception', message: entry.reason?.message || String(entry.reason) };
    }

    const items = Array.isArray(result.goods_list) ? result.goods_list : [];
    providers[platform] = compareProviderStatus(platform, result);
    counts[platform] = items.length;
    goodsList.push(...items.map(normalizeCompareGoods));

    const error = entry.status === 'rejected'
      ? { error: 'provider_exception', message: entry.reason?.message || String(entry.reason), raw: entry.reason?.raw }
      : result.ok ? null : { error: result.error, message: result.message, code: result.code, raw: result.raw, request: result.request, diagnostic: result.diagnostic };
    const normalizedError = providerError(platform, error);
    if (normalizedError) providerErrors[platform] = normalizedError;
  });

  return {
    ok: true,
    q,
    providers,
    goods_list: goodsList,
    counts,
    provider_errors: providerErrors,
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
      if (url.pathname === '/health') return sendJson(res, 200, {
        ok: true,
        service: 'jiabibi-compare-api',
        runtime: 'server7',
        version: '7.7',
        jd_configured: jdConfigured(),
        jd_search_method: JD_SEARCH_METHOD,
        jd_position_id_present: Boolean(jdPositionId()),
        jd_site_id_present: Boolean(jdSiteId()),
        jd_debug_endpoint: '/api/jd/debug?q=小米充电宝',
        douyin_configured: douyinConfigured(),
        douyin_debug_endpoint: '/api/douyin/debug?q=小米充电宝',
        douyin_debug: '/api/douyin/debug?q=小米充电宝',
        compare_api: '/api/compare?q=小米充电宝',
      });
      if (url.pathname === '/api/providers/status') return sendJson(res, 200, { providers: providerStatuses() });
      if (url.pathname === '/api/jd/debug') {
        const q = url.searchParams.get('q') || url.searchParams.get('keyword') || '';
        if (!q.trim()) return sendJson(res, 400, { error: 'missing q' });
        if (!jdUnionConfigured()) {
          const extracted = { candidates: [], raw_result_is_string: false, code: null, message: null, parse_error: null };
          return sendJson(res, 200, {
            ok: false,
            platform: 'jd',
            error: 'jd_not_configured',
            raw: {},
            parsed: null,
            candidates: [],
            goods_list: [],
            diagnostic: jdDiagnostic({}, extracted, []),
          });
        }
        const raw = await jdRequest(JD_SEARCH_METHOD, { goodsReq: { keyword: q.trim(), pageIndex: 1, pageSize: 20 } });
        const extracted = extractJdGoods(raw);
        const goodsList = extracted.candidates.map(item => normalizeJd(item, q)).filter(item => item.title).slice(0, 20);
        const diagnostic = jdDiagnostic(raw, extracted, goodsList);
        return sendJson(res, 200, {
          ok: !isJdBusinessError(raw, extracted),
          platform: 'jd',
          raw: sanitizeJdRaw(raw),
          parsed: extracted.parsed,
          parse_error: extracted.parse_error,
          candidates: sanitizeJdRaw(extracted.candidates),
          goods_list: goodsList,
          diagnostic,
        });
      }
      if (url.pathname === '/api/douyin/debug') {
        const q = url.searchParams.get('q') || url.searchParams.get('keyword') || '';
        if (!q.trim()) return sendJson(res, 400, { error: 'missing q' });
        const result = await searchDouyin(q.trim());
        const goodsList = Array.isArray(result.goods_list) ? result.goods_list : [];
        return sendJson(res, 200, {
          ok: true,
          runtime: 'server7',
          q: q.trim(),
          self_check: douyinSelfCheck(),
          result_ok: Boolean(result.ok),
          code: result.raw?.code,
          desc: result.raw?.desc || result.raw?.message,
          goods_count: goodsList.length,
          goods_preview: goodsList.slice(0, 3),
          raw: result.raw,
        });
      }
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
