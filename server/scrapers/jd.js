// JD.com web search scraper.
// Uses JD's standard search page which server-side renders product cards,
// so cheerio can parse it without a headless browser.
// No authentication required for basic product listings.
import axios from 'axios';
import * as cheerio from 'cheerio';
import { log } from '../utils/sanitize-log.js';

const SEARCH_URL = 'https://search.jd.com/Search';
const TIMEOUT_MS = 12000;
const MAX_RESULTS = 40;

// Mimic a real desktop browser so JD serves SSR content
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.jd.com/',
  'DNT': '1',
};

export async function searchJD(keyword) {
  log('info', 'jd.search.start', { keyword });

  const resp = await axios.get(SEARCH_URL, {
    params: { keyword, enc: 'utf-8', wq: keyword },
    headers: HEADERS,
    timeout: TIMEOUT_MS,
    // Never persist cookies between calls
    withCredentials: false,
  });

  const $ = cheerio.load(resp.data);
  const items = [];

  $('li.gl-item').each((_i, el) => {
    if (items.length >= MAX_RESULTS) return false;

    // Price
    const priceText = $(el).find('.p-price strong').first().text().trim();
    const price = parseFloat(priceText.replace(/[^\d.]/g, ''));

    // Name — JD wraps the matched portion in <em>
    const nameEl = $(el).find('.p-name a');
    const name = (nameEl.find('em').text() || nameEl.text()).trim().replace(/\s+/g, ' ');

    // Product URL
    const href = nameEl.attr('href') || '';
    const url = href.startsWith('//') ? 'https:' + href
      : href.startsWith('http') ? href
      : '';

    const shopName = $(el).find('.p-shop span a').text().trim() || '京东自营';
    const skuId = $(el).attr('data-sku') || '';

    if (!name || isNaN(price) || price <= 0) return;

    items.push({
      goods_name: name,
      goods_desc: name,
      price,
      final_price: price,
      coupon_price_yuan: price,
      min_group_price_yuan: price,
      platform: 'jd',
      source_platform: 'jd',
      provider: 'jd',
      shop_name: shopName,
      url,
      material_url: url,
      item_url: url,
      sku_id: skuId,
      skuId,
      goods_id: skuId,
      unified_tags: [],
      source: 'sandbox',
    });
  });

  log('info', 'jd.search.done', { keyword, count: items.length });
  return items;
}
