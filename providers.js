import { PLATFORM_IDS } from './rules.js';

export function canonPlatform(platform) {
  const p = String(platform || '').toLowerCase();
  if (['pdd', 'pinduoduo', '拼多多'].includes(p)) return 'pdd';
  if (['jd', 'jingdong', 'jd.union', '京东'].includes(p)) return 'jd';
  if (['tb', 'taobao', 'tmall', '淘宝', '天猫'].includes(p)) return 'tb';
  if (['dy', 'douyin', '抖音'].includes(p)) return 'douyin';
  return p;
}

export function normalizeGoods(data = {}) {
  return (data.goods_list || [])
    .map(item => ({ ...item, platform: canonPlatform(item.platform || item.provider || item.source_platform) }))
    .filter(item => PLATFORM_IDS.includes(item.platform));
}

export function normalizeProviderStatus(data = {}) {
  const map = {};
  for (const provider of data.providers || []) {
    map[canonPlatform(provider.platform)] = provider;
  }
  return map;
}

export function forceCustomerPlatforms() {
  return [...PLATFORM_IDS];
}

export async function loadProviderStatus(apiBase, fetcher = fetch) {
  const res = await fetcher(`${apiBase}/api/providers/status`, { cache: 'no-store' });
  return normalizeProviderStatus(await res.json());
}

export async function searchAllPlatforms(apiBase, keyword, fetcher = fetch) {
  const params = new URLSearchParams({ platform: 'all', page_size: '50', keyword });
  return fetcher(`${apiBase}/api/search?${params.toString()}`, { cache: 'no-store' }).then(res => res.json());
}
