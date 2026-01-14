# Requirements Document

## Introduction

PitchMate is a five-a-side football match organizer that creates fair and enjoyable games by automatically generating balanced teams using an ELO-based rating system. The system allows players to join multiple squads, organize matches within those squads, and maintain separate skill ratings per squad to reflect different competitive levels.

## Glossary

- **User**: A registered player who can join squads and participate in matches
- **Squad**: A group of users who organize matches together
- **Squad_Admin**: A user with administrative privileges for a specific squad
- **Match**: A scheduled game between two teams within a squad
- **Team**: A group of players assigned to one side of a match
- **ELO_Rating**: A numerical skill rating for a user within a specific squad
- **K_Factor**: A configurable parameter that determines the magnitude of ELO rating changes
- **Team_Balance_Algorithm**: The algorithm that generates balanced teams based on ELO ratings
- **Match_Result**: The outcome of a completed match (win/loss/draw)
- **Authentication_Service**: The service responsible for user authentication and authorization
- **Repository**: An interface for data persistence operations

## Requirements

### Requirement 1: User Registration and Authentication

**User Story:** As a player, I want to register and log in to the system, so that I can access my profile and participate in matches.

#### Acceptance Criteria

1. WHEN a user provides valid email and password credentials, THE Authentication_Service SHALL create a new user account
2. WHEN a user provides an email that already exists, THE Authentication_Service SHALL reject the registration and return an error
3. WHEN a user logs in with valid credentials, THE Authentication_Service SHALL issue a JWT access token
4. WHEN a user logs in with invalid credentials, THE Authentication_Service SHALL reject the login attempt
5. WHERE Google OAuth is configured, THE Authentication_Service SHALL allow users to authenticate using their Google account
6. WHEN a user authenticates via Google OAuth for the first time, THE Authentication_Service SHALL create a new user account linked to their Google identity

### Requirement 2: Squad Management

**User Story:** As a player, I want to join and belong to multiple squads, so that I can play with different groups of people.

#### Acceptance Criteria

1. WHEN a Squad_Admin creates a squad, THE System SHALL persist the squad with the creator as an admin
2. WHEN a user joins a squad, THE System SHALL add the user to the squad's member list
3. WHEN a user joins a squad for the first time, THE System SHALL initialize their ELO_Rating for that squad to the default value (1000)
4. WHEN a user is already a member of a squad, THE System SHALL prevent duplicate membership
5. THE System SHALL allow a user to be a member of multiple squads simultaneously
6. WHEN a Squad_Admin adds another admin to the squad, THE System SHALL grant that user admin privileges for the squad
7. WHEN a Squad_Admin removes a user from the squad, THE System SHALL remove the user's membership and preserve their historical ELO_Rating

### Requirement 3: Match Creation

**User Story:** As a squad admin, I want to create matches for my squad, so that I can organize games with squad members.

#### Acceptance Criteria

1. WHEN a Squad_Admin creates a match, THE System SHALL validate that the user has admin privileges for the squad
2. WHEN creating a match, THE System SHALL require a date, time, and list of selected players from the squad
3. WHEN creating a match, THE System SHALL allow specification of team size with a default of 5 players per team
4. WHEN the number of selected players is not evenly divisible by 2, THE System SHALL reject the match creation
5. WHEN the number of selected players is less than 2, THE System SHALL reject the match creation
6. WHEN a match is created with valid parameters, THE System SHALL persist the match in a pending state

### Requirement 4: Team Generation

**User Story:** As a squad admin, I want teams to be generated automatically based on player ratings, so that matches are balanced and competitive.

#### Acceptance Criteria

1. WHEN a match requires team generation, THE Team_Balance_Algorithm SHALL use each player's current ELO_Rating for that squad
2. WHEN generating teams, THE Team_Balance_Algorithm SHALL minimize the absolute difference between total team ratings
3. WHEN generating teams, THE Team_Balance_Algorithm SHALL assign exactly half of the players to each team
4. THE Team_Balance_Algorithm SHALL produce deterministic results for the same input
5. WHEN multiple team configurations have equal balance, THE Team_Balance_Algorithm SHALL select one consistently
6. WHEN team generation completes, THE System SHALL persist the team assignments with the match

### Requirement 5: ELO Rating System

**User Story:** As a player, I want my skill rating to be updated based on match results, so that my rating accurately reflects my performance level.

#### Acceptance Criteria

1. WHEN a match result is submitted, THE System SHALL calculate ELO rating changes for all participating players
2. WHEN calculating ELO changes, THE System SHALL use the team-based ELO formula with the configured K_Factor
3. WHEN a team wins, THE System SHALL increase the ELO_Rating for all players on the winning team by the same amount
4. WHEN a team loses, THE System SHALL decrease the ELO_Rating for all players on the losing team by the same amount
5. WHEN a match ends in a draw, THE System SHALL adjust ratings based on the expected outcome (higher-rated team loses rating, lower-rated team gains rating)
6. THE System SHALL ensure that the sum of all rating changes equals zero (zero-sum system)
7. WHEN a player's rating is updated, THE System SHALL persist the new rating value for that squad
8. THE System SHALL maintain separate ELO_Rating values for each user-squad combination

### Requirement 6: Match Results

**User Story:** As a squad admin, I want to submit match results, so that player ratings are updated and match history is recorded.

#### Acceptance Criteria

1. WHEN a Squad_Admin submits a match result, THE System SHALL validate that the user has admin privileges for the squad
2. WHEN submitting a result, THE System SHALL require specification of the winning team or draw
3. WHEN a match result is submitted, THE System SHALL update the match status to completed
4. WHEN a match result is submitted, THE System SHALL trigger ELO rating updates for all participating players
5. WHERE subjective balance feedback is provided, THE System SHALL store the feedback for analytics purposes
6. WHEN a match result is submitted for an already-completed match, THE System SHALL reject the submission
7. WHEN a match result is submitted, THE System SHALL persist the result and timestamp

### Requirement 7: Domain Layer Independence

**User Story:** As a system architect, I want the domain layer to be free of framework dependencies, so that the core business logic is testable and maintainable.

#### Acceptance Criteria

1. THE Domain layer SHALL NOT reference any infrastructure frameworks or libraries
2. THE Domain layer SHALL define interfaces for all external dependencies (repositories, services)
3. WHEN domain logic requires data persistence, THE Domain layer SHALL use repository interfaces
4. THE Domain layer SHALL contain all business rules and invariants
5. THE Domain layer SHALL be testable without requiring infrastructure components

### Requirement 8: RESTful API

**User Story:** As a frontend developer, I want to interact with the backend through RESTful endpoints, so that I can build the user interface.

#### Acceptance Criteria

1. THE API layer SHALL expose endpoints for all user-facing operations
2. WHEN an API endpoint is called, THE System SHALL validate authentication tokens
3. WHEN an API endpoint is called, THE System SHALL validate authorization for the requested operation
4. WHEN an API request is invalid, THE System SHALL return appropriate HTTP status codes and error messages
5. THE API layer SHALL use standard HTTP methods (GET, POST, PUT, DELETE) appropriately
6. THE API layer SHALL return responses in JSON format

### Requirement 9: Data Persistence

**User Story:** As a system architect, I want data to be persisted reliably, so that user information and match history are not lost.

#### Acceptance Criteria

1. THE Infrastructure layer SHALL implement repository interfaces defined in the domain layer
2. WHEN data is persisted, THE System SHALL use Entity Framework Core with PostgreSQL
3. WHEN database operations fail, THE System SHALL handle errors gracefully and return appropriate error messages
4. THE System SHALL maintain referential integrity between related entities
5. WHEN a user is deleted, THE System SHALL handle cascading operations appropriately

### Requirement 10: Configuration Management

**User Story:** As a system administrator, I want to configure system parameters, so that I can tune the system behavior without code changes.

#### Acceptance Criteria

1. THE System SHALL allow configuration of the default ELO_Rating for new players
2. THE System SHALL allow configuration of the K_Factor for ELO calculations
3. THE System SHALL allow configuration of the default team size for matches
4. WHEN configuration values are changed, THE System SHALL apply the new values to subsequent operations
5. THE System SHALL validate configuration values to ensure they are within acceptable ranges

### Requirement 11: Responsive User Interface

**User Story:** As a user, I want the application to work seamlessly on both desktop and mobile devices, so that I can access PitchMate from any device.

#### Acceptance Criteria

1. WHEN the application is accessed on a mobile device, THE UI SHALL adapt to the smaller screen size
2. WHEN the application is accessed on a desktop device, THE UI SHALL utilize the available screen space effectively
3. THE UI SHALL maintain usability and readability across all supported screen sizes
4. WHEN a user rotates their mobile device, THE UI SHALL adjust the layout appropriately
5. THE UI SHALL support touch interactions on mobile devices and mouse/keyboard interactions on desktop devices
6. WHEN UI components are rendered, THE System SHALL use responsive breakpoints to adjust layouts

### Requirement 12: Consistent Design System

**User Story:** As a user, I want a modern and consistent visual experience throughout the application, so that the interface is intuitive and professional.

#### Acceptance Criteria

1. THE UI SHALL use a centralized design system based on Tailwind CSS and shadcn/ui components
2. THE UI SHALL apply consistent color schemes, typography, and spacing across all pages
3. WHEN UI components are created, THE System SHALL use the design system's predefined components
4. THE UI SHALL maintain a modern, clean aesthetic that aligns with contemporary design standards
5. WHEN interactive elements are displayed, THE UI SHALL provide clear visual feedback for user actions
6. THE UI SHALL ensure sufficient color contrast for accessibility compliance
