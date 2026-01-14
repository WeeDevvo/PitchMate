# Design Document: PitchMate Core

## Overview

PitchMate is built using Clean Architecture principles with a clear separation between Domain, Application, Infrastructure, and API layers. The system implements a team-based ELO rating system to create balanced five-a-side football matches. The architecture ensures that business logic remains independent of frameworks and infrastructure concerns, making the system highly testable and maintainable.

The core domain revolves around three main aggregates: User, Squad, and Match. Each aggregate maintains its own consistency boundaries and business rules. The ELO rating system is implemented as a domain service that operates on these aggregates to calculate fair team compositions and update player ratings based on match outcomes.

## Architecture

### Clean Architecture Layers

```
┌─────────────────────────────────────────┐
│           API Layer (Web API)           │
│  - Controllers                          │
│  - Authentication/Authorization         │
│  - Request/Response DTOs                │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│        Application Layer (CQRS)         │
│  - Commands & Command Handlers          │
│  - Queries & Query Handlers             │
│  - Application Services                 │
│  - DTOs & Mapping                       │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│           Domain Layer (Core)           │
│  - Entities & Aggregates                │
│  - Value Objects                        │
│  - Domain Services                      │
│  - Repository Interfaces                │
│  - Domain Events                        │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│      Infrastructure Layer (Data)        │
│  - EF Core DbContext                    │
│  - Repository Implementations           │
│  - External Service Integrations        │
│  - Configuration                        │
└─────────────────────────────────────────┘
```

### Layer Responsibilities

**Domain Layer:**
- Contains all business logic and rules
- Defines entities, value objects, and aggregates
- Declares repository interfaces
- Implements domain services (ELO calculation, team balancing)
- No dependencies on other layers or frameworks

**Application Layer:**
- Orchestrates use cases using CQRS pattern
- Implements commands (write operations) and queries (read operations)
- Handles transaction boundaries
- Maps between domain models and DTOs
- Depends only on Domain layer

**Infrastructure Layer:**
- Implements repository interfaces using EF Core
- Configures database mappings and migrations
- Integrates with external services (Google OAuth)
- Depends on Domain and Application layers

**API Layer:**
- Exposes RESTful endpoints
- Handles HTTP concerns (routing, status codes)
- Implements JWT authentication and authorization
- Validates requests and formats responses
- Depends on Application layer

## Components and Interfaces

### Domain Entities

#### User (Aggregate Root)
```csharp
public class User
{
    public UserId Id { get; private set; }
    public Email Email { get; private set; }
    public string PasswordHash { get; private set; }
    public string? GoogleId { get; private set; }
    public DateTime CreatedAt { get; private set; }
    
    private readonly List<SquadMembership> _squadMemberships;
    public IReadOnlyCollection<SquadMembership> SquadMemberships => _squadMemberships.AsReadOnly();
    
    // Factory methods
    public static User CreateWithPassword(Email email, string passwordHash);
    public static User CreateWithGoogle(Email email, string googleId);
    
    // Business methods
    public void JoinSquad(SquadId squadId, EloRating initialRating);
    public SquadMembership GetMembershipForSquad(SquadId squadId);
}
```

#### Squad (Aggregate Root)
```csharp
public class Squad
{
    public SquadId Id { get; private set; }
    public string Name { get; private set; }
    public DateTime CreatedAt { get; private set; }
    
    private readonly List<UserId> _adminIds;
    public IReadOnlyCollection<UserId> AdminIds => _adminIds.AsReadOnly();
    
    private readonly List<SquadMembership> _members;
    public IReadOnlyCollection<SquadMembership> Members => _members.AsReadOnly();
    
    // Factory method
    public static Squad Create(string name, UserId creatorId);
    
    // Business methods
    public void AddAdmin(UserId userId);
    public void RemoveAdmin(UserId userId);
    public void AddMember(UserId userId, EloRating initialRating);
    public void RemoveMember(UserId userId);
    public bool IsAdmin(UserId userId);
    public bool IsMember(UserId userId);
}
```

#### Match (Aggregate Root)
```csharp
public class Match
{
    public MatchId Id { get; private set; }
    public SquadId SquadId { get; private set; }
    public DateTime ScheduledAt { get; private set; }
    public int TeamSize { get; private set; }
    public MatchStatus Status { get; private set; }
    
    private readonly List<MatchPlayer> _players;
    public IReadOnlyCollection<MatchPlayer> Players => _players.AsReadOnly();
    
    private Team? _teamA;
    private Team? _teamB;
    public Team? TeamA => _teamA;
    public Team? TeamB => _teamB;
    
    public MatchResult? Result { get; private set; }
    
    // Factory method
    public static Match Create(SquadId squadId, DateTime scheduledAt, 
        IEnumerable<UserId> playerIds, int teamSize = 5);
    
    // Business methods
    public void AssignTeams(Team teamA, Team teamB);
    public void RecordResult(TeamDesignation winner, string? balanceFeedback = null);
    public bool CanRecordResult();
}
```

### Value Objects

#### EloRating
```csharp
public record EloRating
{
    public int Value { get; init; }
    
    public static EloRating Default => new(1000);
    public static EloRating Create(int value);
    
    public EloRating Add(int change) => new(Value + change);
    public EloRating Subtract(int change) => new(Value - change);
}
```

#### SquadMembership
```csharp
public record SquadMembership
{
    public UserId UserId { get; init; }
    public SquadId SquadId { get; init; }
    public EloRating CurrentRating { get; init; }
    public DateTime JoinedAt { get; init; }
    
    public SquadMembership UpdateRating(EloRating newRating);
}
```

#### Team
```csharp
public record Team
{
    public IReadOnlyList<MatchPlayer> Players { get; init; }
    public int TotalRating { get; init; }
    
    public static Team Create(IEnumerable<MatchPlayer> players);
}
```

#### MatchPlayer
```csharp
public record MatchPlayer
{
    public UserId UserId { get; init; }
    public EloRating RatingAtMatchTime { get; init; }
    
    public static MatchPlayer Create(UserId userId, EloRating rating);
}
```

### Domain Services

#### ITeamBalancingService
```csharp
public interface ITeamBalancingService
{
    (Team teamA, Team teamB) GenerateBalancedTeams(
        IReadOnlyList<MatchPlayer> players, 
        int teamSize);
}
```

**Implementation Strategy:**
The team balancing algorithm uses a greedy approach to minimize rating difference:
1. Sort players by rating (descending)
2. Initialize two empty teams
3. Iteratively assign each player to the team with lower total rating
4. Return the two balanced teams

This approach is deterministic and runs in O(n log n) time.

#### IEloCalculationService
```csharp
public interface IEloCalculationService
{
    Dictionary<UserId, int> CalculateRatingChanges(
        Team teamA, 
        Team teamB, 
        MatchOutcome outcome,
        int kFactor);
}
```

**Implementation Strategy:**
Uses the standard team-based ELO formula:
1. Calculate average rating for each team
2. Calculate expected score: E_A = 1 / (1 + 10^((R_B - R_A) / 400))
3. Calculate actual score: S_A = 1 (win), 0.5 (draw), 0 (loss)
4. Calculate rating change: ΔR = K * (S_A - E_A)
5. Apply same change to all players on each team
6. Ensure zero-sum property (total changes = 0)

### Repository Interfaces

```csharp
public interface IUserRepository
{
    Task<User?> GetByIdAsync(UserId id, CancellationToken ct = default);
    Task<User?> GetByEmailAsync(Email email, CancellationToken ct = default);
    Task<User?> GetByGoogleIdAsync(string googleId, CancellationToken ct = default);
    Task AddAsync(User user, CancellationToken ct = default);
    Task UpdateAsync(User user, CancellationToken ct = default);
}

public interface ISquadRepository
{
    Task<Squad?> GetByIdAsync(SquadId id, CancellationToken ct = default);
    Task<IReadOnlyList<Squad>> GetSquadsForUserAsync(UserId userId, CancellationToken ct = default);
    Task AddAsync(Squad squad, CancellationToken ct = default);
    Task UpdateAsync(Squad squad, CancellationToken ct = default);
}

public interface IMatchRepository
{
    Task<Match?> GetByIdAsync(MatchId id, CancellationToken ct = default);
    Task<IReadOnlyList<Match>> GetMatchesForSquadAsync(SquadId squadId, CancellationToken ct = default);
    Task AddAsync(Match match, CancellationToken ct = default);
    Task UpdateAsync(Match match, CancellationToken ct = default);
}
```

### Application Layer (CQRS)

#### Commands

**CreateUserCommand**
```csharp
public record CreateUserCommand(string Email, string Password);

public class CreateUserCommandHandler
{
    public async Task<UserId> Handle(CreateUserCommand command, CancellationToken ct)
    {
        // 1. Validate email format
        // 2. Check if user already exists
        // 3. Hash password
        // 4. Create user entity
        // 5. Persist via repository
        // 6. Return user ID
    }
}
```

**CreateSquadCommand**
```csharp
public record CreateSquadCommand(string Name, UserId CreatorId);
```

**CreateMatchCommand**
```csharp
public record CreateMatchCommand(
    SquadId SquadId, 
    DateTime ScheduledAt, 
    List<UserId> PlayerIds, 
    int TeamSize,
    UserId RequestingUserId);
```

**RecordMatchResultCommand**
```csharp
public record RecordMatchResultCommand(
    MatchId MatchId,
    TeamDesignation Winner,
    string? BalanceFeedback,
    UserId RequestingUserId);
```

#### Queries

**GetUserSquadsQuery**
```csharp
public record GetUserSquadsQuery(UserId UserId);
```

**GetSquadMatchesQuery**
```csharp
public record GetSquadMatchesQuery(SquadId SquadId);
```

**GetUserRatingInSquadQuery**
```csharp
public record GetUserRatingInSquadQuery(UserId UserId, SquadId SquadId);
```

## Data Models

### Database Schema

```sql
-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    google_id VARCHAR(255) UNIQUE,
    created_at TIMESTAMP NOT NULL,
    CONSTRAINT chk_auth_method CHECK (
        (password_hash IS NOT NULL AND google_id IS NULL) OR
        (password_hash IS NULL AND google_id IS NOT NULL)
    )
);

-- Squads table
CREATE TABLE squads (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL
);

-- Squad admins (many-to-many)
CREATE TABLE squad_admins (
    squad_id UUID REFERENCES squads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (squad_id, user_id)
);

-- Squad memberships with ELO ratings
CREATE TABLE squad_memberships (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    squad_id UUID REFERENCES squads(id) ON DELETE CASCADE,
    current_rating INT NOT NULL DEFAULT 1000,
    joined_at TIMESTAMP NOT NULL,
    PRIMARY KEY (user_id, squad_id)
);

-- Matches table
CREATE TABLE matches (
    id UUID PRIMARY KEY,
    squad_id UUID REFERENCES squads(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMP NOT NULL,
    team_size INT NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at TIMESTAMP NOT NULL
);

-- Match players (stores rating at match time)
CREATE TABLE match_players (
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    rating_at_match_time INT NOT NULL,
    team_designation VARCHAR(10), -- 'TeamA' or 'TeamB'
    PRIMARY KEY (match_id, user_id)
);

-- Match results
CREATE TABLE match_results (
    match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE CASCADE,
    winner VARCHAR(10) NOT NULL, -- 'TeamA', 'TeamB', or 'Draw'
    balance_feedback TEXT,
    recorded_at TIMESTAMP NOT NULL
);

-- ELO rating history (for analytics)
CREATE TABLE rating_history (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    squad_id UUID REFERENCES squads(id) ON DELETE CASCADE,
    match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
    old_rating INT NOT NULL,
    new_rating INT NOT NULL,
    change INT NOT NULL,
    recorded_at TIMESTAMP NOT NULL
);

-- Configuration table
CREATE TABLE system_configuration (
    key VARCHAR(100) PRIMARY KEY,
    value VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP NOT NULL
);
```

### Entity Framework Core Configuration

```csharp
public class PitchMateDbContext : DbContext
{
    public DbSet<User> Users { get; set; }
    public DbSet<Squad> Squads { get; set; }
    public DbSet<Match> Matches { get; set; }
    
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        // User configuration
        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(u => u.Id);
            entity.Property(u => u.Id)
                .HasConversion(id => id.Value, value => new UserId(value));
            
            entity.OwnsOne(u => u.Email, email =>
            {
                email.Property(e => e.Value).HasColumnName("email");
            });
            
            entity.OwnsMany(u => u.SquadMemberships, membership =>
            {
                membership.ToTable("squad_memberships");
                membership.WithOwner().HasForeignKey("user_id");
                membership.Property<Guid>("squad_id");
                membership.OwnsOne(m => m.CurrentRating);
            });
        });
        
        // Squad configuration
        modelBuilder.Entity<Squad>(entity =>
        {
            entity.HasKey(s => s.Id);
            entity.Property(s => s.Id)
                .HasConversion(id => id.Value, value => new SquadId(value));
            
            entity.HasMany<User>()
                .WithMany()
                .UsingEntity("squad_admins");
        });
        
        // Match configuration
        modelBuilder.Entity<Match>(entity =>
        {
            entity.HasKey(m => m.Id);
            entity.Property(m => m.Id)
                .HasConversion(id => id.Value, value => new MatchId(value));
            
            entity.OwnsMany(m => m.Players, player =>
            {
                player.ToTable("match_players");
                player.WithOwner().HasForeignKey("match_id");
                player.OwnsOne(p => p.RatingAtMatchTime);
            });
            
            entity.OwnsOne(m => m.Result);
        });
    }
}
```


## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### User Authentication Properties

**Property 1: Valid registration creates user account**
*For any* valid email and password combination, creating a user account should result in a persisted user with those credentials that can subsequently authenticate.
**Validates: Requirements 1.1, 1.3**

**Property 2: Duplicate email rejection**
*For any* existing user email, attempting to register another user with the same email should be rejected with an appropriate error.
**Validates: Requirements 1.2**

**Property 3: Invalid credentials rejection**
*For any* user account, attempting to authenticate with incorrect credentials should be rejected and not issue a token.
**Validates: Requirements 1.4**

**Property 4: Google OAuth user creation**
*For any* new Google ID, authenticating via Google OAuth should create a user account linked to that Google identity.
**Validates: Requirements 1.6**

### Squad Management Properties

**Property 5: Squad creation with admin**
*For any* valid squad name and creator user, creating a squad should result in a persisted squad with the creator as an admin.
**Validates: Requirements 2.1**

**Property 6: Squad membership with initial rating**
*For any* user and squad, when a user joins a squad for the first time, they should be added to the member list with an ELO rating of 1000.
**Validates: Requirements 2.2, 2.3**

**Property 7: Duplicate membership prevention**
*For any* user already in a squad, attempting to join the same squad again should either be rejected or have no effect (idempotent).
**Validates: Requirements 2.4**

**Property 8: Multiple squad memberships**
*For any* user and any set of squads, a user should be able to join multiple squads and maintain separate memberships in each.
**Validates: Requirements 2.5**

**Property 9: Admin privilege management**
*For any* squad admin and target user, adding a user as admin should grant them admin privileges that can be verified.
**Validates: Requirements 2.6**

**Property 10: Membership removal preserves history**
*For any* squad member, removing them from the squad should remove their active membership while preserving their historical ELO rating data.
**Validates: Requirements 2.7**

### Match Creation Properties

**Property 11: Admin-only match creation**
*For any* squad and user, only users with admin privileges for that squad should be able to create matches.
**Validates: Requirements 3.1**

**Property 12: Match requires valid parameters**
*For any* match creation attempt, the system should require date, time, and a list of players, rejecting requests missing these parameters.
**Validates: Requirements 3.2**

**Property 13: Default team size**
*For any* match created without specifying team size, the system should default to 5 players per team.
**Validates: Requirements 3.3**

**Property 14: Even player count validation**
*For any* match creation with an odd number of players, the system should reject the creation.
**Validates: Requirements 3.4**

**Property 15: Valid match persistence**
*For any* valid match parameters (even player count ≥ 2, valid date, admin creator), the system should persist the match in pending status.
**Validates: Requirements 3.6**

### Team Balancing Properties

**Property 16: Team balancing uses current ratings**
*For any* set of players in a squad, the team balancing algorithm should use each player's current ELO rating for that specific squad.
**Validates: Requirements 4.1**

**Property 17: Minimal rating difference**
*For any* set of players, the generated teams should minimize the absolute difference between total team ratings (optimal or near-optimal balance).
**Validates: Requirements 4.2**

**Property 18: Equal team sizes**
*For any* set of players, the generated teams should have exactly half the players on each team.
**Validates: Requirements 4.3**

**Property 19: Deterministic team generation**
*For any* set of players with specific ratings, running the team balancing algorithm multiple times should produce the same team assignments.
**Validates: Requirements 4.4, 4.5**

**Property 20: Team assignment persistence**
*For any* match with generated teams, the team assignments should be persisted with the match.
**Validates: Requirements 4.6**

### ELO Rating Properties

**Property 21: Rating changes for all players**
*For any* completed match, all participating players should have their ELO ratings recalculated.
**Validates: Requirements 5.1**

**Property 22: ELO formula correctness**
*For any* match result, the rating changes should be calculated using the team-based ELO formula: ΔR = K × (S - E), where E = 1 / (1 + 10^((R_opponent - R_team) / 400)).
**Validates: Requirements 5.2**

**Property 23: Uniform team rating changes**
*For any* match result, all players on the same team should receive the same rating change (increase for winners, decrease for losers).
**Validates: Requirements 5.3, 5.4**

**Property 24: Draw rating adjustments**
*For any* match ending in a draw, the higher-rated team should lose rating points and the lower-rated team should gain rating points according to the ELO formula.
**Validates: Requirements 5.5**

**Property 25: Zero-sum rating system**
*For any* match result, the sum of all rating changes across all players should equal zero.
**Validates: Requirements 5.6**

**Property 26: Rating persistence**
*For any* player rating update, the new rating should be persisted and retrievable for that user-squad combination.
**Validates: Requirements 5.7**

**Property 27: Independent squad ratings**
*For any* user in multiple squads, rating changes in one squad should not affect their ratings in other squads.
**Validates: Requirements 5.8**

### Match Result Properties

**Property 28: Admin-only result submission**
*For any* match and user, only squad admins should be able to submit match results.
**Validates: Requirements 6.1**

**Property 29: Result requires winner specification**
*For any* match result submission, the system should require specification of the winning team or draw.
**Validates: Requirements 6.2**

**Property 30: Result submission triggers updates**
*For any* match result submission, the system should update the match status to completed and trigger ELO rating updates for all players.
**Validates: Requirements 6.3, 6.4**

**Property 31: Optional feedback storage**
*For any* match result with subjective balance feedback, the feedback should be stored; results without feedback should also be accepted.
**Validates: Requirements 6.5**

**Property 32: Duplicate result prevention**
*For any* already-completed match, attempting to submit another result should be rejected.
**Validates: Requirements 6.6**

**Property 33: Result persistence with timestamp**
*For any* match result submission, the result and submission timestamp should be persisted.
**Validates: Requirements 6.7**

### API Properties

**Property 34: Authentication enforcement**
*For any* protected API endpoint, requests without valid authentication tokens should be rejected with 401 Unauthorized.
**Validates: Requirements 8.2**

**Property 35: Authorization enforcement**
*For any* API endpoint requiring specific permissions, requests from users without those permissions should be rejected with 403 Forbidden.
**Validates: Requirements 8.3**

**Property 36: Invalid request error handling**
*For any* invalid API request (malformed data, missing fields), the system should return appropriate HTTP status codes (400, 422) and descriptive error messages.
**Validates: Requirements 8.4**

**Property 37: JSON response format**
*For any* API endpoint response, the content should be in valid JSON format.
**Validates: Requirements 8.6**

### Data Integrity Properties

**Property 38: Referential integrity**
*For any* related entities (e.g., match and squad), the system should maintain referential integrity and prevent orphaned records.
**Validates: Requirements 9.4**

### Configuration Properties

**Property 39: Default rating configuration**
*For any* configured default ELO rating value, new players joining squads should receive that configured rating.
**Validates: Requirements 10.1**

**Property 40: K-Factor configuration**
*For any* configured K-Factor value, ELO calculations should use that value in the rating change formula.
**Validates: Requirements 10.2**

**Property 41: Default team size configuration**
*For any* configured default team size, matches created without specifying team size should use that configured default.
**Validates: Requirements 10.3**

**Property 42: Configuration application**
*For any* configuration change, subsequent operations should use the new configuration values.
**Validates: Requirements 10.4**

**Property 43: Configuration validation**
*For any* configuration value outside acceptable ranges (e.g., negative K-Factor, team size < 1), the system should reject the configuration change.
**Validates: Requirements 10.5**

### Accessibility Properties

**Property 44: Color contrast compliance**
*For any* UI element with text, the color contrast ratio should meet WCAG AA standards (minimum 4.5:1 for normal text, 3:1 for large text).
**Validates: Requirements 12.6**

## Error Handling

### Domain Layer Error Handling

The domain layer uses a Result pattern to handle errors without exceptions:

```csharp
public record Result<T>
{
    public bool IsSuccess { get; init; }
    public T? Value { get; init; }
    public Error? Error { get; init; }
    
    public static Result<T> Success(T value) => new() { IsSuccess = true, Value = value };
    public static Result<T> Failure(Error error) => new() { IsSuccess = false, Error = error };
}

public record Error(string Code, string Message);
```

### Common Error Scenarios

**Authentication Errors:**
- `AUTH_001`: Invalid credentials
- `AUTH_002`: Email already exists
- `AUTH_003`: Invalid token
- `AUTH_004`: Token expired

**Authorization Errors:**
- `AUTHZ_001`: User is not a squad admin
- `AUTHZ_002`: User is not a squad member
- `AUTHZ_003`: Insufficient permissions

**Validation Errors:**
- `VAL_001`: Invalid email format
- `VAL_002`: Password too weak
- `VAL_003`: Odd number of players
- `VAL_004`: Insufficient players (< 2)
- `VAL_005`: Invalid configuration value

**Business Rule Errors:**
- `BUS_001`: User already in squad
- `BUS_002`: Match already completed
- `BUS_003`: Cannot remove last admin
- `BUS_004`: Player not in squad

**Infrastructure Errors:**
- `INF_001`: Database connection failed
- `INF_002`: External service unavailable
- `INF_003`: Transaction failed

### Error Handling Strategy

1. **Domain Layer**: Returns Result<T> with domain-specific errors
2. **Application Layer**: Catches domain errors and maps to application errors
3. **API Layer**: Maps application errors to HTTP status codes and JSON responses
4. **Infrastructure Layer**: Catches infrastructure exceptions and wraps in Result<T>

## Testing Strategy

### Dual Testing Approach

PitchMate will use both unit testing and property-based testing to ensure comprehensive coverage:

**Unit Tests:**
- Test specific examples and edge cases
- Verify integration points between components
- Test error conditions and boundary values
- Focus on concrete scenarios (e.g., "user with email 'test@example.com' can register")

**Property-Based Tests:**
- Verify universal properties across all inputs
- Use randomized input generation to find edge cases
- Test invariants and mathematical properties
- Focus on general rules (e.g., "for any valid email, registration succeeds")

Both testing approaches are complementary and necessary for production-ready code.

### Property-Based Testing Framework

**Framework:** FsCheck for .NET
- Integrates with xUnit
- Provides generators for random test data
- Supports custom generators for domain types
- Minimum 100 iterations per property test

### Test Organization

```
PitchMate.Domain.Tests/
├── Entities/
│   ├── UserTests.cs (unit tests)
│   ├── SquadTests.cs (unit tests)
│   └── MatchTests.cs (unit tests)
├── Services/
│   ├── TeamBalancingServiceTests.cs (unit + property tests)
│   └── EloCalculationServiceTests.cs (unit + property tests)
└── Properties/
    ├── AuthenticationProperties.cs (property tests)
    ├── SquadManagementProperties.cs (property tests)
    ├── MatchCreationProperties.cs (property tests)
    ├── TeamBalancingProperties.cs (property tests)
    ├── EloRatingProperties.cs (property tests)
    └── ConfigurationProperties.cs (property tests)

PitchMate.Application.Tests/
├── Commands/
│   └── [CommandName]HandlerTests.cs (unit tests)
├── Queries/
│   └── [QueryName]HandlerTests.cs (unit tests)
└── Properties/
    └── ApplicationProperties.cs (property tests)

PitchMate.API.Tests/
├── Controllers/
│   └── [ControllerName]Tests.cs (integration tests)
└── Properties/
    └── ApiProperties.cs (property tests)
```

### Property Test Tagging

Each property-based test must include a comment tag referencing the design property:

```csharp
[Property]
public Property ZeroSumRatingSystem()
{
    // Feature: pitchmate-core, Property 25: Zero-sum rating system
    // For any match result, the sum of all rating changes should equal zero
    
    return Prop.ForAll(
        MatchResultGenerator.Generate(),
        matchResult =>
        {
            var changes = _eloService.CalculateRatingChanges(
                matchResult.TeamA, 
                matchResult.TeamB, 
                matchResult.Outcome,
                kFactor: 32);
            
            return changes.Values.Sum() == 0;
        });
}
```

### Custom Generators

Property-based tests require custom generators for domain types:

```csharp
public static class Generators
{
    public static Arbitrary<Email> EmailGenerator() =>
        Arb.From(
            from localPart in Gen.AlphaNumStr
            from domain in Gen.Elements("example.com", "test.com", "mail.com")
            select Email.Create($"{localPart}@{domain}").Value);
    
    public static Arbitrary<EloRating> EloRatingGenerator() =>
        Arb.From(
            from rating in Gen.Choose(400, 2400)
            select EloRating.Create(rating));
    
    public static Arbitrary<MatchPlayer> MatchPlayerGenerator() =>
        Arb.From(
            from userId in Arb.Generate<Guid>()
            from rating in EloRatingGenerator().Generator
            select MatchPlayer.Create(new UserId(userId), rating));
}
```

### Test Coverage Goals

- **Domain Layer**: 100% coverage (all business logic must be tested)
- **Application Layer**: 90%+ coverage (command/query handlers)
- **API Layer**: 80%+ coverage (controller actions)
- **Infrastructure Layer**: 70%+ coverage (repository implementations)

### Testing Best Practices

1. **Write tests first** (TDD): Write failing tests before implementation
2. **Test behavior, not implementation**: Focus on what the code does, not how
3. **Keep tests simple**: Each test should verify one thing
4. **Use descriptive names**: Test names should explain what is being tested
5. **Avoid mocking domain logic**: Use real domain objects in tests
6. **Mock only infrastructure**: Mock repositories, external services, etc.
7. **Property tests for algorithms**: Use property-based testing for ELO and team balancing
8. **Unit tests for examples**: Use unit tests for specific scenarios and edge cases

### Continuous Integration

All tests must pass before code can be merged:
- Run unit tests on every commit
- Run property tests (100 iterations minimum) on every commit
- Run integration tests on pull requests
- Measure and report code coverage
- Fail builds if coverage drops below thresholds
