# Implementation Plan: PitchMate Core

## Overview

This implementation plan follows Clean Architecture and Test-Driven Development (TDD) principles. We'll build the system layer by layer, starting with the Domain layer (entities, value objects, domain services), then the Application layer (CQRS commands/queries), followed by Infrastructure (EF Core, repositories), and finally the API layer (controllers, authentication).

Each task includes property-based tests and unit tests to ensure correctness. We'll implement core functionality first, then add supporting features.

## Tasks

- [x] 1. Set up solution structure and testing framework
  - Create Clean Architecture solution with Domain, Application, Infrastructure, and API projects
  - Add xUnit, FluentAssertions, and FsCheck NuGet packages
  - Configure test projects for each layer
  - Set up basic project references following dependency rules
  - _Requirements: 7.1, 7.2, 7.3, 7.5_

- [x] 2. Implement core domain value objects
  - [x] 2.1 Create strongly-typed IDs (UserId, SquadId, MatchId)
    - Implement value objects with validation
    - Ensure immutability and equality semantics
    - _Requirements: 7.4_

  - [x] 2.2 Write unit tests for strongly-typed IDs
    - Test equality, immutability, and validation
    - _Requirements: 7.4_

  - [x] 2.3 Create Email value object
    - Implement with email format validation
    - _Requirements: 1.1, 1.2_

  - [x] 2.4 Write property test for Email value object
    - **Property 1: Valid registration creates user account**
    - **Validates: Requirements 1.1**

  - [x] 2.5 Create EloRating value object
    - Implement with range validation (400-2400)
    - Add methods for rating arithmetic
    - _Requirements: 2.3, 5.1, 5.2_

  - [x] 2.6 Write unit tests for EloRating
    - Test range validation and arithmetic operations
    - _Requirements: 2.3, 5.1_

  - [x] 2.7 Create SquadMembership value object
    - Implement with user-squad-rating association
    - _Requirements: 2.2, 2.3, 5.8_

  - [x] 2.8 Create MatchPlayer value object
    - Implement with user and rating-at-match-time
    - _Requirements: 4.1, 5.1_

  - [x] 2.9 Create Team value object
    - Implement with player list and total rating calculation
    - _Requirements: 4.2, 4.3_

  - [x] 2.10 Write unit tests for Team value object
    - Test total rating calculation and player assignment
    - _Requirements: 4.2, 4.3_

- [x] 3. Implement User aggregate
  - [x] 3.1 Create User entity with factory methods
    - Implement CreateWithPassword and CreateWithGoogle factory methods
    - Add squad membership collection
    - Implement JoinSquad and GetMembershipForSquad methods
    - _Requirements: 1.1, 1.6, 2.2, 2.5_

  - [x] 3.2 Write unit tests for User entity
    - Test factory methods and squad membership operations
    - _Requirements: 1.1, 1.6, 2.2_

  - [x] 3.3 Write property test for multiple squad memberships
    - **Property 8: Multiple squad memberships**
    - **Validates: Requirements 2.5**
    - **Status: PASSED (100 iterations)**

- [x] 4. Implement Squad aggregate
  - [x] 4.1 Create Squad entity with factory method
    - Implement Create factory method with creator as admin
    - Add admin and member management methods
    - Implement IsAdmin and IsMember query methods
    - _Requirements: 2.1, 2.2, 2.6, 2.7_

  - [x] 4.2 Write unit tests for Squad entity
    - Test squad creation, admin management, and member operations
    - _Requirements: 2.1, 2.6, 2.7_

  - [x] 4.3 Write property test for squad creation with admin
    - **Property 5: Squad creation with admin**
    - **Validates: Requirements 2.1**

  - [x] 4.4 Write property test for duplicate membership prevention
    - **Property 7: Duplicate membership prevention**
    - **Validates: Requirements 2.4**

- [x] 5. Implement Match aggregate
  - [x] 5.1 Create Match entity with factory method
    - Implement Create factory method with validation (even player count, minimum 2 players)
    - Add team assignment and result recording methods
    - Implement CanRecordResult validation
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 6.2, 6.6_

  - [x] 5.2 Write unit tests for Match entity
    - Test match creation validation and result recording
    - _Requirements: 3.2, 3.4, 3.5, 6.2_

  - [x] 5.3 Write property test for even player count validation
    - **Property 14: Even player count validation**
    - **Validates: Requirements 3.4**
    - **Status: PASSED (100 iterations)**

  - [x] 5.4 Write property test for duplicate result prevention
    - **Property 32: Duplicate result prevention**
    - **Validates: Requirements 6.6**
    - **Status: PASSED (100 iterations)**

- [x] 6. Checkpoint - Ensure all domain entity tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Team Balancing Service
  - [x] 7.1 Create ITeamBalancingService interface
    - Define GenerateBalancedTeams method signature
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 7.2 Implement TeamBalancingService with greedy algorithm
    - Sort players by rating descending
    - Iteratively assign players to team with lower total rating
    - Ensure deterministic behavior
    - _Requirements: 4.2, 4.3, 4.4, 4.5_

  - [x] 7.3 Write property test for minimal rating difference
    - **Property 17: Minimal rating difference**
    - **Validates: Requirements 4.2**

  - [x] 7.4 Write property test for equal team sizes
    - **Property 18: Equal team sizes**
    - **Validates: Requirements 4.3**

  - [x] 7.5 Write property test for deterministic team generation
    - **Property 19: Deterministic team generation**
    - **Validates: Requirements 4.4, 4.5**

  - [x] 7.6 Write unit tests for team balancing edge cases
    - Test with 2 players, 4 players, 10 players
    - Test with equal ratings, vastly different ratings
    - _Requirements: 4.2, 4.3_

- [x] 8. Implement ELO Calculation Service
  - [x] 8.1 Create IEloCalculationService interface
    - Define CalculateRatingChanges method signature
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 8.2 Implement EloCalculationService with team-based formula
    - Calculate average team ratings
    - Calculate expected scores using formula: E = 1 / (1 + 10^((R_B - R_A) / 400))
    - Calculate rating changes: ΔR = K × (S - E)
    - Apply same change to all players on each team
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

  - [x] 8.3 Write property test for ELO formula correctness
    - **Property 22: ELO formula correctness**
    - **Validates: Requirements 5.2**

  - [x] 8.4 Write property test for uniform team rating changes
    - **Property 23: Uniform team rating changes**
    - **Validates: Requirements 5.3, 5.4**

  - [x] 8.5 Write property test for zero-sum rating system
    - **Property 25: Zero-sum rating system**
    - **Validates: Requirements 5.6**

  - [x] 8.6 Write property test for draw rating adjustments
    - **Property 24: Draw rating adjustments**
    - **Validates: Requirements 5.5**

  - [x] 8.7 Write unit tests for ELO calculation scenarios
    - Test win, loss, and draw scenarios
    - Test with different K-factors
    - Test with equal and unequal team ratings
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

- [x] 9. Define repository interfaces
  - [x] 9.1 Create IUserRepository interface
    - Define GetByIdAsync, GetByEmailAsync, GetByGoogleIdAsync, AddAsync, UpdateAsync
    - _Requirements: 7.2, 7.3, 1.1, 1.2, 1.6_

  - [x] 9.2 Create ISquadRepository interface
    - Define GetByIdAsync, GetSquadsForUserAsync, AddAsync, UpdateAsync
    - _Requirements: 7.2, 7.3, 2.1, 2.5_

  - [x] 9.3 Create IMatchRepository interface
    - Define GetByIdAsync, GetMatchesForSquadAsync, AddAsync, UpdateAsync
    - _Requirements: 7.2, 7.3, 3.6, 6.7_

- [x] 10. Checkpoint - Ensure all domain layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement Application layer commands - User management
  - [x] 11.1 Create CreateUserCommand and handler
    - Validate email format
    - Check for duplicate email
    - Hash password using BCrypt or similar
    - Create user entity and persist via repository
    - _Requirements: 1.1, 1.2_

  - [x] 11.2 Write property test for valid registration
    - **Property 1: Valid registration creates user account**
    - **Validates: Requirements 1.1**

  - [x] 11.3 Write property test for duplicate email rejection
    - **Property 2: Duplicate email rejection**
    - **Validates: Requirements 1.2**

  - [x] 11.4 Create AuthenticateUserCommand and handler
    - Validate credentials
    - Generate JWT token on success
    - _Requirements: 1.3, 1.4_

  - [x] 11.5 Write property test for invalid credentials rejection
    - **Property 3: Invalid credentials rejection**
    - **Validates: Requirements 1.4**

  - [x] 11.6 Create AuthenticateWithGoogleCommand and handler
    - Verify Google token
    - Create user if first time, otherwise retrieve existing user
    - Generate JWT token
    - _Requirements: 1.5, 1.6_

  - [x] 11.7 Write property test for Google OAuth user creation
    - **Property 4: Google OAuth user creation**
    - **Validates: Requirements 1.6**

- [x] 12. Implement Application layer commands - Squad management
  - [x] 12.1 Create CreateSquadCommand and handler
    - Create squad with creator as admin
    - Persist via repository
    - _Requirements: 2.1_

  - [x] 12.2 Create JoinSquadCommand and handler
    - Add user to squad with initial rating (1000 or configured default)
    - Prevent duplicate membership
    - _Requirements: 2.2, 2.3, 2.4_

  - [x] 12.3 Write property test for squad membership with initial rating
    - **Property 6: Squad membership with initial rating**
    - **Validates: Requirements 2.2, 2.3**
    - **Status: PASSED (100 iterations)**

  - [x] 12.4 Create AddSquadAdminCommand and handler
    - Validate requesting user is admin
    - Add target user as admin
    - _Requirements: 2.6_

  - [x] 12.5 Write property test for admin privilege management
    - **Property 9: Admin privilege management**
    - **Validates: Requirements 2.6**
    - **Status: PASSED (100 iterations)**

  - [x] 12.6 Create RemoveSquadMemberCommand and handler
    - Validate requesting user is admin
    - Remove member while preserving rating history
    - _Requirements: 2.7_

  - [x] 12.7 Write property test for membership removal preserves history
    - **Property 10: Membership removal preserves history**
    - **Validates: Requirements 2.7**
    - **Status: PASSED (100 iterations)**

- [x] 13. Implement Application layer commands - Match management
  - [x] 13.1 Create CreateMatchCommand and handler
    - Validate requesting user is squad admin
    - Validate player count (even, >= 2)
    - Create match with default team size if not specified
    - Generate balanced teams using ITeamBalancingService
    - Persist match with team assignments
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.6_

  - [x] 13.2 Write property test for admin-only match creation
    - **Property 11: Admin-only match creation**
    - **Validates: Requirements 3.1**

  - [x] 13.3 Write property test for default team size
    - **Property 13: Default team size**
    - **Validates: Requirements 3.3**

  - [x] 13.4 Write property test for team assignment persistence
    - **Property 20: Team assignment persistence**
    - **Validates: Requirements 4.6**

  - [x] 13.5 Create RecordMatchResultCommand and handler
    - Validate requesting user is squad admin
    - Validate match can accept result (not already completed)
    - Record result with timestamp
    - Calculate ELO changes using IEloCalculationService
    - Update player ratings in squad memberships
    - Store optional balance feedback
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 5.1, 5.7_

  - [x] 13.6 Write property test for admin-only result submission
    - **Property 28: Admin-only result submission**
    - **Validates: Requirements 6.1**

  - [x] 13.7 Write property test for result submission triggers updates
    - **Property 30: Result submission triggers updates**
    - **Validates: Requirements 6.3, 6.4**

  - [x] 13.8 Write property test for rating changes for all players
    - **Property 21: Rating changes for all players**
    - **Validates: Requirements 5.1**

  - [x] 13.9 Write property test for independent squad ratings
    - **Property 27: Independent squad ratings**
    - **Validates: Requirements 5.8**

- [x] 14. Implement Application layer queries
  - [x] 14.1 Create GetUserSquadsQuery and handler
    - Retrieve all squads for a user
    - _Requirements: 2.5_

  - [x] 14.2 Create GetSquadMatchesQuery and handler
    - Retrieve all matches for a squad
    - _Requirements: 3.6_

  - [x] 14.3 Create GetUserRatingInSquadQuery and handler
    - Retrieve user's current rating in a specific squad
    - _Requirements: 5.7, 5.8_

  - [x] 14.4 Write unit tests for query handlers
    - Test each query with sample data
    - _Requirements: 2.5, 3.6, 5.7_

- [x] 15. Checkpoint - Ensure all application layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 16. Implement Infrastructure layer - Database configuration
  - [x] 16.1 Create PitchMateDbContext with EF Core
    - Configure DbSets for User, Squad, Match
    - _Requirements: 9.2_

  - [x] 16.2 Configure entity mappings for User
    - Map UserId, Email value objects
    - Configure SquadMemberships as owned entities
    - _Requirements: 9.2, 9.4_

  - [x] 16.3 Configure entity mappings for Squad
    - Map SquadId
    - Configure many-to-many relationship for admins
    - _Requirements: 9.2, 9.4_

  - [x] 16.4 Configure entity mappings for Match
    - Map MatchId
    - Configure MatchPlayers as owned entities
    - Configure MatchResult as owned entity
    - _Requirements: 9.2, 9.4_

  - [x] 16.5 Create initial database migration
    - Generate migration for all entities
    - Review generated SQL for correctness
    - _Requirements: 9.2_

- [x] 17. Implement Infrastructure layer - Repositories
  - [x] 17.1 Implement UserRepository
    - Implement all IUserRepository methods using EF Core
    - Handle errors gracefully
    - _Requirements: 9.1, 9.3_

  - [x] 17.2 Implement SquadRepository
    - Implement all ISquadRepository methods using EF Core
    - Include related entities (members, admins) in queries
    - _Requirements: 9.1, 9.3_

  - [x] 17.3 Implement MatchRepository
    - Implement all IMatchRepository methods using EF Core
    - Include related entities (players, teams, result) in queries
    - _Requirements: 9.1, 9.3_

  - [x] 17.4 Write integration tests for repositories
    - Test CRUD operations with in-memory database
    - Test referential integrity
    - _Requirements: 9.1, 9.4_

  - [x] 17.5 Write property test for referential integrity
    - **Property 38: Referential integrity**
    - **Validates: Requirements 9.4**
    - **Status: PASSED (100 iterations)**

- [x] 18. Implement Infrastructure layer - Configuration service
  - [x] 18.1 Create IConfigurationService interface
    - Define methods for getting default ELO, K-Factor, team size
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 18.2 Implement ConfigurationService
    - Read from system_configuration table
    - Validate configuration values
    - Cache configuration in memory
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 18.3 Write property test for default rating configuration
    - **Property 39: Default rating configuration**
    - **Validates: Requirements 10.1**

  - [x] 18.4 Write property test for K-Factor configuration
    - **Property 40: K-Factor configuration**
    - **Validates: Requirements 10.2**

  - [x] 18.5 Write property test for configuration validation
    - **Property 43: Configuration validation**
    - **Validates: Requirements 10.5**

- [x] 19. Checkpoint - Ensure all infrastructure layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 20. Implement API layer - Authentication and JWT
  - [x] 20.1 Configure JWT authentication in Program.cs
    - Add JWT bearer authentication
    - Configure token validation parameters
    - _Requirements: 1.3, 8.2_

  - [x] 20.2 Create AuthController
    - POST /api/auth/register endpoint
    - POST /api/auth/login endpoint
    - POST /api/auth/google endpoint
    - _Requirements: 1.1, 1.3, 1.5, 8.1, 8.5_

  - [x] 20.3 Write integration tests for AuthController
    - Test registration, login, and Google OAuth flows
    - _Requirements: 1.1, 1.3, 1.5_

  - [x] 20.4 Write property test for authentication enforcement
    - **Property 34: Authentication enforcement**
    - **Validates: Requirements 8.2**

- [x] 21. Implement API layer - Squad endpoints
  - [x] 21.1 Create SquadsController
    - POST /api/squads (create squad)
    - GET /api/squads (get user's squads)
    #
    - POST /api/squads/{id}/join (join squad)
    - POST /api/squads/{id}/admins (add admin)
    - DELETE /api/squads/{id}/members/{userId} (remove member)
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 8.1, 8.5_

  - [x] 21.2 Write integration tests for SquadsController
    - Test all endpoints with valid and invalid inputs
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7_

  - [x] 21.3 Write property test for authorization enforcement
    - **Property 35: Authorization enforcement**
    - **Validates: Requirements 8.3**

- [x] 22. Implement API layer - Match endpoints
  - [x] 22.1 Create MatchesController
    - POST /api/squads/{squadId}/matches (create match)
    - GET /api/squads/{squadId}/matches (get squad matches)
    - POST /api/matches/{id}/result (record result)
    - GET /api/matches/{id} (get match details)
    - _Requirements: 3.1, 3.6, 6.1, 6.7, 8.1, 8.5_

  - [x] 22.2 Write integration tests for MatchesController
    - Test all endpoints with valid and invalid inputs
    - Test authorization for admin-only operations
    - _Requirements: 3.1, 3.6, 6.1, 6.7_
    - **Status: COMPLETED - All 15 tests passing**

  - [x] 22.3 Write property test for invalid request error handling
    - **Property 36: Invalid request error handling**
    - **Validates: Requirements 8.4**
    - **Status: PASSED (100 iterations)**

  - [x] 22.4 Write property test for JSON response format
    - **Property 37: JSON response format**
    - **Validates: Requirements 8.6**
    - **Status: PASSED (100 iterations) - All 4 property tests passing**

- [x] 23. Implement API layer - User and rating endpoints
  - [x] 23.1 Create UsersController
    - GET /api/users/me (get current user)
    - GET /api/users/me/squads (get user's squads with ratings)
    - GET /api/users/{id}/squads/{squadId}/rating (get user rating in squad)
    - _Requirements: 5.7, 5.8, 8.1, 8.5_

  - [x] 23.2 Write integration tests for UsersController
    - Test all endpoints
    - _Requirements: 5.7, 5.8_

- [x] 24. Checkpoint - Ensure all API layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 25. Set up frontend Next.js project
  - [ ] 25.1 Initialize Next.js project with TypeScript and App Router
    - Configure Tailwind CSS and shadcn/ui
    - Set up project structure (app/, components/, lib/)
    - _Requirements: 11.1, 11.2, 12.1_

  - [ ] 25.2 Create API client service
    - Implement REST API client with authentication
    - Handle JWT token storage and refresh
    - _Requirements: 8.1, 8.2_

  - [ ] 25.3 Set up responsive layout with navigation
    - Create root layout with responsive navigation
    - Implement mobile menu and desktop navigation
    - Apply consistent design system
    - _Requirements: 11.1, 11.2, 11.6, 12.2_

- [ ] 26. Implement frontend - Authentication pages
  - [ ] 26.1 Create login page
    - Email/password form
    - Google OAuth button
    - Responsive design
    - _Requirements: 1.1, 1.3, 1.5, 11.1, 11.2_

  - [ ] 26.2 Create registration page
    - Email/password form
    - Form validation
    - Responsive design
    - _Requirements: 1.1, 11.1, 11.2_

  - [ ] 26.3 Test authentication pages on mobile and desktop
    - Verify responsive behavior
    - _Requirements: 11.1, 11.2_

- [ ] 27. Implement frontend - Squad management pages
  - [ ] 27.1 Create squads list page
    - Display user's squads
    - Create new squad button
    - Responsive grid/list layout
    - _Requirements: 2.1, 2.5, 11.1, 11.2_

  - [ ] 27.2 Create squad detail page
    - Display squad members with ratings
    - Admin controls (add admin, remove member)
    - Join squad button for non-members
    - Responsive layout
    - _Requirements: 2.2, 2.6, 2.7, 11.1, 11.2_

  - [ ] 27.3 Test squad pages on mobile and desktop
    - Verify responsive behavior and touch interactions
    - _Requirements: 11.1, 11.2, 11.4, 11.5_

- [ ] 28. Implement frontend - Match management pages
  - [ ] 28.1 Create matches list page
    - Display squad matches (upcoming and completed)
    - Create match button for admins
    - Responsive layout
    - _Requirements: 3.1, 3.6, 11.1, 11.2_

  - [ ] 28.2 Create match creation page
    - Player selection from squad members
    - Team size configuration
    - Date/time picker
    - Responsive form
    - _Requirements: 3.1, 3.2, 3.3, 11.1, 11.2_

  - [ ] 28.3 Create match detail page
    - Display teams with player ratings
    - Record result form for admins
    - Balance feedback input
    - Responsive layout
    - _Requirements: 4.6, 6.1, 6.2, 6.5, 11.1, 11.2_

  - [ ] 28.4 Test match pages on mobile and desktop
    - Verify responsive behavior and form interactions
    - _Requirements: 11.1, 11.2, 11.4, 11.5_

- [ ] 29. Implement frontend - Design system and accessibility
  - [ ] 29.1 Create reusable UI components
    - Button, Input, Card, Modal components using shadcn/ui
    - Apply consistent styling and spacing
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ] 29.2 Implement visual feedback for interactions
    - Hover, focus, and active states
    - Loading states and spinners
    - Success/error notifications
    - _Requirements: 12.5_

  - [ ] 29.3 Test color contrast for accessibility
    - **Property 44: Color contrast compliance**
    - **Validates: Requirements 12.6**

  - [ ] 29.4 Test responsive breakpoints
    - Verify layout adjustments at different screen sizes
    - _Requirements: 11.6_

- [ ] 30. Final integration and end-to-end testing
  - [ ] 30.1 Set up Supabase PostgreSQL database
    - Create database instance
    - Run EF Core migrations
    - Seed initial configuration data
    - _Requirements: 9.2, 10.1, 10.2, 10.3_

  - [ ] 30.2 Configure Google OAuth credentials
    - Set up Google Cloud project
    - Configure OAuth consent screen
    - Add credentials to backend configuration
    - _Requirements: 1.5_

  - [ ] 30.3 Perform end-to-end testing
    - Test complete user flows (register, create squad, create match, record result)
    - Verify ELO calculations are correct
    - Test on mobile and desktop devices
    - _Requirements: All_

  - [ ] 30.4 Review and fix any remaining issues
    - Address any bugs found during testing
    - Ensure all property tests pass with 100+ iterations
    - Verify code coverage meets goals

- [ ] 31. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties with 100+ iterations
- Unit tests validate specific examples and edge cases
- Follow TDD: write tests before implementation
- Domain layer must remain framework-independent
- All business logic resides in Domain and Application layers
- Infrastructure and API layers are thin adapters
