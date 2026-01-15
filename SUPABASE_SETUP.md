# Supabase PostgreSQL Database Setup Guide

This guide walks you through setting up a Supabase PostgreSQL database for PitchMate.

## Prerequisites

- A Supabase account (sign up at https://supabase.com)
- .NET 8 SDK installed
- EF Core CLI tools installed (`dotnet tool install --global dotnet-ef`)

## Step 1: Create a Supabase Project

1. Log in to your Supabase account at https://app.supabase.com
2. Click "New Project"
3. Fill in the project details:
   - **Name**: PitchMate (or your preferred name)
   - **Database Password**: Choose a strong password (save this!)
   - **Region**: Select the region closest to your users
   - **Pricing Plan**: Free tier is sufficient for development
4. Click "Create new project"
5. Wait for the project to be provisioned (this may take a few minutes)

## Step 2: Get Your Connection String

1. Once your project is ready, navigate to **Settings** > **Database**
2. Scroll down to **Connection string** section
3. Select the **URI** tab
4. Copy the connection string (it will look like this):
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with the database password you set in Step 1

## Step 3: Configure Your Application

1. Open `src/PitchMate.API/appsettings.json`
2. Update the `ConnectionStrings` section with your Supabase connection string:
   ```json
   {
     "ConnectionStrings": {
       "DefaultConnection": "Host=db.[YOUR-PROJECT-REF].supabase.co;Database=postgres;Username=postgres;Password=[YOUR-PASSWORD];Port=5432;SSL Mode=Require;Trust Server Certificate=true"
     }
   }
   ```

**For production**, use environment variables or Azure Key Vault instead of storing the connection string in appsettings.json:
- Set the environment variable: `ConnectionStrings__DefaultConnection`
- Or use User Secrets for development: `dotnet user-secrets set "ConnectionStrings:DefaultConnection" "your-connection-string"`

## Step 4: Run EF Core Migrations

Navigate to the solution root directory and run:

```bash
# Apply migrations to create database schema
dotnet ef database update --project src/PitchMate.Infrastructure --startup-project src/PitchMate.API

# Verify migration was successful
dotnet ef migrations list --project src/PitchMate.Infrastructure --startup-project src/PitchMate.API
```

## Step 5: Seed Initial Configuration Data

The application will automatically seed initial configuration data on first run. Alternatively, you can run the seeder manually:

```bash
cd src/PitchMate.API
dotnet run --seed
```

Or use the provided script:

```bash
# From solution root
dotnet run --project src/PitchMate.API -- --seed
```

## Step 6: Verify Database Setup

1. Go back to your Supabase project dashboard
2. Navigate to **Table Editor** in the left sidebar
3. You should see the following tables:
   - `users`
   - `squads`
   - `squad_admins`
   - `squad_memberships`
   - `matches`
   - `match_players`
   - `match_results`
   - `system_configuration`
   - `__EFMigrationsHistory` (EF Core tracking table)

4. Click on `system_configuration` table
5. Verify it contains three rows:
   - `default_elo_rating` = 1000
   - `k_factor` = 32
   - `default_team_size` = 5

## Troubleshooting

### Connection Issues

If you get connection errors:
1. Verify your connection string is correct
2. Check that SSL Mode is set to `Require`
3. Ensure your IP is not blocked (Supabase allows all IPs by default)
4. Check Supabase project status in the dashboard

### Migration Errors

If migrations fail:
1. Ensure you're running from the solution root directory
2. Verify the connection string is correct
3. Check that the database is accessible
4. Try running with verbose logging: `dotnet ef database update --verbose`

### Seed Data Issues

If seed data doesn't appear:
1. Check application logs for errors
2. Manually verify the database connection
3. Run the seeder explicitly with the `--seed` flag

## Security Best Practices

1. **Never commit connection strings** to version control
2. Use **environment variables** or **Azure Key Vault** for production
3. Use **User Secrets** for local development:
   ```bash
   dotnet user-secrets init --project src/PitchMate.API
   dotnet user-secrets set "ConnectionStrings:DefaultConnection" "your-connection-string" --project src/PitchMate.API
   ```
4. Rotate database passwords regularly
5. Use **Row Level Security (RLS)** in Supabase for additional protection
6. Enable **connection pooling** for production workloads

## Next Steps

After setting up the database:
1. Configure Google OAuth credentials (see GOOGLE_OAUTH_SETUP.md)
2. Run the application: `dotnet run --project src/PitchMate.API`
3. Test the API endpoints using Swagger UI at `https://localhost:7xxx/swagger`
4. Perform end-to-end testing

## Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [EF Core Migrations](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/)
- [Connection Strings in .NET](https://learn.microsoft.com/en-us/ef/core/miscellaneous/connection-strings)
