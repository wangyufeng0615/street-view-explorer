# Street View Explorer 🌍

[![Live Demo](https://img.shields.io/badge/Live-earth.wangyufeng.org-blue)](https://earth.wangyufeng.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go)](https://go.dev/)
[![React Version](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7.1-646CFF?logo=vite)](https://vitejs.dev/)

An immersive web application for exploring random street views around the world with AI-generated location descriptions. Discover new places, learn about different cultures, and virtually travel the globe from your browser.

## ✨ Features

### Core Functionality
- 🎲 **Random Global Exploration**: Instantly teleport to random street view locations worldwide
- 🤖 **AI-Powered Descriptions**: Get intelligent, context-aware descriptions of each location
- 🗺️ **Interactive Maps**: Dual map views - global overview and local preview
- 🌐 **Multi-language Support**: Full interface in English and Chinese
- ⌨️ **Keyboard Navigation**: Press Space to jump to the next random location
- 📱 **Responsive Design**: Optimized for desktop, tablet, and mobile devices

### Odyssey (AI Agent Journey)
- 🤖 **AI-Powered Exploration**: Let your AI autonomously explore the world via street view
- 📝 **Travel Letters**: AI writes illustrated letters about its journey discoveries
- 🗺️ **Journey Tracking**: View all stops, routes, and AI observations on a map

### Advanced Features
- 🎯 **Regional Preferences**: Focus exploration on specific continents or regions
- 📊 **Real-time Monitoring**: Sentry integration for performance tracking
- 🔒 **Secure API Design**: Protected API keys with backend proxy
- 🌍 **Uniform Distribution**: Area-weighted algorithm ensures true global randomness
··
## 🚀 Quick Start

### Prerequisites
- Node.js 20+ and Yarn
- Go 1.22+
- Docker & Docker Compose (for production deployment)
- Google Maps API Key (with Maps JavaScript API, Street View API enabled)
- OpenRouter API Key (for AI descriptions)

### Development Setup

#### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/street-view-explorer.git
cd street-view-explorer
```

#### 2. Backend Setup
```bash
cd backend
cp .env.example .env
# Edit .env with your API keys and configuration

# Install dependencies
go mod download

# Run the backend server
go run cmd/server/main.go

# Or with proxy support
go run cmd/server/main.go --proxy http://proxy:port
```

#### 3. Frontend Setup
```bash
cd frontend
cp .env.example .env
# Edit .env with your configuration (VITE_* variables)

# Install dependencies
yarn install

# Start Vite development server
yarn dev
```

The application will be available at http://localhost:3000

#### 4. Available Frontend Scripts
```bash
yarn dev        # Start development server with HMR
yarn build      # Production build
yarn preview    # Preview production build locally
yarn lint       # Run ESLint
yarn format     # Format code with Prettier
```

### Production Deployment

#### Using Docker Compose (Recommended)
```bash
# Configure environment files
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# Edit both .env files with production values

# Build and deploy all services
make deploy

# The application will be available on port 3000
```

## 🔧 Configuration

### Required API Keys

1. **Google Maps API Key**
   - Enable: Maps JavaScript API, Places API, Geocoding API
   - Create separate keys for frontend and backend
   - Restrict frontend key by HTTP referrer
   - Restrict backend key by IP address

2. **OpenRouter API Key**
   - Sign up at [OpenRouter](https://openrouter.ai)
   - Add credits to your account
   - Copy your API key

3. **Sentry DSN** (Optional but recommended)
   - Create projects for frontend and backend
   - Enable performance monitoring
   - Copy DSN from project settings


## 🏗️ Architecture

### System Overview
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│    Nginx    │────▶│   Backend   │
│   (React)   │     │   (Proxy)   │     │    (Go)     │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                     ┌─────────┼─────────┐
                                     ▼                    ▼
                              ┌─────────────┐     ┌─────────────┐
                              │   SQLite    │     │  External   │
                              │    (DB)     │     │    APIs     │
                              └─────────────┘     └─────────────┘
```

### Tech Stack

#### Frontend
- **Framework**: React 18 with JavaScript (JSX)
- **Build Tool**: Vite 7.1 (fast HMR, optimized builds)
- **State Management**: Zustand with devtools
- **Maps**: Google Maps JavaScript API
- **Internationalization**: i18next with localStorage caching
- **Styling**: CSS Modules + Responsive Design
- **Monitoring**: Sentry (lazy loaded)

#### Backend
- **Language**: Go 1.22
- **Framework**: Gin Web Framework
- **Database**: SQLite (WAL mode, pure Go driver modernc.org/sqlite)
- **AI Integration**: OpenRouter API
- **Geographic Processing**: Custom GeoJSON algorithms with orb library
- **Monitoring**: Sentry with performance tracking

#### Infrastructure
- **Containerization**: Docker & Docker Compose (multi-stage builds)
- **Reverse Proxy**: Nginx with gzip, security headers, static caching
- **Monitoring**: Sentry for errors and performance
- **Database**: SQLite (zero external dependencies, auto-migration)

## 📁 Project Structure

```
├── frontend/               # React frontend application
│   ├── src/
│   │   ├── components/    # Reusable UI components
│   │   ├── pages/         # Page components
│   │   ├── hooks/         # Custom React hooks
│   │   ├── store/         # Zustand state management
│   │   ├── services/      # API client and external services
│   │   ├── locales/       # i18n translations (en/zh)
│   │   ├── config/        # Application configuration
│   │   ├── constants/     # Constants
│   │   ├── utils/         # Utility functions
│   │   └── styles/        # CSS modules
├── backend/               # Go backend server
│   ├── cmd/server/        # Application entry point
│   ├── internal/
│   │   ├── api/           # HTTP handlers and routes
│   │   ├── services/      # Business logic
│   │   ├── repositories/  # Data access layer
│   │   ├── models/        # Data structures
│   │   ├── sentry/        # Error tracking integration
│   │   ├── utils/         # Geographic algorithms
│   │   └── config/        # Configuration management
│   └── data/maps/         # GeoJSON world polygons
├── nginx/                 # Nginx configuration
└── docker-compose.yml     # Container orchestration
```

## ⚙️ Environment Variables

### Backend (`backend/.env`)

See `backend/.env.example` for the full list. Key variables:

```bash
SERVER_ADDRESS=:8080
SQLITE_PATH=data/streetview.db
AI_API_KEY=your_openrouter_key
GOOGLE_API_KEY=your_google_maps_key
```

### Frontend (`frontend/.env`)
```bash
VITE_API_BASE_URL=http://localhost:8080
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_key
```

## 📄 License

MIT
