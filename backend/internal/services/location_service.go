package services

import (
	"github.com/my-streetview-project/backend/internal/models"
	"github.com/my-streetview-project/backend/internal/repositories"
)

type LocationService struct {
	repo      repositories.Repository
	aiService *AIService
}

func NewLocationService(repo repositories.Repository, ai *AIService) *LocationService {
	return &LocationService{repo: repo, aiService: ai}
}

func (ls *LocationService) GetLocationByID(locationID string) (models.Location, error) {
	return ls.repo.GetLocationByID(locationID)
}

func (ls *LocationService) GetRandomLocation() (models.Location, error) {
	return ls.repo.GetRandomLocation()
}

func (ls *LocationService) LikeLocation(locationID string) (int, error) {
	return ls.repo.IncrementLike(locationID)
}

func (ls *LocationService) GetLeaderboard(page, pageSize int) ([]models.Location, error) {
	return ls.repo.GetLeaderboard(page, pageSize)
}

func (ls *LocationService) GetAllLikes() ([]models.Location, error) {
	return ls.repo.GetAllLikes()
}
