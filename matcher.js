import { ATTRIBUTES, BRANDS, CATEGORIES, CATEGORY_REQUIRED_SPEC, HARD_EXCLUDES, MUTUALLY_EXCLUSIVE_BRAND_GROUPS, PHONE_MODELS, STORE_RULES } from './rules.js';
import { has, itemCapacity, itemText, norm, parseSpec, priceOf } from './unit-price.js';

export function parseIntent(query) {
  const n = norm(query);
  let cat = '';
  for (const key of Object.keys(CATEGORIES)) {
    if (CATEGORIES[key].some(term => n.includes(norm(term)))) {
      cat = key;
      break;
    }
  }
  if (cat === 'water' && ['可乐', '雪碧', '芬达', '汽水', '碳酸'].some(term => n.includes(norm(term)))) cat = 'cola';

  const brands = Object.keys(BRANDS).filter(key => BRANDS[key].some(term => n.includes(norm(term))));
  const attrs = Object.keys(ATTRIBUTES).filter(key => ATTRIBUTES[key].some(term => n.includes(norm(term))));
  const cap = (n.match(/(\d{4,6})(mah|毫安)/) || [])[1] || '';
  const model = PHONE_MODELS.find(m => n.includes(norm(m))) || '';
  const tokens = String(query).split(/[\s\u3000]+/).map(x => x.trim()).filter(Boolean);

  return { raw: query, cat, brands, attrs, cap, model, tokens };
}

export function brandsInText(item) {
  return Object.keys(BRANDS).filter(key => has(item, BRANDS[key]));
}

export function itemModel(item) {
  const n = norm(itemText(item));
  return PHONE_MODELS.find(m => n.includes(norm(m))) || '';
}

export function storeType(item) {
  if (has(item, STORE_RULES.official)) return 'official';
  if (has(item, STORE_RULES.channel)) return 'channel';
  return 'normal';
}

function categoryMismatchReason(item, intent) {
  const t = itemText(item);
  if (intent.cat === 'yogurt' && !has(t, CATEGORIES.yogurt)) return '品类不符：需要酸奶/发酵乳';
  if (intent.cat === 'milk' && (!has(t, CATEGORIES.milk) || has(t, CATEGORIES.yogurt))) return '品类不符：需要牛奶且不能是酸奶';
  if (intent.cat === 'water' && !has(t, CATEGORIES.water)) return '品类不符：需要饮用水/矿泉水';
  if (intent.cat === 'cola' && !has(t, CATEGORIES.cola)) return '品类不符：需要可乐/汽水';
  if (intent.cat === 'paper' && !has(t, CATEGORIES.paper)) return '品类不符：需要纸巾';
  if (intent.cat === 'laundry' && !has(t, CATEGORIES.laundry)) return '品类不符：需要洗衣液/凝珠/洗衣粉';
  if (intent.cat === 'power' && !has(t, CATEGORIES.power)) return '品类不符：需要充电宝/移动电源';
  if (intent.cat === 'case' && !has(t, CATEGORIES.case)) return '品类不符：需要手机壳';
  return '';
}

export function diagnose(item, queryOrIntent) {
  const intent = typeof queryOrIntent === 'string' ? parseIntent(queryOrIntent) : queryOrIntent;
  const text = itemText(item);
  const n = norm(text);
  const reasons = [];

  for (const word of HARD_EXCLUDES) {
    if (n.includes(norm(word))) reasons.push(`硬排除词：${word}`);
  }

  if (intent.brands.length && !intent.brands.some(key => has(text, BRANDS[key]))) {
    reasons.push(`品牌不符：需要 ${intent.brands.join('/')}`);
  }

  for (const group of MUTUALLY_EXCLUSIVE_BRAND_GROUPS) {
    const wanted = intent.brands.filter(key => group.includes(key));
    if (!wanted.length) continue;
    const present = brandsInText(item).filter(key => group.includes(key));
    const wrong = present.filter(key => !wanted.includes(key));
    if (wrong.length) reasons.push(`互斥品牌混入：${wrong.join('/')}`);
  }

  const catReason = categoryMismatchReason(item, intent);
  if (catReason) reasons.push(catReason);

  for (const key of intent.attrs) {
    if (!has(text, ATTRIBUTES[key])) reasons.push(`属性不符：需要 ${key}`);
  }

  if (intent.cap) {
    const cap = itemCapacity(item);
    if (!cap) reasons.push('容量缺失');
    else if (Math.abs(cap - Number(intent.cap)) > 1000) reasons.push(`容量不符：需要 ${intent.cap}，商品 ${cap}`);
  }

  if (intent.model) {
    const model = itemModel(item);
    if (!model) reasons.push(`机型缺失：需要 ${intent.model}`);
    else if (model !== intent.model) reasons.push(`机型不符：需要 ${intent.model}，商品 ${model}`);
  }

  const spec = parseSpec(item, intent);
  if (CATEGORY_REQUIRED_SPEC.includes(intent.cat) && spec.kind === 'none') reasons.push('规格缺失：无法计算单位价');

  if (!intent.cat && !intent.brands.length && intent.tokens.length > 1) {
    const missing = intent.tokens.filter(token => !n.includes(norm(token)));
    if (missing.length) reasons.push(`关键词缺失：${missing.join('/')}`);
  }

  return { keep: reasons.length === 0, reasons: reasons.length ? reasons : ['通过过滤'], intent, spec };
}

export function isSameProduct(item, queryOrIntent) {
  return diagnose(item, queryOrIntent).keep;
}

export function makeCandidate(item, intent) {
  const spec = parseSpec(item, intent);
  return {
    item,
    group: storeType(item),
    platform: item.platform,
    price: priceOf(item),
    value: spec.value || priceOf(item),
    spec,
  };
}

export function compareCandidates(a, b) {
  return a.value - b.value || a.price - b.price;
}

export function buildPriceModel(items, query) {
  const intent = parseIntent(query);
  const kept = [];
  const rejected = [];
  const model = {
    official: { best: null, byPlatform: {} },
    channel: { best: null, byPlatform: {} },
    normal: { best: null, byPlatform: {} },
  };

  items.forEach((item, index) => {
    const d = diagnose(item, intent);
    if (!d.keep) {
      rejected.push({ item, diagnose: d });
      return;
    }
    item._key = `g${kept.length}`;
    kept.push(item);
    const c = makeCandidate(item, intent);
    const currentPlatform = model[c.group].byPlatform[c.platform];
    if (!currentPlatform || compareCandidates(c, currentPlatform) < 0) model[c.group].byPlatform[c.platform] = c;
    if (!model[c.group].best || compareCandidates(c, model[c.group].best) < 0) model[c.group].best = c;
  });

  return { intent, kept, rejected, model };
}
