package api

import (
	"github.com/gin-gonic/gin"
)

func SetupRoutes(r *gin.Engine, h *Handlers, ah *AgentHandlers, rh *RealtimeHandlers, gh ...*GeoHandlers) {
	// API 版本组
	v1 := r.Group("/api/v1")
	{
		// 位置相关 (公开)
		locations := v1.Group("/locations")
		{
			locations.GET("/random", h.GetRandomLocation)
			locations.GET("/lookup", h.LookupLocation)
			locations.GET("/search", h.SearchLocation)
			locations.GET("/:panoId/description", h.GetLocationDescription)
			locations.GET("/:panoId/detailed-description", h.GetLocationDetailedDescription)
		}

		// 访问记录
		v1.GET("/visits", h.GetVisitHistory)

		// 探索偏好相关 (基于 sessionID)
		preferences := v1.Group("/preferences")
		{
			preferences.POST("/exploration", h.SetExplorationPreference)
			preferences.POST("/exploration/remove", h.DeleteExplorationPreference)
		}

		// Realtime voice demo
		if rh != nil {
			realtime := v1.Group("/realtime")
			{
				realtime.GET("/voice-config", rh.GetVoiceConfig)
				realtime.GET("/client-secret", rh.CreateClientSecret)
				realtime.POST("/calls", rh.ProxyCallSDP)
				realtime.GET("/ws", rh.ConnectWebSocket)
				realtime.POST("/doubao-tts", rh.SynthesizeDoubaoTTS)
			}
		}

		// Agent Journey (token-based auth)
		agent := v1.Group("/agent")
		{
			agent.POST("/journeys", ah.CreateJourney)
			agent.GET("/journeys", ah.ListJourneys)
			agent.GET("/journeys/:id", ah.GetJourney)
			agent.PUT("/journeys/:id/status", ah.UpdateJourneyStatus)
			agent.GET("/journeys/:id/public-letter", ah.GetPublicLetter)
			agent.GET("/explore", ah.AgentExplore)
			agent.GET("/streetview", ah.StreetViewImage)
			agent.POST("/journeys/:id/stops", ah.SaveJourneyStop)
			agent.GET("/journeys/:id/stops", ah.GetJourneyStops)
			agent.POST("/journeys/:id/letter", ah.SaveJourneyLetter)

			// Catch common AI mistakes: missing journey ID in URL
			agent.PUT("/journeys/status", func(c *gin.Context) {
				c.JSON(400, gin.H{
					"success": false,
					"error":   "Missing journey ID in URL. Correct format: PUT /api/v1/agent/journeys/{JOURNEY_ID}/status",
				})
			})
		}

		// Geo Game
		if len(gh) > 0 && gh[0] != nil {
			geo := v1.Group("/geo")
			{
				geo.GET("/satellite", gh[0].SatelliteImage)
				geo.POST("/ai-guess", gh[0].AIGuess)
				geo.POST("/online/rooms", gh[0].CreateOnlineRoom)
				geo.POST("/online/rooms/join", gh[0].JoinOnlineRoom)
				geo.GET("/online/rooms/:roomId", gh[0].GetOnlineRoom)
				geo.POST("/online/rooms/:roomId/ready", gh[0].SetOnlineRoomReady)
				geo.POST("/online/rooms/:roomId/zoom-out", gh[0].ZoomOutOnlineRoom)
				geo.POST("/online/rooms/:roomId/guess", gh[0].SubmitOnlineGuess)
				geo.POST("/online/rooms/:roomId/leave", gh[0].LeaveOnlineRoom)
				geo.GET("/online/rooms/:roomId/image", gh[0].OnlineRoomImage)
				geo.POST("/online/matchmaking", gh[0].JoinOnlineMatchmaking)
				geo.GET("/online/matchmaking", gh[0].GetOnlineMatchmaking)
				geo.DELETE("/online/matchmaking", gh[0].CancelOnlineMatchmaking)
			}
		}
	}
}
