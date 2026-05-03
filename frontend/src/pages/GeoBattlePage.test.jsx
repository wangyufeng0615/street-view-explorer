import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import React from "react";

const neverSettles = () => new Promise(() => {});

const mocks = vi.hoisted(() => {
  const navigate = vi.fn();
  const mapConstructor = vi.fn(function Map() {
    this.addListener = vi.fn();
    this.setCenter = vi.fn();
    this.setZoom = vi.fn();
    this.fitBounds = vi.fn();
  });

  return {
    navigate,
    roomResolver: null,
    maps: {
      Map: mapConstructor,
      Marker: vi.fn(function Marker() {
        this.setMap = vi.fn();
        this.setPosition = vi.fn();
      }),
      Polyline: vi.fn(function Polyline() {
        this.setMap = vi.fn();
      }),
      LatLngBounds: vi.fn(function LatLngBounds() {
        this.extend = vi.fn();
      }),
      SymbolPath: { CIRCLE: "circle" },
      event: {
        addListenerOnce: vi.fn((map, event, handler) => handler()),
        clearInstanceListeners: vi.fn(),
        trigger: vi.fn(),
      },
    },
  };
});

vi.mock("../utils/googleMaps", () => ({
  loadGoogleMapsScript: vi.fn(() => Promise.resolve(mocks.maps)),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ roomId: "room-1" }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key) => key,
    i18n: {
      language: "en",
      resolvedLanguage: "en",
      changeLanguage: vi.fn(() => Promise.resolve()),
    },
  }),
}));

vi.mock("../services/api", () => ({
  getGeoBattleRoom: vi.fn(
    () => new Promise((resolve) => {
      mocks.roomResolver = resolve;
    }),
  ),
  fetchGeoBattleImage: vi.fn(() => neverSettles()),
  cancelGeoBattleMatchmaking: vi.fn(),
  createGeoBattleRoom: vi.fn(),
  joinGeoBattleMatchmaking: vi.fn(),
  joinGeoBattleRoom: vi.fn(),
  leaveGeoBattleRoom: vi.fn(),
  setGeoBattleReady: vi.fn(),
  submitGeoBattleGuess: vi.fn(),
  zoomOutGeoBattle: vi.fn(),
  getGeoBattleMatchmakingStatus: vi.fn(),
}));

import GeoBattlePage from "./GeoBattlePage";
import { loadGoogleMapsScript } from "../utils/googleMaps";

function makeRoom() {
  return {
    room_id: "room-1",
    room_code: "ABC123",
    mode: "private",
    phase: "playing",
    message: "",
    can_ready: false,
    can_submit_guess: true,
    can_zoom_out: true,
    me: {
      nickname: "Me",
      total_score: 0,
      is_online: true,
      is_ready: false,
      has_submitted_this_round: false,
    },
    opponent: {
      nickname: "Opponent",
      total_score: 0,
      is_online: true,
      is_ready: false,
      has_submitted_this_round: false,
    },
    round: {
      index: 1,
      total: 5,
      current_zoom: 14,
      zoom_steps: 0,
      opponent_locked: false,
    },
  };
}

describe("GeoBattlePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.roomResolver = null;
  });

  it("initializes the guess map after the room renders when Maps loads first", async () => {
    render(<GeoBattlePage />);

    await waitFor(() => expect(loadGoogleMapsScript).toHaveBeenCalled());
    await act(async () => {});
    expect(mocks.maps.Map).not.toHaveBeenCalled();

    await act(async () => {
      mocks.roomResolver({ success: true, data: { room: makeRoom() } });
    });

    await waitFor(() => expect(mocks.maps.Map).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText("geo_online.place_guess").length).toBeGreaterThan(0);
  });
});
