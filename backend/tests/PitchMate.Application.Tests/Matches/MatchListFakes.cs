using PitchMate.Application.Matches.Abstractions;

namespace PitchMate.Application.Tests.Matches;

/// <summary>
/// A recording in-memory <see cref="IMatchListSource"/> for the match list handler's unit tests. It
/// returns a pre-arranged page — or <see langword="null"/> to stand for a squad that is not visible
/// (Requirement 5.9) — and records every call it receives.
/// <para>
/// The recording is the point. The list read's gate runs <em>before</em> the source, so "the source
/// was never called" is the observable consequence of a refusal: a caller holding no active
/// membership must cause no match query and must learn nothing about the squad's existence
/// (Requirement 1.11, 5.9). The recorded <see cref="Call.Limit"/> is equally load-bearing — it is
/// how a test shows the handler passes the declared maximum of the read surface rather than a
/// literal of its own.
/// </para>
/// </summary>
internal sealed class RecordingMatchListSource(MatchListPage? page) : IMatchListSource
{
    private readonly List<Call> _calls = [];

    /// <summary>One observed invocation of <see cref="ListForSquadAsync"/>.</summary>
    /// <param name="SquadId">The squad the handler asked for.</param>
    /// <param name="Limit">The entry bound the handler passed.</param>
    internal readonly record struct Call(Guid SquadId, int Limit);

    /// <summary>Every invocation the source received, in order.</summary>
    public IReadOnlyList<Call> Calls => _calls;

    public Task<MatchListPage?> ListForSquadAsync(Guid squadId, int limit, CancellationToken cancellationToken)
    {
        _calls.Add(new Call(squadId, limit));
        return Task.FromResult(page);
    }
}
