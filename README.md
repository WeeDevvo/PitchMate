# PitchMate

A five-a-side football match organizer that creates fair and enjoyable games by automatically generating balanced teams using an ELO-based rating system.

## Features

- 🔐 **User Authentication** - Email/password and Google OAuth support
- 👥 **Squad Management** - Create and join multiple squads
- ⚽ **Match Creation** - Automatic team balancing based on ELO ratings
- 📊 **ELO Rating System** - Track player skill levels per squad
- 🎯 **Admin Controls** - Squad admins can manage members and matches
- 📱 **Responsive Design** - Works on desktop and mobile devices
- 🔒 **Secure API** - JWT authentication and authorization

## Architecture

PitchMate follows Clean Architecture principles with clear separation of concerns:

- **Domain Layer** - Core business logic and entities
- **Application Layer** - Use cases and CQRS commands/queries
- **Infrastructure Layer** - Database access and external services
- **API Layer** - RESTful endpoints with JWT authentication
- **Frontend** - Next.js with TypeScript and Tailwind CSS

## Tech Stack

### Backend
- .NET 8
- ASP.NET Core Web API
- Entity Framework Core
- PostgreSQL (Supabase)
- JWT Authentication
- xUnit + FsCheck (Property-Based Testing)

### Frontend
- Next.js 15
- TypeScript
- Tailwind CSS
- shadcn/ui components
- Vitest for testing

## Getting Started

### Prerequisites

- .NET 8 SDK
- Node.js 18+
- PostgreSQL (or Supabase account)
- Google Cloud account (optional, for OAuth)

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/pitchmate.git
   cd pitchmate
   ```

2. **Set up the database**
   ```bash
   # Follow the guide in SUPABASE_SETUP.md
   .\scripts\setup-database.ps1
   ```

3. **Configure the backend**
   ```bash
   # Update appsettings.json or use user secrets
   cd src/PitchMate.API
   dotnet user-secrets set "ConnectionStrings:DefaultConnection" "your-connection-string"
   ```

4. **Run the backend**
   ```bash
   cd src/PitchMate.API
   dotnet run
   ```

5. **Configure the frontend**
   ```bash
   cd frontend
   cp .env.local.example .env.local
   # Edit .env.local with your API URL
   ```

6. **Run the frontend**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

7. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: https://localhost:7000
   - Swagger UI: https://localhost:7000/swagger

## Documentation

- 📖 [Supabase Setup Guide](SUPABASE_SETUP.md) - Database configuration
- 🔑 [Google OAuth Setup Guide](GOOGLE_OAUTH_SETUP.md) - OAuth configuration
- 🧪 [End-to-End Testing Guide](E2E_TESTING_GUIDE.md) - Testing procedures
- ✅ [Test Checklist](TEST_CHECKLIST.md) - Testing progress tracker
- 🐛 [Known Issues](KNOWN_ISSUES.md) - Current issues and fixes
- 🚀 [Deployment Readiness](DEPLOYMENT_READINESS.md) - Deployment status

## Testing

### Run Backend Tests
```bash
dotnet test
```

### Run Frontend Tests
```bash
cd frontend
npm test
```

### Run E2E Tests
```bash
.\scripts\run-e2e-tests.ps1
```

## Test Coverage

- **Backend**: 271/271 tests passing (100%)
- **Frontend**: 43/49 tests passing (87.8%)
- **Property-Based Tests**: 43/43 passing with 100+ iterations

## Project Structure

```
PitchMate/
├── src/
│   ├── PitchMate.API/           # Web API layer
│   ├── PitchMate.Application/   # Application layer (CQRS)
│   ├── PitchMate.Domain/        # Domain layer (entities, services)
│   └── PitchMate.Infrastructure/ # Infrastructure layer (EF Core, repos)
├── tests/
│   ├── PitchMate.API.Tests/
│   ├── PitchMate.Application.Tests/
│   ├── PitchMate.Domain.Tests/
│   └── PitchMate.Infrastructure.Tests/
├── frontend/                     # Next.js frontend
│   ├── src/
│   │   ├── app/                 # App router pages
│   │   ├── components/          # React components
│   │   ├── lib/                 # Utilities
│   │   └── test/                # Frontend tests
│   └── public/                  # Static assets
├── scripts/                      # Deployment and setup scripts
└── .kiro/specs/                 # Feature specifications

```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/google` - Login with Google OAuth

### Squads
- `POST /api/squads` - Create squad
- `GET /api/squads` - Get user's squads
- `POST /api/squads/{id}/join` - Join squad
- `POST /api/squads/{id}/admins` - Add admin
- `DELETE /api/squads/{id}/members/{userId}` - Remove member

### Matches
- `POST /api/squads/{squadId}/matches` - Create match
- `GET /api/squads/{squadId}/matches` - Get squad matches
- `GET /api/matches/{id}` - Get match details
- `POST /api/matches/{id}/result` - Record match result

### Users
- `GET /api/users/me` - Get current user
- `GET /api/users/{id}/squads/{squadId}/rating` - Get user rating

See Swagger UI for complete API documentation.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Built with Clean Architecture principles
- Property-Based Testing with FsCheck
- UI components from shadcn/ui
- Inspired by the need for fair and balanced football matches

## Support

For issues, questions, or contributions, please open an issue on GitHub.

---

**Status**: Ready for staging deployment  
**Version**: 1.0.0  
**Last Updated**: January 15, 2026

A five-a-side football match organizer that creates fair and enjoyable games by automatically generating balanced teams using an ELO-based rating system.

## Architecture

This project follows Clean Architecture principles with clear separation of concerns:

```
PitchMate/
├── src/
│   ├── PitchMate.Domain/          # Core business logic and entities
│   ├── PitchMate.Application/     # Use cases and CQRS handlers
│   ├── PitchMate.Infrastructure/  # Data persistence and external services
│   └── PitchMate.API/             # RESTful API endpoints
└── tests/
    ├── PitchMate.Domain.Tests/
    ├── PitchMate.Application.Tests/
    ├── PitchMate.Infrastructure.Tests/
    └── PitchMate.API.Tests/
```

## Layer Dependencies

- **Domain**: No dependencies (pure business logic)
- **Application**: Depends on Domain
- **Infrastructure**: Depends on Domain and Application
- **API**: Depends on Application and Infrastructure

## Technology Stack

- **.NET 8.0**: Core framework
- **xUnit**: Testing framework
- **FluentAssertions**: Fluent assertion library for tests
- **FsCheck**: Property-based testing framework
- **Entity Framework Core**: ORM for data persistence (to be added)
- **PostgreSQL**: Database (to be configured)

## Getting Started

### Prerequisites

- .NET 8.0 SDK or later
- PostgreSQL (for production)

### Build

```bash
dotnet build
```

### Run Tests

```bash
dotnet test
```

### Run API

```bash
dotnet run --project src/PitchMate.API
```

## Testing Strategy

This project uses a dual testing approach:

1. **Unit Tests**: Verify specific examples, edge cases, and error conditions
2. **Property-Based Tests**: Verify universal properties across randomized inputs using FsCheck

All property-based tests run with a minimum of 100 iterations to ensure comprehensive coverage.

## Development Workflow

Follow the implementation tasks defined in `.kiro/specs/pitchmate-core/tasks.md` to build the system incrementally with TDD principles.
