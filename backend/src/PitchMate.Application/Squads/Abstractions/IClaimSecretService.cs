namespace PitchMate.Application.Squads.Abstractions;

/// <summary>
/// Issues and hashes guest-claim link secrets. Same scheme as invite secrets: a high-entropy opaque
/// token, carried in the link's path, persisted only as its one-way hash.
/// </summary>
public interface IClaimSecretService
{
    /// <summary>Generates a new secret, returning its link and the hash to persist.</summary>
    ClaimSecret Generate();

    /// <summary>Hashes a presented secret the same way, so it can be looked up by its hash.</summary>
    /// <param name="presentedSecret">The secret as a player's client presented it.</param>
    string Hash(string presentedSecret);
}
