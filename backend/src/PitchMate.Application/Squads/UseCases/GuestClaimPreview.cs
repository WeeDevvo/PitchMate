namespace PitchMate.Application.Squads.UseCases;

/// <summary>What a usable claim link is for: the guest's name and the squad's.</summary>
/// <param name="SquadName">The squad's name.</param>
/// <param name="GuestDisplayName">The guest profile the player would take over.</param>
public sealed record GuestClaimPreview(string SquadName, string GuestDisplayName);
