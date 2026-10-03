import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import LetterContent from "../components/LetterContent";
import { loadNotoSerifSC } from "../utils/pageFonts";
import "../styles/AgentPage.css";

const API_V1 = "/api/v1";

export default function LetterPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [letter, setLetter] = useState(null);
  const [photos, setPhotos] = useState([]);
  // 存翻译 key，切换语言时错误文案跟着变
  const [errorKey, setErrorKey] = useState("");
  const [loading, setLoading] = useState(true);

  // 来信正文和标题用衬线体，挂载时按需加载
  useEffect(() => {
    loadNotoSerifSC();
  }, []);

  useEffect(() => {
    async function load() {
      if (!id || id === "undefined") {
        setErrorKey("letter.invalid_id");
        setLoading(false);
        return;
      }
      try {
        const resp = await fetch(
          `${API_V1}/agent/journeys/${id}/public-letter`,
        );
        const text = await resp.text();
        const data = text ? JSON.parse(text) : null;
        if (resp.ok && data?.success && data.data) {
          setLetter(data.data.letter);
          setPhotos(data.data.photos || []);
        } else {
          console.warn("Letter load failed:", resp.status, data?.error);
          setErrorKey(
            resp.status === 404 ? "letter.not_found" : "letter.load_failed",
          );
        }
      } catch (err) {
        console.warn("Letter load failed:", err);
        setErrorKey("letter.load_failed");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const stopImageMap = {};
  for (const p of photos) {
    if (p.pano_id) {
      stopImageMap[p.stop_number] =
        `/api/v1/agent/streetview?pano_id=${encodeURIComponent(p.pano_id)}&heading=${p.photo_heading || 0}&journey_id=${encodeURIComponent(id)}`;
    }
  }

  const header = (
    <div className="agent-header">
      <button className="agent-back-btn" onClick={() => navigate("/agent")}>
        ← {t("agent.title")}
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="agent-page">
        {header}
        <div className="agent-content">
          <div className="agent-detail-state">{t("common.loading")}</div>
        </div>
      </div>
    );
  }

  if (errorKey) {
    return (
      <div className="agent-page">
        {header}
        <div className="agent-content">
          <div className="agent-detail-state error" role="alert">
            <div>{t(errorKey)}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-page">
      {header}
      <div className="agent-content">
        <div className="agent-letter-section agent-letter-standalone">
          <LetterContent
            text={letter}
            stopImageMap={stopImageMap}
            journeyId={id}
          />
        </div>
      </div>
    </div>
  );
}
