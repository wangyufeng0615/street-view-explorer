package repositories

import (
	"github.com/my-streetview-project/backend/internal/models"
)

type Repository interface {
	GetRandomLocation() (models.Location, error)
	GetLocationByID(locationID string) (models.Location, error)
	IncrementLike(locationID string) (int, error)
	GetLeaderboard(page, pageSize int) ([]models.Location, error)
	GetAllLikes() ([]models.Location, error)
	SetAIDescription(locationID, desc string) error
	GetAIDescription(locationID string) (string, error)
}
