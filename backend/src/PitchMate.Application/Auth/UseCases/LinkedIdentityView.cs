using PitchMate.Domain.Auth;

namespace PitchMate.Application.Auth.UseCases;

/// <summary>
/// One linked sign-in method of an <see cref="AccountView"/>, carrying the
/// <paramref name="IdentityId"/> that unlinking targets, the <see cref="AuthProvider"/> kind,
/// and the instant the identity was linked (Requirement 8.4).
/// <para>
/// The record deliberately carries <strong>no</strong> provider subject
/// (<c>AuthIdentity.ProviderUserId</c>), no password credential, and no token material: the id
/// is the value <c>DELETE /auth/identities/{identityId}</c> accepts, and the provider kind is
/// all account settings needs in order to label the method. This is a separate read model from
/// the DSAR <see cref="Gdpr.UserDataExport"/>, which discloses provider kinds only and carries
/// no identity id (Requirement 9.4).
/// </para>
/// </summary>
/// <param name="IdentityId">The <c>AuthIdentity.Id</c> that unlinking this sign-in method targets.</param>
/// <param name="Provider">The authentication mechanism this identity uses.</param>
/// <param name="LinkedAt">The instant the identity was linked, being its creation instant.</param>
public sealed record LinkedIdentityView(
    Guid IdentityId,
    AuthProvider Provider,
    DateTimeOffset LinkedAt);
