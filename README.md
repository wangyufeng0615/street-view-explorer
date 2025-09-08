# Street View Explorer 🌍

[![Live Demo](https://img.shields.io/badge/Live-earth.wangyufeng.org-blue)](https://earth.wangyufeng.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Go Version](https://img.shields.io/badge/Go-1.22-00ADD8?logo=go)](https://go.dev/)
[![React Version](https://img.shields.io/badge/React-18.2-61DAFB?logo=react)](https://react.dev/)

An immersive web application for exploring random street views around the world with AI-generated location descriptions. Discover new places, learn about different cultures, and virtually travel the globe from your browser.

![Street View Explorer Demo](https://github.com/yourusername/street-view-explorer/assets/demo.gif)

## ✨ Features

### Core Functionality
- 🎲 **Random Global Exploration**: Instantly teleport to random street view locations worldwide
- 🤖 **AI-Powered Descriptions**: Get intelligent, context-aware descriptions of each location
- 🗺️ **Interactive Maps**: Dual map views - global overview and local preview
- 🌐 **Multi-language Support**: Full interface in English and Chinese
- ⌨️ **Keyboard Navigation**: Press Space to jump to the next random location
- 📱 **Responsive Design**: Optimized for desktop, tablet, and mobile devices

### Advanced Features
- 🎯 **Regional Preferences**: Focus exploration on specific continents or regions
- ⚡ **Lightning Fast**: Redis caching for instant repeated views
- 📊 **Real-time Monitoring**: Sentry integration for performance tracking
- 🔒 **Secure API Design**: Protected API keys with backend proxy
- 🌍 **Uniform Distribution**: Area-weighted algorithm ensures true global randomness

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and Yarn
- Go 1.22+
- Redis 7+
- Docker & Docker Compose (for production deployment)
- Google Maps API Key
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
# Edit .env with your configuration

# Install dependencies (Yarn)
yarn install

# Start development server (Vite)
yarn dev
```

The application will be available at http://localhost:3000

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
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
                    ┌─────────────┐     ┌─────────────┐
                    │    Redis    │     │  External   │
                    │   (Cache)   │     │    APIs     │
                    └─────────────┘     └─────────────┘
```

### Tech Stack

#### Frontend
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Maps**: Google Maps JavaScript API
- **Internationalization**: i18next
- **State Management**: React Hooks
- **Styling**: CSS Modules + Responsive Design
- **Monitoring**: Sentry

#### Backend
- **Language**: Go 1.22
- **Framework**: Gin Web Framework
- **Caching**: Redis
- **AI Integration**: OpenRouter API (GPT-4o)
- **Geographic Processing**: Custom GeoJSON algorithms
- **Monitoring**: Sentry

#### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Reverse Proxy**: Nginx
- **CI/CD**: GitHub Actions (optional)
- **Monitoring**: Sentry for errors and performance

## License

MIT
