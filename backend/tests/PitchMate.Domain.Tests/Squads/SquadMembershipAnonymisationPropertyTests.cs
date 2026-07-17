using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Property-based tests for anonymisation of <see cref="SquadMembership"/> (squads-and-membership
/// design Properties 7 and 40). Anonymising a membership nulls its normalised display key so the
/// former name is freed for reuse (Property 7), and it preserves the identity, squad link, and
/// non-PII/relationship state that chronological rating replay depends on while clearing only the
/// backing user, role, and display name (Property 40). Anonymisation is idempotent. Each property
/// runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadMembershipAnonymisationPropertyTests
{
    private static readonly char[] NameChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".ToCharArray();

    private enum Backing { Owner, Registered, Guest }

    // Feature: squads-and-membership, Property 7: Anonymisation frees a display name for reuse -
    // after Anonymise the normalised key is null (exempting the row from the uniqueness rule) and the
    // display name is the fixed placeholder, so the former name becomes available.
    // Validates: Requirements 3.4
    [Property(MaxTest = 100)]
    [Trait("Property", "7")]
    public Property AnonymiseFreesTheDisplayName() =>
        Prop.ForAll(Arb.From(SpecGen()), spec =>
        {
            var membership = Create(spec);
            var formerNormalized = membership.DisplayNameNormalized;

            membership.Anonymise();

            return membership.DisplayNameNormalized is null
                && membership.DisplayName == SquadMembership.DisplayNamePlaceholder
                // The former key was a real name that a uniqueness check would have matched.
                && formerNormalized is not null;
        });

    // Feature: squads-and-membership, Property 7: Anonymisation frees a display name for reuse -
    // once a membership is anonymised, another membership may take its former normalised name because
    // the anonymised row no longer contributes a key to the comparison.
    // Validates: Requirements 3.4
    [Property(MaxTest = 100)]
    [Trait("Property", "7")]
    public Property FormerNameIsReusableAfterAnonymisation() =>
        Prop.ForAll(Arb.From(SpecGen()), spec =>
        {
            var original = Create(spec);
            var freedKey = original.DisplayNameNormalized!;

            original.Anonymise();

            // Model the squad's remaining keys after anonymisation: the anonymised row contributes none.
            var remainingKeys = new[] { original.DisplayNameNormalized }
                .Where(k => k is not null)
                .ToHashSet();

            // A new membership renaming to the freed key is not reported as a collision.
            var newcomer = SquadMembership.CreateRegistered(spec.SquadId, Guid.NewGuid(), "placeholder-name").Value!;
            var rename = newcomer.Rename(freedKey, remainingKeys.Contains!);

            return rename.IsSuccess && newcomer.DisplayNameNormalized == freedKey;
        });

    // Feature: squads-and-membership, Property 40: Anonymisation preserves rating replay inputs -
    // Anonymise retains Id, SquadId, State, SkillTier, ClaimCompleted, and the lawful-basis instant
    // (the relationship and non-PII state replay depends on) while clearing only UserId, Role, and the
    // display name.
    // Validates: Requirements 18.7
    [Property(MaxTest = 100)]
    [Trait("Property", "40")]
    public Property AnonymisePreservesReplayInputs() =>
        Prop.ForAll(Arb.From(SpecGen()), spec =>
        {
            var membership = Create(spec);

            var id = membership.Id;
            var squadId = membership.SquadId;
            var state = membership.State;
            var tier = membership.SkillTier;
            var claimCompleted = membership.ClaimCompleted;
            var lawfulBasis = membership.LawfulBasisAcknowledgedAt;

            membership.Anonymise();

            return membership.Id == id
                && membership.SquadId == squadId
                && membership.State == state
                && membership.SkillTier == tier
                && membership.ClaimCompleted == claimCompleted
                && membership.LawfulBasisAcknowledgedAt == lawfulBasis
                && membership.UserId is null
                && membership.Role is null
                && membership.DisplayName == SquadMembership.DisplayNamePlaceholder;
        });

    // Feature: squads-and-membership, Property 40: Anonymisation preserves rating replay inputs -
    // anonymisation is idempotent: a second Anonymise leaves the same de-identified, replay-preserving
    // state as the first.
    // Validates: Requirements 18.7
    [Property(MaxTest = 100)]
    [Trait("Property", "40")]
    public Property AnonymiseIsIdempotent() =>
        Prop.ForAll(Arb.From(SpecGen()), spec =>
        {
            var membership = Create(spec);

            membership.Anonymise();
            var idAfterFirst = membership.Id;
            var squadAfterFirst = membership.SquadId;

            membership.Anonymise();

            return membership.Id == idAfterFirst
                && membership.SquadId == squadAfterFirst
                && membership.DisplayName == SquadMembership.DisplayNamePlaceholder
                && membership.DisplayNameNormalized is null
                && membership.UserId is null
                && membership.Role is null;
        });

    private sealed record Spec(Backing Kind, Guid SquadId, Guid UserId, string DisplayName, SkillTier? SkillTier);

    private static SquadMembership Create(Spec spec) => spec.Kind switch
    {
        Backing.Owner => SquadMembership.CreateOwner(spec.SquadId, spec.UserId, spec.DisplayName).Value!,
        Backing.Registered => SquadMembership.CreateRegistered(spec.SquadId, spec.UserId, spec.DisplayName).Value!,
        _ => SquadMembership.CreateGuest(spec.SquadId, spec.DisplayName, spec.SkillTier, DateTimeOffset.UtcNow).Value!,
    };

    private static Gen<Spec> SpecGen() =>
        from kind in Gen.Elements(Backing.Owner, Backing.Registered, Backing.Guest)
        from squadId in GuidGen()
        from userId in GuidGen()
        from name in ValidNameGen()
        from tier in TierGen()
        select new Spec(kind, squadId, userId, name, tier);

    private static Gen<string> ValidNameGen() =>
        from length in Gen.Choose(1, 40)
        from chars in Gen.ArrayOf(Gen.Elements(NameChars), length)
        select new string(chars);

    private static Gen<SkillTier?> TierGen() =>
        Gen.Elements<SkillTier?>(null, SkillTier.Beginner, SkillTier.Average, SkillTier.Strong);

    private static Gen<Guid> GuidGen() =>
        from bytes in Gen.ArrayOf(Gen.Choose(1, 255), 16)
        select new Guid(Array.ConvertAll(bytes, b => (byte)b));
}
