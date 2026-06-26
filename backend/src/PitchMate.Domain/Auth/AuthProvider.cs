namespace PitchMate.Domain.Auth;

/// <summary>
/// The closed set of authentication mechanisms behind an <c>AuthIdentity</c>. A
/// <c>User</c> resolves an incoming authentication solely on the pair
/// (<see cref="AuthProvider"/>, provider user id), never on email address.
/// <para>
/// The MVP ships <see cref="Password"/> and <see cref="Google"/>. <see cref="Apple"/>
/// is a reserved future member so the iOS app can adopt Apple Sign-In later without
/// any change to the <c>AuthIdentity</c> schema. Numeric values are assigned
/// explicitly and are stable, because they are persisted.
/// </para>
/// </summary>
public enum AuthProvider
{
    /// <summary>Email address plus a salted, one-way password hash.</summary>
    Password = 1,

    /// <summary>Google sign-in via OpenID Connect.</summary>
    Google = 2,

    /// <summary>Reserved future member: Apple Sign-In, adopted once the iOS app exists.</summary>
    Apple = 3,
}
