using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using PitchMate.Api.Auth;
using PitchMate.Application.Common;

namespace PitchMate.Api.Tests.Auth;

/// <summary>
/// The current user, as the handlers that read <see cref="ICurrentUserAccessor"/> see it (live
/// tracking resolves its requester this way). The configured host resolves the request-scoped
/// accessor rather than the system default, and it reports the access token's subject on a request,
/// and no one outside a request or for a principal with no usable subject.
/// </summary>
public sealed class CurrentUserAccessorTests : IClassFixture<AuthApiFactory>
{
    private readonly AuthApiFactory _factory;

    /// <summary>Receives the shared in-memory Api host factory.</summary>
    public CurrentUserAccessorTests(AuthApiFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public void TheHostResolvesTheRequestScopedAccessor()
    {
        using IServiceScope scope = _factory.Services.CreateScope();

        Assert.IsType<HttpContextCurrentUserAccessor>(scope.ServiceProvider.GetRequiredService<ICurrentUserAccessor>());
    }

    [Fact]
    public void ItReportsTheTokenSubjectOnARequest()
    {
        Guid userId = Guid.NewGuid();
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", userId.ToString())], "Bearer")),
        };

        var accessor = new HttpContextCurrentUserAccessor(new HttpContextAccessor { HttpContext = context });

        Assert.Equal(userId.ToString(), accessor.CurrentUserId);
    }

    [Fact]
    public void ItReportsNoOneOutsideARequestOrWithoutAUsableSubject()
    {
        Assert.Null(new HttpContextCurrentUserAccessor(new HttpContextAccessor()).CurrentUserId);

        var anonymous = new HttpContextAccessor { HttpContext = new DefaultHttpContext() };
        Assert.Null(new HttpContextCurrentUserAccessor(anonymous).CurrentUserId);

        var malformed = new HttpContextAccessor
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", "not-a-guid")], "Bearer")),
            },
        };
        Assert.Null(new HttpContextCurrentUserAccessor(malformed).CurrentUserId);
    }
}
