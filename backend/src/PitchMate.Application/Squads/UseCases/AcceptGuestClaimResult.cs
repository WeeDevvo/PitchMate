namespace PitchMate.Application.Squads.UseCases;

/// <summary>An accepted claim link: the squad it was for, so the player is told what they accepted.</summary>
/// <param name="SquadName">The squad's name.</param>
public sealed record AcceptGuestClaimResult(string SquadName);
