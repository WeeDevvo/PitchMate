using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace PitchMate.Api.Auth.OpenApi;

/// <summary>
/// Declares the HTTP bearer (JWT) security scheme in the OpenAPI document's components so the
/// generated client and interactive docs know how the Api is authenticated (Requirement 13.7). The
/// per-endpoint requirement that references this scheme is added by
/// <see cref="BearerSecurityRequirementOperationTransformer"/>.
/// </summary>
internal sealed class BearerSecuritySchemeDocumentTransformer : IOpenApiDocumentTransformer
{
    /// <summary>The components key and reference id for the bearer scheme.</summary>
    internal const string SchemeId = "Bearer";

    /// <inheritdoc />
    public Task TransformAsync(
        OpenApiDocument document,
        OpenApiDocumentTransformerContext context,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(document);

        document.Components ??= new OpenApiComponents();
        document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();

        document.Components.SecuritySchemes[SchemeId] = new OpenApiSecurityScheme
        {
            Type = SecuritySchemeType.Http,
            Scheme = "bearer",
            BearerFormat = "JWT",
            In = ParameterLocation.Header,
            Description = "JWT access token supplied as an 'Authorization: Bearer {token}' header.",
        };

        return Task.CompletedTask;
    }
}
