import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import LetterContent from "../components/LetterContent";
import "../styles/AgentPage.css";

const API_V1 = "/api/v1";

export default function LetterPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [letter, setLetter] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!id || id === "undefined") {
        setError("Invalid letter ID");
        setLoading(false);
        return;
      }
      try {
        const resp = await fetch(
          `${API_V1}/agent/journeys/${id}/public-letter`,
        );
        const text = await resp.text();
        if (!text) {
          setError("Empty response");
          return;
        }
        const data = JSON.parse(text);
        if (data.success && data.data) {
          setLetter(data.data.letter);
          setPhotos(data.data.photos || []);
        } else {
          setError(data.error || "Letter not found");
        }
      } catch {
        setError("Failed to load letter");
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

  if (loading) {
    return (
      <div className="agent-page">
        <div className="agent-header">
          <button className="agent-back-btn" onClick={() => navigate("/agent")}>
            ← Atlas
          </button>
        </div>
        <div className="agent-content">
          <div className="agent-detail-state">Loading...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="agent-page">
        <div className="agent-header">
          <button className="agent-back-btn" onClick={() => navigate("/agent")}>
            ← Atlas
          </button>
        </div>
        <div className="agent-content">
          <div className="agent-detail-state error">
            <div>{error}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-page">
      <div className="agent-header">
        <button className="agent-back-btn" onClick={() => navigate("/agent")}>
          ← Atlas
        </button>
      </div>
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
