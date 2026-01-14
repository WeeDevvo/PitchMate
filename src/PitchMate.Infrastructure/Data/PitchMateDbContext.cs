using Microsoft.EntityFrameworkCore;
using PitchMate.Domain.Entities;
using PitchMate.Domain.ValueObjects;

namespace PitchMate.Infrastructure.Data;

/// <summary>
/// Entity Framework Core DbContext for PitchMate.
/// Configures entity mappings following Clean Architecture principles.
/// </summary>
public class PitchMateDbContext : DbContext
{
    public PitchMateDbContext(DbContextOptions<PitchMateDbContext> options)
        : base(options)
    {
    }

    public DbSet<User> Users { get; set; } = null!;
    public DbSet<Squad> Squads { get; set; } = null!;
    public DbSet<Match> Matches { get; set; } = null!;
    public DbSet<SystemConfiguration> SystemConfigurations { get; set; } = null!;

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Apply entity configurations
        ConfigureUser(modelBuilder);
        ConfigureSquad(modelBuilder);
        ConfigureMatch(modelBuilder);
        ConfigureSquadAdmins(modelBuilder);
        ConfigureSystemConfiguration(modelBuilder);
    }

    private void ConfigureSquadAdmins(ModelBuilder modelBuilder)
    {
        // Configure squad_admins join table as a simple shadow entity
        // This table will be managed manually in the repository layer
        modelBuilder.SharedTypeEntity<Dictionary<string, object>>("squad_admins", entity =>
        {
            entity.ToTable("squad_admins");
            
            entity.Property<Guid>("squad_id")
                .HasColumnName("squad_id")
                .IsRequired();
            
            entity.Property<Guid>("user_id")
                .HasColumnName("user_id")
                .IsRequired();
            
            entity.HasKey("squad_id", "user_id");
        });
    }

    private void ConfigureUser(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            
            // Primary key
            entity.HasKey(u => u.Id);
            
            // UserId value object conversion
            entity.Property(u => u.Id)
                .HasConversion(
                    id => id.Value,
                    value => new UserId(value))
                .HasColumnName("id");
            
            // Email value object conversion
            entity.Property(u => u.Email)
                .HasConversion(
                    email => email.Value,
                    value => Email.Create(value))
                .HasColumnName("email")
                .HasMaxLength(255)
                .IsRequired();
            
            // Create unique index on email
            entity.HasIndex(u => u.Email)
                .IsUnique();
            
            // Password hash
            entity.Property(u => u.PasswordHash)
                .HasColumnName("password_hash")
                .HasMaxLength(255);
            
            // Google ID
            entity.Property(u => u.GoogleId)
                .HasColumnName("google_id")
                .HasMaxLength(255);
            
            // Create unique index on GoogleId
            entity.HasIndex(u => u.GoogleId)
                .IsUnique()
                .HasFilter("google_id IS NOT NULL");
            
            // Created timestamp
            entity.Property(u => u.CreatedAt)
                .HasColumnName("created_at")
                .IsRequired();
            
            // Configure SquadMemberships as owned entities
            entity.OwnsMany(u => u.SquadMemberships, membership =>
            {
                membership.ToTable("squad_memberships");
                
                // UserId value object conversion
                membership.Property(m => m.UserId)
                    .HasConversion(
                        id => id.Value,
                        value => new UserId(value))
                    .HasColumnName("user_id")
                    .IsRequired();
                
                // SquadId value object conversion
                membership.Property(m => m.SquadId)
                    .HasConversion(
                        id => id.Value,
                        value => new SquadId(value))
                    .HasColumnName("squad_id")
                    .IsRequired();
                
                // EloRating value object conversion
                membership.Property(m => m.CurrentRating)
                    .HasConversion(
                        rating => rating.Value,
                        value => EloRating.Create(value))
                    .HasColumnName("current_rating")
                    .IsRequired();
                
                // Joined timestamp
                membership.Property(m => m.JoinedAt)
                    .HasColumnName("joined_at")
                    .IsRequired();
                
                // Composite primary key
                membership.HasKey(nameof(SquadMembership.UserId), nameof(SquadMembership.SquadId));
                
                // Foreign key to Squad
                membership.HasOne<Squad>()
                    .WithMany()
                    .HasForeignKey(m => m.SquadId)
                    .OnDelete(DeleteBehavior.Cascade);
            });
        });
    }

    private void ConfigureSquad(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Squad>(entity =>
        {
            entity.ToTable("squads");
            
            // Primary key
            entity.HasKey(s => s.Id);
            
            // SquadId value object conversion
            entity.Property(s => s.Id)
                .HasConversion(
                    id => id.Value,
                    value => new SquadId(value))
                .HasColumnName("id");
            
            // Squad name
            entity.Property(s => s.Name)
                .HasColumnName("name")
                .HasMaxLength(255)
                .IsRequired();
            
            // Created timestamp
            entity.Property(s => s.CreatedAt)
                .HasColumnName("created_at")
                .IsRequired();
            
            // Ignore AdminIds - will be managed through a separate join table
            entity.Ignore(s => s.AdminIds);
            
            // Ignore Members collection - it's configured from User side
            entity.Ignore(s => s.Members);
        });
    }

    private void ConfigureMatch(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Match>(entity =>
        {
            entity.ToTable("matches");
            
            // Primary key
            entity.HasKey(m => m.Id);
            
            // MatchId value object conversion
            entity.Property(m => m.Id)
                .HasConversion(
                    id => id.Value,
                    value => new MatchId(value))
                .HasColumnName("id");
            
            // SquadId value object conversion
            entity.Property(m => m.SquadId)
                .HasConversion(
                    id => id.Value,
                    value => new SquadId(value))
                .HasColumnName("squad_id")
                .IsRequired();
            
            // Foreign key to Squad
            entity.HasOne<Squad>()
                .WithMany()
                .HasForeignKey(m => m.SquadId)
                .OnDelete(DeleteBehavior.Cascade);
            
            // Scheduled timestamp
            entity.Property(m => m.ScheduledAt)
                .HasColumnName("scheduled_at")
                .IsRequired();
            
            // Team size
            entity.Property(m => m.TeamSize)
                .HasColumnName("team_size")
                .IsRequired();
            
            // Match status
            entity.Property(m => m.Status)
                .HasConversion<string>()
                .HasColumnName("status")
                .HasMaxLength(50)
                .IsRequired();
            
            // Created timestamp
            entity.Property(m => m.CreatedAt)
                .HasColumnName("created_at")
                .IsRequired();
            
            // Configure MatchPlayers as owned entities
            entity.OwnsMany(m => m.Players, player =>
            {
                player.ToTable("match_players");
                
                player.WithOwner()
                    .HasForeignKey("MatchId");
                
                player.Property<Guid>("MatchId")
                    .HasColumnName("match_id");
                
                // UserId value object conversion
                player.Property(p => p.UserId)
                    .HasConversion(
                        id => id.Value,
                        value => new UserId(value))
                    .HasColumnName("user_id")
                    .IsRequired();
                
                // EloRating value object conversion
                player.Property(p => p.RatingAtMatchTime)
                    .HasConversion(
                        rating => rating.Value,
                        value => EloRating.Create(value))
                    .HasColumnName("rating_at_match_time")
                    .IsRequired();
                
                // Team designation (nullable until teams are assigned)
                player.Property<string?>("TeamDesignation")
                    .HasColumnName("team_designation")
                    .HasMaxLength(10);
                
                // Composite primary key
                player.HasKey("MatchId", nameof(MatchPlayer.UserId));
                
                // Foreign key to User
                player.HasOne<User>()
                    .WithMany()
                    .HasForeignKey(p => p.UserId)
                    .OnDelete(DeleteBehavior.Cascade);
            });
            
            // Ignore TeamA and TeamB - they are computed from match_players
            entity.Ignore(m => m.TeamA);
            entity.Ignore(m => m.TeamB);
            
            // Configure MatchResult as owned entity
            entity.OwnsOne(m => m.Result, result =>
            {
                result.ToTable("match_results");
                
                result.WithOwner()
                    .HasForeignKey("MatchId");
                
                result.Property<Guid>("MatchId")
                    .HasColumnName("match_id");
                
                // Winner designation
                result.Property(r => r.Winner)
                    .HasConversion<string>()
                    .HasColumnName("winner")
                    .HasMaxLength(10)
                    .IsRequired();
                
                // Balance feedback
                result.Property(r => r.BalanceFeedback)
                    .HasColumnName("balance_feedback");
                
                // Recorded timestamp
                result.Property(r => r.RecordedAt)
                    .HasColumnName("recorded_at")
                    .IsRequired();
                
                // Primary key
                result.HasKey("MatchId");
            });
        });
    }

    private void ConfigureSystemConfiguration(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<SystemConfiguration>(entity =>
        {
            entity.ToTable("system_configuration");
            
            // Primary key
            entity.HasKey(c => c.Key);
            
            // Key
            entity.Property(c => c.Key)
                .HasColumnName("key")
                .HasMaxLength(100)
                .IsRequired();
            
            // Value
            entity.Property(c => c.Value)
                .HasColumnName("value")
                .HasMaxLength(255)
                .IsRequired();
            
            // Updated timestamp
            entity.Property(c => c.UpdatedAt)
                .HasColumnName("updated_at")
                .IsRequired();
        });
    }
}
