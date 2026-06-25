using System.Reflection;

using PitchMate.Application.Common.Persistence;
using PitchMate.Domain.Common;

namespace PitchMate.Application.Tests.Common.Persistence;

/// <summary>
/// Verifies the shape of the persistence abstractions: every I/O-bound operation on
/// <see cref="IRepository{T}"/> and <see cref="IUnitOfWork"/> is asynchronous
/// (returns <see cref="Task"/> or <see cref="Task{TResult}"/>) and declares a
/// <see cref="CancellationToken"/> parameter, while the synchronous, non-I/O-bound
/// <c>Remove</c>/<c>Restore</c> mediators are <see langword="void"/> and excluded.
/// A pre-cancelled token is asserted to surface cancellation through a fake
/// implementation.
/// <para>Validates: Requirements 5.2, 5.3, 5.6, 6.1, 6.6.</para>
/// </summary>
public class AbstractionSignatureTests
{
    private const string Feature = "persistence-foundation";

    /// <summary>
    /// The <see cref="IRepository{T}"/> members that are intentionally synchronous
    /// because they only mutate tracked state and are not I/O-bound.
    /// </summary>
    private static readonly string[] SynchronousRepositoryMembers = ["Remove", "Restore"];

    private static IEnumerable<MethodInfo> RepositoryMethods =>
        typeof(IRepository<>).GetMethods(BindingFlags.Public | BindingFlags.Instance);

    private static IEnumerable<MethodInfo> UnitOfWorkMethods =>
        typeof(IUnitOfWork).GetMethods(BindingFlags.Public | BindingFlags.Instance);

    private static bool IsTaskReturning(MethodInfo method)
    {
        var returnType = method.ReturnType;
        if (returnType == typeof(Task))
        {
            return true;
        }

        return returnType.IsGenericType
            && returnType.GetGenericTypeDefinition() == typeof(Task<>);
    }

    private static bool HasCancellationTokenParameter(MethodInfo method) =>
        method.GetParameters().Any(p => p.ParameterType == typeof(CancellationToken));

    [Theory]
    [Trait("Feature", Feature)]
    [MemberData(nameof(RepositoryIoBoundMethodNames))]
    public void Repository_io_bound_operations_are_async_and_take_a_cancellation_token(string methodName)
    {
        var method = RepositoryMethods.Single(m => m.Name == methodName);

        Assert.True(
            IsTaskReturning(method),
            $"IRepository<T>.{methodName} should return Task or Task<T> but returns {method.ReturnType}.");
        Assert.True(
            HasCancellationTokenParameter(method),
            $"IRepository<T>.{methodName} should declare a CancellationToken parameter.");
    }

    public static TheoryData<string> RepositoryIoBoundMethodNames()
    {
        var data = new TheoryData<string>();
        foreach (var method in RepositoryMethods.Where(m => !SynchronousRepositoryMembers.Contains(m.Name)))
        {
            data.Add(method.Name);
        }

        return data;
    }

    [Fact]
    [Trait("Feature", Feature)]
    public void Repository_io_bound_method_set_is_exactly_the_known_async_operations()
    {
        var ioBoundNames = RepositoryMethods
            .Where(m => !SynchronousRepositoryMembers.Contains(m.Name))
            .Select(m => m.Name)
            .OrderBy(n => n)
            .ToArray();

        Assert.Equal(
            ["AddAsync", "GetByIdAsync", "ListAsync", "ListChronologicalAsync"],
            ioBoundNames);
    }

    [Theory]
    [Trait("Feature", Feature)]
    [InlineData("Remove")]
    [InlineData("Restore")]
    public void Repository_state_mutating_operations_are_synchronous_void(string methodName)
    {
        var method = RepositoryMethods.Single(m => m.Name == methodName);

        Assert.Equal(typeof(void), method.ReturnType);
        Assert.False(
            HasCancellationTokenParameter(method),
            $"The synchronous, non-I/O-bound IRepository<T>.{methodName} should not declare a CancellationToken.");
    }

    [Fact]
    [Trait("Feature", Feature)]
    public void UnitOfWork_save_is_async_and_takes_a_cancellation_token()
    {
        var save = UnitOfWorkMethods.Single(m => m.Name == nameof(IUnitOfWork.SaveChangesAsync));

        Assert.True(
            IsTaskReturning(save),
            $"IUnitOfWork.SaveChangesAsync should return Task or Task<T> but returns {save.ReturnType}.");
        Assert.True(
            HasCancellationTokenParameter(save),
            "IUnitOfWork.SaveChangesAsync should declare a CancellationToken parameter.");
    }

    [Fact]
    [Trait("Feature", Feature)]
    public void Every_unit_of_work_operation_is_async_and_takes_a_cancellation_token()
    {
        foreach (var method in UnitOfWorkMethods)
        {
            Assert.True(
                IsTaskReturning(method),
                $"IUnitOfWork.{method.Name} should return Task or Task<T> but returns {method.ReturnType}.");
            Assert.True(
                HasCancellationTokenParameter(method),
                $"IUnitOfWork.{method.Name} should declare a CancellationToken parameter.");
        }
    }

    [Fact]
    [Trait("Feature", Feature)]
    public async Task Repository_AddAsync_surfaces_cancellation_for_a_pre_cancelled_token()
    {
        IRepository<SignatureTestEntity> repository = new SignatureFakeRepository<SignatureTestEntity>();
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => repository.AddAsync(new SignatureTestEntity(), cts.Token));
    }

    [Fact]
    [Trait("Feature", Feature)]
    public async Task Repository_GetByIdAsync_surfaces_cancellation_for_a_pre_cancelled_token()
    {
        IRepository<SignatureTestEntity> repository = new SignatureFakeRepository<SignatureTestEntity>();
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => repository.GetByIdAsync(Guid.NewGuid(), cts.Token));
    }

    [Fact]
    [Trait("Feature", Feature)]
    public async Task Repository_ListAsync_surfaces_cancellation_for_a_pre_cancelled_token()
    {
        IRepository<SignatureTestEntity> repository = new SignatureFakeRepository<SignatureTestEntity>();
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => repository.ListAsync(cts.Token));
    }

    [Fact]
    [Trait("Feature", Feature)]
    public async Task Repository_ListChronologicalAsync_surfaces_cancellation_for_a_pre_cancelled_token()
    {
        IRepository<SignatureTestEntity> repository = new SignatureFakeRepository<SignatureTestEntity>();
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => repository.ListChronologicalAsync(includeDeleted: true, cts.Token));
    }

    [Fact]
    [Trait("Feature", Feature)]
    public async Task UnitOfWork_SaveChangesAsync_surfaces_cancellation_for_a_pre_cancelled_token()
    {
        IUnitOfWork unitOfWork = new SignatureFakeUnitOfWork();
        using var cts = new CancellationTokenSource();
        await cts.CancelAsync();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => unitOfWork.SaveChangesAsync(cts.Token));
    }
}
