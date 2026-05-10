export const PLATFORMS = [
  ['pdd', '拼多多'],
  ['jd', '京东'],
  ['tb', '淘宝'],
  ['douyin', '抖音'],
];

export const PLATFORM_IDS = PLATFORMS.map(([id]) => id);

export const RESULT_GROUPS = [
  ['official', '官方/自营最低价'],
  ['channel', '渠道店最低价'],
  ['normal', '普通店最低价'],
];

export const STORE_RULES = {
  official: ['官方旗舰店', '品牌旗舰店', '旗舰店', '官方店', '京东自营', '自营', '天猫超市', '天猫旗舰', '官方'],
  channel: ['专卖店', '专营店', '授权店', '经销店', '渠道', '批发', '厂家', '工厂', '源头', '尾货', '清仓', '仓库', '量贩', '整箱批发', '团购', '商用', '大包装', '批发价'],
};

export const CATEGORIES = {
  yogurt: ['酸奶', '低温酸奶', '常温酸奶', '风味发酵乳', '发酵乳', '乳酸菌', '酸乳'],
  milk: ['牛奶', '纯牛奶', '鲜牛奶', '牛乳', '蛋白牛乳'],
  water: ['百岁山', '农夫山泉', '怡宝', '矿泉水', '纯净水', '天然水', '饮用水', '矿物质水', '水'],
  cola: ['可口可乐', 'coca', 'cola', '雪碧', '芬达', '百事', '汽水', '碳酸', '可乐'],
  paper: ['纸巾', '抽纸', '卷纸', '面巾纸', '卫生纸'],
  laundry: ['洗衣液', '洗衣凝珠', '洗衣粉'],
  power: ['充电宝', '移动电源', '毫安', 'mah', '快充'],
  case: ['手机壳', '保护壳', '硅胶壳', '透明壳'],
};

export const BRANDS = {
  xiaomi: ['小米', 'xiaomi', 'redmi', '米家'],
  anker: ['安克', 'anker'],
  ganten: ['百岁山', 'ganten'],
  nongfu: ['农夫山泉'],
  cestbon: ['怡宝'],
  coke: ['可口可乐', 'coca', 'cocacola'],
  sprite: ['雪碧', 'sprite'],
  fanta: ['芬达', 'fanta'],
  pepsi: ['百事', 'pepsi'],
  vinda: ['维达', 'vinda'],
  blueMoon: ['蓝月亮'],
  zhenling: ['真零'],
  apple: ['苹果', 'apple', 'iphone'],
  huawei: ['华为', 'huawei'],
};

export const MUTUALLY_EXCLUSIVE_BRAND_GROUPS = [
  ['ganten', 'nongfu', 'cestbon'],
  ['coke', 'sprite', 'fanta', 'pepsi'],
  ['xiaomi', 'anker'],
  ['apple', 'huawei', 'xiaomi'],
];

export const ATTRIBUTES = {
  noSugar: ['无糖', '零糖', '0糖', '零度', 'zero', '无蔗糖', '0蔗糖', '0卡', '零卡'],
  lactoseFree: ['0乳糖', '无乳糖', '零乳糖'],
};

export const HARD_EXCLUDES = ['刻字', '激光', '礼物', '礼盒', '摆件', '挂件', '钥匙扣', '贴纸', '海报', '模型', '手办', '空瓶', '收藏', '周边', '定制', '抱枕', '衣服', '杯子', '水杯', '开瓶器', '配件', '适用', '兼容', '贴膜', '数据线', '支架'];

export const PHONE_MODELS = ['iphone15promax', 'iphone15pro', 'iphone15plus', 'iphone15', 'iphone14promax', 'iphone14pro', 'iphone14plus', 'iphone14', '小米14ultra', '小米14pro', '小米14', '华为mate60pro', '华为mate60', '华为pura70', '华为p70'];

export const CATEGORY_REQUIRED_SPEC = ['water', 'cola', 'yogurt', 'milk', 'paper', 'laundry', 'power'];
