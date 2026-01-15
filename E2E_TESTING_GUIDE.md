# End-to-End Testing Guide

This guide provides comprehensive instructions for testing PitchMate from end to end, covering all major user flows and functionality.

## Prerequisites

Before running E2E tests, ensure:

1. ✅ Database is set up and migrations are applied (see SUPABASE_SETUP.md)
2. ✅ Initial configuration data is seeded
3. ✅ Google OAuth is configured (optional, see GOOGLE_OAUTH_SETUP.md)
4. ✅ Backend API is running
5. ✅ Frontend is running (for UI testing)

## Test Environment Setup

### 1. Start the Backend API

```bash
cd src/PitchMate.API
dotnet run
```

The API should be available at `https://localhost:7xxx` (check console output for exact port)

### 2. Start the Frontend (Optional)

```bash
cd frontend
npm run dev
```

The frontend should be available at `http://localhost:3000`

### 3. Verify Swagger UI

Open your browser and navigate to `https://localhost:7xxx/swagger`

You should see the Swagger UI with all API endpoints documented.

## Test Scenarios

### Scenario 1: User Registration and Authentication

**Objective**: Verify users can register and log in with email/password

#### Test Steps:

1. **Register a new user**
   - Endpoint: `POST /api/auth/register`
   - Request body:
     ```json
     {
       "email": "test@example.com",
       "password": "SecurePassword123!"
     }
     ```
   - Expected: 200 OK with JWT token

2. **Attempt duplicate registration**
   - Endpoint: `POST /api/auth/register`
   - Request body: Same as above
   - Expected: 400 Bad Request with error message

3. **Login with valid credentials**
   - Endpoint: `POST /api/auth/login`
   - Request body:
     ```json
     {
       "email": "test@example.com",
       "password": "SecurePassword123!"
     }
     ```
   - Expected: 200 OK with JWT token

4. **Login with invalid credentials**
   - Endpoint: `POST /api/auth/login`
   - Request body:
     ```json
     {
       "email": "test@example.com",
       "password": "WrongPassword"
     }
     ```
   - Expected: 401 Unauthorized

**Validation**:
- ✅ User can register with valid email and password
- ✅ Duplicate email is rejected
- ✅ User can log in with correct credentials
- ✅ Invalid credentials are rejected
- ✅ JWT token is returned on successful authentication

---

### Scenario 2: Squad Creation and Management

**Objective**: Verify squad creation, joining, and admin management

#### Test Steps:

1. **Create a squad** (as authenticated user)
   - Endpoint: `POST /api/squads`
   - Headers: `Authorization: Bearer {token}`
   - Request body:
     ```json
     {
       "name": "Weekend Warriors"
     }
     ```
   - Expected: 200 OK with squad details
   - Save the `squadId` for later tests

2. **Get user's squads**
   - Endpoint: `GET /api/squads`
   - Headers: `Authorization: Bearer {token}`
   - Expected: 200 OK with array containing the created squad

3. **Register a second user**
   - Endpoint: `POST /api/auth/register`
   - Request body:
     ```json
     {
       "email": "player2@example.com",
       "password": "SecurePassword123!"
     }
     ```
   - Save the token for player2

4. **Player 2 joins the squad**
   - Endpoint: `POST /api/squads/{squadId}/join`
   - Headers: `Authorization: Bearer {player2_token}`
   - Expected: 200 OK

5. **Verify player 2's initial rating**
   - Endpoint: `GET /api/users/{player2_id}/squads/{squadId}/rating`
   - Headers: `Authorization: Bearer {player2_token}`
   - Expected: 200 OK with rating = 1000 (default)

6. **Creator adds player 2 as admin**
   - Endpoint: `POST /api/squads/{squadId}/admins`
   - Headers: `Authorization: Bearer {creator_token}`
   - Request body:
     ```json
     {
       "userId": "{player2_id}"
     }
     ```
   - Expected: 200 OK

**Validation**:
- ✅ Squad creator becomes admin automatically
- ✅ Users can join squads
- ✅ New members get initial rating of 1000
- ✅ Admins can add other admins
- ✅ Users can be members of multiple squads

---

### Scenario 3: Match Creation and Team Balancing

**Objective**: Verify match creation with automatic team balancing

#### Test Steps:

1. **Register 10 players and add them to the squad**
   - Create 10 users (player1 through player10)
   - Each joins the squad
   - Manually update some ratings for variety (optional, via database)

2. **Create a match** (as squad admin)
   - Endpoint: `POST /api/squads/{squadId}/matches`
   - Headers: `Authorization: Bearer {admin_token}`
   - Request body:
     ```json
     {
       "scheduledAt": "2026-01-20T18:00:00Z",
       "playerIds": [
         "{player1_id}",
         "{player2_id}",
         "{player3_id}",
         "{player4_id}",
         "{player5_id}",
         "{player6_id}",
         "{player7_id}",
         "{player8_id}",
         "{player9_id}",
         "{player10_id}"
       ],
       "teamSize": 5
     }
     ```
   - Expected: 200 OK with match details including team assignments
   - Save the `matchId`

3. **Verify team balance**
   - Check that teams have equal number of players (5 each)
   - Check that total team ratings are close (difference should be minimal)

4. **Get match details**
   - Endpoint: `GET /api/matches/{matchId}`
   - Headers: `Authorization: Bearer {token}`
   - Expected: 200 OK with full match details including teams

5. **Attempt to create match with odd number of players**
   - Endpoint: `POST /api/squads/{squadId}/matches`
   - Request body: Include 9 players instead of 10
   - Expected: 400 Bad Request

6. **Attempt to create match as non-admin**
   - Endpoint: `POST /api/squads/{squadId}/matches`
   - Headers: `Authorization: Bearer {non_admin_token}`
   - Expected: 403 Forbidden

**Validation**:
- ✅ Only admins can create matches
- ✅ Teams are automatically balanced
- ✅ Teams have equal number of players
- ✅ Odd number of players is rejected
- ✅ Team assignments are persisted

---

### Scenario 4: Match Result and ELO Updates

**Objective**: Verify match result recording and ELO rating updates

#### Test Steps:

1. **Record match result** (as squad admin)
   - Endpoint: `POST /api/matches/{matchId}/result`
   - Headers: `Authorization: Bearer {admin_token}`
   - Request body:
     ```json
     {
       "winner": "TeamA",
       "balanceFeedback": "Teams were well balanced"
     }
     ```
   - Expected: 200 OK

2. **Verify match status updated**
   - Endpoint: `GET /api/matches/{matchId}`
   - Expected: Match status is "Completed"

3. **Verify ELO ratings updated**
   - For each player on TeamA:
     - Endpoint: `GET /api/users/{playerId}/squads/{squadId}/rating`
     - Expected: Rating increased from initial value
   - For each player on TeamB:
     - Endpoint: `GET /api/users/{playerId}/squads/{squadId}/rating`
     - Expected: Rating decreased from initial value

4. **Verify zero-sum property**
   - Sum all rating changes
   - Expected: Total change = 0

5. **Verify uniform team changes**
   - All players on TeamA should have same rating change
   - All players on TeamB should have same rating change

6. **Attempt to record result again**
   - Endpoint: `POST /api/matches/{matchId}/result`
   - Expected: 400 Bad Request (match already completed)

7. **Attempt to record result as non-admin**
   - Create a new match
   - Try to record result with non-admin token
   - Expected: 403 Forbidden

**Validation**:
- ✅ Only admins can record results
- ✅ Match status updates to completed
- ✅ All players' ratings are updated
- ✅ Winners gain rating, losers lose rating
- ✅ All players on same team get same change
- ✅ Total rating change is zero (zero-sum)
- ✅ Cannot record result twice

---

### Scenario 5: Independent Squad Ratings

**Objective**: Verify users maintain separate ratings in different squads

#### Test Steps:

1. **Create a second squad**
   - Endpoint: `POST /api/squads`
   - Request body:
     ```json
     {
       "name": "Midweek League"
     }
     ```
   - Save the `squad2Id`

2. **Player joins second squad**
   - Endpoint: `POST /api/squads/{squad2Id}/join`
   - Expected: 200 OK

3. **Verify initial rating in second squad**
   - Endpoint: `GET /api/users/{playerId}/squads/{squad2Id}/rating`
   - Expected: Rating = 1000 (default, independent of first squad)

4. **Get player's rating in first squad**
   - Endpoint: `GET /api/users/{playerId}/squads/{squad1Id}/rating`
   - Expected: Rating = previous value (unchanged by joining second squad)

5. **Create and complete a match in second squad**
   - Create match, record result

6. **Verify ratings changed only in second squad**
   - Rating in squad2 should be different from 1000
   - Rating in squad1 should remain unchanged

**Validation**:
- ✅ Users can join multiple squads
- ✅ Each squad has independent rating
- ✅ Rating changes in one squad don't affect others
- ✅ New squad membership starts at default rating

---

### Scenario 6: Google OAuth Authentication (Optional)

**Objective**: Verify Google OAuth login flow

**Note**: This requires Google OAuth to be configured

#### Test Steps:

1. **Get a Google ID token**
   - Use Google OAuth Playground: https://developers.google.com/oauthplayground/
   - Or implement Google Sign-In in frontend

2. **Authenticate with Google**
   - Endpoint: `POST /api/auth/google`
   - Request body:
     ```json
     {
       "idToken": "{google_id_token}"
     }
     ```
   - Expected: 200 OK with JWT token

3. **Verify user was created**
   - Use the JWT token to access protected endpoints
   - Verify user exists in database

4. **Authenticate again with same Google account**
   - Expected: Returns JWT for existing user (not creating duplicate)

**Validation**:
- ✅ Google ID token is validated
- ✅ New user is created on first login
- ✅ Existing user is returned on subsequent logins
- ✅ JWT token is issued

---

## Automated Test Script

Use the provided PowerShell script to run automated E2E tests:

```bash
.\scripts\run-e2e-tests.ps1
```

This script will:
1. Start the backend API
2. Run all test scenarios
3. Verify expected outcomes
4. Generate a test report

## Manual Testing Checklist

### Backend API Testing

- [ ] All endpoints return correct status codes
- [ ] Authentication is enforced on protected endpoints
- [ ] Authorization is enforced (admin-only operations)
- [ ] Invalid requests return appropriate error messages
- [ ] Database transactions are atomic
- [ ] Concurrent requests are handled correctly

### Frontend Testing (Desktop)

- [ ] User can register and login
- [ ] User can create and join squads
- [ ] Admin can create matches
- [ ] Admin can record match results
- [ ] Ratings are displayed correctly
- [ ] Navigation works correctly
- [ ] Forms validate input
- [ ] Error messages are displayed
- [ ] Loading states are shown

### Frontend Testing (Mobile)

- [ ] Responsive layout works on mobile screens
- [ ] Touch interactions work correctly
- [ ] Navigation menu works on mobile
- [ ] Forms are usable on mobile
- [ ] All features accessible on mobile

### ELO Calculation Verification

Create a test scenario with known ratings and verify calculations:

**Example**:
- TeamA: 5 players with rating 1200 each (avg = 1200)
- TeamB: 5 players with rating 1000 each (avg = 1000)
- K-Factor: 32
- TeamA wins

**Expected outcome**:
- E_A = 1 / (1 + 10^((1000-1200)/400)) = 0.76
- ΔR_A = 32 × (1 - 0.76) = 7.68 ≈ 8 points
- TeamA players: 1200 → 1208
- TeamB players: 1000 → 992

Verify the actual rating changes match the expected values.

## Performance Testing

### Load Testing

Test the system under load:

1. Create 100 users
2. Create 10 squads
3. Add users to squads
4. Create 50 matches
5. Record results for all matches

Verify:
- Response times remain acceptable
- No database deadlocks
- No memory leaks
- Concurrent operations work correctly

### Stress Testing

Push the system to its limits:

1. Create 1000 users
2. Create 100 squads
3. Create 500 matches
4. Simulate concurrent match creation and result recording

Monitor:
- CPU usage
- Memory usage
- Database connections
- Response times
- Error rates

## Troubleshooting

### Common Issues

**Issue**: Authentication fails
- Check JWT configuration
- Verify token is included in Authorization header
- Check token expiration

**Issue**: Database errors
- Verify connection string
- Check database is running
- Verify migrations are applied

**Issue**: ELO calculations incorrect
- Verify K-Factor configuration
- Check team rating calculations
- Verify zero-sum property

**Issue**: Team balancing not optimal
- This is expected for small player counts
- Verify algorithm is deterministic
- Check that ratings are being used correctly

## Test Data Cleanup

After testing, clean up test data:

```sql
-- Delete all test data (use with caution!)
DELETE FROM match_results;
DELETE FROM match_players;
DELETE FROM matches;
DELETE FROM squad_memberships;
DELETE FROM squad_admins;
DELETE FROM squads;
DELETE FROM users WHERE email LIKE '%@example.com';
```

Or drop and recreate the database:

```bash
dotnet ef database drop --project src/PitchMate.Infrastructure --startup-project src/PitchMate.API
dotnet ef database update --project src/PitchMate.Infrastructure --startup-project src/PitchMate.API
dotnet run --project src/PitchMate.API -- --seed
```

## Reporting Issues

When reporting issues found during E2E testing:

1. Describe the test scenario
2. Provide steps to reproduce
3. Include expected vs actual behavior
4. Attach relevant logs or screenshots
5. Note the environment (local, staging, production)

## Next Steps

After successful E2E testing:

1. Review and fix any issues found
2. Run all property-based tests with 100+ iterations
3. Verify code coverage meets goals
4. Prepare for deployment
5. Set up monitoring and logging
