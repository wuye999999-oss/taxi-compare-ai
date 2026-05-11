import assert from 'node:assert/strict';
import test from 'node:test';
import { compare, createServer, extractJdGoods, providerStatuses, standardizeItem } from '../server2.js';

function getJson(server, path) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      fetch(`http://127.0.0.1:${port}${path}`)
        .then(res => res.json().then(json => ({ status: res.status, json })))
        .then(resolve, reject)
        .finally(() => server.close());
    });
  });
}


test('standardizeItem maps PDD/JD raw items to canonical fields for unit-price comparison', () => {
  const pdd = standardizeItem('pdd', {
    goods_name: '百岁山 饮用天然矿泉水 570ml*24瓶',
    min_group_price: 4800,
    min_normal_price: 5200,
    mall_name: '百岁山官方旗舰店',
    brand_name: '百岁山',
    goods_thumbnail_url: 'https://example.test/pdd.jpg',
    goods_url: 'https://example.test/pdd',
  }, '百岁山');
  assert.deepEqual(Object.keys(pdd), ['provider', 'title', 'price', 'originalPrice', 'shopName', 'shopType', 'brand', 'category', 'specText', 'volumeValue', 'volumeUnit', 'count', 'unitPrice', 'itemUrl', 'imageUrl', 'raw']);
  assert.equal(pdd.provider, 'pdd');
  assert.equal(pdd.price, 48);
  assert.equal(pdd.originalPrice, 52);
  assert.equal(pdd.shopType, 'official');
  assert.equal(pdd.volumeUnit, 'ml');
  assert.equal(pdd.volumeValue, 13680);

  const jd = standardizeItem('jd', {
    skuName: '京东自营 抽纸 100抽*24包',
    price: 30,
    shopName: '京东自营',
    brandName: '维达',
    itemUrl: 'https://example.test/jd',
  }, '纸巾 100抽*24包');
  assert.equal(jd.provider, 'jd');
  assert.equal(jd.shopType, 'official');
  assert.equal(jd.unitPrice, 1.25);
});

test('/api/providers/status preserves real integration status', () => {
  const statuses = providerStatuses();
  const jd = statuses.find(item => item.provider === 'jd');
  const taobao = statuses.find(item => item.provider === 'taobao');
  const douyin = statuses.find(item => item.provider === 'douyin');

  assert.equal(jd.advancedApi, false);
  assert.match(jd.message, /不会伪造/);
  assert.equal(taobao.status, 'not_integrated');
  assert.equal(douyin.status, 'not_integrated');
});

test('/api/compare returns canonical goods shape without fake taobao/douyin products', async () => {
  const data = await compare('百岁山 570ml*24瓶');
  assert.equal(data.q, '百岁山 570ml*24瓶');
  assert.ok(Array.isArray(data.providers));
  assert.ok(Array.isArray(data.goods));
  assert.ok(data.providers.some(item => item.provider === 'taobao' && item.status === 'not_integrated'));
  assert.ok(data.providers.some(item => item.provider === 'douyin' && item.status === 'not_integrated'));
  assert.equal(data.goods.some(item => item.provider === 'taobao' || item.provider === 'douyin'), false);

  const expectedKeys = ['provider', 'title', 'price', 'originalPrice', 'shopName', 'shopType', 'brand', 'category', 'specText', 'volumeValue', 'volumeUnit', 'count', 'unitPrice', 'itemUrl', 'imageUrl', 'raw'];
  for (const item of data.goods) assert.deepEqual(Object.keys(item), expectedKeys);
});


test('extractJdGoods parses string result errors and prioritizes parsed data arrays', () => {
  const raw = {
    jd_union_open_goods_query_response: {
      result: JSON.stringify({
        code: 200,
        message: 'ok',
        data: [
          { skuId: 'sku-1', skuName: '京东测试商品', priceInfo: { price: 12.3 } },
        ],
      }),
    },
  };

  const extracted = extractJdGoods(raw);
  assert.equal(extracted.raw_result_is_string, true);
  assert.equal(extracted.code, 200);
  assert.equal(extracted.data_present, true);
  assert.equal(extracted.candidates.length, 1);
  assert.equal(extracted.candidates[0].skuId, 'sku-1');
});

test('/api/search keeps other providers and surfaces JD business errors', async () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    JD_APP_KEY: process.env.JD_APP_KEY,
    JD_APP_SECRET: process.env.JD_APP_SECRET,
    JD_SEARCH_METHOD: process.env.JD_SEARCH_METHOD,
  };
  process.env.JD_APP_KEY = 'test-app-key';
  process.env.JD_APP_SECRET = 'test-app-secret';
  delete process.env.JD_SEARCH_METHOD;
  globalThis.fetch = async () => new Response(JSON.stringify({
    jd_union_open_goods_query_response: {
      result: JSON.stringify({ code: '300', message: '京东测试错误', data: null }),
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const data = await compare('小米充电宝');
    assert.equal(data.q, '小米充电宝');
    assert.ok(Array.isArray(data.goods));
    assert.equal(data.provider_errors.jd.ok, false);
    assert.equal(data.provider_errors.jd.code, '300');
    assert.equal(data.provider_errors.jd.message, '京东测试错误');
    assert.ok(data.providers.some(item => item.provider === 'pdd'));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('http routes keep /health, /api/providers/status and /api/compare', async () => {
  const health = await getJson(createServer(), '/health');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);

  const status = await getJson(createServer(), '/api/providers/status');
  assert.equal(status.status, 200);
  assert.equal(status.json.providers.length, 4);

  const compareResult = await getJson(createServer(), '/api/compare?q=%E7%99%BE%E5%B2%81%E5%B1%B1');
  assert.equal(compareResult.status, 200);
  assert.equal(compareResult.json.q, '百岁山');
});
