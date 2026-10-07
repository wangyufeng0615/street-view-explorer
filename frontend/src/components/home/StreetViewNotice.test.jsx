import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import StreetViewNotice from "./StreetViewNotice";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

describe("StreetViewNotice", () => {
  it("explains an unreachable Google with a retry", () => {
    render(<StreetViewNotice kind="unreachable" />);
    expect(screen.getByRole("alert").textContent).toContain(
      "home.streetview.unreachableBody",
    );
    expect(
      screen.getByRole("button", { name: "home.streetview.retry" }),
    ).toBeTruthy();
  });

  it("tells a rejected key apart", () => {
    render(<StreetViewNotice kind="unavailable" />);
    expect(screen.getByText("home.streetview.unavailableTitle")).toBeTruthy();
  });
});
