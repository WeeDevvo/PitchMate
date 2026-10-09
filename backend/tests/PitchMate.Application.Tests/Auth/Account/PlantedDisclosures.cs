using PitchMate.Domain.Auth;

namespace PitchMate.Application.Tests.Auth.Account;

/// <summary>
/// The positive control for <b>Property 16</b>. A reflection walk that found nothing would pass just
/// as well if it walked nothing at all, so these test-only read models each plant exactly one
/// deliberately disclosing member — at a different depth and reached by a different route — and the
/// guard asserts the walker finds each of them and names the declaring type and member.
/// <para>
/// Between them the cases exercise every route the walker has to cover: a disclosure on the root
/// itself, one two hops down behind a collection, one carried by a benignly named member's
/// <em>type</em>, one on a public nested type, an identity id, and one behind a self-referencing
/// member that would loop forever without the cycle guard. The benign control closes the other side:
/// a read model shaped like the real ones must yield no finding at all, so the walker is not simply
/// condemning everything it sees.
/// </para>
/// <para>
/// None of these types is referenced by production code; they exist only so the guard can be shown to
/// fail when it should.
/// </para>
/// </summary>
public static class PlantedDisclosures
{
    /// <summary>One planted case: the root to walk, and the finding the walker must report.</summary>
    /// <param name="Label">A short description used as the test case name.</param>
    /// <param name="Root">The test-only root type to walk.</param>
    /// <param name="ExpectedKind">The classification the planted member must receive.</param>
    /// <param name="ExpectedDeclaringTypeName">The name of the type the planted member sits on.</param>
    /// <param name="ExpectedMemberName">The name of the planted member.</param>
    public sealed record PlantedCase(
        string Label,
        Type Root,
        ResolvingIdentifierScan.DisclosureKind ExpectedKind,
        string ExpectedDeclaringTypeName,
        string ExpectedMemberName)
    {
        /// <summary>The label, so a shrunk counterexample reads as the case it came from.</summary>
        public override string ToString() => Label;
    }

    /// <summary>A provider subject planted directly on the root, beside benign members.</summary>
    /// <param name="UserId">A benign member.</param>
    /// <param name="DisplayName">A benign member.</param>
    /// <param name="ProviderUserId">The planted provider subject.</param>
    public sealed record ProviderSubjectOnTheRoot(Guid UserId, string DisplayName, string ProviderUserId);

    /// <summary>A root whose only non-benign material sits two hops away, behind a collection.</summary>
    /// <param name="UserId">A benign member.</param>
    /// <param name="Branches">A collection whose element type leads to the planted member.</param>
    public sealed record PasswordHashBehindACollection(Guid UserId, IReadOnlyList<CollectionBranch> Branches);

    /// <summary>The intermediate hop of <see cref="PasswordHashBehindACollection"/>.</summary>
    /// <param name="Leaf">The benignly named member carrying the leaf.</param>
    public sealed record CollectionBranch(CollectionLeaf Leaf);

    /// <summary>The leaf carrying the planted password hash.</summary>
    /// <param name="PasswordHash">The planted password credential.</param>
    public sealed record CollectionLeaf(string PasswordHash);

    /// <summary>
    /// A root reaching token material through a member whose <em>name</em> gives nothing away, so
    /// only the member-type route can catch it.
    /// </summary>
    /// <param name="UserId">A benign member.</param>
    /// <param name="Holder">A benignly named member whose type leads to the planted member.</param>
    public sealed record MaterialCarriedByMemberType(Guid UserId, BenignlyNamedBranch Holder);

    /// <summary>A branch whose benignly named member is typed as a token entity.</summary>
    /// <param name="Rotation">A benign member name carrying <see cref="RefreshToken"/>.</param>
    public sealed record BenignlyNamedBranch(RefreshToken Rotation);

    /// <summary>A root whose disclosure sits on a public nested type rather than on a member type.</summary>
    /// <param name="UserId">A benign member.</param>
    public sealed record AccessTokenOnANestedType(Guid UserId)
    {
        /// <summary>The nested type carrying the planted access token.</summary>
        /// <param name="AccessToken">The planted token material.</param>
        public sealed record Inner(string AccessToken);
    }

    /// <summary>A root carrying an identity id, for the identity-id classification.</summary>
    /// <param name="AuthIdentityId">The planted identity id.</param>
    public sealed record IdentityIdOnTheRoot(Guid AuthIdentityId);

    /// <summary>
    /// A self-referencing root: without the walker's cycle guard this graph never terminates, and the
    /// planted member is never reported.
    /// </summary>
    /// <param name="Next">The self-reference that closes the cycle.</param>
    /// <param name="PasswordHash">The planted password credential.</param>
    public sealed record CyclicPasswordHash(CyclicPasswordHash? Next, string PasswordHash);

    /// <summary>
    /// The negative control: a read model shaped like the real ones, carrying nothing resolving. The
    /// walker must report no finding for it at all.
    /// </summary>
    /// <param name="UserId">A benign member.</param>
    /// <param name="DisplayName">A benign member.</param>
    /// <param name="Email">A benign member.</param>
    /// <param name="EmailVerified">A benign member.</param>
    /// <param name="AvatarReference">A benign member.</param>
    /// <param name="Providers">A benign collection of provider kinds.</param>
    /// <param name="LinkedAt">A benign member.</param>
    public sealed record BenignControl(
        Guid UserId,
        string DisplayName,
        string Email,
        bool EmailVerified,
        string? AvatarReference,
        IReadOnlyList<AuthProvider> Providers,
        DateTimeOffset LinkedAt);

    /// <summary>Every planted case the guard drives, one per detection route.</summary>
    public static IReadOnlyList<PlantedCase> Cases { get; } =
    [
        new PlantedCase(
            "provider subject on the root",
            typeof(ProviderSubjectOnTheRoot),
            ResolvingIdentifierScan.DisclosureKind.ProviderSubject,
            nameof(ProviderSubjectOnTheRoot),
            nameof(ProviderSubjectOnTheRoot.ProviderUserId)),
        new PlantedCase(
            "password hash two hops down, behind a collection",
            typeof(PasswordHashBehindACollection),
            ResolvingIdentifierScan.DisclosureKind.PasswordCredential,
            nameof(CollectionLeaf),
            nameof(CollectionLeaf.PasswordHash)),
        new PlantedCase(
            "token material carried by a benignly named member's type",
            typeof(MaterialCarriedByMemberType),
            ResolvingIdentifierScan.DisclosureKind.TokenMaterial,
            nameof(BenignlyNamedBranch),
            nameof(BenignlyNamedBranch.Rotation)),
        new PlantedCase(
            "access token on a public nested type",
            typeof(AccessTokenOnANestedType),
            ResolvingIdentifierScan.DisclosureKind.TokenMaterial,
            nameof(AccessTokenOnANestedType.Inner),
            nameof(AccessTokenOnANestedType.Inner.AccessToken)),
        new PlantedCase(
            "identity id on the root",
            typeof(IdentityIdOnTheRoot),
            ResolvingIdentifierScan.DisclosureKind.IdentityId,
            nameof(IdentityIdOnTheRoot),
            nameof(IdentityIdOnTheRoot.AuthIdentityId)),
        new PlantedCase(
            "password hash behind a self-referencing member",
            typeof(CyclicPasswordHash),
            ResolvingIdentifierScan.DisclosureKind.PasswordCredential,
            nameof(CyclicPasswordHash),
            nameof(CyclicPasswordHash.PasswordHash)),
    ];
}
