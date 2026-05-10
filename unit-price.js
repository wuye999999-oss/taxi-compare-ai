import { CATEGORIES } from './rules.js';

export const yuan = n => Number(n || 0).toFixed(2).replace(/\.00$/, '');
export const norm = s => String(s || '').toLowerCase().replace(/[\s\-_〖〗\[\]（）()，,。.!！:：/\\]+/g, '');
export const has = (value, terms) => {
  const n = norm(typeof value === 'string' ? value : itemText(value));
  return terms.some(term => n.includes(norm(term)));
};
export const itemText = item => [item?.goods_name, item?.goods_desc, item?.brand_name, item?.shop_name, (item?.unified_tags || []).join(' ')].filter(Boolean).join(' ');
export const priceOf = item => Number(item?.coupon_price_yuan || item?.final_price || item?.min_group_price_yuan || item?.price || 999999);

const cleanSpecText = item => itemText(item)
  .replace(/[×ＸxX]/g, '*')
  .replace(/毫升/g, 'ml')
  .replace(/升/g, 'L')
  .replace(/公斤|千克/g, 'kg')
  .replace(/克/g, 'g')
  .replace(/毫安时/g, 'mAh')
  .replace(/毫安/g, 'mAh')
  .replace(/\s+/g, ' ');

const toMl = (v, u) => String(u).toLowerCase() === 'l' ? v * 1000 : v;
const toKg = (v, u) => {
  if (u === '斤') return v * 0.5;
  if (String(u).toLowerCase() === 'g') return v / 1000;
  return v;
};

function volumeSpec(ml, count, container, price, intent) {
  const totalMl = ml * count;
  if (!totalMl) return null;
  const per100 = price / (totalMl / 100);
  const perL = price / (totalMl / 1000);
  if (['yogurt', 'milk', 'laundry'].includes(intent.cat)) {
    return { kind: 'volume', text: `${ml}ml × ${count}${container} ｜ 约 ¥${yuan(perL)}/L`, value: perL, total: totalMl };
  }
  return { kind: 'volume', text: `${ml}ml × ${count}${container} ｜ 约 ¥${yuan(per100)}/100ml`, value: per100, total: totalMl };
}

export function itemCapacity(item) {
  const m = norm(itemText(item)).match(/(\d{4,6})(mah|毫安)/);
  return m ? Number(m[1]) : 0;
}

export function parseSpec(item, intent = { cat: '' }) {
  const t = cleanSpecText(item);
  const n = norm(t);
  const price = priceOf(item);
  let m;

  m = t.match(/(\d+(?:\.\d+)?)\s*(ml|mL|ML|l|L)\s*\*\s*(\d+)\s*(瓶|罐|听|盒|杯|支|袋|桶)?/);
  if (m) return volumeSpec(toMl(Number(m[1]), m[2]), Number(m[3]), m[4] || '件', price, intent);

  m = t.match(/(\d+)\s*(瓶|罐|听|盒|杯|支|袋|桶).{0,12}?(\d+(?:\.\d+)?)\s*(ml|mL|ML|l|L)/);
  if (m) return volumeSpec(toMl(Number(m[3]), m[4]), Number(m[1]), m[2], price, intent);

  m = t.match(/(\d+)\s*\*\s*(\d+(?:\.\d+)?)\s*(ml|mL|ML|l|L)/);
  if (m) return volumeSpec(toMl(Number(m[2]), m[3]), Number(m[1]), '件', price, intent);

  m = t.match(/(\d+(?:\.\d+)?)\s*(ml|mL|ML|l|L)/);
  if (m) {
    const cm = t.match(/(\d+)\s*(瓶|罐|听|盒|杯|支|袋|箱|整箱|桶)/);
    return volumeSpec(toMl(Number(m[1]), m[2]), cm ? Number(cm[1]) : 1, cm ? cm[2] : '件', price, intent);
  }

  m = t.match(/(\d+(?:\.\d+)?)\s*(kg|KG|斤|g|G)\s*\*?\s*(\d+)?\s*(桶|瓶|袋|盒|包)?/);
  if (m) {
    const kg = toKg(Number(m[1]), m[2]) * Number(m[3] || 1);
    if (kg) return { kind: 'weight', text: `${yuan(kg)}kg ｜ 约 ¥${yuan(price / kg)}/kg`, value: price / kg, total: kg };
  }

  m = t.match(/(\d+)\s*(抽|张)\s*\*\s*(\d+)\s*(包|提|箱|组)?/);
  if (m) {
    const total = Number(m[1]) * Number(m[3]);
    return { kind: 'paper', text: `${total}抽/张 ｜ 约 ¥${yuan(price / (total / 100))}/100抽`, value: price / (total / 100), total };
  }

  m = t.match(/(\d+)\s*(包|提|箱).{0,12}?(\d+)\s*(抽|张)/);
  if (m) {
    const total = Number(m[1]) * Number(m[3]);
    return { kind: 'paper', text: `${total}抽/张 ｜ 约 ¥${yuan(price / (total / 100))}/100抽`, value: price / (total / 100), total };
  }

  m = n.match(/(\d{4,6})(mah|毫安)/);
  if (m) {
    const cap = Number(m[1]);
    return { kind: 'power', text: `${cap}mAh ｜ 约 ¥${yuan(price / (cap / 10000))}/万mAh`, value: price / (cap / 10000), total: cap };
  }

  return { kind: 'none', text: '', value: price, total: 0 };
}

export function compareValue(item, intent) {
  const spec = parseSpec(item, intent);
  return spec.value || priceOf(item);
}
