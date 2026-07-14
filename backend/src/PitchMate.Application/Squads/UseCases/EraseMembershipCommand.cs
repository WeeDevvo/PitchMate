namespace PitchMate.Application.Squads.UseCases;

/// <summary>
/// A request to erase a single squad membership under the UK GDPR erasure path (Requirement 18.1,
/// 18.2). The membership is identified by its identity; the handler branches on whether it carries
/// match history — anonymising a history-bearing membership (retaining its de-identified row) or
/// permanently removing one that carries none — and blocks erasing the owner of a squad that is not
/// itself being deleted (Requirement 18.5, 18.6).
/// </summary>
/// <param name="MembershipId">The membership to erase.</param>
public sealed record EraseMembershipCommand(Guid MembershipId);
