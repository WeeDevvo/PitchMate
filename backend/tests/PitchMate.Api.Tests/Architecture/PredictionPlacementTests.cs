using System.Reflection;
using System.Reflection.Emit;
using PitchMate.Application.Matches.UseCases;
using PitchMate.Domain.Rating;

namespace PitchMate.Api.Tests.Architecture;

/// <summary>
/// The split prediction is an Application use case, asserted <b>both halves</b> (match-read-models task
/// 15.2): no method in <c>PitchMate.Api</c> invokes any <see cref="IRatingEngine"/> member, <b>and</b>
/// <see cref="GetWorkingTeamsHandler"/> does invoke <see cref="IRatingEngine.Predict"/> — so the
/// negative cannot be satisfied by the prediction having quietly moved somewhere else entirely.
/// <para>
/// Calls are read from the compiled IL (every <c>call</c> and <c>callvirt</c> in every method body,
/// compiler-generated async state machines included) rather than from source text, so a call cannot
/// hide behind formatting or an alias. A planted test-only type proves the scan sees a call. The
/// broader rule — no use-case handler, rating type or statistics type in Api member signatures — is
/// <see cref="ApiInwardLogicProperties"/>, which this extends rather than replaces.
/// </para>
/// <para><b>Validates: Requirements 11.4, 11.10.</b></para>
/// </summary>
public sealed class PredictionPlacementTests
{
    private static readonly Assembly ApiAssembly = typeof(Program).Assembly;

    [Fact]
    public void NoApiMethodInvokesTheRatingEngine()
    {
        List<string> offenders =
        [
            .. ApiAssembly.GetTypes()
                .SelectMany(static type => CallsFrom(type).Select(called => (type, called)))
                .Where(static pair => pair.called.DeclaringType == typeof(IRatingEngine))
                .Select(static pair => $"{pair.type.FullName} calls {nameof(IRatingEngine)}.{pair.called.Name}"),
        ];

        Assert.True(offenders.Count == 0, string.Join(Environment.NewLine, offenders));
    }

    [Fact]
    public void TheWorkingTeamsHandlerInvokesPredict()
    {
        Assert.Contains(
            CallsFrom(typeof(GetWorkingTeamsHandler)),
            static called => called.DeclaringType == typeof(IRatingEngine) && called.Name == nameof(IRatingEngine.Predict));
    }

    [Fact]
    public void TheScanDetectsAPlantedCall()
    {
        Assert.Contains(
            CallsFrom(typeof(PlantedPredictionCaller)),
            static called => called.DeclaringType == typeof(IRatingEngine) && called.Name == nameof(IRatingEngine.Predict));
        Assert.DoesNotContain(CallsFrom(typeof(GetMatchDetailHandler)), static called => called.DeclaringType == typeof(IRatingEngine));
    }

    /// <summary>
    /// Every method a type's own method bodies call, including those of its nested (compiler-generated)
    /// types — where an async method's body actually lives.
    /// </summary>
    private static IEnumerable<MethodBase> CallsFrom(Type type)
    {
        const BindingFlags all = BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static | BindingFlags.DeclaredOnly;

        IEnumerable<Type> types = type.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic).SelectMany(NestedAndSelf).Prepend(type);

        foreach (Type declaring in types)
        {
            IEnumerable<MethodBase> bodies = declaring.GetMethods(all).Cast<MethodBase>().Concat(declaring.GetConstructors(all));
            foreach (MethodBase method in bodies)
            {
                foreach (MethodBase called in CallsIn(method))
                {
                    yield return called;
                }
            }
        }
    }

    private static IEnumerable<Type> NestedAndSelf(Type type) =>
        type.GetNestedTypes(BindingFlags.Public | BindingFlags.NonPublic).SelectMany(NestedAndSelf).Prepend(type);

    /// <summary>Resolves the target of every <c>call</c>, <c>callvirt</c> and <c>newobj</c> in a method body.</summary>
    private static IEnumerable<MethodBase> CallsIn(MethodBase method)
    {
        byte[]? il;
        try
        {
            il = method.GetMethodBody()?.GetILAsByteArray();
        }
        catch (Exception exception) when (exception is InvalidOperationException or NotSupportedException)
        {
            yield break;
        }

        if (il is null)
        {
            yield break;
        }

        for (int i = 0; i + 4 < il.Length; i++)
        {
            if (il[i] != OpCodes.Call.Value && il[i] != OpCodes.Callvirt.Value && il[i] != OpCodes.Newobj.Value)
            {
                continue;
            }

            int token = BitConverter.ToInt32(il, i + 1);
            MethodBase? called = null;
            try
            {
                called = method.Module.ResolveMethod(
                    token,
                    method.DeclaringType?.IsGenericType == true ? method.DeclaringType.GetGenericArguments() : null,
                    method.IsGenericMethod ? method.GetGenericArguments() : null);
            }
            catch (Exception exception) when (exception is ArgumentException or BadImageFormatException)
            {
                // Not a method token: the byte was an operand, not an opcode.
            }

            if (called is not null)
            {
                yield return called;
            }
        }
    }

    /// <summary>A test-only type that calls the engine, so the scan's positive case is non-vacuous.</summary>
    private static class PlantedPredictionCaller
    {
        public static void Call(IRatingEngine engine) => engine.Predict([]);
    }
}
