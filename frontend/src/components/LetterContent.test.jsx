import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LetterContent from "./LetterContent";

const stopImageMap = {
  1: "/api/v1/agent/streetview?pano_id=allowed-pano&heading=90&token=secret",
};

describe("LetterContent", () => {
  it("renders hostile image alt text without creating executable attributes", () => {
    render(
      <LetterContent
        text={'![x" onerror="globalThis.__atlasXss=1](stop_1)'}
        stopImageMap={stopImageMap}
        journeyId="journey-1"
      />,
    );

    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("alt", 'x" onerror="globalThis.__atlasXss=1');
    expect(image).not.toHaveAttribute("onerror");
    expect(image.getAttribute("src")).not.toContain("token=");
    expect(image.getAttribute("src")).toContain("journey_id=journey-1");
  });

  it("rejects images that do not belong to a recorded journey stop", () => {
    const { container } = render(
      <LetterContent
        text="![Other](/api/v1/agent/streetview?pano_id=not-allowed)"
        stopImageMap={stopImageMap}
        journeyId="journey-1"
      />,
    );

    expect(container.querySelector("img")).toBeNull();
  });

  it("preserves the supported heading and bold subset", () => {
    render(
      <LetterContent
        text={"# Arrival\nA **bright** afternoon."}
        stopImageMap={stopImageMap}
        journeyId="journey-1"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Arrival" }),
    ).toBeInTheDocument();
    expect(screen.getByText("bright").tagName).toBe("STRONG");
  });
});
