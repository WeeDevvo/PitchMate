using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace PitchMate.Api.Tests.Contracts;

/// <summary>
/// One seam result as a client would observe it: the status written to the response and the exact bytes
/// written to the body.
/// <para>
/// The result is <b>executed</b> against a real (in-memory) <see cref="HttpContext"/> rather than
/// inspected as a <c>ProblemHttpResult</c>, because the concealment guarantee is about the wire. Two
/// <c>ProblemDetails</c> instances can look equivalent in C# and still serialise differently — a
/// populated versus absent extension, a differing member order — and it is the serialised form a caller
/// compares. Capturing the bytes once, here, also means the guard's comparisons are ordinary value
/// comparisons rather than repeated I/O.
/// </para>
/// </summary>
/// <param name="Failure">The failure that produced this response.</param>
/// <param name="Status">The status code written to the response.</param>
/// <param name="Body">The exact bytes written to the response body.</param>
public sealed record CapturedResponse(ConcealedFailure Failure, int Status, byte[] Body)
{
    /// <summary>The seam whose concealing path produced this response.</summary>
    public string SeamName => Failure.SeamName;

    /// <summary>The body decoded as text, for failure messages.</summary>
    public string BodyText => Encoding.UTF8.GetString(Body);

    /// <summary>
    /// Every path at which a <c>code</c> member appears in the body, at any depth. Empty is the
    /// requirement: a concealed not-found must carry no branchable code (Requirements 5.2, 5.6).
    /// </summary>
    public IReadOnlyList<string> CodeMemberPaths => FindCodeMembers(Body);

    /// <summary>The number of members of the body's root object, or zero when it is not an object.</summary>
    public int RootMemberCount
    {
        get
        {
            using JsonDocument document = JsonDocument.Parse(Body);

            return document.RootElement.ValueKind == JsonValueKind.Object
                ? document.RootElement.EnumerateObject().Count()
                : 0;
        }
    }

    /// <summary>A readable form for failure messages and FsCheck's distribution output.</summary>
    public override string ToString() => $"{Failure} => {Status} {BodyText}";

    /// <summary>
    /// Executes a minimal-API <see cref="IResult"/> against a fresh in-memory
    /// <see cref="HttpContext"/> and captures the status and the exact bytes written — the same output a
    /// real client would observe.
    /// </summary>
    /// <param name="failure">The failure whose result is being captured.</param>
    /// <returns>The captured response.</returns>
    public static async Task<CapturedResponse> CaptureAsync(ConcealedFailure failure)
    {
        ArgumentNullException.ThrowIfNull(failure);

        await using var body = new MemoryStream();
        var context = new DefaultHttpContext
        {
            RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider(),
        };
        context.Response.Body = body;

        await failure.Produce().ExecuteAsync(context);

        return new CapturedResponse(failure, context.Response.StatusCode, body.ToArray());
    }

    /// <summary>
    /// Finds every <c>code</c> member in a JSON body, at <b>any</b> depth.
    /// <para>
    /// Depth matters: <c>ProblemDetails</c> extensions are written as root members today, but a future
    /// seam could just as easily nest the code inside an <c>errors</c> object or an array of details,
    /// and a root-only check would call that clean. The match is on the member <i>name</i> only, so a
    /// member merely containing the word — <c>encoded</c>, <c>codex</c> — is not an offence.
    /// </para>
    /// </summary>
    /// <param name="body">The serialised body to walk.</param>
    /// <returns>The path of every <c>code</c> member found, in document order.</returns>
    public static IReadOnlyList<string> FindCodeMembers(byte[] body)
    {
        ArgumentNullException.ThrowIfNull(body);

        if (body.Length == 0)
        {
            return [];
        }

        using JsonDocument document = JsonDocument.Parse(body);

        var found = new List<string>();
        Walk(document.RootElement, path: "$", found);

        return found;
    }

    private static void Walk(JsonElement element, string path, List<string> found)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (JsonProperty property in element.EnumerateObject())
                {
                    string childPath = $"{path}.{property.Name}";

                    if (string.Equals(property.Name, "code", StringComparison.OrdinalIgnoreCase))
                    {
                        found.Add(childPath);
                    }

                    Walk(property.Value, childPath, found);
                }

                break;

            case JsonValueKind.Array:
                int index = 0;

                foreach (JsonElement item in element.EnumerateArray())
                {
                    Walk(item, $"{path}[{index++}]", found);
                }

                break;

            default:
                break;
        }
    }
}
