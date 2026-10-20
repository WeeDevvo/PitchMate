using System.Text;
using System.Text.Json;

namespace PitchMate.Api.Tests.Matches;

/// <summary>
/// One response to a real HTTP request, reduced to the only two things the indistinguishability guarantee
/// speaks about: the status code and the exact bytes of the body.
/// <para>
/// Headers are deliberately <b>not</b> captured. Requirement 7.8 compares the response a caller can
/// observe as evidence of the refusal's cause, and the design scopes that comparison to status and body
/// bytes, excluding headers, any per-request trace or correlation value, and timing. Including a header
/// would make the comparison stronger than the contract and would start failing for reasons that disclose
/// nothing — which is how a guard gets relaxed rather than fixed.
/// </para>
/// <para>
/// The body is held as bytes rather than a string because "identical" is a fact about the wire: two
/// <c>ProblemDetails</c> instances can be equal in C# and still serialise differently through a differing
/// member order or a populated-versus-absent extension, and it is the serialised form a caller compares.
/// </para>
/// </summary>
/// <param name="Status">The status code written to the response.</param>
/// <param name="Body">The exact bytes written to the response body.</param>
public sealed record CapturedMatchResponse(int Status, byte[] Body)
{
    /// <summary>The body decoded as text, for failure messages.</summary>
    public string BodyText => Encoding.UTF8.GetString(Body);

    /// <summary>
    /// The number of members of the body's root object, or zero when the body is empty or not an object.
    /// Used by the non-vacuity floor: byte-equality across two empty bodies proves nothing.
    /// </summary>
    public int RootMemberCount
    {
        get
        {
            if (Body.Length == 0)
            {
                return 0;
            }

            using JsonDocument document = JsonDocument.Parse(Body);

            return document.RootElement.ValueKind == JsonValueKind.Object
                ? document.RootElement.EnumerateObject().Count()
                : 0;
        }
    }

    /// <summary>
    /// Whether this response is byte-for-byte what a caller would observe from <paramref name="other"/> —
    /// same status, same body bytes.
    /// </summary>
    /// <param name="other">The response to compare against.</param>
    /// <returns><see langword="true"/> when the two are indistinguishable.</returns>
    public bool IsIndistinguishableFrom(CapturedMatchResponse other)
    {
        ArgumentNullException.ThrowIfNull(other);

        return Status == other.Status && Body.AsSpan().SequenceEqual(other.Body);
    }

    /// <summary>A readable form for failure messages.</summary>
    public override string ToString() => $"{Status} {BodyText}";
}
