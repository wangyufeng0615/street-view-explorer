import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AiDescription from "./AiDescription";
import { streamLocationDetailedDescription } from "../services/api";

vi.mock("../services/api", () => ({
  streamLocationDetailedDescription: vi.fn(),
}));

const translations = {
  "ai.thinkingTitle": "Atlas 正翻着地图…",
  "ai.waitingForAnalysis": "Atlas 旅行中…",
  "ai.loadingDetailedDescription": "我再往深处找找…",
  "ai.tellMeMore": "Atlas，再多讲讲",
};

const languageState = vi.hoisted(() => ({ current: "zh" }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => translations[key] || key,
    i18n: {
      language: languageState.current,
      resolvedLanguage: languageState.current,
    },
  }),
}));

describe("AiDescription thinking states", () => {
  it('does not announce failure while coordinates are still resolving and there is no pano yet', () => {
    render(<AiDescription isLoading description={null} panoId={null} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('ai.cannotGetStreetView')).not.toBeInTheDocument();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    languageState.current = "zh";
  });

  it('discloses missing research confirmation after generation', () => {
    const { rerender } = render(<AiDescription isLoading={false} description="眼前是一条山路。" panoId="pano" researchStatus="unverified" />);
    expect(screen.getByRole('note')).toHaveTextContent('本次检索状态未获上游确认');
    rerender(<AiDescription isLoading={false} description="眼前是一条山路。" panoId="pano" researchStatus="verified" />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
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
    expect(status).toHaveAccessibleName("Atlas 正翻着地图…");
    expect(screen.getAllByText("Atlas 正翻着地图…")).toHaveLength(1);
    expect(status).not.toHaveTextContent("Atlas 正翻着地图…");
  });

  it("uses first-person language for a pending deep description", async () => {
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

    expect(await screen.findByText("我再往深处找找…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAccessibleName(
      "我再往深处找找…",
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
    expect(screen.queryByText("Atlas 正翻着地图…")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Atlas，再多讲讲" }),
    ).not.toBeInTheDocument();
  });

  it("aborts and clears a detailed response when the UI language changes", async () => {
    let receivedSignal;
    streamLocationDetailedDescription.mockImplementation(
      (_panoId, _language, signal) => {
        receivedSignal = signal;
        return new Promise(() => {});
      },
    );
    const props = {
      isLoading: false,
      error: null,
      description: "眼前是一条山路。",
      citations: null,
      retries: 0,
      panoId: "pano-language",
      onRetry: vi.fn(),
    };
    const { rerender } = render(<AiDescription {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Atlas，再多讲讲" }));
    expect(await screen.findByText("我再往深处找找…")).toBeInTheDocument();

    languageState.current = "en";
    rerender(<AiDescription {...props} description="A mountain road." />);

    await waitFor(() => expect(receivedSignal.aborted).toBe(true));
    expect(screen.queryByText("我再往深处找找…")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Atlas，再多讲讲" }),
    ).toBeInTheDocument();
  });
});
