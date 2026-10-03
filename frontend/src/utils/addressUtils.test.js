import { describe, it, expect } from "vitest";
import { formatAddress } from "./addressUtils";

describe("localized country suffix", () => {
  it("changes country language without guessing or altering the locality", () => {
    const loc = {
      formatted_address: "Unnamed Road, Paia, 萨摩亚",
      country: "萨摩亚",
      country_code: "WS",
    };
    expect(formatAddress(loc, "en")).toBe("Paia, Samoa");
    expect(formatAddress(loc, "zh")).toBe("Paia, 萨摩亚");
    expect(formatAddress({ ...loc, country_code: undefined }, "en")).toBe(
      "Paia, 萨摩亚",
    );
  });
});

describe("unnamed roads", () => {
  it("drops Google's Unnamed Road prefix in any case and separator", () => {
    expect(
      formatAddress({
        formatted_address: "unnamed road，東埔村信義鄉南投縣台湾 556",
      }),
    ).toBe("東埔村信義鄉南投縣台湾 556");
    expect(
      formatAddress({ formatted_address: "Mae Salit Road, Tak, Thailand" }),
    ).toBe("Mae Salit Road, Tak, Thailand");
  });

  it("falls back to city and country when the road was all there was", () => {
    expect(
      formatAddress(
        {
          formatted_address: "Unnamed Road",
          city: "Tak",
          country: "Thailand",
          latitude: 1,
          longitude: 2,
        },
        "en",
      ),
    ).toBe("Tak, Thailand");
  });
});

describe("plus codes", () => {
  it("keeps the place after a leading plus code", () => {
    expect(
      formatAddress({
        formatted_address:
          "WW5C+WH, Ulu Mahuam, Silangkitang, North Sumatra 21461, Indonesia",
      }),
    ).toBe("Ulu Mahuam, Silangkitang, North Sumatra, Indonesia");
    expect(
      formatAddress({ formatted_address: "WW5C+WH 印度尼西亚北苏门答腊省" }),
    ).toBe("印度尼西亚北苏门答腊省");
    expect(
      formatAddress({
        formatted_address: "Unnamed Road, WW5C+WH, Tak, Thailand",
      }),
    ).toBe("Tak, Thailand");
  });

  it("falls back to city and country when only a plus code is left", () => {
    expect(
      formatAddress(
        {
          formatted_address: "WW5C+WH",
          country: "Indonesia",
          latitude: 1,
          longitude: 2,
        },
        "en",
      ),
    ).toBe("Indonesia");
  });
});

describe("postal codes and the country suffix", () => {
  it("drops postal codes and separates a Chinese country name from Latin text", () => {
    const brazil = {
      formatted_address: "BR-101, Iguape - SP, 11920-000巴西",
      country: "巴西",
      country_code: "BR",
    };
    expect(formatAddress(brazil, "zh")).toBe("BR-101, Iguape - SP, 巴西");
    expect(formatAddress(brazil, "en")).toBe("BR-101, Iguape - SP, Brazil");
    expect(
      formatAddress(
        {
          formatted_address:
            "Jebba - Mokwa Rd, Gbajibo/Muwo 913104, Niger, Nigeria",
          country: "Nigeria",
          country_code: "NG",
        },
        "en",
      ),
    ).toBe("Jebba - Mokwa Rd, Gbajibo/Muwo, Niger, Nigeria");
  });

  it("drops the Spanish unnamed road and separates a country after an abbreviation", () => {
    expect(
      formatAddress(
        {
          formatted_address: "Vía Sin Nombre, 33155 Chih.墨西哥",
          country: "墨西哥",
          country_code: "MX",
        },
        "zh",
      ),
    ).toBe("Chih., 墨西哥");
    expect(
      formatAddress({
        formatted_address: "Calle sin nombre, Santa Cruz, Bolivia",
      }),
    ).toBe("Santa Cruz, Bolivia");
  });

  it("keeps house numbers and addresses written without commas", () => {
    expect(
      formatAddress({
        formatted_address:
          "1600 Amphitheatre Pkwy, Mountain View, CA 94043, USA",
      }),
    ).toBe("1600 Amphitheatre Pkwy, Mountain View, CA, USA");
    expect(formatAddress({ formatted_address: "10115 Berlin, Germany" })).toBe(
      "10115 Berlin, Germany",
    );
    expect(
      formatAddress({ formatted_address: "日本〒100-0001 东京都千代田区" }),
    ).toBe("日本〒100-0001 东京都千代田区");
  });

  it("shows only the country when nothing else is left", () => {
    expect(
      formatAddress(
        { formatted_address: "萨摩亚", country: "萨摩亚", country_code: "WS" },
        "en",
      ),
    ).toBe("Samoa");
  });
});
