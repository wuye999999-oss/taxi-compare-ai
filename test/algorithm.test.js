import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPriceModel, diagnose, parseIntent } from '../matcher.js';
import { normalizeGoods, forceCustomerPlatforms } from '../providers.js';

const item = (name, price, platform = 'pdd', shop = '普通店') => ({ goods_name: name, coupon_price_yuan: price, platform, shop_name: shop });

function keptNames(query, items) {
  return normalizeGoods({ goods_list: items }).filter(x => diagnose(x, query).keep).map(x => x.goods_name);
}

test('百岁山：互斥水品牌过滤，先同品后比单位价', () => {
  const goods = [
    item('百岁山 饮用天然矿泉水 570ml*24瓶 整箱', 48, 'jd', '百岁山官方旗舰店'),
    item('百岁山 饮用天然矿泉水 348ml*24瓶 整箱', 30, 'pdd'),
    item('农夫山泉 饮用天然水 550ml*24瓶', 20, 'tb'),
  ];
  const built = buildPriceModel(normalizeGoods({ goods_list: goods }), '百岁山');
  assert.equal(built.kept.length, 2);
  assert.equal(built.model.official.best.item.goods_name, goods[0].goods_name);
  assert.equal(built.model.normal.best.item.goods_name, goods[1].goods_name);
});

test('农夫山泉：过滤百岁山，保留农夫山泉饮用水', () => {
  const names = keptNames('农夫山泉', [
    item('农夫山泉 饮用天然水 550ml*24瓶', 36),
    item('百岁山 饮用天然矿泉水 570ml*24瓶', 40),
  ]);
  assert.deepEqual(names, ['农夫山泉 饮用天然水 550ml*24瓶']);
});

test('小米充电宝 20000mAh：品牌、品类、容量强约束', () => {
  const names = keptNames('小米充电宝 20000mAh', [
    item('小米 充电宝 20000mAh 22.5W 快充', 99),
    item('小米 充电宝 10000mAh 轻薄版', 59),
    item('安克 充电宝 20000mAh', 129),
  ]);
  assert.deepEqual(names, ['小米 充电宝 20000mAh 22.5W 快充']);
});

test('iPhone 15 Pro Max 手机壳：机型强约束，错机型过滤', () => {
  const names = keptNames('iPhone 15 Pro Max 手机壳', [
    item('苹果 iPhone15ProMax 透明手机壳 防摔', 19),
    item('苹果 iPhone15Pro 手机壳 防摔', 9),
    item('华为 Mate60Pro 手机壳', 12),
  ]);
  assert.deepEqual(names, ['苹果 iPhone15ProMax 透明手机壳 防摔']);
});

test('纸巾 100抽*24包：规格缺失过滤，按每100抽排序', () => {
  const goods = normalizeGoods({ goods_list: [
    item('抽纸 100抽*24包 整箱', 30),
    item('抽纸 100抽*12包', 18),
    item('纸巾 家用实惠装', 1),
  ] });
  const built = buildPriceModel(goods, '纸巾 100抽*24包');
  assert.equal(built.kept.length, 2);
  assert.equal(built.model.normal.best.item.goods_name, '抽纸 100抽*24包 整箱');
});

test('洗衣液 3kg*2桶：按kg单位价排序，规格缺失过滤', () => {
  const goods = normalizeGoods({ goods_list: [
    item('蓝月亮 洗衣液 3kg*2桶', 59),
    item('洗衣液 2kg*2桶', 42),
    item('洗衣液 香味持久', 9),
  ] });
  const built = buildPriceModel(goods, '洗衣液 3kg*2桶');
  assert.equal(built.kept.length, 2);
  assert.equal(built.model.normal.best.item.goods_name, '蓝月亮 洗衣液 3kg*2桶');
});

test('顾客端固定全平台，不读取旧localStorage平台筛选', () => {
  assert.deepEqual(forceCustomerPlatforms(), ['pdd', 'jd', 'tb', 'douyin']);
});

test('intent parsing includes category and model for iPhone case', () => {
  assert.equal(parseIntent('iPhone 15 Pro Max 手机壳').cat, 'case');
  assert.equal(parseIntent('iPhone 15 Pro Max 手机壳').model, 'iphone15promax');
});
