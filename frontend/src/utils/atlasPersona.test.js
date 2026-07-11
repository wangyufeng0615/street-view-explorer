import { describe, expect, it } from "vitest";
import { buildAtlasVoiceInstructions, formatAtlasLocation } from "./atlasPersona";

describe("buildAtlasVoiceInstructions", () => {
  it("uses the last known location while a new location is loading", () => {
    const instructions = buildAtlasVoiceInstructions("zh", {
      location: null,
      currentLocationRef: {
        formatted_address: "Cromwell, New Zealand",
        latitude: -45.0384,
        longitude: 169.2001,
        pano_id: "last-pano",
      },
      heading: 32,
      description: "",
    });

    expect(instructions).toContain("Cromwell, New Zealand");
    expect(instructions).not.toContain("Current place: not loaded yet");
  });

  it("requires movement language to be backed by a tool call", () => {
    const instructions = buildAtlasVoiceInstructions("zh", {
      location: null,
      currentLocationRef: null,
      heading: 0,
      description: "",
    });

    expect(instructions).toContain("必须同时调用对应工具");
    expect(instructions).toContain("不要只用嘴承诺行动");
  });

  it("keeps voice replies conversational without forcing one-line arrivals", () => {
    const instructions = buildAtlasVoiceInstructions("zh", {
      location: null,
      currentLocationRef: null,
      heading: 0,
      description: "",
    });

    expect(instructions).toContain("默认 2-4 句");
    expect(instructions).toContain("80-160 个中文字");
    expect(instructions).toContain("历史或生活趣闻");
    expect(instructions).not.toContain("默认 1-2 句");
    expect(instructions).not.toContain("只用一句");
  });

  it("keeps Plus Codes out of the human-facing place label and instructions", () => {
    const location = {
      formatted_address: "8G5Q7QGF+9X",
      city: "Majdal Shams",
      latitude: 33.27597,
      longitude: 35.77493,
    };
    const instructions = buildAtlasVoiceInstructions("zh", {
      location,
      heading: 0,
      description: "",
    });

    expect(formatAtlasLocation(location)).toContain("Majdal Shams");
    expect(formatAtlasLocation(location)).not.toContain("8G5Q7QGF+9X");
    expect(instructions).toContain("街景图片");
    expect(instructions).toContain("直接从现场说话");
    expect(instructions).toContain("除非用户明确询问，否则绝不提及");
    expect(instructions).not.toContain("8G5Q7QGF+9X");
  });
});
