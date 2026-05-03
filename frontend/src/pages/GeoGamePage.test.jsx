import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import React from "react";

const neverSettles = () => new Promise(() => {});
const navigate = vi.fn();

vi.mock("../utils/googleMaps", () => ({
  loadGoogleMapsScript: vi.fn(() => neverSettles()),
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

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));

vi.mock("../services/api", () => ({
  getRandomLocation: vi.fn(() => neverSettles()),
}));

global.fetch = vi.fn().mockResolvedValue({
  json: () => Promise.resolve({ success: false }),
});

import GeoGamePage, { getGameOverAtlasMessage } from "./GeoGamePage";
import { loadGoogleMapsScript } from "../utils/googleMaps";
import { getRandomLocation } from "../services/api";

function makeSummaryT() {
  return (key, params = {}) => {
    const templates = {
      "geo.place_list_pair": `${params.first} and ${params.second}`,
      "geo.place_list_trio": `${params.first}, ${params.second}, and ${params.third}`,
      "geo.gameover_atlas_outcome_win": "win",
      "geo.gameover_atlas_outcome_lose": "lose",
      "geo.gameover_atlas_note_multi_hit": `multi:${params.perfectPlaceList}|best:${params.bestPlace}|score:${params.score}|${params.outcome}`,
      "geo.gameover_atlas_note_mixed_hit": `mixed:${params.perfectPlaceList}|second:${params.secondPlace}|rough:${params.roughPlace}|score:${params.score}|${params.outcome}`,
      "geo.gameover_atlas_note_good": `good:${params.placeList}|best:${params.bestPlace}|${params.outcome}`,
      "geo.gameover_atlas_note_rough": `rough:${params.placeList}|best:${params.bestPlace}|${params.outcome}`,
      "geo.gameover_atlas_note_giveup": `giveup:${params.score}|${params.outcome}`,
      "geo.plain_score_value": `${params.score} pts`,
      "geo.perfect_distance_short": "right area",
      "geo.unknown_place": "Unknown",
    };
    return templates[key] || key;
  };
}

function createMapsMock(onMapClickHandler) {
  return {
    Map: class {
      addListener(event, handler) {
        if (event === "click") onMapClickHandler(handler);
      }
      setCenter() {}
      setZoom() {}
      fitBounds() {}
    },
    Marker: class {
      setMap() {}
      setPosition() {}
    },
    Polyline: class {
      setMap() {}
    },
    LatLngBounds: class {
      extend() {}
      isEmpty() {
        return false;
      }
    },
    Point: class {
      constructor(x, y) {
        this.x = x;
        this.y = y;
      }
    },
    Size: class {
      constructor(width, height) {
        this.width = width;
        this.height = height;
      }
    },
    event: { trigger: vi.fn() },
  };
}

describe("GeoGamePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ success: false }),
    });
  });

  it("renders welcome modal", () => {
    render(<GeoGamePage />);
    expect(screen.getByText("geo.title")).toBeInTheDocument();
    expect(screen.getByText("geo.start_atlas")).toBeInTheDocument();
    expect(screen.getByText("geo.invite_friend_online")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "language" })).toBeInTheDocument();
    expect(document.querySelector(".geo-main")).not.toBeInTheDocument();
    expect(document.querySelector(".geo-map-container")).not.toBeInTheDocument();
  });

  it("shows the concise intro", () => {
    render(<GeoGamePage />);
    expect(screen.getByText("geo.subtitle")).toBeInTheDocument();
    expect(screen.queryByText("geo.welcome_rule_1")).not.toBeInTheDocument();
    expect(screen.queryByText("geo.welcome_rule_2")).not.toBeInTheDocument();
  });

  it("summarizes multiple strong rounds in Atlas's game-over note", () => {
    const t = makeSummaryT();
    const state = {
      aiEnabled: true,
      scores: [
        {
          playerScore: 4800,
          distance: 5,
          zoomSteps: 10,
          locationLabel: "London",
        },
        {
          playerScore: 4700,
          distance: 4,
          zoomSteps: 9,
          locationLabel: "Paris",
        },
        {
          playerScore: 1900,
          distance: 900,
          zoomSteps: 1,
          locationLabel: "Sahara",
        },
      ],
    };

    expect(getGameOverAtlasMessage(state, t, 11400, 9000)).toBe(
      "multi:Paris and London|best:Paris|score:11,400 pts|win",
    );
  });

  it("uses a mixed Atlas note when only one round hits the right area", () => {
    const t = makeSummaryT();
    const state = {
      aiEnabled: true,
      scores: [
        {
          playerScore: 4500,
          distance: 8,
          zoomSteps: 8,
          locationLabel: "London",
        },
        {
          playerScore: 3100,
          distance: 160,
          zoomSteps: 3,
          locationLabel: "Reykjavik",
        },
        {
          playerScore: 900,
          distance: 1600,
          zoomSteps: 0,
          locationLabel: "Patagonia",
        },
      ],
    };

    expect(getGameOverAtlasMessage(state, t, 8500, 9200)).toBe(
      "mixed:London|second:Reykjavik|rough:Patagonia|score:8,500 pts|lose",
    );
  });

  it("invites friends online", () => {
    render(<GeoGamePage />);
    fireEvent.click(screen.getByText("geo.invite_friend_online"));
    expect(navigate).toHaveBeenCalledWith("/guess/online");
  });

  it("starts an Atlas game", () => {
    render(<GeoGamePage />);
    fireEvent.click(screen.getByText("geo.start_atlas"));
    expect(screen.queryByText("geo.start_atlas")).not.toBeInTheDocument();
    expect(document.querySelector(".geo-main")).toBeInTheDocument();
    expect(screen.getByText("geo.map_loading")).toBeInTheDocument();
  });

  it("keeps the current satellite image visible while preloading the next round", async () => {
    window.history.pushState({}, "", "/guess?country=ZZ");
    let mapClickHandler;
    const maps = createMapsMock((handler) => {
      mapClickHandler = handler;
    });
    const preloadedUrls = [];
    const OriginalImage = global.Image;
    global.Image = class {
      set src(value) {
        preloadedUrls.push(value);
      }
    };

    loadGoogleMapsScript.mockResolvedValueOnce(maps);
    getRandomLocation
      .mockResolvedValueOnce({
        success: true,
        data: {
          latitude: 10,
          longitude: 20,
          formatted_address: "Round One",
          country: "One",
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          latitude: 30,
          longitude: 40,
          formatted_address: "Round Two",
          country: "Two",
        },
      });

    try {
      render(<GeoGamePage />);
      fireEvent.click(screen.getByText("geo.start_atlas"));

      await waitFor(() => {
        expect(document.querySelector(".geo-satellite-img")?.src).toContain(
          "lat=10",
        );
      });
      const currentRoundSrc = document.querySelector(".geo-satellite-img").src;
      fireEvent.load(document.querySelector(".geo-satellite-img"));
      const zoomButton = screen.getByText("geo.zoom_out");
      fireEvent.click(zoomButton);
      expect(screen.queryByText("geo.zoom_preparing")).not.toBeInTheDocument();
      expect(zoomButton).toBeDisabled();

      await waitFor(() => expect(mapClickHandler).toBeTruthy());
      await act(async () => {
        mapClickHandler({
          latLng: {
            lat: () => 11,
            lng: () => 21,
          },
        });
      });
      fireEvent.click(screen.getByText("geo.lock_in"));

      await waitFor(() =>
        expect(document.querySelector(".geo-result-panel")).toBeTruthy(),
      );
      await waitFor(() => {
        expect(preloadedUrls.some((url) => url.includes("lat=30"))).toBe(true);
      });
      expect(document.querySelector(".geo-satellite-img").src).toBe(
        currentRoundSrc,
      );

      await waitFor(() =>
        expect(screen.getByText("geo.next_round")).not.toBeDisabled(),
      );
      fireEvent.click(screen.getByText("geo.next_round"));

      await waitFor(() => {
        expect(document.querySelector(".geo-satellite-img")?.src).toContain(
          "lat=30",
        );
      });
    } finally {
      global.Image = OriginalImage;
    }
  });

  it("cancels a pending zoom-out image load after locking in", async () => {
    window.history.pushState({}, "", "/guess?country=ZZ");
    let mapClickHandler;
    const maps = createMapsMock((handler) => {
      mapClickHandler = handler;
    });
    const imageInstances = [];
    const OriginalImage = global.Image;
    global.Image = class {
      constructor() {
        imageInstances.push(this);
      }
      set src(value) {
        this.srcValue = value;
      }
    };

    loadGoogleMapsScript.mockResolvedValueOnce(maps);
    getRandomLocation.mockResolvedValueOnce({
      success: true,
      data: {
        latitude: 10,
        longitude: 20,
        formatted_address: "Round One",
        country: "One",
      },
    });

    try {
      render(<GeoGamePage />);
      fireEvent.click(screen.getByText("geo.start_atlas"));

      await waitFor(() => {
        expect(document.querySelector(".geo-satellite-img")?.src).toContain(
          "lat=10",
        );
      });
      const currentRoundSrc = document.querySelector(".geo-satellite-img").src;
      fireEvent.load(document.querySelector(".geo-satellite-img"));

      fireEvent.click(screen.getByText("geo.zoom_out"));
      const pendingZoomImage = imageInstances.find(
        (image) => typeof image.onload === "function",
      );
      expect(pendingZoomImage).toBeTruthy();

      await waitFor(() => expect(mapClickHandler).toBeTruthy());
      await act(async () => {
        mapClickHandler({
          latLng: {
            lat: () => 11,
            lng: () => 21,
          },
        });
      });
      fireEvent.click(screen.getByText("geo.lock_in"));

      await waitFor(() =>
        expect(document.querySelector(".geo-result-panel")).toBeTruthy(),
      );
      act(() => {
        pendingZoomImage.onload();
      });

      expect(document.querySelector(".geo-satellite-img").src).toBe(
        currentRoundSrc,
      );
      expect(document.querySelector(".geo-satellite-img")).toHaveClass(
        "loaded",
      );
    } finally {
      global.Image = OriginalImage;
    }
  });

  it("lets the next-round button proceed before AI or next image preloading finishes", async () => {
    window.history.pushState({}, "", "/guess?country=ZZ");
    let mapClickHandler;
    const maps = createMapsMock((handler) => {
      mapClickHandler = handler;
    });
    const OriginalImage = global.Image;
    global.Image = class {
      set src(value) {
        this.srcValue = value;
      }
    };
    global.fetch = vi.fn(() => neverSettles());

    loadGoogleMapsScript.mockResolvedValueOnce(maps);
    getRandomLocation
      .mockResolvedValueOnce({
        success: true,
        data: {
          latitude: 10,
          longitude: 20,
          formatted_address: "Round One",
          country: "One",
        },
      })
      .mockImplementation(() => neverSettles());

    try {
      render(<GeoGamePage />);
      fireEvent.click(screen.getByText("geo.start_atlas"));

      await waitFor(() => {
        expect(document.querySelector(".geo-satellite-img")?.src).toContain(
          "lat=10",
        );
      });
      fireEvent.load(document.querySelector(".geo-satellite-img"));

      await waitFor(() => expect(mapClickHandler).toBeTruthy());
      await act(async () => {
        mapClickHandler({
          latLng: {
            lat: () => 11,
            lng: () => 21,
          },
        });
      });
      fireEvent.click(screen.getByText("geo.lock_in"));

      await waitFor(() =>
        expect(document.querySelector(".geo-result-panel")).toBeTruthy(),
      );
      const nextButton = screen.getByText("geo.next_round");
      expect(nextButton).not.toBeDisabled();
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText("geo.loading")).toBeInTheDocument();
      });
      expect(document.querySelector(".geo-result-panel")).not.toBeInTheDocument();
    } finally {
      global.Image = OriginalImage;
    }
  });

  it("keeps the round stable on repeated lock-in and next-round clicks", async () => {
    window.history.pushState({}, "", "/guess?country=ZZ");
    let mapClickHandler;
    const maps = createMapsMock((handler) => {
      mapClickHandler = handler;
    });
    const OriginalImage = global.Image;
    global.Image = class {
      set src(value) {
        this.srcValue = value;
      }
    };

    loadGoogleMapsScript.mockResolvedValueOnce(maps);
    getRandomLocation
      .mockResolvedValueOnce({
        success: true,
        data: {
          latitude: 10,
          longitude: 20,
          formatted_address: "Round One",
          country: "One",
        },
      })
      .mockImplementation(() => neverSettles());

    try {
      render(<GeoGamePage />);
      fireEvent.click(screen.getByText("geo.start_atlas"));

      await waitFor(() => {
        expect(document.querySelector(".geo-satellite-img")?.src).toContain(
          "lat=10",
        );
      });
      fireEvent.load(document.querySelector(".geo-satellite-img"));

      await waitFor(() => expect(mapClickHandler).toBeTruthy());
      await act(async () => {
        mapClickHandler({
          latLng: {
            lat: () => 11,
            lng: () => 21,
          },
        });
      });

      const lockButton = screen.getByText("geo.lock_in");
      fireEvent.click(lockButton);
      fireEvent.click(lockButton);

      await waitFor(() =>
        expect(document.querySelector(".geo-result-panel")).toBeTruthy(),
      );
      expect(screen.getByText("geo.round")).toBeInTheDocument();
      expect(screen.getByText("geo.next_round")).toBeInTheDocument();

      const nextButton = screen.getByText("geo.next_round");
      fireEvent.click(nextButton);
      fireEvent.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText("geo.loading")).toBeInTheDocument();
      });
      expect(screen.getByText("geo.round_progress")).toBeInTheDocument();
    } finally {
      global.Image = OriginalImage;
    }
  });
});
