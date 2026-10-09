using System.Text.Json;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One error code driven through its real seam, together with the response that came back and the one
/// classification Property 11 turns on: whether that response <i>is</i> the seam's concealed
/// not-found.
/// <para>
/// The classification is <b>measured, not listed</b>. A code is treated as concealed when the bytes it
/// produces are identical to the bytes that seam's fixed <c>Concealed()</c> result produces — which is
/// the only honest definition, because "answered by a concealed not-found" is a statement about the
/// response a caller sees, not about a name in a table. It also makes the exclusion self-maintaining:
/// a code routed through <c>Concealed()</c> next year leaves the branchable-code rule on its own,
/// and a code quietly taken <i>out</i> of the concealing path joins it. The guard still pins today's
/// excluded set explicitly, so the exclusion cannot widen unnoticed in either direction.
/// </para>
/// </summary>
/// <param name="SeamName">The seam class that translated the code, for example <c>SquadErrorResults</c>.</param>
/// <param name="VariantName">
/// The variant the code was driven under — <c>standard</c> for the ordinary mapping, <c>concealed</c>
/// where the seam was called with its existence-concealment flag set.
/// </param>
/// <param name="ErrorCodeType">The error-code enum the code belongs to.</param>
/// <param name="CodeName">The error code's C# member name, which is the value the body must carry.</param>
/// <param name="Response">The captured status and bytes the seam wrote.</param>
/// <param name="IsConcealedNotFound">
/// Whether the response is byte-for-byte the seam's fixed concealed not-found, and so outside the rule.
/// </param>
public sealed record SeamProblem(
    string SeamName,
    string VariantName,
    Type ErrorCodeType,
    string CodeName,
    CapturedResponse Response,
    bool IsConcealedNotFound)
{
    /// <summary>The root path at which the one branchable code is expected to sit.</summary>
    public const string RootCodePath = "$.code";

    /// <summary>The producing error code, qualified by its enum, for failure messages.</summary>
    public string Producer => $"{ErrorCodeType.Name}.{CodeName}";

    /// <summary>The seam and variant, for FsCheck's distribution output and the non-vacuity floor.</summary>
    public string SeamVariant => $"{SeamName} ({VariantName})";

    /// <summary>The seam, variant and producing code — what a failure message has to name.</summary>
    public string Description => $"{SeamVariant}: {Producer}";

    /// <summary>The status the seam wrote.</summary>
    public int Status => Response.Status;

    /// <summary>The serialised body, for failure messages.</summary>
    public string BodyText => Response.BodyText;

    /// <summary>
    /// Every path at which a <c>code</c> member appears in the body, at any depth, as the shared walk
    /// reports them. Exactly one, at <see cref="RootCodePath"/>, is the requirement.
    /// </summary>
    public IReadOnlyList<string> CodeMemberPaths => Response.CodeMemberPaths;

    /// <summary>
    /// The value of the body's root <c>code</c> member, or <see langword="null"/> when the body has
    /// none. A non-string value is returned as its raw JSON text so a failure message can show what
    /// was actually written rather than reporting it as absent.
    /// </summary>
    public string? CodeExtension => RootCode(Response.Body);

    /// <summary>A readable form for failure messages and FsCheck's distribution output.</summary>
    public override string ToString() => $"{Description} => {Status} {BodyText}";

    private static string? RootCode(byte[] body)
    {
        if (body.Length == 0)
        {
            return null;
        }

        using JsonDocument document = JsonDocument.Parse(body);

        if (document.RootElement.ValueKind != JsonValueKind.Object
            || !document.RootElement.TryGetProperty("code", out JsonElement code))
        {
            return null;
        }

        return code.ValueKind == JsonValueKind.String ? code.GetString() : code.GetRawText();
    }
}
