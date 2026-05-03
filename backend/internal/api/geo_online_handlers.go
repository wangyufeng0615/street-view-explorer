package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

type geoBattleCreateRoomRequest struct {
	Nickname string `json:"nickname"`
}

type geoBattleJoinRoomRequest struct {
	Nickname string `json:"nickname"`
	Code     string `json:"code"`
}

type geoBattleReadyRequest struct {
	Ready *bool `json:"ready"`
}

type geoBattleGuessRequest struct {
	Lat    *float64 `json:"lat"`
	Lng    *float64 `json:"lng"`
	GiveUp bool     `json:"give_up"`
}

func (gh *GeoHandlers) CreateOnlineRoom(c *gin.Context) {
	var req geoBattleCreateRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	room, err := gh.battleService.CreatePrivateRoom(sessionID, req.Nickname)
	if err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"room": room}})
}

func (gh *GeoHandlers) JoinOnlineRoom(c *gin.Context) {
	var req geoBattleJoinRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	room, err := gh.battleService.JoinPrivateRoom(sessionID, req.Nickname, strings.TrimSpace(req.Code))
	if err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"room": room}})
}

func (gh *GeoHandlers) GetOnlineRoom(c *gin.Context) {
	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	room, err := gh.battleService.GetRoomSnapshot(c.Param("roomId"), sessionID)
	if err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"room": room}})
}

func (gh *GeoHandlers) SetOnlineRoomReady(c *gin.Context) {
	var req geoBattleReadyRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.Ready == nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "ready is required"})
		return
	}

	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	room, err := gh.battleService.SetReady(c.Param("roomId"), sessionID, *req.Ready)
	if err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"room": room}})
}

func (gh *GeoHandlers) ZoomOutOnlineRoom(c *gin.Context) {
	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	room, err := gh.battleService.ZoomOut(c.Param("roomId"), sessionID)
	if err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"room": room}})
}

func (gh *GeoHandlers) SubmitOnlineGuess(c *gin.Context) {
	var req geoBattleGuessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	room, err := gh.battleService.SubmitGuess(c.Param("roomId"), sessionID, req.Lat, req.Lng, req.GiveUp)
	if err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"room": room}})
}

func (gh *GeoHandlers) LeaveOnlineRoom(c *gin.Context) {
	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := gh.battleService.LeaveRoom(c.Param("roomId"), sessionID); err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (gh *GeoHandlers) JoinOnlineMatchmaking(c *gin.Context) {
	var req geoBattleCreateRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": "invalid request body"})
		return
	}

	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	status, err := gh.battleService.JoinMatchmaking(sessionID, req.Nickname)
	if err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": status})
}

func (gh *GeoHandlers) GetOnlineMatchmaking(c *gin.Context) {
	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	status, err := gh.battleService.GetMatchmakingStatus(sessionID)
	if err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": status})
}

func (gh *GeoHandlers) CancelOnlineMatchmaking(c *gin.Context) {
	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	if err := gh.battleService.CancelMatchmaking(sessionID); err != nil && gh.geoBattleStatusCode(err) != http.StatusConflict {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}

func (gh *GeoHandlers) OnlineRoomImage(c *gin.Context) {
	sessionID, err := gh.geoBattleSessionID(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "error": err.Error()})
		return
	}

	lat, lng, zoom, err := gh.battleService.GetImageSpec(c.Param("roomId"), sessionID)
	if err != nil {
		c.JSON(gh.geoBattleStatusCode(err), gin.H{"success": false, "error": err.Error()})
		return
	}

	gh.proxySatelliteImage(
		c,
		lat,
		lng,
		zoom,
		geoSatelliteImageDefaultWidth,
		geoSatelliteImageDefaultHeight,
		"no-store",
	)
}
