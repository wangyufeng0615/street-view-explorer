import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CoverOverlay from "./CoverOverlay";

const mocks = vi.hoisted(() => ({ language: "zh" }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) =>
      ({
        site_tagline:
          mocks.language === "zh"
            ? "和 Atlas 一起探索地球"
            : "Explore the Earth with Atlas",
        "cover.cta": "跟 Atlas 出发",
      })[key] || key,
    i18n: { language: mocks.language, resolvedLanguage: mocks.language },
  }),
}));

const place = {
  id: "namib",
  zh: "纳米布沙海",
  en: "Namib Sand Sea, Namibia",
  lat: -24.08,
  lng: 15.55,
  posMobile: "12% 50%",
};

function renderCover() {
  const onClose = vi.fn();
  render(<CoverOverlay place={place} onClose={onClose} />);
  return { onClose };
}

describe("CoverOverlay", () => {
  beforeEach(() => {
    mocks.language = "zh";
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the title, one button, the coordinates and the imagery credit", () => {
    renderCover();

    const title = screen.getByRole("heading");
    expect(title).toHaveTextContent("和 Atlas 一起探索地球");
    // 中文标题在 Atlas 后分成两段，手机上各占一行
    expect(title.querySelectorAll(".cover__line")).toHaveLength(2);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("24.08°S 15.55°E")).toBeInTheDocument();
    expect(screen.getByText("cover.credit")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "纳米布沙海" })).toBeInTheDocument();
  });

  it("keeps the English title on one line", () => {
    mocks.language = "en";
    renderCover();

    const title = screen.getByRole("heading");
    expect(title).toHaveTextContent("Explore the Earth with Atlas");
    expect(title.querySelectorAll(".cover__line")).toHaveLength(1);
    expect(
      screen.getByRole("img", { name: "Namib Sand Sea, Namibia" }),
    ).toBeInTheDocument();
  });

  it("fades out and hands over to street view when the button is pressed", async () => {
    const { onClose } = renderCover();

    fireEvent.click(screen.getByRole("button", { name: /跟 Atlas 出发/ }));

    expect(screen.getByRole("dialog")).toHaveClass("cover--leaving");
    expect(sessionStorage.getItem("atlasCoverSeen")).toBe("1");
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("closes with Space or Escape", async () => {
    const { onClose } = renderCover();

    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });
    fireEvent.keyDown(document.body, { key: " ", code: "Space" });

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("does not leave on its own", async () => {
    const { onClose } = renderCover();

    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).not.toHaveClass("cover--leaving");
  });
});
