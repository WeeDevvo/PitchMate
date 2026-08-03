namespace PitchMate.Application.Matches.Abstractions;

/// <summary>
/// Produces a random, light-hearted team name for use when an admin rolls teams without supplying a
/// name of their own (Requirement 8.4, <c>product.md</c> "Match presentation"). Declared in
/// Application; implemented in Infrastructure by drawing from a curated word list.
/// </summary>
public interface ISillyNameGenerator
{
    /// <summary>
    /// Returns the next generated team name. Each call yields a non-empty name suitable for a team;
    /// successive calls may repeat.
    /// </summary>
    /// <returns>A generated, non-empty team name.</returns>
    string Next();
}
