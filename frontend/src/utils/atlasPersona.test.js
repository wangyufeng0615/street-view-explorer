import { describe, expect, it } from "vitest";
import { buildAtlasVoiceInstructions } from "./atlasPersona";

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
});
