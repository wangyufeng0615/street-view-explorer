import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  cancelGeoBattleMatchmaking,
  createGeoBattleRoom,
  getGeoBattleMatchmakingStatus,
  joinGeoBattleMatchmaking,
  joinGeoBattleRoom,
} from "../services/api";
import { readLocalStorage, writeLocalStorage } from "../utils/safeStorage";
import { getGeoBattleErrorMessage } from "../hooks/useGeoBattleRoomSync";

const NICKNAME_STORAGE_KEY = "geoBattleNickname";
const SYNC_INTERVAL_PLAYING = 1500;

const NICKNAMES = {
  zh: [
    "星图旅人",
    "云层观察员",
    "海岸猎手",
    "地图玩家",
    "经纬探员",
    "山脊向导",
  ],
  en: ["Sky Mapper", "Cloud Scout", "Coast Hunter", "Map Runner", "Geo Pilot"],
};

function readSavedNickname() {
  return readLocalStorage(NICKNAME_STORAGE_KEY) || "";
}

function saveNickname(nickname) {
  writeLocalStorage(NICKNAME_STORAGE_KEY, nickname);
}

function getGeoLanguage(i18n) {
  const language = i18n.resolvedLanguage || i18n.language || "en";
  return language.startsWith("zh") ? "zh" : "en";
}

function generateNickname(language = "en") {
  const names = NICKNAMES[language] || NICKNAMES.en;
  const name = names[Math.floor(Math.random() * names.length)];
  return `${name}${Math.floor(100 + Math.random() * 900)}`;
}

/**
 * Best-effort queue cancel while the page is being unloaded; failures are
 * ignored because the server also drops queue entries that stop polling.
 */
function cancelMatchmakingOnPageHide() {
  cancelGeoBattleMatchmaking({ keepalive: true }).catch(() => {});
}

function normalizeRoomCode(code) {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function GeoBattleHubPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const activeLanguage = getGeoLanguage(i18n);
  const [nickname, setNickname] = useState(
    () => readSavedNickname() || generateNickname(activeLanguage),
  );
  const [roomCode, setRoomCode] = useState("");
  const [matchmaking, setMatchmaking] = useState({ status: "idle" });
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  // Set once a match is found so leaving for the room does not cancel it.
  const matchedRef = useRef(false);
  const queuedRef = useRef(false);
  const errorRef = useRef(null);

  // 提示在页面最底下，手机上常在首屏以外；出错时滚到看得见的位置
  useEffect(() => {
    if (!error) return;
    const reduceMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    errorRef.current?.scrollIntoView?.({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }, [error]);
  queuedRef.current = matchmaking.status === "queued";

  useEffect(() => {
    saveNickname(nickname);
  }, [nickname]);

  const syncMatchmaking = useCallback(async () => {
    const res = await getGeoBattleMatchmakingStatus();
    if (!res.success || !res.data) return;

    if (res.data.status === "matched" && res.data.room?.room_id) {
      matchedRef.current = true;
      navigate(`/guess/online/${res.data.room.room_id}`, { replace: true });
      return;
    }

    setMatchmaking(res.data);
  }, [navigate]);

  // Leaving the hub while queued must take this player out of the queue,
  // otherwise someone else gets matched against a player who is gone.
  useEffect(
    () => () => {
      if (queuedRef.current && !matchedRef.current) {
        cancelGeoBattleMatchmaking();
      }
    },
    [],
  );

  useEffect(() => {
    if (matchmaking.status !== "queued") return undefined;
    const handlePageHide = () => {
      if (!matchedRef.current) cancelMatchmakingOnPageHide();
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [matchmaking.status]);

  useEffect(() => {
    syncMatchmaking();
  }, [syncMatchmaking]);

  useEffect(() => {
    if (matchmaking.status !== "queued") return undefined;

    const timer = window.setInterval(syncMatchmaking, SYNC_INTERVAL_PLAYING);
    return () => {
      window.clearInterval(timer);
    };
  }, [matchmaking.status, syncMatchmaking]);

  const withNickname = useCallback(() => {
    const value = nickname.trim();
    if (!value) {
      setError(t("geo_online.need_nickname"));
      return null;
    }
    saveNickname(value);
    setError("");
    return value;
  }, [nickname, t]);

  const handleCreateRoom = async () => {
    const value = withNickname();
    if (!value) return;

    setBusyAction("create");
    const res = await createGeoBattleRoom(value);
    setBusyAction("");

    if (!res.success || !res.data?.room?.room_id) {
      setError(getGeoBattleErrorMessage(res, t));
      return;
    }

    navigate(`/guess/online/${res.data.room.room_id}`);
  };

  const handleJoinRoom = async () => {
    const value = withNickname();
    if (!value) return;

    const code = normalizeRoomCode(roomCode);
    if (!code) {
      setError(t("geo_online.need_room_code"));
      return;
    }

    setBusyAction("join");
    const res = await joinGeoBattleRoom(code, value);
    setBusyAction("");

    if (!res.success || !res.data?.room?.room_id) {
      setError(
        getGeoBattleErrorMessage(res, t, {
          notFoundKey: "geo_online.error_room_not_found",
        }),
      );
      return;
    }

    navigate(`/guess/online/${res.data.room.room_id}`);
  };

  const handleMatchmaking = async () => {
    const value = withNickname();
    if (!value) return;

    setBusyAction("match");
    const res = await joinGeoBattleMatchmaking(value);
    setBusyAction("");

    if (!res.success || !res.data) {
      // 匹配接口的 409 只会是"仍在好友房里"
      setError(
        res.status === 409
          ? t("geo_online.already_in_room")
          : getGeoBattleErrorMessage(res, t),
      );
      return;
    }

    if (res.data.status === "matched" && res.data.room?.room_id) {
      matchedRef.current = true;
      navigate(`/guess/online/${res.data.room.room_id}`);
      return;
    }

    setMatchmaking(res.data);
  };

  const handleCancelMatchmaking = async () => {
    setBusyAction("cancel-match");
    await cancelGeoBattleMatchmaking();
    setBusyAction("");
    setMatchmaking({ status: "idle" });
  };

  const handleRandomNickname = () => {
    setNickname(generateNickname(activeLanguage));
    setError("");
  };

  return (
    <div className="geo-battle-page">
      <div className="geo-battle-shell geo-battle-shell--hub">
        <div className="geo-battle-topbar">
          <button
            className="geo-battle-back"
            onClick={() => navigate("/guess")}
            type="button"
          >
            ← {t("geo_online.back_single")}
          </button>
          <div className="geo-battle-title-block">
            <div className="geo-battle-title">{t("geo_online.title")}</div>
          </div>
        </div>

        <div className="geo-battle-lobby">
          <div className="geo-battle-panel geo-battle-profile-panel">
            <label className="geo-battle-field">
              <span>{t("geo_online.nickname")}</span>
              <div className="geo-battle-nickname-row">
                <input
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder={t("geo_online.nickname_placeholder")}
                  maxLength={20}
                />
                <button
                  type="button"
                  className="geo-battle-icon-btn"
                  aria-label={t("geo_online.randomize_nickname")}
                  title={t("geo_online.randomize_nickname")}
                  onClick={handleRandomNickname}
                >
                  ↻
                </button>
              </div>
            </label>
          </div>

          <div className="geo-battle-hub-grid">
            <section className="geo-battle-panel geo-battle-private-panel">
              <div className="geo-battle-choice-title">
                {t("geo_online.private_room")}
              </div>
              <div className="geo-battle-private-actions">
                <button
                  type="button"
                  className="geo-battle-primary-btn"
                  disabled={
                    busyAction !== "" || matchmaking.status === "queued"
                  }
                  onClick={handleCreateRoom}
                >
                  {busyAction === "create"
                    ? t("geo_online.loading")
                    : t("geo_online.create_room")}
                </button>
                <div className="geo-battle-join-row">
                  <label className="geo-battle-field geo-battle-field--compact">
                    <span>{t("geo_online.room_code")}</span>
                    <input
                      value={roomCode}
                      onChange={(event) => setRoomCode(event.target.value)}
                      placeholder={t("geo_online.room_code_placeholder")}
                      maxLength={6}
                    />
                  </label>
                  <button
                    type="button"
                    className="geo-battle-secondary-btn"
                    disabled={
                      busyAction !== "" || matchmaking.status === "queued"
                    }
                    onClick={handleJoinRoom}
                  >
                    {busyAction === "join"
                      ? t("geo_online.loading")
                      : t("geo_online.join_room")}
                  </button>
                </div>
              </div>
            </section>

            <section className="geo-battle-panel geo-battle-match-panel">
              <div className="geo-battle-choice-title">
                {t("geo_online.match_room")}
              </div>
              {matchmaking.status !== "queued" && (
                <button
                  type="button"
                  className="geo-battle-secondary-btn geo-battle-match-btn"
                  disabled={
                    busyAction !== "" || matchmaking.status === "queued"
                  }
                  onClick={handleMatchmaking}
                >
                  {busyAction === "match"
                    ? t("geo_online.loading")
                    : t("geo_online.matchmaking")}
                </button>
              )}

              {matchmaking.status === "queued" && (
                <div className="geo-battle-matchmaking-card">
                  <div className="geo-battle-matchmaking-visual" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </div>
                  <div>
                    <div className="geo-battle-side-title">
                      {t("geo_online.matchmaking_wait")}
                    </div>
                    <div className="geo-battle-side-copy">
                      {t("geo_online.matchmaking_wait_hint")}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="geo-battle-secondary-btn"
                    disabled={busyAction !== ""}
                    onClick={handleCancelMatchmaking}
                  >
                    {busyAction === "cancel-match"
                      ? t("geo_online.loading")
                      : t("geo_online.cancel_matchmaking")}
                  </button>
                </div>
              )}
            </section>
          </div>

          {error && (
            <div className="geo-battle-banner" role="alert" ref={errorRef}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { GeoBattleHubPage };
