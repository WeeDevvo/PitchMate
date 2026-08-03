namespace PitchMate.Domain.Matches;

/// <summary>
/// The recorded outcome of a played match: its <see cref="ResultFidelity"/> and a
/// <see cref="TeamScore"/> for each of the match's teams (Requirement 11.2, 11.3). A match team's
/// final score is always stored — at both <see cref="ResultFidelity.Basic"/> and
/// <see cref="ResultFidelity.Rich"/> fidelity — and is the basis from which the match outcome
/// (win/loss/draw) is later derived (Requirement 11.3).
/// <para>
/// A <see cref="MatchResult"/> is a proposed carrier of scores: it does not validate the scores or
/// their team identities on construction. All validation — score range (0..99), a score for every
/// team, no score for a non-team — is performed by <see cref="Match.RecordResult(MatchResult, bool)"/>,
/// which identifies the offending score and stores nothing on failure (Requirement 11.7). It is a
/// pure Domain value with no persistence identity, mirroring <see cref="KickoffLineup"/>.
/// </para>
/// </summary>
public sealed class MatchResult
{
    /// <summary>The minimum valid team score (Requirement 11.2, 11.7).</summary>
    public const int MinScore = 0;

    /// <summary>The maximum valid team score (Requirement 11.2, 11.7).</summary>
    public const int MaxScore = 99;

    private readonly List<TeamScore> _teamScores;

    /// <summary>Parameterless constructor reserved for the persistence layer.</summary>
    private MatchResult() => _teamScores = [];

    /// <summary>
    /// Creates a proposed match result at <paramref name="fidelity"/> carrying the supplied
    /// <paramref name="teamScores"/>, one per match team. The scores are copied defensively and are
    /// validated by <see cref="Match.RecordResult(MatchResult, bool)"/>, not here.
    /// </summary>
    /// <param name="fidelity">The fidelity at which the result is recorded.</param>
    /// <param name="teamScores">The proposed per-team final scores; validated when the result is recorded.</param>
    public MatchResult(ResultFidelity fidelity, IEnumerable<TeamScore> teamScores)
    {
        Fidelity = fidelity;
        _teamScores = [.. teamScores ?? []];
    }

    /// <summary>The fidelity at which this result was recorded.</summary>
    public ResultFidelity Fidelity { get; private set; }

    /// <summary>The final score of each match team, one entry per team.</summary>
    public IReadOnlyList<TeamScore> TeamScores => _teamScores;
}
