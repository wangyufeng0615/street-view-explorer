import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const neverSettles = () => new Promise(() => {});
const navigate = vi.fn();

vi.mock("../utils/googleMaps", () => ({
  loadGoogleMapsScript: vi.fn(() => neverSettles()),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: "en" } }),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

vi.mock("../services/api", () => ({
  getRandomLocation: vi.fn(() => neverSettles()),
}));

global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ success: false }),
});

import GeoGamePage from "./GeoGamePage";

describe("GeoGamePage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders welcome modal", () => {
    render(<GeoGamePage />);
    expect(screen.getByText("geo.title")).toBeInTheDocument();
    expect(screen.getByText("geo.start_atlas")).toBeInTheDocument();
    expect(screen.getByText("geo.invite_friend_online")).toBeInTheDocument();
  });

  it("shows the concise intro", () => {
    render(<GeoGamePage />);
    expect(screen.getByText("geo.subtitle")).toBeInTheDocument();
    expect(screen.queryByText("geo.welcome_rule_1")).not.toBeInTheDocument();
    expect(screen.queryByText("geo.welcome_rule_2")).not.toBeInTheDocument();
  });

  it("invites friends online", () => {
    render(<GeoGamePage />);
    fireEvent.click(screen.getByText("geo.invite_friend_online"));
    expect(navigate).toHaveBeenCalledWith("/geo/online");
  });

  it("starts an Atlas game", () => {
    render(<GeoGamePage />);
    fireEvent.click(screen.getByText("geo.start_atlas"));
    expect(screen.queryByText("geo.start_atlas")).not.toBeInTheDocument();
  });
});
