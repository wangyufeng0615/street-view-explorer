import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
} from "@testing-library/react";
import React from "react";

const neverSettles = () => new Promise(() => {});

const mocks = vi.hoisted(() => {
  const navigate = vi.fn();
  const markerInstances = [];
  const mockState = {
    navigate,
    roomResolver: null,
    mapClickHandler: null,
    markerInstances,
  };
  const mapConstructor = vi.fn(function Map() {
    this.addListener = vi.fn((event, handler) => {
      if (event === "click") {
        mockState.mapClickHandler = handler;
      }
    });
    this.setCenter = vi.fn();
    this.setZoom = vi.fn();
    this.fitBounds = vi.fn();
  });

  mockState.maps = {
    Map: mapConstructor,
    Marker: vi.fn(function Marker() {
      this.setMap = vi.fn();
      this.setPosition = vi.fn();
      markerInstances.push(this);
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
  };
  return mockState;
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
    () =>
      new Promise((resolve) => {
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
import { fetchGeoBattleImage, zoomOutGeoBattle } from "../services/api";

Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  value: vi.fn(),
});

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

function withSnapshotTime(room, seconds) {
  const suffix = String(seconds).padStart(2, "0");
  return {
    ...room,
    server_time: `2026-05-07T00:00:${suffix}Z`,
    updated_at: `2026-05-07T00:00:${suffix}Z`,
  };
}

describe("GeoBattlePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.roomResolver = null;
    mocks.mapClickHandler = null;
    mocks.markerInstances.length = 0;
    vi.mocked(fetchGeoBattleImage).mockImplementation(() => neverSettles());
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
    expect(
      screen.getAllByText("geo_online.place_guess").length,
    ).toBeGreaterThan(0);
  });

  it("keeps the current satellite image visible while a zoom-out image refreshes", async () => {
    vi.mocked(fetchGeoBattleImage)
      .mockResolvedValueOnce("blob:round-1-zoom-14")
      .mockImplementationOnce(() => neverSettles());

    const zoomedRoom = makeRoom();
    zoomedRoom.round = {
      ...zoomedRoom.round,
      current_zoom: 13,
      zoom_steps: 1,
    };
    vi.mocked(zoomOutGeoBattle).mockResolvedValue({
      success: true,
      data: { room: zoomedRoom },
    });

    render(<GeoBattlePage />);

    await act(async () => {
      mocks.roomResolver({ success: true, data: { room: makeRoom() } });
    });

    await waitFor(() => {
      expect(
        document
          .querySelector(".geo-battle-satellite-img")
          ?.getAttribute("src"),
      ).toBe("blob:round-1-zoom-14");
    });

    fireEvent.click(screen.getByText("geo_online.zoom_out"));

    await waitFor(() => expect(zoomOutGeoBattle).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchGeoBattleImage).toHaveBeenCalledTimes(2));

    expect(
      screen.queryByText("geo_online.loading_image"),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector(".geo-battle-satellite-img")?.getAttribute("src"),
    ).toBe("blob:round-1-zoom-14");
    expect(screen.getByText("geo_online.zoom_out")).toBeDisabled();
    expect(screen.getByText("geo_online.skip_round")).toBeEnabled();
  });

  it("does not request or show the satellite image during countdown", async () => {
    const countdownRoom = {
      ...makeRoom(),
      phase: "countdown",
      can_zoom_out: false,
      can_submit_guess: false,
    };

    render(<GeoBattlePage />);

    await act(async () => {
      mocks.roomResolver({ success: true, data: { room: countdownRoom } });
    });

    expect(screen.getByText("geo_online.waiting_image")).toBeInTheDocument();
    expect(fetchGeoBattleImage).not.toHaveBeenCalled();
    expect(
      document.querySelector(".geo-battle-satellite-img"),
    ).not.toBeInTheDocument();
  });

  it("keeps player and opponent identity colors consistent across status and reveal UI", async () => {
    const revealRoom = {
      ...makeRoom(),
      phase: "reveal",
      can_submit_guess: false,
      can_zoom_out: false,
      round: {
        ...makeRoom().round,
        target: {
          lat: 10,
          lng: 20,
          location: { city: "Target City", country: "Target Country" },
        },
        my_guess: {
          lat: 10.2,
          lng: 20.2,
          score: 4200,
          distance_km: 31,
          zoom_steps: 1,
        },
        opponent_guess: {
          lat: 11,
          lng: 21,
          score: 2500,
          distance_km: 150,
          zoom_steps: 2,
        },
      },
    };

    render(<GeoBattlePage />);

    await act(async () => {
      mocks.roomResolver({ success: true, data: { room: revealRoom } });
    });

    expect(
      document.querySelector(".geo-battle-player-card--player"),
    ).toBeInTheDocument();
    expect(
      document.querySelector(".geo-battle-player-card--opponent"),
    ).toBeInTheDocument();
    expect(
      document.querySelector(".geo-battle-guess-stat--player"),
    ).toBeInTheDocument();
    expect(
      document.querySelector(".geo-battle-guess-stat--opponent"),
    ).toBeInTheDocument();
    expect(
      document.querySelector(".geo-battle-round-outcome--you"),
    ).toBeInTheDocument();
  });

  it("shows sound controls and a placement feedback bubble in the room", async () => {
    vi.mocked(fetchGeoBattleImage).mockResolvedValue("blob:round-1-zoom-14");
    render(<GeoBattlePage />);

    await act(async () => {
      mocks.roomResolver({ success: true, data: { room: makeRoom() } });
    });
    await waitFor(() => expect(mocks.mapClickHandler).toBeTruthy());

    expect(
      screen.getByRole("button", { name: "geo.feedback_sound_on" }),
    ).toBeInTheDocument();

    await act(async () => {
      mocks.mapClickHandler({
        latLng: {
          lat: () => 12.34,
          lng: () => 56.78,
        },
      });
    });

    expect(
      screen.getByText("geo_online.feedback_pin_placed"),
    ).toBeInTheDocument();
  });

  it("keeps the selected map pin across polling updates in the same playing round", async () => {
    vi.mocked(fetchGeoBattleImage).mockResolvedValue("blob:round-1-zoom-14");
    render(<GeoBattlePage />);

    await act(async () => {
      mocks.roomResolver({ success: true, data: { room: makeRoom() } });
    });
    await waitFor(() => expect(mocks.mapClickHandler).toBeTruthy());

    await act(async () => {
      mocks.mapClickHandler({
        latLng: {
          lat: () => 12.34,
          lng: () => 56.78,
        },
      });
    });

    await waitFor(() => expect(mocks.maps.Marker).toHaveBeenCalledTimes(1));
    const marker = mocks.markerInstances[0];
    expect(marker.setMap).not.toHaveBeenCalled();
    const firstRoomResolver = mocks.roomResolver;

    await waitFor(
      () => expect(mocks.roomResolver).not.toBe(firstRoomResolver),
      {
        timeout: 2200,
      },
    );

    await act(async () => {
      mocks.roomResolver({
        success: true,
        data: { room: { ...makeRoom(), updated_at: "later" } },
      });
    });

    expect(marker.setMap).not.toHaveBeenCalled();
    expect(screen.getByText("geo_online.submit_guess")).toBeEnabled();
  });

  it("ignores older polling snapshots after a local zoom action advances the room", async () => {
    vi.mocked(fetchGeoBattleImage)
      .mockResolvedValueOnce("blob:round-1-zoom-14")
      .mockResolvedValueOnce("blob:round-1-zoom-13");

    const zoomedRoom = withSnapshotTime(makeRoom(), 3);
    zoomedRoom.round = {
      ...zoomedRoom.round,
      current_zoom: 13,
      zoom_steps: 1,
    };
    vi.mocked(zoomOutGeoBattle).mockResolvedValue({
      success: true,
      data: { room: zoomedRoom },
    });

    render(<GeoBattlePage />);

    await act(async () => {
      mocks.roomResolver({
        success: true,
        data: { room: withSnapshotTime(makeRoom(), 1) },
      });
    });

    await waitFor(() => {
      expect(
        document
          .querySelector(".geo-battle-satellite-img")
          ?.getAttribute("src"),
      ).toBe("blob:round-1-zoom-14");
    });

    fireEvent.click(screen.getByText("geo_online.zoom_out"));
    await waitFor(() => expect(zoomOutGeoBattle).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchGeoBattleImage).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(
        document
          .querySelector(".geo-battle-satellite-img")
          ?.getAttribute("src"),
      ).toBe("blob:round-1-zoom-13");
    });

    const resolverBeforePoll = mocks.roomResolver;
    await waitFor(
      () => expect(mocks.roomResolver).not.toBe(resolverBeforePoll),
      {
        timeout: 2200,
      },
    );

    await act(async () => {
      mocks.roomResolver({
        success: true,
        data: { room: withSnapshotTime(makeRoom(), 2) },
      });
    });

    expect(fetchGeoBattleImage).toHaveBeenCalledTimes(2);
    expect(
      document.querySelector(".geo-battle-satellite-img")?.getAttribute("src"),
    ).toBe("blob:round-1-zoom-13");
  });
});
