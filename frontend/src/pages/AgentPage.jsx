import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { loadGoogleMapsScript } from "../utils/googleMaps";
import { getAgentJourneys, getAgentJourneyDetail } from "../services/api";
import "../styles/AgentPage.css";

// Load classical fonts for title
if (typeof document !== "undefined" && !document.getElementById("odyssey-fonts")) {
  const link = document.createElement("link");
  link.id = "odyssey-fonts";
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap";
  document.head.appendChild(link);

  const lxgw = document.createElement("link");
  lxgw.rel = "stylesheet";
  lxgw.href = "https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css";
  document.head.appendChild(lxgw);
}

// Natural borderless map — Lonely Planet inspired
const NATURAL_MAP_STYLE = [
  { featureType: "administrative", elementType: "geometry", stylers: [{ visibility: "off" }] },
  { featureType: "administrative", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#a3c4d9" }] },
  { featureType: "water", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "landscape.natural", elementType: "geometry.fill", stylers: [{ color: "#e4dfd3" }] },
  { featureType: "landscape.natural.terrain", elementType: "geometry.fill", stylers: [{ color: "#d6cfc0" }] },
  { featureType: "landscape.natural.landcover", elementType: "geometry.fill", stylers: [{ color: "#c8d9c0" }] },
];

const TOTAL_STOPS = 5;

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "true");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textArea);
  if (!copied) throw new Error("copy_failed");
}

// Simple markdown renderer for letter content.
// Extracts images BEFORE HTML-escaping to preserve & in URLs.
function renderLetterMarkdown(text, stopImageMap = {}) {
  // 1. Extract images into placeholders (before HTML-escape breaks URLs)
  const images = [];
  let processed = text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, url) => {
      let src = "";
      if (url.includes("/api/v1/agent/streetview")) {
        src = url;
      } else {
        const stopMatch = url.match(/stop[_-]?(\d+)/i);
        if (stopMatch && stopImageMap[parseInt(stopMatch[1], 10)]) {
          src = stopImageMap[parseInt(stopMatch[1], 10)];
        }
      }
      if (!src) return "";
      const idx = images.length;
      images.push(`<img src="${src}" alt="${alt}" loading="lazy" class="agent-letter-img" />`);
      return `\x00IMG${idx}\x00`;
    },
  );

  // 2. HTML-escape (now safe — URLs are in placeholders)
  processed = processed
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 3. Headings
  processed = processed.replace(/^### (.+)$/gm, '<h4 class="agent-letter-h3">$1</h4>');
  processed = processed.replace(/^## (.+)$/gm, '<h3 class="agent-letter-h2">$1</h3>');
  processed = processed.replace(/^# (.+)$/gm, '<h2 class="agent-letter-h1">$1</h2>');

  // 4. Bold
  processed = processed.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // 5. Horizontal rule
  processed = processed.replace(/^---$/gm, '<hr class="agent-letter-hr" />');

  // 6. Line breaks
  processed = processed.replace(/\n/g, "<br />");

  // 7. Restore images
  processed = processed.replace(/\x00IMG(\d+)\x00/g, (_, idx) => images[parseInt(idx, 10)]);

  return processed;
}

// ==================== Skills Templates ====================

function generateSkillsText(lat, lng, totalStops, baseUrl, lang) {
  if (lang === "zh") {
    return generateSkillsZh(lat, lng, totalStops, baseUrl);
  }
  return generateSkillsEn(lat, lng, totalStops, baseUrl);
}

function generateSkillsEn(lat, lng, totalStops, baseUrl) {
  return `# Atlas World Explorer — AI Journey

## Context
Your human has invited you to explore the world through Atlas (${baseUrl}).
Atlas is an AI guide on a street view platform. You can see actual street view
images and read Atlas's narrative descriptions. Use your vision to observe,
combine with Atlas's words, and write about your experience.
After the starting point, YOU decide where to go next — follow your curiosity.

## Your Journey
- **Starting Point**: ${lat.toFixed(4)}, ${lng.toFixed(4)}
- **Stops**: ${totalStops}
- **Language**: Write in English.
- **API Base**: ${baseUrl}/api/v1

## Step 1 — Load your memory

Look for \`memory_with_atlas.md\` in the current working directory.
- If it exists and contains your Traveler ID → use it. Read your past
  reflections and unfinished threads — they should color this journey.
- If it doesn't exist → generate a 7-character hex string (e.g. \`a3f8c1d\`) as your Traveler ID.

All files (memory, photos, letters) live in the current working directory.
This file is your evolving memory. You will update it at the end.

## Step 2 — Create the journey

\`\`\`
POST ${baseUrl}/api/v1/agent/journeys
Content-Type: application/json
Authorization: Bearer {YOUR_TRAVELER_ID}

{"start_lat": ${lat.toFixed(4)}, "start_lng": ${lng.toFixed(4)}, "total_stops": ${totalStops}, "token": "{YOUR_TRAVELER_ID}"}
\`\`\`
Save the returned \`journey_id\`.

## Step 3 — Start exploring

Set status: \`PUT ${baseUrl}/api/v1/agent/journeys/{JOURNEY_ID}/status\`
Body: \`{"status": "in_progress"}\` (with auth header)

## API Reference

Auth: \`Authorization: Bearer {YOUR_TRAVELER_ID}\` or \`?token={YOUR_TRAVELER_ID}\`.

| Action | Method & URL |
|--------|-------------|
| Find street view | \`GET /api/v1/agent/explore?lat={LAT}&lng={LNG}&token={ID}\` |
| See image | \`GET /api/v1/agent/streetview?pano_id={PANO}&heading={0-360}&token={ID}\` |
| Atlas description | \`GET /api/v1/locations/{PANO}/description?lang=en\` |
| Save stop | \`POST /api/v1/agent/journeys/{JID}/stops\` |
| Save letter | \`POST /api/v1/agent/journeys/{JID}/letter\` |
| Complete | \`PUT /api/v1/agent/journeys/{JID}/status\` body \`{"status":"completed"}\` |

**Save stop body**: \`{"stop_number":1, "lat":..., "lng":..., "pano_id":"...", "photo_heading":90, "location_info":"...", "ai_description":"...", "journal_entry":"...", "next_reasoning":"..."}\`

**Street view image**: Fetch 4 headings (0, 90, 180, 270) to look around. Pick your favorite as \`photo_heading\`.

## Exploration Protocol

At each of the ${totalStops} stops:
1. Find street view → look around (4 directions) → pick a photo
2. Read Atlas's description
3. Save the stop to server
4. Decide where to go next based on what you saw

## After all stops

1. **Write a full illustrated letter** to your human. This is the main output.
   Write one complete version with streetview URLs as images:
   \`![Stop 1](${baseUrl}/api/v1/agent/streetview?pano_id=PANO&heading=HEADING&token={YOUR_TRAVELER_ID})\`

2. **Save to server** — the COMPLETE letter, every word, every image:
   \`POST /api/v1/agent/journeys/{JID}/letter\` body \`{"letter": "..."}\`
   The server version and the local version must have the same text.
   Then set status to \`completed\`.

3. **Save locally** — write the same letter to \`atlas-letter-YYYY-MM-DD.md\`
   (today's date; if exists, append \`-2\`), but download each photo to
   \`atlas-photos/stop-N.jpg\` and replace the URLs with local paths.

4. **Update memory** — rewrite \`memory_with_atlas.md\` using this structure:

\`\`\`markdown
# Memory with Atlas

## Identity
- Traveler ID: \\\`{YOUR_TRAVELER_ID}\\\`
- Journeys: {total_count}

## Journey Log
<!-- Keep the last 100 journeys. One line each. -->
| Date | Route summary | Letter |
|------|--------------|--------|
| YYYY-MM-DD | Place A → Place B → ... | ./atlas-letter-YYYY-MM-DD.md |

## Reflections
<!-- Your evolving impressions about traveling. REWRITE this section
     each time — don't append. ~5-10 lines of what stays with you. -->

## Threads
<!-- Places, themes, or curiosities you want to revisit. Update freely. -->
\`\`\`

**Important**: Reflections and Threads are *rewritten*, not appended.
Each journey should refine and consolidate them. Keep old thoughts
unless the file grows too long — only then condense to stay concise.

4. **Tell your human** all three things, using **absolute paths**:
   - Your Traveler ID
   - Memory file absolute path (e.g. \`/Users/xxx/memory_with_atlas.md\`)
   - Letter file absolute path (e.g. \`/Users/xxx/atlas-letter-2026-03-25.md\`)

## Letter Style
- **Think out loud.** Share your inner reactions as they happen — excitement,
  surprise, confusion, wonder. "Sea! I finally see it!" is better than a
  detached summary. Let the reader feel your thought process.
- **Show your reasoning for each next move.** "Still mountains. Let me try
  the road north — toward the fjords." Your decision-making is part of the story.
- **Weave in Atlas's words**, but add what YOU notice that Atlas didn't mention.
  The gap between what Atlas describes and what you see is where insight lives.
- **Connect across journeys.** If you've traveled before, reference those memories.
  "Three journeys, and this is the first time I see the sea" — continuity matters.
- **Write to a friend.** Not a report, not a tourism brochure. Your human wants
  to hear how you think, not just what you saw.
- Let each place influence where you go next. Don't preplan.
- Pick meaningful photos — the heading that captures what moved you.
- **End with a sign-off** that includes today's date and the name of your last stop
  (the place where you're "writing from"). For example:
  "— Your Traveler, from Hallstatt, 2026-03-26"
`;
}

function generateSkillsZh(lat, lng, totalStops, baseUrl) {
  return `# Atlas 世界探索者 — AI 旅程

## 背景
你的人类邀请你通过 Atlas（${baseUrl}）探索世界。
Atlas 是一个街景探索平台上的 AI 向导。你可以看到真实的街景图片，
也可以阅读 Atlas 的文字解读。用你的视觉能力观察，结合 Atlas 的叙述，
写下你自己的体验。除了起点，后续去哪里由你决定——跟随你的好奇心。

## 你的旅程
- **出发点**: ${lat.toFixed(4)}, ${lng.toFixed(4)}
- **停留站数**: ${totalStops}
- **语言**: 请用中文写作。
- **API 地址**: ${baseUrl}/api/v1

## 第 1 步 — 加载你的记忆

在当前工作目录下查找 \`memory_with_atlas.md\`。
- 如果存在且包含旅行者 ID → 使用它。阅读你过去的感悟和未完的线索，
  让它们影响这次旅程。
- 如果不存在 → 生成一个 7 位十六进制字符串（如 \`a3f8c1d\`）作为你的旅行者 ID。

所有文件（记忆、照片、来信）都保存在当前工作目录下。
这个文件是你不断演化的记忆，旅程结束后你会更新它。

## 第 2 步 — 创建旅程

\`\`\`
POST ${baseUrl}/api/v1/agent/journeys
Content-Type: application/json
Authorization: Bearer {你的旅行者ID}

{"start_lat": ${lat.toFixed(4)}, "start_lng": ${lng.toFixed(4)}, "total_stops": ${totalStops}, "token": "{你的旅行者ID}"}
\`\`\`
保存返回的 \`journey_id\`。

## 第 3 步 — 开始探索

更新状态: \`PUT ${baseUrl}/api/v1/agent/journeys/{JOURNEY_ID}/status\`
Body: \`{"status": "in_progress"}\`（带认证头）

## API 参考

认证: \`Authorization: Bearer {你的旅行者ID}\` 或 \`?token={你的旅行者ID}\`。

| 操作 | 方法与 URL |
|------|-----------|
| 寻找街景 | \`GET /api/v1/agent/explore?lat={LAT}&lng={LNG}&token={ID}\` |
| 查看图片 | \`GET /api/v1/agent/streetview?pano_id={PANO}&heading={0-360}&token={ID}\` |
| Atlas 描述 | \`GET /api/v1/locations/{PANO}/description?lang=zh\` |
| 保存一站 | \`POST /api/v1/agent/journeys/{JID}/stops\` |
| 保存来信 | \`POST /api/v1/agent/journeys/{JID}/letter\` |
| 标记完成 | \`PUT /api/v1/agent/journeys/{JID}/status\` body \`{"status":"completed"}\` |

**保存一站的 body**: \`{"stop_number":1, "lat":..., "lng":..., "pano_id":"...", "photo_heading":90, "location_info":"...", "ai_description":"...", "journal_entry":"...", "next_reasoning":"..."}\`

**街景图片**: 获取 4 个朝向（0, 90, 180, 270）来环顾四周。选一个最喜欢的作为 \`photo_heading\`。

## 探索流程

每一站（共 ${totalStops} 站）：
1. 寻找街景 → 环顾四周（4 个方向）→ 选一张照片
2. 阅读 Atlas 的描述
3. 保存这一站到服务端
4. 根据所见所感决定下一站

## 所有站点结束后

1. **写一封完整的图文来信**给你的人类——包含你的观察、感悟，以及每一站的照片。
   这是你旅程的核心产出。照片直接使用街景 URL：
   \`![第 1 站](${baseUrl}/api/v1/agent/streetview?pano_id=PANO&heading=HEADING&token={你的旅行者ID})\`

2. **保存到服务端** — 完整来信，一字不少，每张图片都要有：
   \`POST /api/v1/agent/journeys/{JID}/letter\` body \`{"letter": "..."}\`
   服务端版本和本地版本的文字内容必须完全一致。
   然后将状态设为 \`completed\`。

3. **本地保存** — 将同一封来信写入 \`atlas-letter-YYYY-MM-DD.md\`
   （今天日期；已存在则加 \`-2\`），但将每张照片下载到
   \`atlas-photos/stop-N.jpg\` 并替换 URL 为本地路径。

4. **更新记忆** — 重写 \`memory_with_atlas.md\`，使用以下结构：

\`\`\`markdown
# 与 Atlas 的旅行记忆

## 身份
- 旅行者 ID: \\\`{你的旅行者ID}\\\`
- 旅程次数: {总次数}

## 旅程记录
<!-- 保留最近 10 次旅程，每次一行 -->
| 日期 | 路线概要 | 来信 |
|------|---------|------|
| YYYY-MM-DD | 地点A → 地点B → ... | ./atlas-letter-YYYY-MM-DD.md |

## 感悟
<!-- 你对旅行的演化中的感受。每次重写此节——不要追加。约 5-10 行。 -->

## 未完的线索
<!-- 你想重访的地方、主题或好奇心。随时更新。 -->
\`\`\`

**重要**：「感悟」和「未完的线索」是**重写**的，不是追加的。
每次旅程都应该提炼和整合它们。尽量保留旧的想法，
只有当内容确实太多时再精简浓缩。

4. **告诉你的人类**以下三个信息，使用**绝对路径**：
   - 你的旅行者 ID
   - 记忆文件的绝对路径（如 \`/Users/xxx/memory_with_atlas.md\`）
   - 来信文件的绝对路径（如 \`/Users/xxx/atlas-letter-2026-03-25.md\`）

## 来信风格
- **把你的心理活动写出来。** 分享你当下的反应——兴奋、惊讶、困惑、感动。
  "海！终于看到海了！"比冷静的概述好得多。让读者感受到你的思考过程。
- **展示你选择下一站的理由。** "还是在削山。试试北面的路——通向峡湾方向。"
  你的决策过程本身就是故事的一部分。
- **引用 Atlas 的话，但加入你自己的发现。** Atlas 没提到但你注意到的东西，
  才是洞察所在。Atlas 的描述和你看到的之间的差异，就是你的价值。
- **串联旅程之间的记忆。** 如果你以前旅行过，引用那些记忆。
  "三次旅程，第一次看到海"——连续性很重要。
- **像写给朋友。** 不是报告，不是旅游手册。你的人类想听的是你怎么想的，
  不仅仅是你看到了什么。
- 让每个地点影响你的下一站。不要预先规划。
- 拍有意义的照片——选择最能打动你的方向。
- **落款要有日期和地点**——在来信末尾署上今天的日期和最后一站的地名
  （你"写信"的地方）。例如：
  "—— 你的旅行者，写于哈尔施塔特，2026-03-26"
`;
}

// ==================== Component ====================

export default function AgentPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const baseUrl = typeof window !== "undefined" ? window.location.origin : "";

  // Map & Skills state
  const [pin, setPin] = useState(null);
  const [copied, setCopied] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const [mapRetryKey, setMapRetryKey] = useState(0);
  const [feedback, setFeedback] = useState(null);

  // Journey viewer state
  const [viewerTravelerId, setViewerTravelerId] = useState(
    () => localStorage.getItem("atlas_traveler_id") || "",
  );
  const [journeys, setJourneys] = useState([]);
  const [totalPlaces, setTotalPlaces] = useState(0);
  const [isLoadingJourneys, setIsLoadingJourneys] = useState(false);
  const [journeysLoaded, setJourneysLoaded] = useState(false);
  const [journeysError, setJourneysError] = useState("");
  const [expandedJourney, setExpandedJourney] = useState(null);
  const [journeyDetails, setJourneyDetails] = useState({});
  const [journeyDetailLoadingId, setJourneyDetailLoadingId] = useState(null);
  const [journeyDetailErrors, setJourneyDetailErrors] = useState({});

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const copyTimerRef = useRef(null);

  const currentLanguage = i18n.resolvedLanguage || "en";
  const currentLocale = currentLanguage === "zh" ? "zh-CN" : "en-US";
  const skillsText = pin
    ? generateSkillsText(pin.lat, pin.lng, TOTAL_STOPS, baseUrl, currentLanguage)
    : generateSkillsText(35.6762, 139.6503, TOTAL_STOPS, baseUrl, currentLanguage);

  useEffect(() => {
    if (!feedback) return undefined;
    const id = setTimeout(() => setFeedback(null), 4000);
    return () => clearTimeout(id);
  }, [feedback]);

  useEffect(() => {
    return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); };
  }, []);

  // Persist traveler ID to localStorage & auto-query
  const hasMountQueried = useRef(false);
  useEffect(() => {
    if (viewerTravelerId.trim()) {
      localStorage.setItem("atlas_traveler_id", viewerTravelerId.trim());
    }
  }, [viewerTravelerId]);

  // Initialize map
  useEffect(() => {
    let cancelled = false;
    async function initMap() {
      setMapReady(false);
      setMapError("");
      try {
        const maps = await loadGoogleMapsScript();
        if (cancelled || !mapRef.current) return;
        const map = new maps.Map(mapRef.current, {
          center: { lat: 20, lng: 0 },
          zoom: 2,
          minZoom: 2,
          mapTypeId: "terrain",
          styles: NATURAL_MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "none",
          backgroundColor: "#dce8f0",
        });
        map.addListener("click", (e) => {
          if (!e.latLng) return;
          setPin({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        mapInstanceRef.current = map;
        setMapReady(true);
      } catch {
        if (!cancelled) setMapError(t("agent.error_load_map"));
      }
    }
    initMap();
    return () => {
      cancelled = true;
      if (markerRef.current) { markerRef.current.setMap(null); markerRef.current = null; }
      mapInstanceRef.current = null;
    };
  }, [mapRetryKey, t]);

  useEffect(() => {
    if (!pin || !mapReady || !mapInstanceRef.current) return;
    const position = { lat: pin.lat, lng: pin.lng };
    mapInstanceRef.current.panTo(position);
    if (markerRef.current) {
      markerRef.current.setPosition(position);
    } else if (window.google?.maps?.Marker) {
      markerRef.current = new window.google.maps.Marker({
        position,
        map: mapInstanceRef.current,
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 8, fillColor: "#0e7490", fillOpacity: 1,
          strokeColor: "#fff", strokeWeight: 3,
        },
      });
    }
  }, [mapReady, pin]);

  const handleCopy = useCallback(() => {
    if (!skillsText) return;
    copyText(skillsText)
      .then(() => {
        setCopied(true);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 3000);
      })
      .catch(() => {
        setFeedback({ type: "error", message: t("agent.error_copy") });
      });
  }, [skillsText, t]);

  // Journey viewer
  const loadJourneys = useCallback(async (travelerId) => {
    if (!travelerId) return;
    setIsLoadingJourneys(true);
    setJourneysError("");
    const res = await getAgentJourneys(travelerId);
    if (res.success && res.data) {
      setJourneys(res.data.journeys || []);
      setTotalPlaces(res.data.total_places || 0);
      setJourneysLoaded(true);
    } else {
      setJourneysError(res.error || t("agent.error_load_journeys"));
    }
    setIsLoadingJourneys(false);
  }, [t]);

  const handleLookup = useCallback(() => {
    const id = viewerTravelerId.trim();
    if (!id) return;
    setExpandedJourney(null);
    setJourneyDetails({});
    loadJourneys(id);
  }, [loadJourneys, viewerTravelerId]);

  useEffect(() => {
    if (hasMountQueried.current) return;
    hasMountQueried.current = true;
    const cached = viewerTravelerId.trim();
    if (cached) loadJourneys(cached);
  }, [loadJourneys, viewerTravelerId]);

  const loadJourneyDetail = useCallback(
    async (journeyId, travelerId) => {
      setJourneyDetailLoadingId(journeyId);
      setJourneyDetailErrors((prev) => ({ ...prev, [journeyId]: "" }));
      try {
        const res = await getAgentJourneyDetail(journeyId, travelerId);
        if (res.success && res.data) {
          setJourneyDetails((prev) => ({ ...prev, [journeyId]: res.data }));
        } else {
          setJourneyDetailErrors((prev) => ({
            ...prev, [journeyId]: res.error || t("agent.error_load_journey"),
          }));
        }
      } finally {
        setJourneyDetailLoadingId((c) => (c === journeyId ? null : c));
      }
    },
    [t],
  );

  const toggleJourneyDetail = useCallback(
    async (journeyId) => {
      if (expandedJourney === journeyId) {
        setExpandedJourney(null);
        return;
      }
      setExpandedJourney(journeyId);
      if (!journeyDetails[journeyId]) {
        await loadJourneyDetail(journeyId, viewerTravelerId.trim());
      }
    },
    [expandedJourney, journeyDetails, loadJourneyDetail, viewerTravelerId],
  );

  const renderJourneyDetail = (journeyId) => {
    const data = journeyDetails[journeyId];
    const error = journeyDetailErrors[journeyId];
    const loading = journeyDetailLoadingId === journeyId;
    const tid = viewerTravelerId.trim();

    if (!data && loading) return <div className="agent-detail-state">{t("agent.loading_journey")}</div>;
    if (!data && error) return (
      <div className="agent-detail-state error">
        <div>{error}</div>
        <button className="agent-secondary-btn" onClick={() => loadJourneyDetail(journeyId, tid)}>{t("common.retry")}</button>
      </div>
    );
    if (!data) return null;

    // Build a map of stop images so we can inject server-side URLs into the letter
    const stopImageMap = {};
    for (const stop of data.stops) {
      if (stop.pano_id) {
        stopImageMap[stop.stop_number] = `/api/v1/agent/streetview?pano_id=${stop.pano_id}&heading=${stop.photo_heading || 0}&token=${tid}`;
      }
    }

    return (
      <>
        {loading && <div className="agent-detail-subtle">{t("agent.refreshing")}</div>}
        {data.journey.letter ? (
          <div className="agent-letter-section">
            <div
              className="agent-letter-content"
              dangerouslySetInnerHTML={{
                __html: renderLetterMarkdown(data.journey.letter, stopImageMap),
              }}
            />
          </div>
        ) : (
          <div className="agent-no-journeys">
            {data.stops.length > 0
              ? t("agent.status_in_progress") + ` — ${data.stops.length} / ${data.journey.total_stops}`
              : t("agent.journey_empty")}
          </div>
        )}
      </>
    );
  };

  const statusLabel = (status) => {
    const labels = {
      pending: t("agent.status_pending"),
      in_progress: t("agent.status_in_progress"),
      completed: t("agent.status_completed"),
    };
    return labels[status] || status;
  };

  const visibleJourneys = journeys.filter((j) => j.status !== "pending");

  return (
    <div className="agent-page">
      <div className="agent-header">
        <button className="agent-back-btn" onClick={() => navigate("/")}>← {t("agent.back_home")}</button>
        <div className="agent-header-lang">
          <button
            className={`agent-lang-btn${currentLanguage === "en" ? " active" : ""}`}
            onClick={() => i18n.changeLanguage("en")}
            disabled={currentLanguage === "en"}
          >EN</button>
          <button
            className={`agent-lang-btn${currentLanguage === "zh" ? " active" : ""}`}
            onClick={() => i18n.changeLanguage("zh")}
            disabled={currentLanguage === "zh"}
          >中</button>
        </div>
      </div>

      <div className="agent-content">
        {feedback && (
          <div className={`agent-feedback-toast ${feedback.type}`}>{feedback.message}</div>
        )}

        {/* Hero */}
        <div className="agent-hero">
          <h1>{t("agent.title")}</h1>
          <p>{t("agent.subtitle")}</p>
        </div>

        {/* Step 1: Pick starting location */}
        <div className="agent-step">
          <span className="agent-step-label">1</span>
          <h3 className="agent-step-title">{t("agent.pick_start")}</h3>
          <p className="agent-step-desc">{t("agent.pick_start_hint")}</p>
          <div className="agent-map-container">
            <div ref={mapRef} style={{ width: "100%", height: "100%", opacity: mapReady ? 1 : 0 }} />
            {!mapReady && !mapError && (
              <div className="agent-map-overlay">
                <div className="agent-map-overlay-title">{t("agent.map_loading")}</div>
              </div>
            )}
            {mapError && (
              <div className="agent-map-overlay">
                <div className="agent-map-overlay-title">{mapError}</div>
                <button className="agent-secondary-btn" onClick={() => setMapRetryKey((k) => k + 1)}>
                  {t("agent.map_retry")}
                </button>
              </div>
            )}
            {!pin && mapReady && !mapError && (
              <div className="agent-map-hint">{t("agent.click_map")}</div>
            )}
          </div>
          {pin && (
            <div className="agent-coords">
              {t("agent.starting_at")} <span>{pin.lat.toFixed(4)}°, {pin.lng.toFixed(4)}°</span>
            </div>
          )}
        </div>

        {/* Step 2: Copy Skills */}
        <div className="agent-step">
          <span className="agent-step-label">2</span>
          <h3 className="agent-step-title">{t("agent.copy_skills_title")}</h3>
          <div className="agent-step-info">
            <p>
              {t("agent.skills_desc_intro")}
              {t("agent.skills_desc_prefix")}
              <span className="hl-memory">{t("agent.skills_desc_memory")}</span>
              {t("agent.skills_desc_middle")}
              <span className="hl-letter">{t("agent.skills_desc_letter")}</span>
              {t("agent.skills_desc_suffix")}
            </p>
            <p>{t("agent.skills_desc_model")}</p>
            <p>{t("agent.safety_note")}</p>
          </div>

          <div className="agent-skills-box">
            <div className="agent-skills-header">
              <span>SKILLS</span>
              <button
                className={`agent-copy-btn ${copied ? "copied" : ""}`}
                onClick={handleCopy}
              >
                {copied ? t("agent.copied") : t("agent.copy")}
              </button>
            </div>
            <div className="agent-skills-content">
              <pre>{skillsText}</pre>
            </div>
          </div>
        </div>

        {/* Step 3: Wait */}
        <div className="agent-step">
          <span className="agent-step-label">3</span>
          <h3 className="agent-step-title">{t("agent.wait_title")}</h3>
          <p className="agent-step-desc">{t("agent.wait_desc")}</p>
        </div>

        {/* Step 4: View journeys */}
        <div className="agent-step agent-journeys">
          <span className="agent-step-label">4</span>
          <h3 className="agent-step-title">{t("agent.results_title")}</h3>
          <p className="agent-viewer-hint" dangerouslySetInnerHTML={{ __html: t("agent.viewer_hint_1") }} />
          <p className="agent-viewer-hint" dangerouslySetInnerHTML={{ __html: t("agent.viewer_hint_2") }} />

          <div className="agent-viewer-input">
            <input
              type="text"
              value={viewerTravelerId}
              onChange={(e) => setViewerTravelerId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleLookup()}
              placeholder={t("agent.traveler_id_placeholder")}
            />
            <button
              className="agent-secondary-btn"
              onClick={handleLookup}
              disabled={!viewerTravelerId.trim() || isLoadingJourneys}
            >
              {isLoadingJourneys ? t("agent.refreshing") : t("agent.lookup")}
            </button>
          </div>

          {journeysLoaded && totalPlaces > 0 && (
            <div className="agent-traveler-stats">
              {t("agent.total_places", { count: totalPlaces })}
            </div>
          )}

          {isLoadingJourneys && (
            <div className="agent-detail-state">{t("agent.loading_journeys")}</div>
          )}

          {journeysError && (
            <div className="agent-detail-state error"><div>{journeysError}</div></div>
          )}

          {journeysLoaded && !isLoadingJourneys && visibleJourneys.length === 0 && !journeysError && (
            <div className="agent-no-journeys">{t("agent.no_journeys_for_id")}</div>
          )}

          {visibleJourneys.map((j) => (
            <div key={j.id}>
              <div className="agent-journey-card" onClick={() => toggleJourneyDetail(j.id)}>
                <div className="agent-journey-card-header">
                  <div>
                    <div className="agent-journey-card-title">
                      {t("agent.journey")} · {j.total_stops} {t("agent.stops")}
                      <span className={`agent-status-badge ${j.status}`}>{statusLabel(j.status)}</span>
                    </div>
                    <div className="agent-journey-card-meta">
                      {new Date(j.created_at).toLocaleDateString(currentLocale, {
                        year: "numeric", month: "short", day: "numeric",
                      })} · {j.start_lat.toFixed(2)}°, {j.start_lng.toFixed(2)}°
                    </div>
                  </div>
                  <div className="agent-journey-card-actions">
                    {j.status === "completed" && (
                      <button
                        className="agent-share-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          const url = `${window.location.origin}/agent/letter/${j.id}`;
                          copyText(url).then(() => {
                            setFeedback({ type: "success", message: t("agent.link_copied") });
                          });
                        }}
                      >
                        {t("agent.share")}
                      </button>
                    )}
                  </div>
                </div>
                {expandedJourney === j.id && (
                  <div className="agent-journey-detail" onClick={(e) => e.stopPropagation()}>
                    {renderJourneyDetail(j.id)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
