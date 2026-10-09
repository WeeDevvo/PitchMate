namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// The raw standing of one membership as reported by <see cref="IMembershipStandingSource"/>: how many
/// completed matches of that squad the membership has appeared in, and its current μ/σ where a rating
/// exists.
/// <para>
/// μ and σ never leave the backend on the squad read path; only the classification derived from them
/// does (Requirement 10.7). A membership with no rating carries <see langword="null"/> for both.
/// </para>
/// </summary>
/// <param name="Appearances">Appearances in completed matches of the squad; never negative.</param>
/// <param name="Mu">The membership's current μ, or <see langword="null"/> when it has no rating.</param>
/// <param name="Sigma">The membership's current σ, or <see langword="null"/> when it has no rating.</param>
public sealed record MembershipStanding(int Appearances, double? Mu, double? Sigma);
