using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;

namespace PitchMate.Api.Auth.OpenApi;

/// <summary>
/// Marks each protected operation in the OpenAPI document as requiring the bearer scheme
/// (Requirement 13.7). An operation is protected when its endpoint carries authorization metadata and
/// is not explicitly anonymous — mirroring the <c>RequireAuthorization()</c> / <c>AllowAnonymous()</c>
/// metadata the endpoints declare — so the document's per-endpoint security matches what the
/// middleware actually enforces.
/// </summary>
internal sealed class BearerSecurityRequirementOperationTransformer : IOpenApiOperationTransformer
{
    /// <inheritdoc />
    public Task TransformAsync(
        OpenApiOperation operation,
        OpenApiOperationTransformerContext context,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ArgumentNullException.ThrowIfNull(context);

        IList<object> metadata = context.Description.ActionDescriptor.EndpointMetadata;

        bool isAnonymous = metadata.OfType<IAllowAnonymous>().Any();
        bool requiresAuthorization = metadata.OfType<IAuthorizeData>().Any();

        if (isAnonymous || !requiresAuthorization)
        {
            return Task.CompletedTask;
        }

        operation.Security ??= [];
        operation.Security.Add(new OpenApiSecurityRequirement
        {
            [new OpenApiSecuritySchemeReference(BearerSecuritySchemeDocumentTransformer.SchemeId)] = [],
        });

        return Task.CompletedTask;
    }
}
