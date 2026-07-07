using FsCheck;
using FsCheck.Fluent;
using FsCheck.Xunit;
using PitchMate.Domain.Rating;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Squads;

/// <summary>
/// Property-based tests for the exactly-one-backing invariant on <see cref="SquadMembership"/>
/// (squads-and-membership design Property 4). Every membership produced by a factory is backed by
/// exactly one of a registered user (user set and role non-null) or a guest (user null and role
/// null), never both and never neither, and <see cref="SquadMembership.IsGuest"/> agrees with the
/// backing. Each property runs at least 100 iterations.
/// </summary>
[Trait("Feature", "squads-and-membership")]
public class SquadMembershipBackingPropertyTests
{
    private static readonly char[] NameChars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.!' ".ToCharArray();

    private enum Backing { Owner, Registered, Guest }

    // Feature: squads-and-membership, Property 4: Exactly-one-backing invariant - every membership a
    // factory constructs is either (UserId set AND Role non-null) or (UserId null AND Role null),
    // never both and never neither, and IsGuest reflects the absence of a backing user.
    // Validates: Requirements 2.2, 2.3, 4.1
    [Property(MaxTest = 100)]
    [Trait("Property", "4")]
    public Property EveryConstructedMembershipHasExactlyOneBacking() =>
        Prop.ForAll(Arb.From(SpecGen()), spec =>
        {
            var result = Create(spec);
            if (!result.IsSuccess)
            {
                return false; // valid inputs must construct a membership
            }

            var membership = result.Value!;
            var registered = membership.UserId is not null && membership.Role is not null;
            var guest = membership.UserId is null && membership.Role is null;

            // Exactly one backing (XOR), and IsGuest agrees with the discriminator.
            return (registered ^ guest) && membership.IsGuest == (membership.UserId is null);
        });

    // Feature: squads-and-membership, Property 4: Exactly-one-backing invariant - the guest factory
    // always yields a guest backing (no user, no role) while the registered/owner factories always
    // yield a registered backing (user present, role present).
    // Validates: Requirements 2.2, 2.3, 4.1
    [Property(MaxTest = 100)]
    [Trait("Property", "4")]
    public Property BackingMatchesTheFactoryUsed() =>
        Prop.ForAll(Arb.From(SpecGen()), spec =>
        {
            var membership = Create(spec).Value!;

            return spec.Kind switch
            {
                Backing.Guest => membership.IsGuest && membership.UserId is null && membership.Role is null,
                Backing.Owner => !membership.IsGuest && membership.UserId is not null && membership.Role == SquadRole.Owner,
                _ => !membership.IsGuest && membership.UserId is not null && membership.Role == SquadRole.Member,
            };
        });

    private sealed record Spec(Backing Kind, Guid SquadId, Guid UserId, string DisplayName, SkillTier? SkillTier);

    private static PitchMate.Domain.Squads.Result<SquadMembership> Create(Spec spec) => spec.Kind switch
    {
        Backing.Owner => SquadMembership.CreateOwner(spec.SquadId, spec.UserId, spec.DisplayName),
        Backing.Registered => SquadMembership.CreateRegistered(spec.SquadId, spec.UserId, spec.DisplayName),
        _ => SquadMembership.CreateGuest(spec.SquadId, spec.DisplayName, spec.SkillTier, DateTimeOffset.UtcNow),
    };

    private static Gen<Spec> SpecGen() =>
        from kind in Gen.Elements(Backing.Owner, Backing.Registered, Backing.Guest)
        from squadId in GuidGen()
        from userId in GuidGen()
        from name in ValidNameGen()
        from tier in TierGen()
        select new Spec(kind, squadId, userId, name, tier);

    /// <summary>Generates a display name whose trimmed length is within the accepted 1..50 range.</summary>
    private static Gen<string> ValidNameGen() =>
        from length in Gen.Choose(0, 49)
        from chars in Gen.ArrayOf(Gen.Elements(NameChars), length)
        // Lead with a non-whitespace anchor so the trimmed length is 1..50 regardless of padding.
        select "x" + new string(chars);

    private static Gen<SkillTier?> TierGen() =>
        Gen.Elements<SkillTier?>(null, SkillTier.Beginner, SkillTier.Average, SkillTier.Strong);

    /// <summary>Generates a non-empty GUID.</summary>
    private static Gen<Guid> GuidGen() =>
        from bytes in Gen.ArrayOf(Gen.Choose(1, 255), 16)
        select new Guid(Array.ConvertAll(bytes, b => (byte)b));
}
