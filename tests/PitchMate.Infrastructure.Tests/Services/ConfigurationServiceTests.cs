using FsCheck;
using FsCheck.Xunit;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using PitchMate.Infrastructure.Data;
using PitchMate.Infrastructure.Services;
using Xunit;

namespace PitchMate.Infrastructure.Tests.Services;

/// <summary>
/// Property-based tests for ConfigurationService.
/// Tests configuration retrieval, validation, and caching behavior.
/// </summary>
public class ConfigurationServiceTests
{
    /// <summary>
    /// Feature: pitchmate-core, Property 39: Default rating configuration
    /// For any configured default ELO rating value, new players joining squads should receive that configured rating.
    /// Validates: Requirements 10.1
    /// </summary>
    [Property(MaxTest = 100)]
    public void ConfiguredDefaultRatingIsReturned(PositiveInt ratingSeed)
    {
        // Arrange - Generate a valid rating between 400 and 2400
        var configuredRating = 400 + (ratingSeed.Get % 2001); // 400 to 2400
        
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Add configuration to database
        context.SystemConfigurations.Add(new SystemConfiguration
        {
            Key = "default_elo_rating",
            Value = configuredRating.ToString(),
            UpdatedAt = DateTime.UtcNow
        });
        context.SaveChanges();

        // Act
        var result = service.GetDefaultEloRatingAsync().Result;

        // Assert
        result.Should().Be(configuredRating);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 39: Default rating configuration
    /// When no configuration exists, the system should return the default value of 1000.
    /// Validates: Requirements 10.1
    /// </summary>
    [Property(MaxTest = 100)]
    public void MissingConfigurationReturnsDefault()
    {
        // Arrange
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Act
        var result = service.GetDefaultEloRatingAsync().Result;

        // Assert
        result.Should().Be(1000);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 39: Default rating configuration
    /// Configuration values should be cached for performance.
    /// Validates: Requirements 10.1
    /// </summary>
    [Property(MaxTest = 100)]
    public void ConfigurationValuesAreCached(PositiveInt ratingSeed)
    {
        // Arrange - Generate a valid rating between 400 and 2400
        var configuredRating = 400 + (ratingSeed.Get % 2001); // 400 to 2400
        
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Add configuration to database
        context.SystemConfigurations.Add(new SystemConfiguration
        {
            Key = "default_elo_rating",
            Value = configuredRating.ToString(),
            UpdatedAt = DateTime.UtcNow
        });
        context.SaveChanges();

        // Act - First call should read from database
        var result1 = service.GetDefaultEloRatingAsync().Result;

        // Remove the configuration from database
        var config = context.SystemConfigurations.First(c => c.Key == "default_elo_rating");
        context.SystemConfigurations.Remove(config);
        context.SaveChanges();

        // Second call should return cached value (not default)
        var result2 = service.GetDefaultEloRatingAsync().Result;

        // Assert - Both calls should return the same configured value
        result1.Should().Be(configuredRating);
        result2.Should().Be(configuredRating);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 40: K-Factor configuration
    /// For any configured K-Factor value, ELO calculations should use that value in the rating change formula.
    /// Validates: Requirements 10.2
    /// </summary>
    [Property(MaxTest = 100)]
    public void ConfiguredKFactorIsReturned(PositiveInt kFactorSeed)
    {
        // Arrange - Generate a valid K-Factor between 1 and 100
        var configuredKFactor = 1 + (kFactorSeed.Get % 100); // 1 to 100
        
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Add configuration to database
        context.SystemConfigurations.Add(new SystemConfiguration
        {
            Key = "k_factor",
            Value = configuredKFactor.ToString(),
            UpdatedAt = DateTime.UtcNow
        });
        context.SaveChanges();

        // Act
        var result = service.GetKFactorAsync().Result;

        // Assert
        result.Should().Be(configuredKFactor);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 40: K-Factor configuration
    /// When no K-Factor configuration exists, the system should return the default value of 32.
    /// Validates: Requirements 10.2
    /// </summary>
    [Fact]
    public void MissingKFactorConfigurationReturnsDefault()
    {
        // Arrange
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Act
        var result = service.GetKFactorAsync().Result;

        // Assert
        result.Should().Be(32);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 40: K-Factor configuration
    /// K-Factor values should be cached for performance.
    /// Validates: Requirements 10.2
    /// </summary>
    [Property(MaxTest = 100)]
    public void KFactorValuesAreCached(PositiveInt kFactorSeed)
    {
        // Arrange - Generate a valid K-Factor between 1 and 100
        var configuredKFactor = 1 + (kFactorSeed.Get % 100); // 1 to 100
        
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Add configuration to database
        context.SystemConfigurations.Add(new SystemConfiguration
        {
            Key = "k_factor",
            Value = configuredKFactor.ToString(),
            UpdatedAt = DateTime.UtcNow
        });
        context.SaveChanges();

        // Act - First call should read from database
        var result1 = service.GetKFactorAsync().Result;

        // Remove the configuration from database
        var config = context.SystemConfigurations.First(c => c.Key == "k_factor");
        context.SystemConfigurations.Remove(config);
        context.SaveChanges();

        // Second call should return cached value (not default)
        var result2 = service.GetKFactorAsync().Result;

        // Assert - Both calls should return the same configured value
        result1.Should().Be(configuredKFactor);
        result2.Should().Be(configuredKFactor);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 43: Configuration validation
    /// For any configuration value outside acceptable ranges, the system should reject the configuration change.
    /// Validates: Requirements 10.5
    /// </summary>
    [Property(MaxTest = 100)]
    public void InvalidEloRatingReturnsDefault(int invalidRating)
    {
        // Skip valid ratings
        if (invalidRating >= 400 && invalidRating <= 2400)
            return;

        // Arrange
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Add invalid configuration to database
        context.SystemConfigurations.Add(new SystemConfiguration
        {
            Key = "default_elo_rating",
            Value = invalidRating.ToString(),
            UpdatedAt = DateTime.UtcNow
        });
        context.SaveChanges();

        // Act
        var result = service.GetDefaultEloRatingAsync().Result;

        // Assert - Should return default value (1000) instead of invalid value
        result.Should().Be(1000);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 43: Configuration validation
    /// For any K-Factor value outside acceptable ranges (1-100), the system should use the default value.
    /// Validates: Requirements 10.5
    /// </summary>
    [Property(MaxTest = 100)]
    public void InvalidKFactorReturnsDefault(int invalidKFactor)
    {
        // Skip valid K-Factors
        if (invalidKFactor >= 1 && invalidKFactor <= 100)
            return;

        // Arrange
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Add invalid configuration to database
        context.SystemConfigurations.Add(new SystemConfiguration
        {
            Key = "k_factor",
            Value = invalidKFactor.ToString(),
            UpdatedAt = DateTime.UtcNow
        });
        context.SaveChanges();

        // Act
        var result = service.GetKFactorAsync().Result;

        // Assert - Should return default value (32) instead of invalid value
        result.Should().Be(32);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 43: Configuration validation
    /// For any team size value outside acceptable ranges (1-50), the system should use the default value.
    /// Validates: Requirements 10.5
    /// </summary>
    [Property(MaxTest = 100)]
    public void InvalidTeamSizeReturnsDefault(int invalidTeamSize)
    {
        // Skip valid team sizes
        if (invalidTeamSize >= 1 && invalidTeamSize <= 50)
            return;

        // Arrange
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Add invalid configuration to database
        context.SystemConfigurations.Add(new SystemConfiguration
        {
            Key = "default_team_size",
            Value = invalidTeamSize.ToString(),
            UpdatedAt = DateTime.UtcNow
        });
        context.SaveChanges();

        // Act
        var result = service.GetDefaultTeamSizeAsync().Result;

        // Assert - Should return default value (5) instead of invalid value
        result.Should().Be(5);
    }

    /// <summary>
    /// Feature: pitchmate-core, Property 43: Configuration validation
    /// For any non-numeric configuration value, the system should use the default value.
    /// Validates: Requirements 10.5
    /// </summary>
    [Property(MaxTest = 100)]
    public void NonNumericConfigurationReturnsDefault(NonEmptyString invalidValue)
    {
        // Skip numeric values
        if (int.TryParse(invalidValue.Get, out _))
            return;

        // Arrange
        var options = new DbContextOptionsBuilder<PitchMateDbContext>()
            .UseInMemoryDatabase(databaseName: Guid.NewGuid().ToString())
            .Options;

        using var context = new PitchMateDbContext(options);
        var cache = new MemoryCache(new MemoryCacheOptions());
        var service = new ConfigurationService(context, cache);

        // Add invalid configuration to database
        context.SystemConfigurations.Add(new SystemConfiguration
        {
            Key = "default_elo_rating",
            Value = invalidValue.Get,
            UpdatedAt = DateTime.UtcNow
        });
        context.SaveChanges();

        // Act
        var result = service.GetDefaultEloRatingAsync().Result;

        // Assert - Should return default value (1000) for non-numeric input
        result.Should().Be(1000);
    }
}
