import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiDescription from "./AiDescription";
import { streamLocationDetailedDescription } from "../services/api";

vi.mock("../services/api", () => ({
  streamLocationDetailedDescription: vi.fn(),
}));

const translations = {
  "ai.thinkingTitle": "Atlas 正在观察…",
  "ai.waitingForAnalysis": "Atlas 旅行中…",
  "ai.loadingDetailedDescription": "Atlas 正在深入了解…",
  "ai.tellMeMore": "Atlas，再多讲讲",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => translations[key] || key,
    i18n: { language: "zh", resolvedLanguage: "zh" },
  }),
}));

describe("AiDescription thinking states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders an accessible, prominent status while the first description loads", () => {
    render(
      <AiDescription
        isLoading
        error={null}
        description={null}
        citations={null}
        retries={0}
        panoId="pano-loading"
        onRetry={vi.fn()}
      />,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveAccessibleName("Atlas 正在观察…");
    expect(screen.getByText("Atlas 正在观察…")).toBeInTheDocument();
  });

  it("uses the same thinking language for a pending deep description", async () => {
    streamLocationDetailedDescription.mockImplementation(
      () => new Promise(() => {}),
    );
    render(
      <AiDescription
        isLoading={false}
        error={null}
        description="眼前是一条山路。"
        citations={null}
        retries={0}
        panoId="pano-detailed"
        onRetry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Atlas，再多讲讲" }));

    expect(await screen.findByText("Atlas 正在深入了解…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "Atlas 正在深入了解…",
    );
  });

  it("reveals streamed prose while the first description is still loading", () => {
    render(
      <AiDescription
        isLoading
        error={null}
        description="Atlas 已经开始写这封来信。"
        citations={null}
        retries={0}
        panoId="pano-streaming"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Atlas 已经开始写这封来信。")).toBeInTheDocument();
    expect(screen.queryByText("Atlas 正在观察…")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Atlas，再多讲讲" }),
    ).not.toBeInTheDocument();
  });
});
