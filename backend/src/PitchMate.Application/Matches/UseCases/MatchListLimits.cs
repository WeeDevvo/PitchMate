namespace PitchMate.Application.Matches.UseCases;

/// <summary>
/// The declared bound of the match list read, held as a named constant of the match read surface
/// rather than as a literal at a call site (Requirement 1.10).
/// <para>
/// One constant, named once, is what lets the handler, the query source's row limit and the tests
/// that assert the bound all speak of the same number — and what makes the bound reviewable without
/// reading the SQL.
/// </para>
/// </summary>
public static class MatchListLimits
{
    /// <summary>
    /// The maximum number of <see cref="MatchListEntry"/> values a <see cref="MatchList"/> carries.
    /// The first <see cref="MaximumEntries"/> entries of the order of Requirement 1.9 are retained
    /// and the remainder discarded, with <see cref="MatchList.Truncated"/> reporting that the
    /// discard happened.
    /// </summary>
    public const int MaximumEntries = 200;
}
