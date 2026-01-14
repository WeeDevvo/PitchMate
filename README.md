# PitchMate

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
