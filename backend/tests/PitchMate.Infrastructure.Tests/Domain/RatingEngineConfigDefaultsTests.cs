using PitchMate.Domain.Rating;

namespace PitchMate.Infrastructure.Tests.Domain;

/// <summary>
/// Verifies that a default-constructed <see cref="RatingEngineConfig"/> exposes every documented
/// default parameter value (Requirements 11.3, 11.4).
/// </summary>
public class RatingEngineConfigDefaultsTests
{
    private static readonly RatingEngineConfig Config = new();

    [Fact]
    public void DefaultMean_IsTwentyFive()
    {
        Assert.Equal(25.0, Config.DefaultMean);
    }

    [Fact]
    public void InitialUncertainty_IsTwentyFiveThirds()
    {
        Assert.Equal(25.0 / 3.0, Config.InitialUncertainty);
    }

    [Fact]
    public void Beta_IsTwentyFiveSixths()
    {
        Assert.Equal(25.0 / 6.0, Config.Beta);
    }

    [Fact]
    public void Tau_IsTwentyFiveThreeHundredths()
    {
        Assert.Equal(25.0 / 300.0, Config.Tau);
    }

    [Fact]
    public void ProvisionalThreshold_IsTwentyFiveSixths()
    {
        Assert.Equal(25.0 / 6.0, Config.ProvisionalThreshold);
    }

    [Fact]
    public void DecayFreePeriodDays_IsFortyTwo()
    {
        Assert.Equal(42, Config.DecayFreePeriodDays);
    }

    [Fact]
    public void DecayRate_IsZeroPointZeroFive()
    {
        Assert.Equal(0.05, Config.DecayRate);
    }

    [Fact]
    public void MarginOfVictoryWeighting_IsDisabledByDefault()
    {
        Assert.False(Config.MarginOfVictoryWeightingEnabled);
    }

    [Fact]
    public void ParticipationWeighting_IsDisabledByDefault()
    {
        Assert.False(Config.ParticipationWeightingEnabled);
    }

    [Fact]
    public void BeginnerMean_IsTwenty()
    {
        Assert.Equal(20.0, Config.BeginnerMean);
    }

    [Fact]
    public void AverageMean_IsTwentyFive()
    {
        Assert.Equal(25.0, Config.AverageMean);
    }

    [Fact]
    public void StrongMean_IsThirty()
    {
        Assert.Equal(30.0, Config.StrongMean);
    }

    [Fact]
    public void MarginMultiplierMax_IsOnePointFive()
    {
        Assert.Equal(1.5, Config.MarginMultiplierMax);
    }

    [Fact]
    public void NumericTolerance_IsOneEMinusNine()
    {
        Assert.Equal(1e-9, Config.NumericTolerance);
    }
}
