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
// 纯数字邮编，如 "11920-000"、"Gbajibo/Muwo 913104"、"CA 94043"、"10115 Berlin"。
// 不用逗号分段的中日韩地址不动，避免误删门牌号
const POSTAL_AT_END = /\s*\b\d{4,6}(?:-\d{3,4})?$/;
const POSTAL_AT_START = /^\d{4,6}(?:-\d{3,4})?\s+/;

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
    // 先按原始分段去邮编（第一段是门牌和路名），再去无名路前缀；
    // 反过来的话，去掉无名路后邮编所在的那段会变成第一段而被保留
    address = stripNoisePrefixes(stripPostalCodes(address));
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
