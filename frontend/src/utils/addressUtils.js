import { isPlusCodeLabel } from "./atlasPersona";

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

  if (
    location.formatted_address &&
    !isPlusCodeLabel(location.formatted_address)
  ) {
    const address = location.formatted_address;
    // Only replace the known country suffix; never translate a place by guessing.
    if (country && location.country && address.endsWith(location.country)) {
      return address.slice(0, -location.country.length) + country;
    }
    return address;
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
