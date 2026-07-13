import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/session", () => ({
  getOrCreateSessionId: () => "test-session",
}));

vi.mock("../i18n", () => ({
  default: { language: "zh", resolvedLanguage: "zh" },
}));

import { getVisitHistory, streamLocationDescription } from "./api";

function streamingResponse(chunks) {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk));
  let index = 0;
  return {
    ok: true,
    headers: { get: () => "text/event-stream; charset=utf-8" },
    body: {
      getReader: () => ({
        read: async () =>
          index < encoded.length
            ? { value: encoded[index++], done: false }
            : { value: undefined, done: true },
      }),
    },
  };
}

describe("description SSE client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards deltas and resolves with the sanitized final payload", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        streamingResponse([
          'event: status\ndata: {"phase":"researching"}\n\n',
          'event: delta\ndata: {"text":"第一段"}\n\nevent: del',
          'ta\r\ndata: {"text":"第二段"}\r\n\r\nevent: done\ndata: {"description":"第一段第二段","citations":[]}\n\n',
        ]),
      );
    const deltas = [];

    const result = await streamLocationDescription(
      "pano-1",
      "zh",
      null,
      { heading: 90, pitch: 0, fov: 80 },
      (delta) => deltas.push(delta),
    );

    expect(result.success).toBe(true);
    expect(result.data.description).toBe("第一段第二段");
    expect(deltas).toEqual(["第一段第二段"]);
    expect(fetchMock.mock.calls[0][0]).toContain("stream=1");
    expect(fetchMock.mock.calls[0][0]).toContain("heading=90");
  });

  it("fails closed when the server rejects the researched response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamingResponse([
        'event: delta\ndata: {"text":"未验证的文字"}\n\n',
        'event: error\ndata: {"error":"AI 未执行要求的资料搜索"}\n\n',
      ]),
    );

    const onDelta = vi.fn();
    const result = await streamLocationDescription(
      "pano-2",
      "zh",
      null,
      null,
      onDelta,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("未执行要求的资料搜索");
    expect(onDelta).not.toHaveBeenCalled();
  });
});

describe("visit history client", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests only random visits for Atlas footprints", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      json: async () => ({
        success: true,
        data: { visits: [], total_visits: 0, unique_places: 0 },
      }),
    });

    const result = await getVisitHistory(5000, 0, "random");

    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/api/v1/visits?limit=5000&offset=0&source=random",
    );
  });
});
