// 地址开头这两种前缀没有信息量：Google 给无名道路填的 "Unnamed Road"（西语地区是
// "Vía/Calle/Camino Sin Nombre"），以及没有门牌时生成的 Plus Code（如 "WW5C+WH"）。
// 只去掉开头这一段，后面的地名照常显示
const NOISE_PREFIXES = [
  /^unnamed road\s*(?:[,，、]\s*|$)/i,
  /^(?:v[ií]a|calle|camino|carretera)\s+sin\s+nombre\s*(?:[,，、]\s*|$)/i,
  /^[23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3}(?:\s*[,，、]\s*|\s+|$)/i,
];

function stripNoisePrefixes(address) {
  let current = address.trim();
  let previous;
  do {
    previous = current;
    for (const prefix of NOISE_PREFIXES) current = current.replace(prefix, "");
  } while (current !== previous);
  return current;
}

// 邮编对读者没有意义。逗号分段的地址里，除第一段（门牌和路名）外，去掉每段开头或结尾的
// 纯数字邮编，如 "11920-000"、"Gbajibo/Muwo 913104"、"CA 94043"、"10115 Berlin"，
// 以及日本的 "105-0011"。邮编前面必须是空格或段首，不会只削掉一半留下 "105-"。
// 不用逗号分段的中日韩地址不动，避免误删门牌号
const POSTAL_CODE = String.raw`(?:\d{3}-\d{4}|\d{4,6}(?:-\d{3,4})?)`;
const POSTAL_AT_END = new RegExp(String.raw`(?:^|\s+)${POSTAL_CODE}$`);
const POSTAL_AT_START = new RegExp(String.raw`^${POSTAL_CODE}\s+`);

// Google 的中文地址把邮编写成文字标签接在最后："…未命名的道路邮政编码: 64945-000"，
// 有时只剩 "邮政编码:"。中文地址从大到小写，无名道路也排在最后
const CJK_POSTAL_LABEL = /\s*(?:邮政编码|郵遞區號|邮编)\s*[:：]?\s*[\d-]*\s*$/;
const CJK_UNNAMED_ROAD = /(?:\s*[,，、]\s*|\s*)未命名的?道路$/;

function stripPostalCodes(address) {
  const segments = address.split(/\s*,\s*/);
  if (segments.length < 2) return address;
  const rest = segments
    .slice(1)
    .map((segment) =>
      segment.replace(POSTAL_AT_END, "").replace(POSTAL_AT_START, "").trim(),
    );
  return [segments[0], ...rest].filter(Boolean).join(", ");
}

export const formatAddress = (location, language) => {
  if (!location) return "";
  let country = location.country;
  if (language && /^[A-Za-z]{2}$/.test(location.country_code || "")) {
    try {
      country = new Intl.DisplayNames([language], { type: "region" }).of(
        location.country_code.toUpperCase(),
      );
    } catch {
      /* Keep original if locale unsupported. */
    }
  }

  if (location.formatted_address) {
    let address = location.formatted_address.trim();
    // Only replace the known country suffix; never translate a place by guessing.
    let suffix = "";
    if (location.country && address.endsWith(location.country)) {
      address = address
        .slice(0, -location.country.length)
        .replace(/[\s,，、]+$/, "");
      suffix = country || location.country;
    }
    // 中文地址有时把国家写在最前面（"巴西 Piauí, …"、"巴西马拉尼昂州…"）：
    // 同样只换已知的国家名，原来有空格就留空格，紧挨着就继续紧挨着
    let prefix = "";
    let prefixSeparator = "";
    if (!suffix && location.country && address.startsWith(location.country)) {
      const rest = address.slice(location.country.length);
      prefixSeparator = /^[\s,，、]/.test(rest) ? " " : "";
      address = rest.replace(/^[\s,，、]+/, "");
      prefix = country || location.country;
    }
    // 先去中文的邮编标签和末尾的无名路，再按原始分段去邮编（第一段是门牌和路名），
    // 最后去开头的无名路；反过来的话，去掉无名路后邮编所在的那段会变成第一段而被保留
    address = address.replace(CJK_POSTAL_LABEL, "");
    address = stripPostalCodes(address).replace(CJK_UNNAMED_ROAD, "");
    address = stripNoisePrefixes(address);
    if (prefix) return address ? prefix + prefixSeparator + address : prefix;
    if (suffix) {
      if (!address) return suffix;
      // Google 的中文地址把国家名直接接在最后一个字后面（"11920-000巴西"）；拉丁字母结尾时补上逗号
      const separator = /[A-Za-z0-9.)\]\u00C0-\u024F]$/.test(address)
        ? ", "
        : "";
      return address + separator + suffix;
    }
    if (address) return address;
  }

  // 如果没有 formatted_address，尝试组合其他地址信息
  const parts = [];
  if (location.city) parts.push(location.city);
  if (country) parts.push(country);

  // 如果连城市和国家都没有，显示坐标
  if (parts.length === 0) {
    return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
  }

  return parts.join(", ");
};
