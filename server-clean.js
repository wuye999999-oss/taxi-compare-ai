// server-clean.js: clean, first-principles Jiabibi API runtime.
// Real provider data only. Secrets must live in environment variables, never in GitHub.
// Conflict resolution note: keep this as the canonical Render runtime and preserve /api/compare compatibility.

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';

const PORT = process.env.PORT || 3000;

function envFirst(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return '';
}
function md5Upper(s) { return crypto.createHash('md5').update(String(s), 'utf8').digest('hex').toUpperCase(); }
function sha256Hex(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'); }
function cleanParams(p) {
  const out = {};
  for (const [k, v] of Object.entries(p || {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = String(v);
  }
  return out;
}
function asArray(v) { return !v ? [] : (Array.isArray(v) ? v : [v]); }
function yuanFromFen(v) { return Math.round(Number(v || 0)) / 100; }
function httpsUrl(u) {
  if (!u) return '';
  const s = String(u).trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return 'https://' + s.replace(/^\/\//, '');
}
function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(body, null, 2));
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 2_000_000) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}
function postForm(endpoint, params, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString();
    let u;
    try { u = new URL(endpoint); } catch (e) { return reject(e); }
    const cli = u.protocol === 'http:' ? http : https;
    const req = cli.request({
      method: 'POST', hostname: u.hostname, path: u.pathname + u.search, port: u.port || (u.protocol === 'http:' ? 80 : 443), timeout: timeoutMs,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Jiabibi/clean-1.1' }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('non_json ' + data.slice(0, 200))); } });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('request_timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function postJson(endpoint, payload, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    let u;
    try { u = new URL(endpoint); } catch (e) { return reject(e); }
    const cli = u.protocol === 'http:' ? http : https;
    const req = cli.request({
      method: 'POST', hostname: u.hostname, path: u.pathname + u.search, port: u.port || (u.protocol === 'http:' ? 80 : 443), timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'User-Agent': 'Jiabibi/clean-1.1' }
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(new Error('non_json ' + data.slice(0, 200))); } });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('request_timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
function sortByPrice(goods) {
  return (goods || []).slice().sort((a, b) => Number(a.coupon_price_yuan || a.min_group_price_yuan || 0) - Number(b.coupon_price_yuan || b.min_group_price_yuan || 0));
}
function cheapest(goods) { return sortByPrice(goods).find(x => Number(x.coupon_price_yuan || x.min_group_price_yuan || 0) > 0) || null; }
function parseJsonMaybe(v) { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return null; } }
function findDeep(obj, pred, limit = 5000) {
  const seen = new Set(); const out = [];
  function walk(v) {
    if (!v || typeof v !== 'object' || seen.has(v) || out.length >= limit) return;
    seen.add(v);
    if (pred(v)) out.push(v);
    if (Array.isArray(v)) v.forEach(walk); else Object.values(v).forEach(walk);
  }
  walk(obj); return out;
}
function newReqId() { return (crypto.randomUUID ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(16).slice(2))); }

// ---------- PDD ----------
const PDD_API_URL = process.env.PDD_API_URL || 'https://gw-api.pinduoduo.com/api/router';
const PDD_CLIENT_ID = envFirst('PDD_CLIENT_ID', 'PDD_APP_KEY');
const PDD_CLIENT_SECRET = envFirst('PDD_CLIENT_SECRET', 'PDD_APP_SECRET');
const PDD_PID = envFirst('PDD_PID');
const PDD_CUSTOM_PARAMETERS = envFirst('PDD_CUSTOM_PARAMETERS');
function pddSign(params) { let s = PDD_CLIENT_SECRET; Object.keys(params).sort().forEach(k => { s += k + params[k]; }); return md5Upper(s + PDD_CLIENT_SECRET); }
async function pddRequest(type, biz = {}) {
  if (!PDD_CLIENT_ID || !PDD_CLIENT_SECRET || !PDD_PID) return { error: 'missing_pdd_env' };
  const params = cleanParams({ type, client_id: PDD_CLIENT_ID, timestamp: Math.floor(Date.now() / 1000), data_type: 'JSON', ...biz });
  params.sign = pddSign(params);
  return postForm(PDD_API_URL, params);
}
function normalizePdd(item, source = 'pdd.ddk.goods.search') {
  const price = Number(item.min_group_price || item.min_normal_price || 0);
  const coupon = Number(item.coupon_discount || item.extra_coupon_amount || 0);
  const final = Math.max(0, price - coupon);
  return { platform: 'pdd', source, goods_name: item.goods_name || '', goods_desc: item.goods_desc || item.goods_name || '', brand_name: item.brand_name || '', shop_name: item.mall_name || '', goods_image_url: item.goods_image_url || '', goods_thumbnail_url: item.goods_thumbnail_url || item.goods_image_url || '', goods_id: String(item.goods_id || ''), goods_sign: item.goods_sign || '', sales_tip: item.sales_tip || '', min_group_price_yuan: yuanFromFen(price), coupon_discount_yuan: yuanFromFen(coupon), coupon_price_yuan: yuanFromFen(final || price), has_coupon: coupon > 0, unified_tags: ['拼多多'], material_url: item.goods_url || '', url: item.goods_url || '', raw: item };
}
async function searchPdd(q) {
  const raw = await pddRequest('pdd.ddk.goods.search', { keyword: q, pid: PDD_PID, page: 1, page_size: 20, custom_parameters: PDD_CUSTOM_PARAMETERS });
  if (raw.error || raw.error_response) return { ok: false, platform: 'pdd', keyword: q, total_count: 0, goods_list: [], raw };
  const list = raw.goods_search_response && raw.goods_search_response.goods_list ? asArray(raw.goods_search_response.goods_list) : [];
  const goods = list.map(x => normalizePdd(x));
  return { ok: true, platform: 'pdd', source: 'pdd.ddk.goods.search', keyword: q, total_count: goods.length, goods_list: goods, raw };
}
async function pddLink(body) {
  const goodsSign = body.goods_sign || body.goodsSign || '';
  const goodsId = body.goods_id || body.goodsId || '';
  const biz = { p_id: PDD_PID, generate_short_url: 'true', custom_parameters: PDD_CUSTOM_PARAMETERS };
  if (goodsSign) biz.goods_sign_list = JSON.stringify([goodsSign]); else if (goodsId) biz.goods_id_list = JSON.stringify([Number(goodsId)]); else return { ok: false, platform: 'pdd', error: 'missing_goods_sign_or_id' };
  const raw = await pddRequest('pdd.ddk.goods.promotion.url.generate', biz);
  const list = raw.goods_promotion_url_generate_response && raw.goods_promotion_url_generate_response.goods_promotion_url_list ? asArray(raw.goods_promotion_url_generate_response.goods_promotion_url_list) : [];
  const first = list[0] || {};
  const url = first.short_url || first.mobile_short_url || first.url || first.mobile_url || '';
  return { ok: !!url, platform: 'pdd', url, material_url: url, raw };
}

// ---------- JD ----------
const JD_API_URL = envFirst('JD_API_URL') || 'https://api.jd.com/routerjson';
const JD_APP_KEY = envFirst('JD_APP_KEY', 'JD_APPKEY', 'APP_KEY');
const JD_APP_SECRET = envFirst('JD_APP_SECRET', 'JD_APPSECRET', 'APP_SECRET');
const JD_ACCESS_TOKEN = envFirst('JD_ACCESS_TOKEN', 'JD_TOKEN');
const JD_POSITION_ID = envFirst('JD_POSITION_ID', 'JD_POSITIONID') || '3104496027';
const JD_PID = envFirst('JD_PID') || '2038054117_4104082584_3104496027';
const JD_SITE_ID = envFirst('JD_SITE_ID', 'JD_SITEID') || (JD_PID.split('_')[1] || '');
const JD_SEARCH_METHOD = envFirst('JD_SEARCH_METHOD') || 'jd.union.open.goods.query';
const JD_PROMOTION_METHOD = envFirst('JD_PROMOTION_METHOD') || 'jd.union.open.promotion.common.get';
function jdTimestamp() { const d = new Date(Date.now() + 8 * 3600000); const p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; }
function jdSign(params) { let s = JD_APP_SECRET; Object.keys(params).sort().forEach(k => { s += k + params[k]; }); return md5Upper(s + JD_APP_SECRET); }
async function jdRequest(method, biz = {}) {
  if (!JD_APP_KEY || !JD_APP_SECRET) return { error: 'missing_jd_env' };
  const params = cleanParams({ method, app_key: JD_APP_KEY, access_token: JD_ACCESS_TOKEN, timestamp: jdTimestamp(), format: 'json', v: '1.0', sign_method: 'md5', '360buy_param_json': JSON.stringify(biz) });
  params.sign = jdSign(params);
  return postForm(JD_API_URL, params);
}
function normalizeJd(item, source = 'jd.union.open.goods.query') {
  const skuId = String(item.skuId || item.sku_id || item.itemId || '');
  const priceInfo = item.priceInfo || item.price_info || {};
  const couponInfo = item.couponInfo || item.coupon_info || {};
  const imageInfo = item.imageInfo || item.image_info || {};
  const images = imageInfo.imageList || imageInfo.image_list || [];
  const price = Number(priceInfo.price || priceInfo.lowestPrice || item.price || 0);
  const coupon = Number(couponInfo.discount || 0);
  const final = Math.max(0, price - coupon);
  const url = skuId ? `https://item.jd.com/${skuId}.html` : '';
  return { platform: 'jd', source, goods_name: item.skuName || item.goodsName || item.name || '', goods_desc: item.skuName || '', brand_name: item.brandName || '', shop_name: item.shopName || '', goods_image_url: httpsUrl((images[0] && (images[0].url || images[0].imageUrl)) || item.imageUrl || ''), goods_thumbnail_url: httpsUrl((images[0] && (images[0].url || images[0].imageUrl)) || item.imageUrl || ''), sku_id: skuId, goods_id: skuId, sales_tip: item.comments || item.inOrderCount30Days || '', min_group_price_yuan: price, coupon_discount_yuan: coupon, coupon_price_yuan: final || price, has_coupon: coupon > 0, unified_tags: ['京东'], material_url: url, url, raw: item };
}
async function searchJd(q) {
  const raw = await jdRequest(JD_SEARCH_METHOD, { goodsReq: { keyword: q, pageIndex: 1, pageSize: 20 } });
  if (raw.error || raw.error_response) return { ok: false, platform: 'jd', keyword: q, total_count: 0, goods_list: [], raw };
  const resultText = raw.jd_union_open_goods_query_response && raw.jd_union_open_goods_query_response.result;
  const parsed = parseJsonMaybe(resultText) || raw;
  const list = findDeep(parsed, x => x && (x.skuId || x.skuName || x.goodsName)).slice(0, 20);
  const goods = list.map(x => normalizeJd(x));
  return { ok: true, platform: 'jd', source: JD_SEARCH_METHOD, keyword: q, total_count: goods.length, goods_list: goods, raw };
}
async function jdLink(body) {
  const skuId = body.sku_id || body.skuId || '';
  const materialId = body.material_url || body.materialId || body.url || (skuId ? `https://item.jd.com/${skuId}.html` : '');
  if (!materialId) return { ok: false, platform: 'jd', error: 'missing_material_id' };
  const raw = await jdRequest(JD_PROMOTION_METHOD, { promotionCodeReq: cleanParams({ materialId, couponUrl: body.coupon_url || body.couponUrl || '', siteId: JD_SITE_ID, positionId: JD_POSITION_ID }) });
  const text = JSON.stringify(raw);
  const m = text.match(/https?:\\?\/\\?\/[^"\\]+/);
  const url = m ? m[0].replace(/\\\//g, '/') : '';
  return { ok: !!url, platform: 'jd', url, material_url: url, raw };
}

// ---------- Taobao ----------
const TB_API_URL = envFirst('TB_API_URL') || 'https://eco.taobao.com/router/rest';
const TB_API_FALLBACK_URL = envFirst('TB_API_FALLBACK_URL') || 'http://gw.api.taobao.com/router/rest';
const TB_APP_KEY = envFirst('TB_APP_KEY', 'TAOBAO_APP_KEY', 'ALIMAMA_APP_KEY');
const TB_APP_SECRET = envFirst('TB_APP_SECRET', 'TAOBAO_APP_SECRET', 'ALIMAMA_APP_SECRET');
let TB_ADZONE_ID = envFirst('TB_ADZONE_ID', 'TAOBAO_ADZONE_ID', 'ADZONE_ID');
const TB_PID = envFirst('TB_PID', 'TAOBAO_PID');
const TB_ENABLED = String(process.env.TB_ENABLED || '').toLowerCase() === 'true';
const TB_SEARCH_METHOD = envFirst('TB_SEARCH_METHOD') || 'taobao.tbk.dg.material.optional.upgrade';
const TB_ITEM_METHOD = envFirst('TB_ITEM_METHOD') || 'taobao.tbk.item.info.get';
(function normalizeAdzone() { const raw = String(TB_ADZONE_ID || TB_PID || '').trim(); const fromPid = raw.match(/(?:mm_)?\d+_\d+_(\d+)$/); const direct = raw.match(/^\d+$/); if (fromPid) TB_ADZONE_ID = fromPid[1]; else if (direct) TB_ADZONE_ID = raw; })();
function tbTimestamp() { const d = new Date(Date.now() + 8 * 3600000); const p = n => String(n).padStart(2, '0'); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; }
function tbSign(params) { let s = TB_APP_SECRET; Object.keys(params).sort().forEach(k => { s += k + String(params[k]); }); return md5Upper(s + TB_APP_SECRET); }
async function tbRequest(method, biz = {}) {
  if (!TB_ENABLED) return { error: 'tb_disabled', message: 'TB_ENABLED is not true' };
  if (!TB_APP_KEY || !TB_APP_SECRET) return { error: 'missing_tb_env', message: 'TB_APP_KEY/TB_APP_SECRET missing' };
  const params = cleanParams({ method, app_key: TB_APP_KEY, timestamp: tbTimestamp(), format: 'json', v: '2.0', sign_method: 'md5', ...biz });
  params.sign = tbSign(params);
  const errors = [];
  for (const endpoint of [TB_API_FALLBACK_URL, TB_API_URL].filter((x, i, a) => x && a.indexOf(x) === i)) {
    try { const raw = await postForm(endpoint, params, 6500); raw.__endpoint = endpoint; return raw; }
    catch (e) { errors.push({ endpoint, code: e.code || '', message: e.message || String(e) }); }
  }
  return { error: 'tb_request_failed', message: '淘宝接口请求失败', detail: errors };
}
function pickTbItems(raw) {
  const direct = raw && raw.tbk_dg_material_optional_upgrade_response && raw.tbk_dg_material_optional_upgrade_response.result_list && raw.tbk_dg_material_optional_upgrade_response.result_list.map_data;
  if (Array.isArray(direct)) return direct.slice(0, 20);
  const out = [];
  findDeep(raw, x => x && (x.item_basic_info || x.price_promotion_info || x.publish_info || x.num_iid || x.item_id || x.title || x.short_title), 1000).forEach(x => out.push(x));
  const seen = new Set();
  return out.filter(x => { const b = x.item_basic_info || x.basic_info || x; const key = String(x.item_id || b.num_iid || b.item_id || b.title || b.short_title || Math.random()); if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 20);
}
function normalizeTb(item, source = 'tb.material.search') {
  const basic = item.item_basic_info || item.basic_info || item;
  const promo = item.price_promotion_info || {};
  const publish = item.publish_info || {};
  const title = basic.title || basic.short_title || basic.raw_title || item.title || '淘宝商品';
  const image = basic.pict_url || basic.pic_url || basic.white_image || item.pict_url || '';
  const promoList = promo.final_promotion_path_list && promo.final_promotion_path_list.final_promotion_path_map_data;
  const coupon = Array.isArray(promoList) && promoList[0] ? promoList[0] : {};
  const price = Number(promo.final_promotion_price || item.final_promotion_price || basic.zk_final_price || basic.reserve_price || basic.price || 0);
  const couponDiscount = Number(coupon.promotion_fee || 0);
  const direct = httpsUrl(publish.coupon_share_url || publish.click_url || basic.item_url || item.item_url || item.url || '');
  const fallback = title ? `https://s.m.taobao.com/h5?q=${encodeURIComponent(title)}` : '';
  const url = direct || fallback;
  return { platform: 'tb', source, goods_name: title, goods_desc: basic.sub_title || title, brand_name: basic.brand_name || '', shop_name: basic.shop_title || basic.nick || '', goods_image_url: httpsUrl(image), goods_thumbnail_url: httpsUrl(image), goods_id: String(item.item_id || basic.num_iid || basic.item_id || ''), num_iid: String(item.item_id || basic.num_iid || basic.item_id || ''), sales_tip: String(basic.annual_vol || basic.tk_total_sales || basic.volume || ''), min_group_price_yuan: price, coupon_discount_yuan: couponDiscount, coupon_price_yuan: price, has_coupon: couponDiscount > 0, unified_tags: ['淘宝', '关键词搜索'], material_url: url, url, item_url: url, direct_buy_url: !!direct, buy_link_status: direct ? 'direct' : 'fallback_search', raw: item };
}
async function searchTb(q) {
  if (!TB_ENABLED) return { ok: false, platform: 'tb', keyword: q, total_count: 0, goods_list: [], error: 'tb_disabled' };
  if (!TB_ADZONE_ID) return { ok: false, platform: 'tb', keyword: q, total_count: 0, goods_list: [], error: 'missing_tb_adzone_id' };
  const raw = await tbRequest(TB_SEARCH_METHOD, { adzone_id: TB_ADZONE_ID, q, page_size: 20, page_no: 1, platform: 2 });
  const failed = raw && (raw.error_response || raw.error || raw.code);
  const items = failed ? [] : pickTbItems(raw).map(x => normalizeTb(x, 'tb.material.search'));
  return { ok: !failed, platform: 'tb', mode: 'keyword_search', source: 'tb.material.search', keyword: q, total_count: items.length, q, goods_list: items, raw };
}
async function tbItem(input) {
  const id = String(input || '').match(/\d{8,16}/)?.[0] || '';
  if (!id) return { ok: false, platform: 'tb', error: 'missing_item_id' };
  const fields = 'num_iid,title,pict_url,small_images,reserve_price,zk_final_price,user_type,provcity,item_url,nick,seller_id,volume,cat_name,shop_title';
  const raw = await tbRequest(TB_ITEM_METHOD, { fields, num_iids: id, platform: 2 });
  const items = pickTbItems(raw).map(x => normalizeTb(x, 'tb.item.info'));
  return { ok: !(raw.error_response || raw.error || raw.code), platform: 'tb', mode: 'item_detail', item_id: id, goods: items[0] || null, goods_list: items, raw };
}

// ---------- Douyin / Pangolin E-commerce CPS ----------
const DOUYIN_API_HOST = (envFirst('DOUYIN_API_HOST', 'DOUYIN_CPS_API_HOST') || 'https://ecom.pangolin-sdk-toutiao.com').replace(/\/$/, '');
const DOUYIN_APP_ID = envFirst('DOUYIN_APP_ID', 'DOUYIN_CPS_APP_ID');
const DOUYIN_USER_ID = envFirst('DOUYIN_USER_ID', 'DOUYIN_CPS_USER_ID', 'DOUYIN_ROLE_ID', 'DOUYIN_CPS_ROLE_ID');
const DOUYIN_ROLE_ID = envFirst('DOUYIN_ROLE_ID', 'DOUYIN_CPS_ROLE_ID') || DOUYIN_USER_ID;
const DOUYIN_SECURITY_KEY = envFirst('DOUYIN_SECURITY_KEY', 'DOUYIN_SECURE_KEY', 'DOUYIN_CPS_SECURITY_KEY', 'DOUYIN_CPS_SECURE_KEY');
const DOUYIN_ENABLED = String(process.env.DOUYIN_CPS_ENABLED || process.env.DOUYIN_ENABLED || '').toLowerCase() === 'true';
const DOUYIN_SIGN_MODE = envFirst('DOUYIN_SIGN_MODE') || 'official_wrap_sorted';
const DOUYIN_PRODUCT_SEARCH_PATH = envFirst('DOUYIN_PRODUCT_SEARCH_PATH') || '/product/search';
const DOUYIN_PRODUCT_LINK_PATH = envFirst('DOUYIN_PRODUCT_LINK_PATH') || '/product/link';
const DOUYIN_CONFIGURED = !!(DOUYIN_APP_ID && DOUYIN_USER_ID && DOUYIN_ROLE_ID && DOUYIN_SECURITY_KEY);
const DOUYIN_SIGN_MODES = ['official_wrap_sorted', 'sorted_then_secret', 'secret_then_sorted', 'no_wrap_sorted', 'body_after_sorted_wrap'];
const DOUYIN_RETRY_SIGN_MODES = ['official_wrap_sorted', 'sorted_then_secret', 'secret_then_sorted', 'body_after_sorted_wrap'];
function douyinSafeNum(v) { const n = Number(v); return Number.isFinite(n) && String(v).trim() !== '' ? n : String(v || ''); }
export function stableJsonStringify(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(item => stableJsonStringify(item)).join(',') + ']';
  if (obj && typeof obj === 'object') {
    const entries = Object.keys(obj).sort().filter(k => obj[k] !== undefined).map(k => JSON.stringify(k) + ':' + stableJsonStringify(obj[k]));
    return '{' + entries.join(',') + '}';
  }
  return JSON.stringify(obj);
}
function douyinSignInput(basePayload, mode = DOUYIN_SIGN_MODE) {
  const normalizedMode = DOUYIN_SIGN_MODES.includes(mode) ? mode : 'official_wrap_sorted';
  const sortedKeys = Object.keys(basePayload).filter(k => k !== 'sign' && basePayload[k] !== undefined && basePayload[k] !== null).sort();
  const sorted = sortedKeys.map(k => k + String(basePayload[k])).join('');
  const sortedWithoutDataKeys = sortedKeys.filter(k => k !== 'data');
  const sortedWithoutData = sortedWithoutDataKeys.map(k => k + String(basePayload[k])).join('');
  const dataStr = String(basePayload.data || '');
  let signBody;
  if (normalizedMode === 'sorted_then_secret') signBody = sorted + DOUYIN_SECURITY_KEY;
  else if (normalizedMode === 'secret_then_sorted') signBody = DOUYIN_SECURITY_KEY + sorted;
  else if (normalizedMode === 'no_wrap_sorted') signBody = sorted;
  else if (normalizedMode === 'body_after_sorted_wrap') signBody = DOUYIN_SECURITY_KEY + sortedWithoutData + dataStr + DOUYIN_SECURITY_KEY;
  else signBody = DOUYIN_SECURITY_KEY + sorted + DOUYIN_SECURITY_KEY;
  return { mode: normalizedMode, signBody, signedKeys: normalizedMode === 'body_after_sorted_wrap' ? sortedWithoutDataKeys.concat(['data']) : sortedKeys };
}
export function buildDouyinPayload(path, data, options = {}) {
  const dataObj = { user_id: douyinSafeNum(DOUYIN_USER_ID), role_id: douyinSafeNum(DOUYIN_ROLE_ID), ...(data || {}) };
  const dataStr = stableJsonStringify(dataObj);
  const basePayload = {
    app_id: String(DOUYIN_APP_ID),
    timestamp: options.timestamp || Math.floor(Date.now() / 1000),
    version: '1',
    sign_type: 'MD5',
    req_id: options.req_id || newReqId(),
    data: dataStr
  };
  const signInfo = douyinSignInput(basePayload, options.signMode || options.mode || DOUYIN_SIGN_MODE);
  const sign = md5Upper(signInfo.signBody);
  const payload = { ...basePayload, sign };
  return { payload, dataObj, dataStr, path, sign_mode: signInfo.mode, signed_keys: signInfo.signedKeys, sign_debug: safeDouyinSignDebug(payload, dataStr, signInfo.mode, signInfo.signedKeys) };
}
function safeDouyinSignDebug(payload, dataStr, mode, signedKeys) {
  return {
    mode,
    signed_keys: signedKeys,
    sign_prefix: String(payload.sign || '').slice(0, 6),
    sign_suffix: String(payload.sign || '').slice(-6),
    data_hash: sha256Hex(dataStr || ''),
    payload_hash: sha256Hex(JSON.stringify({ ...payload, sign: payload.sign ? `${String(payload.sign).slice(0, 6)}...${String(payload.sign).slice(-6)}` : '' }))
  };
}
export function douyinSelfCheck() {
  return {
    ok: true,
    platform: 'douyin',
    enabled: DOUYIN_ENABLED,
    configured: DOUYIN_CONFIGURED,
    api_host: DOUYIN_API_HOST,
    app_id_present: !!DOUYIN_APP_ID,
    user_id_present: !!DOUYIN_USER_ID,
    role_id_present: !!DOUYIN_ROLE_ID,
    security_key_present: !!DOUYIN_SECURITY_KEY,
    security_key_masked: DOUYIN_SECURITY_KEY ? DOUYIN_SECURITY_KEY.slice(0, 3) + '***' + DOUYIN_SECURITY_KEY.slice(-3) : '',
    sign_mode: DOUYIN_SIGN_MODE,
    product_search_path: DOUYIN_PRODUCT_SEARCH_PATH,
    product_link_path: DOUYIN_PRODUCT_LINK_PATH,
    no_secret_in_repo: true,
    required_env: ['DOUYIN_CPS_ENABLED=true', 'DOUYIN_APP_ID', 'DOUYIN_USER_ID', 'DOUYIN_ROLE_ID', 'DOUYIN_SECURITY_KEY']
  };
}
async function douyinRequestOnce(path, data = {}, mode = DOUYIN_SIGN_MODE) {
  const built = buildDouyinPayload(path, data, { signMode: mode });
  const raw = await postJson(DOUYIN_API_HOST + path, built.payload, 9000);
  raw.__request_meta = {
    path,
    req_id: built.payload.req_id,
    signed: true,
    data_keys: Object.keys(built.dataObj),
    signed_keys: built.signed_keys,
    sign_mode_used: built.sign_mode,
    sign_debug: built.sign_debug,
    secret_sent_to_client: false
  };
  return raw;
}
export async function douyinRequest(path, data = {}) {
  if (!DOUYIN_ENABLED) return { code: -1, desc: 'douyin_disabled', data: null, __request_meta: { path, signed: false, secret_sent_to_client: false } };
  if (!DOUYIN_CONFIGURED) return { code: -1, desc: 'missing_douyin_env', data: douyinSelfCheck(), __request_meta: { path, signed: false, secret_sent_to_client: false } };
  const modes = [DOUYIN_SIGN_MODE, ...DOUYIN_RETRY_SIGN_MODES].filter((x, i, a) => x && a.indexOf(x) === i);
  const attempts = [];
  let lastRaw = null;
  for (const mode of modes) {
    const raw = await douyinRequestOnce(path, data, mode);
    const attempt = { mode: raw.__request_meta.sign_mode_used, code: raw.code, desc: raw.desc || raw.message || '', ...raw.__request_meta.sign_debug };
    attempts.push(attempt);
    raw.__request_meta.sign_attempts = attempts;
    raw.__request_meta.sign_mode_used = attempt.mode;
    raw.__request_meta.secret_sent_to_client = false;
    delete raw.__request_meta.sign_debug;
    lastRaw = raw;
    if (Number(raw.code) !== 100004) return raw;
  }
  return lastRaw;
}
function douyinPayloadData(raw) {
  const d = raw && raw.data;
  if (!d) return {};
  return typeof d === 'string' ? (parseJsonMaybe(d) || {}) : d;
}
function pickDouyinProducts(data) {
  const candidates = [
    data && data.products,
    data && data.product_list,
    data && data.list,
    data && data.product_infos,
    data && data.items,
    data && data.result,
    data && data.result && data.result.list,
    data && data.result && data.result.products,
    data && data.product_list && data.product_list.list
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}
function normalizeDouyinProduct(p, source = 'douyin.cps.product.search') {
  const priceFen = Number(p.coupon_price || p.price || 0);
  const normalFen = Number(p.price || p.coupon_price || 0);
  const image = p.cover || p.image || (Array.isArray(p.imgs) ? p.imgs[0] : '') || '';
  const url = p.public_plan_detail_url || p.detail_url || p.product_url || '';
  return {
    platform: 'douyin', source,
    goods_name: p.title || p.product_name || '抖音商品', goods_desc: p.title || p.product_name || '', brand_name: p.brand_name || p.brand_name_cn || '', shop_name: p.shop_name || '',
    goods_image_url: httpsUrl(image), goods_thumbnail_url: httpsUrl(image), goods_id: String(p.product_id || ''), product_id: String(p.product_id || ''),
    sales_tip: p.sales ? String(p.sales) + '销量' : '', min_group_price_yuan: yuanFromFen(normalFen), coupon_discount_yuan: Math.max(0, yuanFromFen(normalFen) - yuanFromFen(priceFen)), coupon_price_yuan: yuanFromFen(priceFen || normalFen),
    has_coupon: !!p.coupon_price && Number(p.coupon_price) > 0 && Number(p.coupon_price) < Number(p.price || 0), unified_tags: ['抖音CPS'], material_url: url, url, product_url: url,
    product_ext: p.ext || p.product_ext || '', commission_ratio: p.cos_ratio || p.public_plan_cos_ratio || 0, commission_fee_yuan: yuanFromFen(p.cos_fee || 0), raw: p
  };
}
export async function searchDouyin(q, page = 1, pageSize = 20) {
  if (!DOUYIN_ENABLED || !DOUYIN_CONFIGURED) return { ok: false, platform: 'douyin', source: 'douyin.cps', keyword: q, total_count: 0, goods_list: [], error: !DOUYIN_ENABLED ? 'douyin_disabled' : 'missing_douyin_env', self_check: douyinSelfCheck() };
  const raw = await douyinRequest(DOUYIN_PRODUCT_SEARCH_PATH, { page: Number(page) || 1, page_size: Math.min(Math.max(Number(pageSize) || 20, 1), 20), title: q });
  const data = douyinPayloadData(raw);
  const products = pickDouyinProducts(data);
  const ok = Number(raw.code || 0) === 0;
  const result = { ok, platform: 'douyin', source: 'douyin.cps.product.search', keyword: q, total_count: Number(data.total || data.total_count || products.length || 0), goods_list: ok ? products.map(x => normalizeDouyinProduct(x)) : [], raw };
  if (!ok) result.diagnostic = { sign_mode_used: raw.__request_meta && raw.__request_meta.sign_mode_used, sign_attempts: raw.__request_meta && raw.__request_meta.sign_attempts };
  return result;
}
async function douyinLink(body) {
  const productUrl = body.product_url || body.material_url || body.url || body.detail_url || '';
  const productExt = body.product_ext || body.ext || '';
  if (!productUrl) return { ok: false, platform: 'douyin', error: 'missing_product_url', message: 'product_url/material_url/url is required' };
  const raw = await douyinRequest(DOUYIN_PRODUCT_LINK_PATH, { product_url: productUrl, product_ext: productExt, external_info: String(body.external_info || 'jiabibi').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40), share_type: body.share_type || [1, 3, 4, 5], platform: Number(body.dy_platform || body.platform || 0), use_coupon: body.use_coupon !== false });
  const data = douyinPayloadData(raw);
  const coupon = data.coupon_link || {};
  const publicPlan = data.public_plan_product_link_result_info || {};
  const url = data.dy_deeplink || data.dy_zlink || data.dy_sharelink || coupon.deeplink || coupon.share_link || publicPlan.dy_deeplink || publicPlan.dy_zlink || publicPlan.dy_sharelink || '';
  return { ok: Number(raw.code || 0) === 0 && !!url, platform: 'douyin', url, material_url: url, dy_deeplink: data.dy_deeplink || '', dy_zlink: data.dy_zlink || '', dy_sharelink: data.dy_sharelink || '', dy_password: data.dy_password || coupon.share_command || '', coupon_link: coupon, raw };
}
async function douyinSignDebug(q, page = 1, pageSize = 20) {
  const path = DOUYIN_PRODUCT_SEARCH_PATH;
  const data = { page: Number(page) || 1, page_size: Math.min(Math.max(Number(pageSize) || 20, 1), 20), title: q };
  const preview = buildDouyinPayload(path, data, { signMode: DOUYIN_SIGN_MODE });
  const attempts = [];
  let selectedMode = DOUYIN_SIGN_MODE;
  if (DOUYIN_ENABLED && DOUYIN_CONFIGURED) {
    const modes = [DOUYIN_SIGN_MODE, ...DOUYIN_RETRY_SIGN_MODES].filter((x, i, a) => x && a.indexOf(x) === i);
    for (const mode of modes) {
      const raw = await douyinRequestOnce(path, data, mode);
      const attempt = { mode: raw.__request_meta.sign_mode_used, code: raw.code, desc: raw.desc || raw.message || '', ...raw.__request_meta.sign_debug };
      attempts.push(attempt);
      selectedMode = attempt.mode;
      if (Number(raw.code) !== 100004) break;
    }
  }
  return {
    ok: attempts.length ? Number(attempts[attempts.length - 1].code || 0) === 0 : false,
    platform: 'douyin',
    self_check: douyinSelfCheck(),
    request_preview: {
      path,
      data_keys: Object.keys(preview.dataObj),
      data_hash: sha256Hex(preview.dataStr),
      timestamp_present: !!preview.payload.timestamp,
      app_id_present: !!preview.payload.app_id,
      role_id_present: !!preview.dataObj.role_id,
      user_id_present: !!preview.dataObj.user_id
    },
    attempts,
    selected_mode: selectedMode
  };
}

async function parseInput(req, url) {
  const rawBody = req.method === 'POST' ? await readBody(req) : '';
  let body = {};
  try { body = rawBody ? JSON.parse(rawBody) : {}; } catch { body = {}; }
  const q = String(body.q || body.keyword || url.searchParams.get('q') || url.searchParams.get('keyword') || url.searchParams.get('kw') || '').trim();
  const platform = String(body.platform || body.provider || url.searchParams.get('platform') || url.searchParams.get('provider') || '').trim();
  return { body, q, platform };
}
function providerStatus() {
  return [
    { platform: 'pdd', name: '拼多多', configured: !!(PDD_CLIENT_ID && PDD_CLIENT_SECRET && PDD_PID), search: true, link: true, source: 'pdd.ddk' },
    { platform: 'jd', name: '京东', configured: !!(JD_APP_KEY && JD_APP_SECRET), search: true, link: true, source: 'jd.union' },
    { platform: 'tb', name: '淘宝', configured: !!(TB_APP_KEY && TB_APP_SECRET && TB_ADZONE_ID), enabled: TB_ENABLED, search: true, link: true, source: 'taobao TOP / alimama' },
    { platform: 'douyin', name: '抖音', configured: DOUYIN_CONFIGURED, enabled: DOUYIN_ENABLED, search: DOUYIN_ENABLED && DOUYIN_CONFIGURED, link: DOUYIN_ENABLED && DOUYIN_CONFIGURED, source: 'pangolin.ecom.cps', app_id_present: !!DOUYIN_APP_ID, user_id_present: !!DOUYIN_USER_ID, role_id_present: !!DOUYIN_ROLE_ID, security_key_present: !!DOUYIN_SECURITY_KEY, secret_masked: DOUYIN_SECURITY_KEY ? DOUYIN_SECURITY_KEY.slice(0, 3) + '***' + DOUYIN_SECURITY_KEY.slice(-3) : '', sign_mode: DOUYIN_SIGN_MODE, product_search_path: DOUYIN_PRODUCT_SEARCH_PATH, product_link_path: DOUYIN_PRODUCT_LINK_PATH, notice: DOUYIN_CONFIGURED ? '抖音CPS真实接口已配置' : '抖音CPS环境变量未配置' }
  ];
}
export function health() {
  return {
    ok: true,
    name: '价比比 API clean',
    runtime: 'server-clean',
    pdd_configured: !!(PDD_CLIENT_ID && PDD_CLIENT_SECRET && PDD_PID),
    jd_configured: !!(JD_APP_KEY && JD_APP_SECRET),
    tb_enabled: TB_ENABLED,
    tb_configured: !!(TB_APP_KEY && TB_APP_SECRET && TB_ADZONE_ID),
    douyin_enabled: DOUYIN_ENABLED,
    douyin_configured: DOUYIN_CONFIGURED,
    douyin_secret_present: !!DOUYIN_SECURITY_KEY,
    douyin_sign_mode: DOUYIN_SIGN_MODE,
    douyin_product_search_path: DOUYIN_PRODUCT_SEARCH_PATH,
    douyin_product_link_path: DOUYIN_PRODUCT_LINK_PATH,
    douyin_sign_debug_endpoint: '/api/douyin/sign-debug?q=小米充电宝',
    douyin_search_endpoint: '/api/douyin/search?q=小米充电宝',
    provider_status: '/api/providers/status'
  };
}
async function handle(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/' || url.pathname === '/health') return sendJson(res, 200, health());
    if (url.pathname === '/api/providers/status') return sendJson(res, 200, { ok: true, runtime: 'server-clean', providers: providerStatus() });
    if (url.pathname === '/api/douyin/self-check' || url.pathname === '/api/douyin/selfcheck') return sendJson(res, 200, douyinSelfCheck());
    const { body, q, platform } = await parseInput(req, url);
    if (url.pathname === '/api/douyin/sign-debug') { if (!q) return sendJson(res, 400, { ok: false, platform: 'douyin', error: 'missing_keyword', message: '请加 ?q=关键词' }); return sendJson(res, 200, await douyinSignDebug(q, Number(url.searchParams.get('page') || body.page || 1), Number(url.searchParams.get('page_size') || body.page_size || 20))); }
    if (url.pathname === '/api/douyin/search') { if (!q) return sendJson(res, 400, { ok: false, platform: 'douyin', error: 'missing_keyword', message: '请加 ?q=关键词' }); return sendJson(res, 200, await searchDouyin(q, Number(url.searchParams.get('page') || body.page || 1), Number(url.searchParams.get('page_size') || body.page_size || 20))); }
    if (url.pathname === '/api/douyin/link') return sendJson(res, 200, await douyinLink({ ...body, product_url: body.product_url || url.searchParams.get('product_url'), product_ext: body.product_ext || url.searchParams.get('product_ext') }));
    if (url.pathname === '/api/tb/search' || url.pathname === '/api/tb/real-search') { if (!q) return sendJson(res, 400, { ok: false, platform: 'tb', error: 'missing_keyword', message: '请加 ?q=关键词' }); return sendJson(res, 200, await searchTb(q)); }
    if (url.pathname === '/api/tb/item' || url.pathname === '/api/tb/link') { const input = body.item_id || body.num_iid || body.id || body.url || body.material_url || url.searchParams.get('item_id') || url.searchParams.get('num_iid') || url.searchParams.get('id') || url.searchParams.get('url') || ''; return sendJson(res, 200, await tbItem(input)); }
    if (url.pathname === '/api/pdd/link') return sendJson(res, 200, await pddLink({ ...body, goods_sign: body.goods_sign || url.searchParams.get('goods_sign'), goods_id: body.goods_id || url.searchParams.get('goods_id') }));
    if (url.pathname === '/api/jd/link') return sendJson(res, 200, await jdLink({ ...body, sku_id: body.sku_id || url.searchParams.get('sku_id'), material_url: body.material_url || url.searchParams.get('material_url') }));
    if (url.pathname === '/api/search' || url.pathname === '/api/compare' || url.pathname === '/api/search.json' || url.pathname === '/api/provider/search') {
      if (!q) return sendJson(res, 400, { ok: false, error: 'missing_keyword', message: '请加 ?q=关键词' });
      let result;
      if (platform === 'tb') result = await searchTb(q);
      else if (platform === 'pdd') result = await searchPdd(q);
      else if (platform === 'jd') result = await searchJd(q);
      else if (platform === 'douyin' || platform === 'dy') result = await searchDouyin(q);
      else {
        const tasks = [searchPdd(q), searchJd(q), searchTb(q)];
        if (DOUYIN_ENABLED && DOUYIN_CONFIGURED) tasks.push(searchDouyin(q));
        const settled = await Promise.allSettled(tasks);
        const providers = settled.map(x => x.status === 'fulfilled' ? x.value : { ok: false, error: x.reason && x.reason.message || String(x.reason) });
        const goods = providers.flatMap(x => x.goods_list || []);
        result = { ok: true, q, keyword: q, providers, total_count: goods.length, best: cheapest(goods), goods_list: sortByPrice(goods) };
      }
      return sendJson(res, 200, result);
    }
    return sendJson(res, 404, { error: 'not_found', path: url.pathname });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: 'server_error', message: e.message || String(e), stack: process.env.NODE_ENV === 'production' ? undefined : e.stack });
  }
}
export function createServer() {
  return http.createServer(handle);
}
export function startServer(port = PORT) {
  const server = createServer();
  server.listen(port, () => console.log('Jiabibi clean API listening on', port));
  return server;
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startServer();
}
