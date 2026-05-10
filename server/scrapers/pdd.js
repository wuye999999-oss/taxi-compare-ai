// Pinduoduo web search scraper.
// Attempts PDD's Yangkeduo public search endpoint (no credentials).
// If PDD returns a 4xx/5xx or an empty list, the caller receives
// status=sandbox_failed_fallback and the frontend falls back to API data.
// We never attempt to bypass CAPTCHA or anti-bot measures.
import axios from 'axios';
import { log } from '../utils/sanitize-log.js';

const PDD_SEARCH_URL = 'https://apiv4.yangkeduo.com/search/v2';
const TIMEOUT_MS = 12000;
const MAX_RESULTS = 40;

// Mobile UA gives the best chance of getting a JSON response from PDD H5 API
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://mobile.yangkeduo.com/',
  'Origin': 'https://mobile.yangkeduo.com',
};

function centToYuan(v) {
  const n = parseInt(v || 0, 10);
  return isNaN(n) ? 0 : n / 100;
}

export async function searchPDD(keyword) {
  log('info', 'pdd.search.start', { keyword });

  const resp = await axios.get(PDD_SEARCH_URL, {
    params: {
      pdduid: 0,
      keyword,
      sort_type: 0,
      page_size: MAX_RESULTS,
      page: 0,
      search_id: '',
    },
    headers: HEADERS,
    timeout: TIMEOUT_MS,
    withCredentials: false,
  });

  // PDD response shape may vary; try common nesting paths
  const raw = resp.data;
  const goodsList =
    raw?.goods_list ||
    raw?.data?.goods_list ||
    raw?.result?.goods_list ||
    [];

  const items = goodsList.slice(0, MAX_RESULTS)
    .map(g => {
      const price = centToYuan(g.min_group_price || g.min_normal_price || g.price);
      const name = (g.goods_name || g.goods_desc || '').trim();
      if (!name || price <= 0) return null;

      const goodsId = String(g.goods_id || '');
      const url = g.goods_url ||
        (goodsId ? `https://mobile.pinduoduo.com/goods.html?goods_id=${goodsId}` : '');

      return {
        goods_name: name,
        goods_desc: g.goods_desc || name,
        price,
        final_price: price,
        coupon_price_yuan: price,
        min_group_price_yuan: centToYuan(g.min_group_price),
        platform: 'pdd',
        source_platform: 'pdd',
        provider: 'pdd',
        shop_name: g.mall_name || g.store_name || '拼多多',
        url,
        material_url: url,
        item_url: url,
        goods_id: goodsId,
        goods_sign: g.goods_sign || '',
        unified_tags: Array.isArray(g.unified_tags) ? g.unified_tags : [],
        source: 'sandbox',
      };
    })
    .filter(Boolean);

  log('info', 'pdd.search.done', { keyword, count: items.length });
  return items;
}
