# minispace.app

A collaborative platform for modern daycares and families. Real-time communication, photo sharing, daily journals, and complete child management in one secure place.

🇨🇦 **Data hosted in Quebec** | 🔒 **End-to-end encryption** | 🌍 **Multi-language support** | 📱 **Web & Mobile**

## Features

- **Real-time Messaging** - Communicate instantly with parents. Individual, group, or broadcast messages
- **Photo Sharing** - Capture precious moments and securely share with families
- **Daily Journal** - Document health, nutrition, sleep, and observations for each child
- **Team Management** - Organize educators, manage access and roles easily
- **Data Security** - Encrypted data, granular access control, GDPR & Quebec compliance
- **Documents** - Centralize menus, policies, and important documents
- **Multi-tenant** - Each daycare has its own secure space

## Tech Stack

### Backend
- **Language**: Rust
- **Framework**: Axum (async web framework)
- **Database**: PostgreSQL (multi-tenant with separate schemas per daycare)
- **Cache**: Redis (for rate limiting, sessions, real-time features)
- **Email**: Lettre (SMTP support)
- **Authentication**: JWT Bearer tokens

### Frontend
- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS
- **State Management**: SWR (for data fetching)
- **Internationalization**: next-intl (French & English)
- **Icons**: SVG-based components

### Infrastructure
- **Containerization**: Docker & Docker Compose
- **Reverse Proxy**: Nginx (with SSL/TLS)
- **Deployment**: VPS with Docker support

## Getting Started

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development)
- Rust 1.70+ (for local backend development)
- PostgreSQL 14+ (if running without Docker)
- Redis 6+ (for caching & real-time features)

### Development Setup

1. **Clone the repository**
```bash
git clone git@github.com:minispace-app/minispace.git
cd minispace
```

2. **Configure environment variables**
```bash
# Backend configuration
cp backend/.env.example backend/.env

# Frontend configuration
cp frontend-web/.env.example frontend-web/.env
```

3. **Start services with Docker Compose**
```bash
docker-compose up -d
```

This will start:
- PostgreSQL (port 5432)
- Redis (port 6379)
- Backend API (port 8080)
- Frontend (port 3000)
- Nginx reverse proxy (port 80/443)

4. **Access the application**
- Frontend: http://localhost:3000
- API: http://localhost/api
- Documentation: Check out the individual backend/frontend READMEs

### Local Development (without Docker)

#### Backend
```bash
cd backend
cargo build
cargo run
# Runs on http://localhost:8080
```

#### Frontend
```bash
cd frontend-web
npm install
npm run dev
# Runs on http://localhost:3000
```

## Project Structure

```
minispace/
├── backend/                 # Rust/Axum API server
│   ├── src/
│   │   ├── main.rs         # Application entry point
│   │   ├── config.rs       # Configuration management
│   │   ├── routes/         # API endpoint handlers
│   │   ├── models/         # Data models
│   │   ├── services/       # Business logic
│   │   ├── middleware/     # Auth, rate limiting, etc.
│   │   └── db/             # Database migrations & utilities
│   └── Cargo.toml
├── frontend-web/            # Next.js frontend
│   ├── app/                # App Router pages
│   ├── components/         # React components
│   ├── lib/                # Utilities (API calls, etc.)
│   ├── public/             # Static assets
│   ├── messages/           # i18n translations
│   └── package.json
├── nginx/                   # Nginx configuration
├── docker-compose.yml       # Development docker setup
├── docker-compose.prod.yml  # Production docker setup
└── .github/workflows/       # CI/CD pipelines
```

## Architecture

### Multi-tenant Design
Each daycare organization gets its own PostgreSQL schema (`garderie_{slug}`). This ensures:
- Complete data isolation
- Independent scaling per tenant
- Simplified compliance & data residency

### Authentication
- JWT Bearer tokens for API authentication
- Refresh token rotation
- Role-based access control (Admin, Educator, Parent)

### Rate Limiting
- Per-IP rate limiting on public endpoints (e.g., contact form)
- Uses Redis for distributed rate limiting
- Configurable limits per endpoint

## Deployment

### Production Deployment

1. **Build Docker images**
```bash
docker build -t minispace-api:latest backend/
docker build -t minispace-web:latest frontend-web/
```

2. **Push to registry** (e.g., GitHub Container Registry)
```bash
docker tag minispace-api:latest ghcr.io/minispace-app/minispace/api:latest
docker push ghcr.io/minispace-app/minispace/api:latest
```

3. **Deploy with docker-compose.prod.yml**
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Variables (Production)
See `backend/.env.example` and `frontend-web/.env.example` for required variables.

Key production variables:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret key for JWT signing
- `SMTP_*` - Email configuration
- `NEXT_PUBLIC_API_URL` - Frontend API endpoint

## Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Security

- ✅ All data encrypted in transit (TLS 1.2+)
- ✅ Data encrypted at rest in database
- ✅ Granular access control per role
- ✅ Regular security audits
- ✅ No hardcoded secrets
- ✅ Rate limiting on public endpoints
- ✅ CSRF protection
- ✅ XSS prevention

**Data Residency**: All data for Canadian organizations is stored in Quebec, ensuring compliance with provincial regulations.

## API Documentation

API endpoints follow RESTful conventions. Key endpoints:

### Authentication
- `POST /auth/login` - User login
- `POST /auth/refresh` - Refresh JWT token
- `POST /auth/logout` - User logout

### Messages
- `GET /messages/conversations` - List conversations
- `POST /messages/thread/broadcast` - Send broadcast message
- `POST /messages/thread/group/:id` - Send group message
- `POST /messages/thread/individual/:parent_id` - Send individual message

### Users & Teams
- `GET /users` - List users (admin)
- `POST /users` - Create user (admin)
- `PUT /users/:id` - Update user (admin)

For full API documentation, see the Swagger docs at `/api/docs` (if enabled).

## Support

- 📧 Email: support@minispace.app
- 🐛 Bug reports: [GitHub Issues](https://github.com/minispace-app/minispace/issues)
- 💬 Discussions: [GitHub Discussions](https://github.com/minispace-app/minispace/discussions)

## License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Built with ❤️ for modern daycares and families.

---

**minispace.app** - Connecting daycares and families in real-time
