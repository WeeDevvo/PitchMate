using PitchMate.Domain.Matches;
using PitchMate.Domain.Squads;

namespace PitchMate.Domain.Tests.Matches;

/// <summary>
/// Unit tests for <see cref="ParticipantDisplayName.Resolve"/>, the single display-name-at-time rule
/// every match read obeys (Requirements 2.13, 4.6, 4.7, 10.7).
/// <para>
/// This function is the oracle the equivalent SQL <c>CASE</c> in each EF query source is validated
/// against, so its full truth table is covered <em>directly</em> here rather than only through the
/// harnesses that consume it. Every branch gets its own case: a live membership with a captured name,
/// an anonymised membership, an unresolved membership, and a captured name that is null, empty or
/// whitespace.
/// </para>
/// </summary>
[Trait("Feature", "match-read-models")]
public class ParticipantDisplayNameTests
{
    private const string CapturedName = "Dave";

    /// <summary>
    /// A live, resolved membership with a captured display-name-at-time reports that name verbatim.
    /// </summary>
    [Fact]
    public void LiveMembershipWithACapturedNameReportsThatName()
    {
        string resolved = ParticipantDisplayName.Resolve(
            CapturedName, membershipResolved: true, isAnonymised: false);

        Assert.Equal(CapturedName, resolved);
    }

    /// <summary>
    /// An anonymised membership reports the placeholder and never the name captured when the
    /// participant was added, so erasure is not defeated by the captured name (Requirement 2.13).
    /// </summary>
    [Fact]
    public void AnonymisedMembershipReportsThePlaceholderAndNeverTheCapturedName()
    {
        string resolved = ParticipantDisplayName.Resolve(
            CapturedName, membershipResolved: true, isAnonymised: true);

        Assert.Equal(SquadMembership.DisplayNamePlaceholder, resolved);
        Assert.NotEqual(CapturedName, resolved);
    }

    /// <summary>
    /// An identity that resolves to no visible membership — a rostered identity the match holds no
    /// participant for, or a membership row that is absent or soft-deleted — reports the placeholder
    /// and is neither omitted nor reported as an empty name (Requirement 4.7, 10.7).
    /// </summary>
    [Theory]
    [InlineData(CapturedName)]
    [InlineData((string?)null)]
    public void UnresolvedMembershipReportsThePlaceholder(string? capturedName)
    {
        string resolved = ParticipantDisplayName.Resolve(
            capturedName, membershipResolved: false, isAnonymised: false);

        Assert.Equal(SquadMembership.DisplayNamePlaceholder, resolved);
    }

    /// <summary>
    /// A captured name that is null, empty or whitespace reports the placeholder, so no roster row or
    /// participant view ever carries a blank display name (Requirement 10.7).
    /// </summary>
    [Theory]
    [InlineData((string?)null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("   ")]
    [InlineData("\t")]
    [InlineData("\r\n ")]
    public void BlankCapturedNameReportsThePlaceholder(string? capturedName)
    {
        string resolved = ParticipantDisplayName.Resolve(
            capturedName, membershipResolved: true, isAnonymised: false);

        Assert.Equal(SquadMembership.DisplayNamePlaceholder, resolved);
    }

    /// <summary>
    /// A live membership legitimately <em>named</em> "Former player" reports its own name rather than
    /// being mistaken for an anonymised one. The anonymisation flag is derived here the way every
    /// caller must derive it — from <see cref="SquadMembership.DisplayNameNormalized"/> being
    /// <see langword="null"/> — which a live membership of that name is not: its normalised name is
    /// "former player". Comparing the display name to the placeholder would misreport this case.
    /// </summary>
    [Fact]
    public void LiveMembershipNamedFormerPlayerReportsItsOwnName()
    {
        SquadMembership live = SquadMembership
            .CreateRegistered(Guid.CreateVersion7(), Guid.CreateVersion7(), SquadMembership.DisplayNamePlaceholder)
            .Value!;

        // The sound detector: anonymisation clears the normalised name, and nothing else does.
        Assert.NotNull(live.DisplayNameNormalized);
        Assert.Equal(SquadMembership.DisplayNamePlaceholder, live.DisplayName);

        string resolved = ParticipantDisplayName.Resolve(
            live.DisplayName,
            membershipResolved: true,
            isAnonymised: live.DisplayNameNormalized is null);

        Assert.Equal(live.DisplayName, resolved);
    }

    /// <summary>
    /// The counterpart to the case above: once the same membership is anonymised its normalised name
    /// becomes null, the detector fires, and the captured name is replaced by the placeholder.
    /// </summary>
    [Fact]
    public void AnonymisedMembershipIsDetectedByItsClearedNormalisedName()
    {
        SquadMembership membership = SquadMembership
            .CreateRegistered(Guid.CreateVersion7(), Guid.CreateVersion7(), CapturedName)
            .Value!;

        membership.Anonymise();

        Assert.Null(membership.DisplayNameNormalized);

        string resolved = ParticipantDisplayName.Resolve(
            CapturedName,
            membershipResolved: true,
            isAnonymised: membership.DisplayNameNormalized is null);

        Assert.Equal(SquadMembership.DisplayNamePlaceholder, resolved);
        Assert.NotEqual(CapturedName, resolved);
    }
}
