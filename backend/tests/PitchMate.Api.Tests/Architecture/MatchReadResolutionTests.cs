using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Tests.Auth;
using PitchMate.Api.Tests.Contracts;
using PitchMate.Application.Matches.Abstractions;
using PitchMate.Application.Matches.UseCases;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// Every query handler and every <c>Match_Query_Source</c> the match-read-models chore adds resolves
/// from the application's <b>configured</b> service provider (task 15.4), so a mapped read cannot ship
/// with an unresolvable dependency. The handlers are the discovered set from
/// <see cref="MatchReadContracts.Handlers"/> — the three new reads and the team sheet, which joined the
/// set when task 13.3 gave it a projection port — and the sources are named, since each is an interface
/// whose implementation is internal.
/// <para><b>Validates: Requirement 11.12.</b></para>
/// </summary>
public sealed class MatchReadResolutionTests : IClassFixture<AuthApiFactory>
{
    private readonly AuthApiFactory _factory;

    /// <summary>Receives the shared in-memory Api host factory.</summary>
    public MatchReadResolutionTests(AuthApiFactory factory)
    {
        _factory = factory;
    }

    public static TheoryData<Type> Services()
    {
        var data = new TheoryData<Type>();
        foreach (Type handler in MatchReadContracts.Handlers)
        {
            data.Add(handler);
        }

        data.Add(typeof(IMatchListSource));
        data.Add(typeof(IMatchDetailSource));
        data.Add(typeof(IWorkingTeamsSource));
        data.Add(typeof(IRosterDisplayNameSource));
        return data;
    }

    [Theory]
    [MemberData(nameof(Services))]
    public void ResolvesFromTheConfiguredProvider(Type service)
    {
        using IServiceScope scope = _factory.Services.CreateScope();

        Assert.NotNull(scope.ServiceProvider.GetRequiredService(service));
    }

    [Fact]
    public void TheDiscoveredHandlerSetIsTheThreeReadsAndTheTeamSheet()
    {
        Assert.Equal(
            [nameof(GetMatchDetailHandler), nameof(GetMatchListHandler), nameof(GetTeamSheetHandler), nameof(GetWorkingTeamsHandler)],
            MatchReadContracts.Handlers.Select(static handler => handler.Name).Order(StringComparer.Ordinal));
    }
}
