import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  cancelGeoBattleMatchmaking,
  createGeoBattleRoom,
  getGeoBattleMatchmakingStatus,
  joinGeoBattleMatchmaking,
  joinGeoBattleRoom,
} from "../services/api";

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
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(NICKNAME_STORAGE_KEY) || "";
}

function saveNickname(nickname) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(NICKNAME_STORAGE_KEY, nickname);
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

  useEffect(() => {
    saveNickname(nickname);
  }, [nickname]);

  const syncMatchmaking = useCallback(async () => {
    const res = await getGeoBattleMatchmakingStatus();
    if (!res.success || !res.data) return;

    if (res.data.status === "matched" && res.data.room?.room_id) {
      navigate(`/guess/online/${res.data.room.room_id}`, { replace: true });
      return;
    }

    setMatchmaking(res.data);
  }, [navigate]);

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
      setError(res.error || t("geo_online.generic_error"));
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
      setError(res.error || t("geo_online.generic_error"));
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
      if (res.status === 409) {
        setError(t("geo_online.already_in_room"));
      } else {
        setError(res.error || t("geo_online.generic_error"));
      }
      return;
    }

    if (res.data.status === "matched" && res.data.room?.room_id) {
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

          {error && <div className="geo-battle-banner">{error}</div>}
        </div>
      </div>
    </div>
  );
}

export { GeoBattleHubPage };
