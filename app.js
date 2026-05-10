import { PLATFORMS, RESULT_GROUPS } from './rules.js';
import { buildPriceModel } from './matcher.js';
import { forceCustomerPlatforms, loadProviderStatus, normalizeGoods, searchAllPlatforms } from './providers.js';
import { renderDebug } from './debug.js';
import { priceOf, yuan } from './unit-price.js';

const API = 'https://jiabibi-api.onrender.com';
const $ = id => document.getElementById(id);
const platformName = id => (PLATFORMS.find(([p]) => p === id) || [id, id])[1];
const groupHint = {
  official: '官方旗舰、自营、品牌官方店里的最低价',
  channel: '授权/专卖/批发源头等渠道店最低价',
  normal: '普通店铺最低价',
};

let goodsMap = {};
let providerMap = {};
let lastKeyword = '';

function providerOk(provider, count) {
  return Boolean(provider?.configured || provider?.search || provider?.link || provider?.ok || count);
}

function renderProviderStatus(kept = []) {
  return `<section class="card provider-card"><div class="type">平台状态</div><div class="platforms">${forceCustomerPlatforms().map(id => {
    const provider = providerMap[id] || {};
    const count = kept.filter(item => item.platform === id).length;
    const ok = providerOk(provider, count);
    return `<div class="platform"><b>${platformName(id)}</b><span class="${ok ? 'ok' : 'warn'}">${ok ? '已接入' : '待接入'}${count ? `｜${count}个可靠匹配` : ''}</span></div>`;
  }).join('')}</div></section>`;
}

function buyButton(item) {
  return item ? `<button class="buy" data-key="${item._key}">去购买</button>` : '<button class="buy" disabled>去购买</button>';
}

function platformSnapshot(group) {
  return `<div class="mini-platforms">${forceCustomerPlatforms().map(id => {
    const c = group.byPlatform[id];
    return `<div class="mini"><b>${platformName(id)}</b>${c ? `<span>¥${yuan(c.price)}</span><small>${c.spec.text || '按总价'}</small>` : '<span>暂无</span>'}</div>`;
  }).join('')}</div>`;
}

function groupCard(type, group) {
  const c = group.best;
  const item = c?.item;
  return `<section class="card result-card"><div class="head"><div><div class="type">${groupHint[type]}</div><h2>${RESULT_GROUPS.find(([id]) => id === type)[1]}</h2></div><span class="badge">${item ? platformName(item.platform) : '暂无'}</span></div>${item ? `<div class="price"><small>¥</small>${yuan(priceOf(item))}</div><p class="source">${platformName(item.platform)} · ${item.shop_name || item.brand_name || '未知店铺'}<br>${item.goods_name || ''}</p>${c.spec.text ? `<div class="spec">${c.spec.text}</div>` : ''}` : '<div class="price"><small>¥</small>--</div><p class="source">暂未返回可靠同品商品。</p>'}${buyButton(item)}${platformSnapshot(group)}</section>`;
}

function render(data, keyword) {
  goodsMap = {};
  const all = normalizeGoods(data);
  const built = buildPriceModel(all, keyword);
  built.kept.forEach(item => { goodsMap[item._key] = item; });
  $('summary').innerHTML = renderProviderStatus(built.kept) + RESULT_GROUPS.map(([type]) => groupCard(type, built.model[type])).join('') + (built.kept.length ? '' : '<div class="empty">没有可靠同品匹配。为避免错品，已过滤不满足品牌、品类、强属性或规格的结果。</div>');
  $('debug').innerHTML = renderDebug(all, keyword);
  document.querySelectorAll('[data-key]').forEach(el => { el.onclick = () => buy(goodsMap[el.dataset.key]); });
}

async function search(keyword) {
  const q = (keyword || $('keyword').value || '').trim();
  if (!q) return;
  lastKeyword = q;
  $('keyword').value = q;
  $('status').textContent = '正在做同品校验和单位价比价...';
  $('summary').innerHTML = renderProviderStatus([]) + '<div class="empty">加载中...</div>';
  try {
    const data = await searchAllPlatforms(API, q);
    render(data, q);
    $('status').textContent = '已固定查询拼多多、京东、淘宝、抖音；先过滤错品，再按单位价排序。';
  } catch (error) {
    $('summary').innerHTML = renderProviderStatus([]) + `<div class="empty">搜索失败：${error.message}</div>`;
    $('status').textContent = '查询失败';
  }
}

function fallbackUrl(item) {
  if (item.platform === 'jd') return `https://search.jd.com/Search?keyword=${encodeURIComponent(item.goods_name || lastKeyword)}`;
  if (item.platform === 'tb') return item.material_url || item.url || item.item_url || `https://s.taobao.com/search?q=${encodeURIComponent(item.goods_name || lastKeyword)}`;
  if (item.platform === 'douyin') return item.material_url || item.url || item.item_url || `https://www.douyin.com/search/${encodeURIComponent(item.goods_name || lastKeyword)}`;
  return item.material_url || item.url || item.item_url || '';
}

async function buy(item) {
  if (!item) return;
  let url = fallbackUrl(item);
  try {
    if (item.platform === 'pdd' && item.goods_sign) {
      const res = await fetch(`${API}/api/pdd/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goods_sign: item.goods_sign, goods_id: item.goods_id }) });
      const data = await res.json();
      url = data.mobile_short_url || data.short_url || data.mobile_url || data.url || url;
    }
    if (item.platform === 'jd') {
      const res = await fetch(`${API}/api/jd/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku_id: item.sku_id || item.skuId || item.goods_id || '', material_url: url, coupon_url: item.coupon_url || item.couponUrl || '' }) });
      const data = await res.json();
      url = data.url || data.material_url || data.click_url || data.short_url || data.mobile_url || url;
    }
    if (url) location.href = url;
    else $('status').textContent = '暂时没有购买链接';
  } catch (error) {
    if (url) location.href = url;
    else $('status').textContent = `跳转失败：${error.message}`;
  }
}

async function init() {
  $('form').onsubmit = event => { event.preventDefault(); search(); };
  $('debugToggle').onclick = () => $('debug').classList.toggle('show');
  $('summary').innerHTML = renderProviderStatus([]);
  try {
    providerMap = await loadProviderStatus(API);
    $('summary').innerHTML = renderProviderStatus([]);
    $('status').textContent = '平台状态已读取。';
  } catch {
    $('status').textContent = '平台状态读取失败，但顾客端仍固定全平台查询。';
  }
}

init();
