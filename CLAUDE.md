# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Street View Explorer - A web application for random global street view exploration with AI-generated descriptions. Live at: https://earth.wangyufeng.org/

### Core Features
- 🎲 Random global street view exploration using Google Street View
- 🤖 AI-generated location descriptions via OpenRouter API (using GPT-4o)
- 🌍 Area-weighted geographic selection for uniform global distribution
- 🗺️ Interactive maps with both 2D preview and Street View
- 🔖 User exploration preferences with regional selection
- 🌐 Multi-language support (English/Chinese) with i18next
- ⚡ Redis caching for AI descriptions and geocoding results
- 📊 Real-time monitoring with Sentry for errors and performance
- 🔒 Rate limiting and CORS protection for API security

### Tech Stack
- **Frontend**: React 18 + TypeScript + Google Maps JavaScript API
- **Backend**: Go 1.22 + Gin framework + Redis
- **AI Integration**: OpenRouter API (GPT-4o model)
- **Caching**: Redis with TTL-based expiration
- **Monitoring**: Sentry (Error tracking + Performance monitoring)
- **Deployment**: Docker Compose + Nginx reverse proxy
- **Geographic Data**: Natural Earth world polygons (GeoJSON)

## Common Development Commands

### Frontend Development
```bash
cd frontend
yarn install           # Install dependencies
yarn start             # Start dev server (port 3000)
yarn build             # Production build
yarn lint              # Run ESLint
yarn format            # Format code with Prettier
yarn test              # Run tests
```

### Backend Development
```bash
cd backend
go run cmd/server/main.go                    # Start server (port 8080)
go test ./...                                 # Run all tests
go test ./internal/services/geo -v           # Run specific geo service tests
go test -bench=. ./internal/services/geo     # Run benchmarks
```

### Full Stack Development
```bash
make deploy            # Build and deploy with Docker Compose
make clean             # Clean up Docker containers
docker-compose up      # Start all services
docker-compose down    # Stop all services
```

## Architecture & Code Structure

### Frontend Architecture (`frontend/`)
- **Components** (`src/components/`):
  - `StreetView.jsx`: Google Street View integration with panorama controls
  - `GlobalMap.jsx`: Interactive world map with location markers
  - `PreviewMap.jsx`: Small preview map for current location
  - `AiDescription.jsx`: AI-generated location descriptions display
  - `NewSidebar.jsx`: Main sidebar with controls and information
  - `TopBar.jsx`: Header with language switcher and help
  - `ExplorationPreference.jsx`: Regional preference selection
  - `Toast.jsx`: Notification system
  - `LoadingDots.jsx`, `GlobalLoading.jsx`: Loading states
- **Pages** (`src/pages/`): 
  - `HomePage.jsx`: Main application layout and state orchestration
- **Services** (`src/services/`):
  - `api.js`: Backend API client with error handling
  - `sentry.js`: Sentry initialization and configuration
- **Hooks** (`src/hooks/`):
  - `useLocationData.js`: Location fetching and state management
  - `useLocationDescription.js`: AI description fetching
  - `useExplorationMode.js`: Exploration preference management
  - `useKeyboardNavigation.js`: Keyboard shortcuts (Space for next location)
  - `useUIHandlers.js`: UI interaction handlers
- **Utilities** (`src/utils/`):
  - `googleMaps.js`: Google Maps loader and utilities
  - `addressUtils.js`: Address formatting helpers
  - `session.js`: Session ID management
- **i18n**: Translations in `frontend/public/locales/` (en/zh)
- **State Management**: React hooks with prop drilling for simplicity
- **Styling**: CSS modules in `frontend/src/styles/` with responsive design

### Backend Architecture (`backend/`)
- **Entry Point**: `cmd/server/main.go` - Server initialization and configuration
- **API Layer** (`internal/api/`):
  - `routes.go`: API route definitions (v1 endpoints)
  - `handlers.go`: HTTP request handlers
  - `middleware.go`: Session, CORS, rate limiting middleware
  - `errors.go`: Standardized error responses
- **Services** (`internal/services/`):
  - `location_service.go`: Random location generation with preference support
  - `ai_service.go`: OpenRouter integration with prompt engineering
  - `maps_service.go`: Google Maps proxy with caching
- **Geographic Utilities** (`internal/utils/`):
  - `geo.go`: Core geographic algorithms (point-in-polygon, area calculation)
  - `map_data.go`: GeoJSON data loading and management
  - `random_coordinates.go`: Area-weighted random coordinate generation
  - `logger.go`: Structured logging with contextual information
  - `proxy.go`: HTTP proxy support for API calls
- **Repository Layer** (`internal/repositories/`):
  - `repository.go`: Repository interface definition
  - `redisrepo.go`: Redis implementation with TTL management
- **Configuration** (`internal/config/`):
  - `config.go`: Environment variable loading and validation
- **Models** (`internal/models/`):
  - `location.go`: Location data structures
  - `models.go`: Shared data models
- **Monitoring** (`internal/sentry/`):
  - `sentry.go`: Sentry initialization
  - `middleware.go`: Gin middleware for error capture
- **Geographic Data** (`data/maps/`):
  - `world.geojson`: Simplified world polygons for land mass detection
  - `minor_islands.json`: Additional small islands data

### Key Implementation Details

1. **Random Location Generation**: 
   - Area-weighted polygon selection for uniform distribution
   - Point-in-polygon tests using ray casting algorithm
   - Fallback mechanism to nearest major cities if no street view found
   - Support for user-defined regional preferences

2. **Street View Integration**:
   - Dynamic panorama loading with Google Street View Service
   - Automatic quality checks and fallback to nearby locations
   - Keyboard navigation support (Space key for next location)
   - Mobile-responsive controls

3. **AI Description System**:
   - OpenRouter API integration with GPT-4o model
   - Multi-language prompts (English/Chinese)
   - Structured output parsing with retry logic
   - Response caching with 24-hour TTL

4. **Caching Strategy**: 
   - Redis for all caching needs
   - AI descriptions: 24-hour TTL
   - Location data: 1-hour TTL
   - User preferences: 30-day TTL
   - Automatic cache invalidation on errors

5. **Session Management**:
   - UUID-based session IDs stored in localStorage
   - Session-scoped exploration preferences
   - No user authentication required

6. **Error Handling**: 
   - Sentry integration for real-time error tracking
   - Structured logging with contextual metadata
   - Graceful degradation with user-friendly error messages
   - Automatic retry with exponential backoff

7. **API Security**:
   - Backend proxy for Google Maps API key protection
   - Rate limiting: 100 requests per minute per IP
   - CORS configuration for production domain
   - Request validation and sanitization

8. **Performance Optimizations**:
   - Lazy loading of Google Maps scripts
   - Component-level code splitting
   - Debounced API calls
   - Optimized GeoJSON processing with spatial indexing

## Environment Configuration

### Backend (.env)
```
PORT=8080
OPENROUTER_API_KEY=your_key
GOOGLE_MAPS_API_KEY=your_key
REDIS_ADDR=localhost:6379
SENTRY_DSN=your_dsn
SENTRY_ENVIRONMENT=development
```

### Frontend (.env)
```
REACT_APP_GOOGLE_MAPS_API_KEY=your_key
REACT_APP_API_BASE_URL=http://localhost:8080/api
REACT_APP_SENTRY_DSN=your_dsn
REACT_APP_SENTRY_ENVIRONMENT=development
```

## API Endpoints

### V1 API (`/api/v1`)

#### Locations
- `GET /locations/random?lang={en|zh}` - Get random location with optional language
- `GET /locations/:panoId/description?lang={en|zh}` - Get AI description for location
- `GET /locations/:panoId/detailed-description?lang={en|zh}` - Get detailed AI description

#### Preferences
- `POST /preferences/exploration` - Set user exploration preferences (regions)
- `POST /preferences/exploration/remove` - Remove exploration preferences

### Response Format
All API responses follow this structure:
```json
{
  "success": true|false,
  "data": { ... },
  "error": "error message if failed"
}
```

## Testing Approach

### Backend Testing
- **Unit Tests**: Run with `go test ./...`
- **Geographic Tests**: `go test ./internal/utils -v`
  - Point-in-polygon algorithm validation
  - Area calculation accuracy
  - Random distribution uniformity
- **Benchmarks**: `go test -bench=. ./internal/utils`
- **Integration Tests**: Redis and API endpoint tests
- **Coverage**: `go test -cover ./...`

### Frontend Testing
- **Component Tests**: `yarn test` (React Testing Library)
- **Manual Testing Checklist**:
  - Street View loading on different devices
  - Language switching functionality
  - Keyboard navigation (Space key)
  - Error states and recovery
  - Mobile responsiveness

## Deployment

### Docker Services
Production deployment uses Docker Compose with 4 services:

1. **nginx** (Port 3000):
   - Reverse proxy for API and static files
   - Gzip compression enabled
   - Custom headers for security
   - Static file caching

2. **backend** (Port 8080):
   - Go API server with health checks
   - Auto-restart on failure
   - Environment-based configuration

3. **frontend**:
   - Multi-stage build for optimization
   - Static files served via Nginx
   - Build-time environment injection

4. **redis** (Port 6379):
   - Persistent data volume
   - Custom configuration for production
   - Health checks for service dependency

### Deployment Commands
```bash
# Full deployment
make deploy

# Clean deployment (removes volumes)
make clean

# View logs
docker-compose logs -f [service_name]

# Scale services
docker-compose up -d --scale backend=3
```

### Health Checks
- Backend: `GET /health` endpoint
- Redis: `redis-cli ping`
- Frontend: Static file availability

### Monitoring
- Sentry for error tracking and performance
- Docker logs for debugging
- Redis INFO for cache statistics

## Important Patterns & Best Practices

### Code Patterns
1. **Service Interfaces**: All backend services implement interfaces for dependency injection and testing
2. **Repository Pattern**: Data access abstracted through repository interfaces
3. **Middleware Chain**: Request processing through configurable middleware stack
4. **Error Propagation**: Errors bubble up with context, handled at handler level
5. **Resource Cleanup**: Proper defer statements for closing connections/files

### API Patterns
1. **Consistent Response Format**: All endpoints return `{success, data, error}`
2. **Version Prefix**: API versioning via URL path (`/api/v1/`)
3. **Language Support**: Query parameter `lang` for internationalization
4. **Session Headers**: `X-Session-ID` for user tracking without auth

### Frontend Patterns
1. **Component Composition**: Small, focused components with single responsibilities
2. **Custom Hooks**: Logic extraction into reusable hooks
3. **Error Boundaries**: Graceful error handling with fallback UI
4. **Lazy Loading**: Dynamic imports for code splitting
5. **Responsive Design**: Mobile-first with CSS Grid/Flexbox

### Geographic Processing
1. **Spatial Indexing**: Optimized polygon lookups with bounding boxes
2. **Precision Handling**: Coordinate rounding to 6 decimal places
3. **Projection Awareness**: WGS84 coordinate system throughout
4. **Area Calculations**: Shoelace formula for polygon areas

### Performance Patterns
1. **Connection Pooling**: Redis connection reuse
2. **Request Debouncing**: Prevent rapid API calls
3. **Batch Processing**: Group related operations
4. **Early Returns**: Fail fast on validation errors

### Security Patterns
1. **API Key Protection**: Never expose keys in frontend code
2. **Input Validation**: Sanitize all user inputs
3. **Rate Limiting**: Per-IP request throttling
4. **CORS Restrictions**: Whitelist allowed origins
5. **Error Sanitization**: Never leak internal details