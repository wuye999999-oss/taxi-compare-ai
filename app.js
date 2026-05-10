import { PLATFORMS, RESULT_GROUPS } from './rules.js';
import { buildPriceModel } from './matcher.js';
import { forceCustomerPlatforms, loadProviderStatus, normalizeGoods, searchAllPlatforms } from './providers.js';
import { renderDebug } from './debug.js';
import { priceOf, yuan } from './unit-price.js';
import { SandboxSession, STATUS_LABELS } from './sandbox.js';

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

// ── Sandbox state ──────────────────────────────────────────────────────────
let sandboxSession = null;
let sandboxEnabled = false;
let lastSandboxItems = [];   // Most recent sandbox-scraped items

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

function sourceBadge(item) {
  if (!item) return '';
  return item.source === 'sandbox'
    ? '<span class="sandbox-badge">沙盒验价</span>'
    : '';
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
  return `<section class="card result-card"><div class="head"><div><div class="type">${groupHint[type]}</div><h2>${RESULT_GROUPS.find(([id]) => id === type)[1]}</h2></div><span class="badge">${item ? platformName(item.platform) : '暂无'}${sourceBadge(item)}</span></div>${item ? `<div class="price"><small>¥</small>${yuan(priceOf(item))}</div><p class="source">${platformName(item.platform)} · ${item.shop_name || item.brand_name || '未知店铺'}<br>${item.goods_name || ''}</p>${c.spec.text ? `<div class="spec">${c.spec.text}</div>` : ''}` : '<div class="price"><small>¥</small>--</div><p class="source">暂未返回可靠同品商品。</p>'}${buyButton(item)}${platformSnapshot(group)}</section>`;
}

// Merges sandbox items + API items into a single goods_list, sandbox wins on overlap
function mergeForPipeline(sandboxItems, apiData) {
  const apiItems = apiData?.goods_list || [];
  const seen = new Set();
  const merged = [];

  for (const item of [...sandboxItems, ...apiItems]) {
    const nameKey = (item.goods_name || '').slice(0, 20).toLowerCase().replace(/\s+/g, '');
    const key = `${item.platform}:${nameKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }
  return { goods_list: merged };
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

  // If sandbox is active, kick off sandbox search first (fire-and-forget)
  if (sandboxEnabled && sandboxSession) {
    setSandboxPlatformStatus({ jd: 'sandbox_searching', pdd: 'sandbox_searching' });
    sandboxSession.search(q).catch(() => {});
  }

  try {
    const apiData = await searchAllPlatforms(API, q);
    const mergedData = mergeForPipeline(lastSandboxItems, apiData);
    render(mergedData, q);
    $('status').textContent = sandboxEnabled
      ? '已合并沙盒验价与 API 数据；先过滤错品，再按单位价排序。'
      : '已固定查询拼多多、京东、淘宝、抖音；先过滤错品，再按单位价排序。';
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

// ── Sandbox UI helpers ──────────────────────────────────────────────────────

const SANDBOX_PLATFORM_LABELS = { jd: '京东', pdd: '拼多多', tb: '淘宝', douyin: '抖音' };

function setSandboxPlatformStatus(statuses) {
  const container = $('sbPlatforms');
  if (!container) return;
  const all = { jd: 'unsupported', pdd: 'unsupported', tb: 'unsupported', douyin: 'unsupported', ...statuses };
  container.innerHTML = Object.entries(all).map(([platform, status]) =>
    `<div class="sb-plat"><b>${SANDBOX_PLATFORM_LABELS[platform] || platform}</b><span class="sb-status-${status}">${STATUS_LABELS[status] || status}</span></div>`
  ).join('');
}

function showSandboxPanel(show) {
  $('sandboxPanel').classList.toggle('show', show);
}

async function openSandboxSession() {
  if (sandboxSession) await sandboxSession.close();
  sandboxSession = new SandboxSession();

  sandboxSession
    .on('created', data => {
      const statuses = {};
      for (const [k, v] of Object.entries(data.platforms)) statuses[k] = v.status;
      setSandboxPlatformStatus(statuses);
    })
    .on('status', data => {
      setSandboxPlatformStatus(data.platformStatus || {});
      if (data.results?.length) {
        lastSandboxItems = data.results;
      }
    })
    .on('done', ({ results, platformStatus }) => {
      setSandboxPlatformStatus(platformStatus || {});
      lastSandboxItems = results || [];
      // Re-render with sandbox results merged if we have a keyword
      if (lastKeyword && lastSandboxItems.length) {
        $('status').textContent = '沙盒验价完成，正在重新合并比价...';
        search(lastKeyword);
      }
    });

  try {
    await sandboxSession.create();
    showSandboxPanel(true);
    sandboxEnabled = true;
    $('sandboxToggleBtn').classList.add('active');
    $('sandboxToggleBtn').textContent = '✓ 沙盒验价已启用';
    $('status').textContent = '沙盒验价已启用。请发起比价，京东和拼多多将同时进行网页搜索。';
  } catch (_err) {
    $('status').textContent = '沙盒服务不可用（请先启动本地 sandbox server）';
    sandboxEnabled = false;
    showSandboxPanel(false);
  }
}

async function closeSandboxSession() {
  if (sandboxSession) {
    await sandboxSession.close();
    sandboxSession = null;
  }
  sandboxEnabled = false;
  lastSandboxItems = [];
  showSandboxPanel(false);
  $('sandboxToggleBtn').classList.remove('active');
  $('sandboxToggleBtn').textContent = '🔍 真实沙盒验价 Beta';
  $('status').textContent = '沙盒验价已关闭。';
}

// ── Init ────────────────────────────────────────────────────────────────────

async function init() {
  $('form').onsubmit = event => { event.preventDefault(); search(); };
  $('debugToggle').onclick = () => $('debug').classList.toggle('show');

  // Sandbox modal
  $('sandboxToggleBtn').onclick = () => {
    if (sandboxEnabled) {
      closeSandboxSession();
    } else {
      $('sandboxModal').classList.remove('hidden');
    }
  };
  $('sandboxModalCancel').onclick = () => $('sandboxModal').classList.add('hidden');
  $('sandboxModalConfirm').onclick = () => {
    $('sandboxModal').classList.add('hidden');
    openSandboxSession();
  };
  $('sandboxCloseBtn').onclick = () => closeSandboxSession();

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
