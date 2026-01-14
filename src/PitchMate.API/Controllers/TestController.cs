using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace PitchMate.API.Controllers;

/// <summary>
/// Test controller for verifying authentication and authorization.
/// This controller is used for testing purposes only.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class TestController : ControllerBase
{
    /// <summary>
    /// Protected endpoint that requires authentication.
    /// </summary>
    [HttpGet("protected")]
    [Authorize]
    public IActionResult GetProtected()
    {
        return Ok(new { message = "You are authenticated!" });
    }

    /// <summary>
    /// Public endpoint that does not require authentication.
    /// </summary>
    [HttpGet("public")]
    public IActionResult GetPublic()
    {
        return Ok(new { message = "This is public!" });
    }
}
