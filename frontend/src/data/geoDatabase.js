/**
 * Curated database of world cities and landmarks for the geo guessing game.
 *
 * Each entry's coordinates are chosen for distinctive satellite imagery
 * at zoom 14 (~2 km view). Difficulty: 1 = easy, 2 = medium, 3 = hard.
 */

const GEO_DATABASE = [

  // ═══════════════════════════════════════════════════════════
  // EUROPE
  // ═══════════════════════════════════════════════════════════

  // ─── Easy ───
  { name: 'Venice',           nameZh: '威尼斯',       country: 'Italy',         countryZh: '意大利',   lat: 45.438,  lng: 12.335,  difficulty: 1 },
  { name: 'Paris',            nameZh: '巴黎',         country: 'France',        countryZh: '法国',     lat: 48.858,  lng: 2.294,   difficulty: 1 },
  { name: 'Barcelona',        nameZh: '巴塞罗那',     country: 'Spain',         countryZh: '西班牙',   lat: 41.390,  lng: 2.165,   difficulty: 1 },
  { name: 'Amsterdam',        nameZh: '阿姆斯特丹',   country: 'Netherlands',   countryZh: '荷兰',     lat: 52.370,  lng: 4.895,   difficulty: 1 },
  { name: 'London',           nameZh: '伦敦',         country: 'United Kingdom', countryZh: '英国',    lat: 51.501,  lng: -0.125,  difficulty: 1 },
  { name: 'Vatican City',     nameZh: '梵蒂冈',       country: 'Vatican',       countryZh: '梵蒂冈',   lat: 41.902,  lng: 12.457,  difficulty: 1 },
  { name: 'Dubrovnik',        nameZh: '杜布罗夫尼克', country: 'Croatia',       countryZh: '克罗地亚', lat: 42.641,  lng: 18.108,  difficulty: 1 },
  { name: 'Santorini',        nameZh: '圣托里尼',     country: 'Greece',        countryZh: '希腊',     lat: 36.416,  lng: 25.432,  difficulty: 1 },
  { name: 'Monaco',           nameZh: '摩纳哥',       country: 'Monaco',        countryZh: '摩纳哥',   lat: 43.738,  lng: 7.425,   difficulty: 1 },

  // ─── Medium ───
  { name: 'Rome',             nameZh: '罗马',         country: 'Italy',         countryZh: '意大利',   lat: 41.890,  lng: 12.492,  difficulty: 2 },
  { name: 'Istanbul',         nameZh: '伊斯坦布尔',   country: 'Turkey',        countryZh: '土耳其',   lat: 41.012,  lng: 28.976,  difficulty: 2 },
  { name: 'Moscow',           nameZh: '莫斯科',       country: 'Russia',        countryZh: '俄罗斯',   lat: 55.752,  lng: 37.618,  difficulty: 2 },
  { name: 'Berlin',           nameZh: '柏林',         country: 'Germany',       countryZh: '德国',     lat: 52.514,  lng: 13.378,  difficulty: 2 },
  { name: 'Lisbon',           nameZh: '里斯本',       country: 'Portugal',      countryZh: '葡萄牙',   lat: 38.707,  lng: -9.136,  difficulty: 2 },
  { name: 'Stockholm',        nameZh: '斯德哥尔摩',   country: 'Sweden',        countryZh: '瑞典',     lat: 59.326,  lng: 18.072,  difficulty: 2 },
  { name: 'Athens',           nameZh: '雅典',         country: 'Greece',        countryZh: '希腊',     lat: 37.972,  lng: 23.726,  difficulty: 2 },
  { name: 'Prague',           nameZh: '布拉格',       country: 'Czech Republic', countryZh: '捷克',    lat: 50.086,  lng: 14.413,  difficulty: 2 },
  { name: 'Budapest',         nameZh: '布达佩斯',     country: 'Hungary',       countryZh: '匈牙利',   lat: 47.498,  lng: 19.040,  difficulty: 2 },
  { name: 'Vienna',           nameZh: '维也纳',       country: 'Austria',       countryZh: '奥地利',   lat: 48.206,  lng: 16.363,  difficulty: 2 },
  { name: 'Copenhagen',       nameZh: '哥本哈根',     country: 'Denmark',       countryZh: '丹麦',     lat: 55.676,  lng: 12.568,  difficulty: 2 },
  { name: 'Edinburgh',        nameZh: '爱丁堡',       country: 'United Kingdom', countryZh: '英国',    lat: 55.949,  lng: -3.200,  difficulty: 2 },
  { name: 'Florence',         nameZh: '佛罗伦萨',     country: 'Italy',         countryZh: '意大利',   lat: 43.773,  lng: 11.256,  difficulty: 2 },
  { name: 'St. Petersburg',   nameZh: '圣彼得堡',     country: 'Russia',        countryZh: '俄罗斯',   lat: 59.940,  lng: 30.316,  difficulty: 2 },
  { name: 'Porto',            nameZh: '波尔图',       country: 'Portugal',      countryZh: '葡萄牙',   lat: 41.141,  lng: -8.613,  difficulty: 2 },
  { name: 'Seville',          nameZh: '塞维利亚',     country: 'Spain',         countryZh: '西班牙',   lat: 37.389,  lng: -5.984,  difficulty: 2 },
  { name: 'Geneva',           nameZh: '日内瓦',       country: 'Switzerland',   countryZh: '瑞士',     lat: 46.204,  lng: 6.143,   difficulty: 2 },
  { name: 'Split',            nameZh: '斯普利特',     country: 'Croatia',       countryZh: '克罗地亚', lat: 43.508,  lng: 16.440,  difficulty: 2 },
  { name: 'Bruges',           nameZh: '布鲁日',       country: 'Belgium',       countryZh: '比利时',   lat: 51.209,  lng: 3.225,   difficulty: 2 },

  // ─── Hard ───
  { name: 'Warsaw',           nameZh: '华沙',         country: 'Poland',        countryZh: '波兰',     lat: 52.230,  lng: 21.012,  difficulty: 3 },
  { name: 'Brussels',         nameZh: '布鲁塞尔',     country: 'Belgium',       countryZh: '比利时',   lat: 50.847,  lng: 4.357,   difficulty: 3 },
  { name: 'Bucharest',        nameZh: '布加勒斯特',   country: 'Romania',       countryZh: '罗马尼亚', lat: 44.432,  lng: 26.103,  difficulty: 3 },
  { name: 'Oslo',             nameZh: '奥斯陆',       country: 'Norway',        countryZh: '挪威',     lat: 59.913,  lng: 10.738,  difficulty: 3 },
  { name: 'Zurich',           nameZh: '苏黎世',       country: 'Switzerland',   countryZh: '瑞士',     lat: 47.366,  lng: 8.541,   difficulty: 3 },
  { name: 'Reykjavik',        nameZh: '雷克雅未克',   country: 'Iceland',       countryZh: '冰岛',     lat: 64.147,  lng: -21.926, difficulty: 3 },
  { name: 'Belgrade',         nameZh: '贝尔格莱德',   country: 'Serbia',        countryZh: '塞尔维亚', lat: 44.816,  lng: 20.461,  difficulty: 3 },
  { name: 'Helsinki',         nameZh: '赫尔辛基',     country: 'Finland',       countryZh: '芬兰',     lat: 60.170,  lng: 24.952,  difficulty: 3 },
  { name: 'Tallinn',          nameZh: '塔林',         country: 'Estonia',       countryZh: '爱沙尼亚', lat: 59.440,  lng: 24.748,  difficulty: 3 },
  { name: 'Riga',             nameZh: '里加',         country: 'Latvia',        countryZh: '拉脱维亚', lat: 56.946,  lng: 24.106,  difficulty: 3 },

  // ═══════════════════════════════════════════════════════════
  // ASIA
  // ═══════════════════════════════════════════════════════════

  // ─── Easy ───
  { name: 'Dubai',            nameZh: '迪拜',         country: 'UAE',           countryZh: '阿联酋',   lat: 25.112,  lng: 55.138,  difficulty: 1 },
  { name: 'Tokyo',            nameZh: '东京',         country: 'Japan',         countryZh: '日本',     lat: 35.685,  lng: 139.753, difficulty: 1 },
  { name: 'Singapore',        nameZh: '新加坡',       country: 'Singapore',     countryZh: '新加坡',   lat: 1.282,   lng: 103.862, difficulty: 1 },
  { name: 'Hong Kong',        nameZh: '香港',         country: 'China',         countryZh: '中国',     lat: 22.285,  lng: 114.158, difficulty: 1 },
  { name: 'Mecca',            nameZh: '麦加',         country: 'Saudi Arabia',  countryZh: '沙特阿拉伯', lat: 21.423, lng: 39.826,  difficulty: 1 },

  // ─── Medium ───
  { name: 'Shanghai',         nameZh: '上海',         country: 'China',         countryZh: '中国',     lat: 31.240,  lng: 121.499, difficulty: 2 },
  { name: 'Beijing',          nameZh: '北京',         country: 'China',         countryZh: '中国',     lat: 39.916,  lng: 116.397, difficulty: 2 },
  { name: 'Seoul',            nameZh: '首尔',         country: 'South Korea',   countryZh: '韩国',     lat: 37.577,  lng: 126.977, difficulty: 2 },
  { name: 'Bangkok',          nameZh: '曼谷',         country: 'Thailand',      countryZh: '泰国',     lat: 13.745,  lng: 100.489, difficulty: 2 },
  { name: 'Taipei',           nameZh: '台北',         country: 'Taiwan',        countryZh: '台湾',     lat: 25.033,  lng: 121.565, difficulty: 2 },
  { name: 'Mumbai',           nameZh: '孟买',         country: 'India',         countryZh: '印度',     lat: 18.922,  lng: 72.835,  difficulty: 2 },
  { name: 'Delhi',            nameZh: '德里',         country: 'India',         countryZh: '印度',     lat: 28.656,  lng: 77.241,  difficulty: 2 },
  { name: 'Kyoto',            nameZh: '京都',         country: 'Japan',         countryZh: '日本',     lat: 35.012,  lng: 135.768, difficulty: 2 },
  { name: 'Hanoi',            nameZh: '河内',         country: 'Vietnam',       countryZh: '越南',     lat: 21.028,  lng: 105.854, difficulty: 2 },
  { name: 'Ho Chi Minh City', nameZh: '胡志明市',     country: 'Vietnam',       countryZh: '越南',     lat: 10.773,  lng: 106.703, difficulty: 2 },
  { name: 'Jerusalem',        nameZh: '耶路撒冷',     country: 'Israel',        countryZh: '以色列',   lat: 31.778,  lng: 35.230,  difficulty: 2 },
  { name: 'Doha',             nameZh: '多哈',         country: 'Qatar',         countryZh: '卡塔尔',   lat: 25.300,  lng: 51.530,  difficulty: 2 },
  { name: 'Abu Dhabi',        nameZh: '阿布扎比',     country: 'UAE',           countryZh: '阿联酋',   lat: 24.454,  lng: 54.378,  difficulty: 2 },
  { name: 'Osaka',            nameZh: '大阪',         country: 'Japan',         countryZh: '日本',     lat: 34.694,  lng: 135.502, difficulty: 2 },
  { name: 'Busan',            nameZh: '釜山',         country: 'South Korea',   countryZh: '韩国',     lat: 35.103,  lng: 129.032, difficulty: 2 },
  { name: 'Kathmandu',        nameZh: '加德满都',     country: 'Nepal',         countryZh: '尼泊尔',   lat: 27.702,  lng: 85.314,  difficulty: 2 },

  // ─── Hard ───
  { name: 'Tehran',           nameZh: '德黑兰',       country: 'Iran',          countryZh: '伊朗',     lat: 35.699,  lng: 51.338,  difficulty: 3 },
  { name: 'Jakarta',          nameZh: '雅加达',       country: 'Indonesia',     countryZh: '印度尼西亚', lat: -6.175, lng: 106.827, difficulty: 3 },
  { name: 'Karachi',          nameZh: '卡拉奇',       country: 'Pakistan',      countryZh: '巴基斯坦', lat: 24.860,  lng: 67.010,  difficulty: 3 },
  { name: 'Kuala Lumpur',     nameZh: '吉隆坡',       country: 'Malaysia',      countryZh: '马来西亚', lat: 3.152,   lng: 101.711, difficulty: 3 },
  { name: 'Manila',           nameZh: '马尼拉',       country: 'Philippines',   countryZh: '菲律宾',   lat: 14.580,  lng: 120.978, difficulty: 3 },
  { name: 'Colombo',          nameZh: '科伦坡',       country: 'Sri Lanka',     countryZh: '斯里兰卡', lat: 6.927,   lng: 79.858,  difficulty: 3 },
  { name: 'Phnom Penh',       nameZh: '金边',         country: 'Cambodia',      countryZh: '柬埔寨',   lat: 11.556,  lng: 104.928, difficulty: 3 },
  { name: 'Yangon',           nameZh: '仰光',         country: 'Myanmar',       countryZh: '缅甸',     lat: 16.867,  lng: 96.199,  difficulty: 3 },
  { name: 'Dhaka',            nameZh: '达卡',         country: 'Bangladesh',    countryZh: '孟加拉国', lat: 23.727,  lng: 90.396,  difficulty: 3 },
  { name: 'Almaty',           nameZh: '阿拉木图',     country: 'Kazakhstan',    countryZh: '哈萨克斯坦', lat: 43.238, lng: 76.946,  difficulty: 3 },

  // ═══════════════════════════════════════════════════════════
  // AMERICAS
  // ═══════════════════════════════════════════════════════════

  // ─── Easy ───
  { name: 'Manhattan',        nameZh: '曼哈顿',       country: 'United States',  countryZh: '美国',    lat: 40.782,  lng: -73.966, difficulty: 1 },
  { name: 'Brasilia',         nameZh: '巴西利亚',     country: 'Brazil',         countryZh: '巴西',    lat: -15.793, lng: -47.883, difficulty: 1 },
  { name: 'Washington D.C.',  nameZh: '华盛顿',       country: 'United States',  countryZh: '美国',    lat: 38.890,  lng: -77.010, difficulty: 1 },
  { name: 'San Francisco',    nameZh: '旧金山',       country: 'United States',  countryZh: '美国',    lat: 37.808,  lng: -122.410, difficulty: 1 },

  // ─── Medium ───
  { name: 'Rio de Janeiro',   nameZh: '里约热内卢',   country: 'Brazil',         countryZh: '巴西',    lat: -22.955, lng: -43.170, difficulty: 2 },
  { name: 'Buenos Aires',     nameZh: '布宜诺斯艾利斯', country: 'Argentina',    countryZh: '阿根廷',  lat: -34.600, lng: -58.380, difficulty: 2 },
  { name: 'Mexico City',      nameZh: '墨西哥城',     country: 'Mexico',         countryZh: '墨西哥',  lat: 19.432,  lng: -99.133, difficulty: 2 },
  { name: 'Havana',           nameZh: '哈瓦那',       country: 'Cuba',           countryZh: '古巴',    lat: 23.135,  lng: -82.360, difficulty: 2 },
  { name: 'Lima',             nameZh: '利马',         country: 'Peru',           countryZh: '秘鲁',    lat: -12.045, lng: -77.030, difficulty: 2 },
  { name: 'Chicago',          nameZh: '芝加哥',       country: 'United States',  countryZh: '美国',    lat: 41.883,  lng: -87.627, difficulty: 2 },
  { name: 'Los Angeles',      nameZh: '洛杉矶',       country: 'United States',  countryZh: '美国',    lat: 34.040,  lng: -118.247, difficulty: 2 },
  { name: 'Toronto',          nameZh: '多伦多',       country: 'Canada',         countryZh: '加拿大',  lat: 43.645,  lng: -79.380, difficulty: 2 },
  { name: 'Vancouver',        nameZh: '温哥华',       country: 'Canada',         countryZh: '加拿大',  lat: 49.300,  lng: -123.140, difficulty: 2 },
  { name: 'Montreal',         nameZh: '蒙特利尔',     country: 'Canada',         countryZh: '加拿大',  lat: 45.505,  lng: -73.573, difficulty: 2 },
  { name: 'Miami',            nameZh: '迈阿密',       country: 'United States',  countryZh: '美国',    lat: 25.790,  lng: -80.136, difficulty: 2 },
  { name: 'New Orleans',      nameZh: '新奥尔良',     country: 'United States',  countryZh: '美国',    lat: 29.955,  lng: -90.075, difficulty: 2 },
  { name: 'Panama City',      nameZh: '巴拿马城',     country: 'Panama',         countryZh: '巴拿马',  lat: 9.000,   lng: -79.520, difficulty: 2 },
  { name: 'Cartagena',        nameZh: '卡塔赫纳',     country: 'Colombia',       countryZh: '哥伦比亚', lat: 10.424, lng: -75.550, difficulty: 2 },
  { name: 'Cusco',            nameZh: '库斯科',       country: 'Peru',           countryZh: '秘鲁',    lat: -13.520, lng: -71.980, difficulty: 2 },
  { name: 'Santiago',         nameZh: '圣地亚哥',     country: 'Chile',          countryZh: '智利',    lat: -33.440, lng: -70.650, difficulty: 2 },

  // ─── Hard ───
  { name: 'Bogota',           nameZh: '波哥大',       country: 'Colombia',       countryZh: '哥伦比亚', lat: 4.625,  lng: -74.065, difficulty: 3 },
  { name: 'Quito',            nameZh: '基多',         country: 'Ecuador',        countryZh: '厄瓜多尔', lat: -0.180, lng: -78.468, difficulty: 3 },
  { name: 'Montevideo',       nameZh: '蒙得维的亚',   country: 'Uruguay',        countryZh: '乌拉圭',  lat: -34.880, lng: -56.170, difficulty: 3 },
  { name: 'La Paz',           nameZh: '拉巴斯',       country: 'Bolivia',        countryZh: '玻利维亚', lat: -16.500, lng: -68.150, difficulty: 3 },
  { name: 'Medellin',         nameZh: '麦德林',       country: 'Colombia',       countryZh: '哥伦比亚', lat: 6.244,  lng: -75.574, difficulty: 3 },
  { name: 'Guatemala City',   nameZh: '危地马拉城',   country: 'Guatemala',      countryZh: '危地马拉', lat: 14.640, lng: -90.510, difficulty: 3 },

  // ═══════════════════════════════════════════════════════════
  // AFRICA
  // ═══════════════════════════════════════════════════════════

  // ─── Easy ───
  { name: 'Cairo',            nameZh: '开罗',         country: 'Egypt',          countryZh: '埃及',    lat: 30.044,  lng: 31.236,  difficulty: 1 },

  // ─── Medium ───
  { name: 'Cape Town',        nameZh: '开普敦',       country: 'South Africa',   countryZh: '南非',    lat: -33.960, lng: 18.420,  difficulty: 2 },
  { name: 'Marrakech',        nameZh: '马拉喀什',     country: 'Morocco',        countryZh: '摩洛哥',  lat: 31.630,  lng: -7.990,  difficulty: 2 },
  { name: 'Tunis',            nameZh: '突尼斯',       country: 'Tunisia',        countryZh: '突尼斯',  lat: 36.800,  lng: 10.170,  difficulty: 2 },
  { name: 'Casablanca',       nameZh: '卡萨布兰卡',   country: 'Morocco',        countryZh: '摩洛哥',  lat: 33.590,  lng: -7.610,  difficulty: 2 },
  { name: 'Dar es Salaam',    nameZh: '达累斯萨拉姆', country: 'Tanzania',       countryZh: '坦桑尼亚', lat: -6.820, lng: 39.290,  difficulty: 2 },
  { name: 'Nairobi',          nameZh: '内罗毕',       country: 'Kenya',          countryZh: '肯尼亚',  lat: -1.290,  lng: 36.820,  difficulty: 2 },
  { name: 'Dakar',            nameZh: '达喀尔',       country: 'Senegal',        countryZh: '塞内加尔', lat: 14.690, lng: -17.450, difficulty: 2 },

  // ─── Hard ───
  { name: 'Lagos',            nameZh: '拉各斯',       country: 'Nigeria',        countryZh: '尼日利亚', lat: 6.455,  lng: 3.406,   difficulty: 3 },
  { name: 'Kinshasa',         nameZh: '金沙萨',       country: 'DR Congo',       countryZh: '刚果(金)', lat: -4.325, lng: 15.310,  difficulty: 3 },
  { name: 'Luanda',           nameZh: '罗安达',       country: 'Angola',         countryZh: '安哥拉',  lat: -8.830,  lng: 13.234,  difficulty: 3 },
  { name: 'Khartoum',         nameZh: '喀土穆',       country: 'Sudan',          countryZh: '苏丹',    lat: 15.600,  lng: 32.530,  difficulty: 3 },
  { name: 'Accra',            nameZh: '阿克拉',       country: 'Ghana',          countryZh: '加纳',    lat: 5.550,   lng: -0.200,  difficulty: 3 },
  { name: 'Zanzibar',         nameZh: '桑给巴尔',     country: 'Tanzania',       countryZh: '坦桑尼亚', lat: -6.160, lng: 39.190,  difficulty: 3 },
  { name: 'Addis Ababa',      nameZh: '亚的斯亚贝巴', country: 'Ethiopia',       countryZh: '埃塞俄比亚', lat: 9.020, lng: 38.750,  difficulty: 3 },

  // ═══════════════════════════════════════════════════════════
  // OCEANIA
  // ═══════════════════════════════════════════════════════════

  // ─── Easy ───
  { name: 'Sydney',           nameZh: '悉尼',         country: 'Australia',      countryZh: '澳大利亚', lat: -33.857, lng: 151.215, difficulty: 1 },

  // ─── Medium ───
  { name: 'Melbourne',        nameZh: '墨尔本',       country: 'Australia',      countryZh: '澳大利亚', lat: -37.815, lng: 144.960, difficulty: 2 },
  { name: 'Auckland',         nameZh: '奥克兰',       country: 'New Zealand',    countryZh: '新西兰',  lat: -36.850, lng: 174.770, difficulty: 2 },
  { name: 'Honolulu',         nameZh: '檀香山',       country: 'United States',  countryZh: '美国',    lat: 21.280,  lng: -157.830, difficulty: 2 },
  { name: 'Perth',            nameZh: '珀斯',         country: 'Australia',      countryZh: '澳大利亚', lat: -31.950, lng: 115.860, difficulty: 2 },

  // ─── Hard ───
  { name: 'Wellington',       nameZh: '惠灵顿',       country: 'New Zealand',    countryZh: '新西兰',  lat: -41.290, lng: 174.778, difficulty: 3 },
  { name: 'Brisbane',         nameZh: '布里斯班',     country: 'Australia',      countryZh: '澳大利亚', lat: -27.470, lng: 153.025, difficulty: 3 },

  // ═══════════════════════════════════════════════════════════
  // LANDMARKS — non-city locations with distinctive satellite views
  // ═══════════════════════════════════════════════════════════

  { name: 'Pyramids of Giza',  nameZh: '吉萨金字塔',   country: 'Egypt',          countryZh: '埃及',     lat: 29.979,  lng: 31.134,  difficulty: 1 },
  { name: 'Grand Canyon',      nameZh: '大峡谷',       country: 'United States',  countryZh: '美国',     lat: 36.107,  lng: -112.113, difficulty: 1 },
  { name: 'Mount Fuji',        nameZh: '富士山',       country: 'Japan',          countryZh: '日本',     lat: 35.361,  lng: 138.727, difficulty: 1 },
  { name: 'Niagara Falls',     nameZh: '尼亚加拉瀑布', country: 'United States',  countryZh: '美国',     lat: 43.079,  lng: -79.075, difficulty: 1 },
  { name: 'Uluru',             nameZh: '乌鲁鲁',       country: 'Australia',      countryZh: '澳大利亚', lat: -25.344, lng: 131.037, difficulty: 1 },
  { name: 'Angkor Wat',        nameZh: '吴哥窟',       country: 'Cambodia',       countryZh: '柬埔寨',   lat: 13.413,  lng: 103.867, difficulty: 1 },
  { name: 'Machu Picchu',      nameZh: '马丘比丘',     country: 'Peru',           countryZh: '秘鲁',     lat: -13.163, lng: -72.545, difficulty: 1 },
  { name: 'Taj Mahal',         nameZh: '泰姬陵',       country: 'India',          countryZh: '印度',     lat: 27.175,  lng: 78.042,  difficulty: 1 },
  { name: 'Maldives',          nameZh: '马尔代夫',     country: 'Maldives',       countryZh: '马尔代夫', lat: 4.175,   lng: 73.509,  difficulty: 1 },
  { name: 'Eye of the Sahara', nameZh: '撒哈拉之眼',   country: 'Mauritania',     countryZh: '毛里塔尼亚', lat: 21.125, lng: -11.400, difficulty: 1 },
  { name: 'Great Wall',        nameZh: '长城',         country: 'China',          countryZh: '中国',     lat: 40.432,  lng: 116.570, difficulty: 2 },
  { name: 'Panama Canal',      nameZh: '巴拿马运河',   country: 'Panama',         countryZh: '巴拿马',   lat: 9.277,   lng: -79.922, difficulty: 2 },
  { name: 'Three Gorges Dam',  nameZh: '三峡大坝',     country: 'China',          countryZh: '中国',     lat: 30.823,  lng: 111.004, difficulty: 2 },
  { name: 'Hoover Dam',        nameZh: '胡佛大坝',     country: 'United States',  countryZh: '美国',     lat: 36.016,  lng: -114.738, difficulty: 2 },
  { name: 'Victoria Falls',    nameZh: '维多利亚瀑布', country: 'Zambia',         countryZh: '赞比亚',   lat: -17.924, lng: 25.857,  difficulty: 2 },
  { name: 'Mount Everest',     nameZh: '珠穆朗玛峰',   country: 'Nepal',          countryZh: '尼泊尔',   lat: 27.988,  lng: 86.925,  difficulty: 2 },
  { name: 'Easter Island',     nameZh: '复活节岛',     country: 'Chile',          countryZh: '智利',     lat: -27.125, lng: -109.350, difficulty: 2 },
  { name: 'Gibraltar',         nameZh: '直布罗陀',     country: 'United Kingdom', countryZh: '英国',     lat: 36.140,  lng: -5.345,  difficulty: 2 },
];

export default GEO_DATABASE;
