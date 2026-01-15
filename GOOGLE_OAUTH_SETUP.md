# Google OAuth Setup Guide

This guide walks you through setting up Google OAuth authentication for PitchMate.

## Prerequisites

- A Google account
- Access to Google Cloud Console
- PitchMate backend API running (or at least know your redirect URIs)

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown at the top of the page
3. Click **"New Project"**
4. Fill in the project details:
   - **Project name**: PitchMate (or your preferred name)
   - **Organization**: Leave as default or select your organization
5. Click **"Create"**
6. Wait for the project to be created, then select it from the project dropdown

## Step 2: Enable Google+ API

1. In the Google Cloud Console, navigate to **APIs & Services** > **Library**
2. Search for "Google+ API" or "Google Identity"
3. Click on **"Google+ API"** (or "Google Identity Toolkit API")
4. Click **"Enable"**
5. Wait for the API to be enabled

## Step 3: Configure OAuth Consent Screen

1. Navigate to **APIs & Services** > **OAuth consent screen**
2. Select **User Type**:
   - **Internal**: Only for Google Workspace users (if applicable)
   - **External**: For any Google account user (recommended for most cases)
3. Click **"Create"**

### Fill in App Information:

**App information:**
- **App name**: PitchMate
- **User support email**: Your email address
- **App logo**: (Optional) Upload your app logo

**App domain:**
- **Application home page**: Your app's homepage URL (e.g., `https://pitchmate.com`)
- **Application privacy policy link**: Your privacy policy URL
- **Application terms of service link**: Your terms of service URL

**Authorized domains:**
- Add your domain (e.g., `pitchmate.com`)
- For local development, you don't need to add `localhost`

**Developer contact information:**
- **Email addresses**: Your email address

4. Click **"Save and Continue"**

### Configure Scopes:

1. Click **"Add or Remove Scopes"**
2. Select the following scopes:
   - `openid`
   - `email`
   - `profile`
3. Click **"Update"**
4. Click **"Save and Continue"**

### Test Users (for External apps in testing):

If your app is in testing mode:
1. Click **"Add Users"**
2. Add email addresses of users who should be able to test the app
3. Click **"Save and Continue"**

### Summary:

Review your settings and click **"Back to Dashboard"**

## Step 4: Create OAuth 2.0 Credentials

1. Navigate to **APIs & Services** > **Credentials**
2. Click **"Create Credentials"** > **"OAuth client ID"**
3. Select **Application type**: 
   - **Web application** (for backend API)
4. Fill in the details:

**Name**: PitchMate Backend API

**Authorized JavaScript origins** (for frontend):
- `http://localhost:3000` (for local development)
- `https://your-frontend-domain.com` (for production)

**Authorized redirect URIs** (for backend):
- `http://localhost:5000/api/auth/google/callback` (for local development)
- `https://your-api-domain.com/api/auth/google/callback` (for production)

5. Click **"Create"**
6. A dialog will appear with your **Client ID** and **Client Secret**
7. **IMPORTANT**: Copy both values and store them securely

## Step 5: Configure Your Application

### Backend Configuration

1. Open `src/PitchMate.API/appsettings.json`
2. Add a new section for Google OAuth:

```json
{
  "ConnectionStrings": {
    "DefaultConnection": "..."
  },
  "Jwt": {
    "SecretKey": "...",
    "Issuer": "PitchMate",
    "Audience": "PitchMate",
    "ExpirationMinutes": 60
  },
  "Google": {
    "ClientId": "YOUR_CLIENT_ID_HERE",
    "ClientSecret": "YOUR_CLIENT_SECRET_HERE"
  }
}
```

**For production**, use environment variables or Azure Key Vault:
```bash
# Set environment variables
export Google__ClientId="your-client-id"
export Google__ClientSecret="your-client-secret"
```

Or use User Secrets for development:
```bash
dotnet user-secrets set "Google:ClientId" "your-client-id" --project src/PitchMate.API
dotnet user-secrets set "Google:ClientSecret" "your-client-secret" --project src/PitchMate.API
```

### Frontend Configuration

1. Open `frontend/.env.local` (create if it doesn't exist)
2. Add your Google Client ID:

```env
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id-here
NEXT_PUBLIC_API_URL=http://localhost:5000
```

## Step 6: Implement Google Token Validation

The current implementation is a stub. You need to implement actual token validation.

### Option 1: Using Google.Apis.Auth Library (Recommended)

1. Add the NuGet package:
```bash
dotnet add src/PitchMate.Infrastructure package Google.Apis.Auth
```

2. Update `GoogleTokenValidator.cs`:

```csharp
using Google.Apis.Auth;
using PitchMate.Application.Services;

namespace PitchMate.Infrastructure.Services;

public class GoogleTokenValidator : IGoogleTokenValidator
{
    private readonly string _clientId;

    public GoogleTokenValidator(IConfiguration configuration)
    {
        _clientId = configuration["Google:ClientId"] 
            ?? throw new InvalidOperationException("Google ClientId is not configured");
    }

    public async Task<GoogleUserInfo?> ValidateTokenAsync(string token, CancellationToken ct = default)
    {
        try
        {
            var payload = await GoogleJsonWebSignature.ValidateAsync(token);
            
            // Verify the token is for our client
            if (payload.Audience != _clientId)
            {
                return null;
            }

            return new GoogleUserInfo(payload.Subject, payload.Email);
        }
        catch (InvalidJwtException)
        {
            // Token is invalid
            return null;
        }
    }
}
```

3. Update the service registration in `Program.cs`:

```csharp
builder.Services.AddScoped<IGoogleTokenValidator>(sp =>
{
    var configuration = sp.GetRequiredService<IConfiguration>();
    return new GoogleTokenValidator(configuration);
});
```

### Option 2: Using Google's tokeninfo Endpoint

Alternatively, you can validate tokens by calling Google's tokeninfo endpoint:

```csharp
public async Task<GoogleUserInfo?> ValidateTokenAsync(string token, CancellationToken ct = default)
{
    using var httpClient = new HttpClient();
    var response = await httpClient.GetAsync(
        $"https://oauth2.googleapis.com/tokeninfo?id_token={token}", ct);

    if (!response.IsSuccessStatusCode)
    {
        return null;
    }

    var json = await response.Content.ReadAsStringAsync(ct);
    var payload = JsonSerializer.Deserialize<GoogleTokenInfo>(json);

    if (payload?.Aud != _clientId)
    {
        return null;
    }

    return new GoogleUserInfo(payload.Sub, payload.Email);
}
```

## Step 7: Test Google OAuth Flow

### Testing with Postman or cURL:

1. Get a Google ID token (you can use Google OAuth Playground: https://developers.google.com/oauthplayground/)
2. Make a POST request to your API:

```bash
curl -X POST https://localhost:7xxx/api/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken": "YOUR_GOOGLE_ID_TOKEN"}'
```

3. You should receive a JWT token in response

### Testing with Frontend:

1. Implement Google Sign-In button in your React/Next.js app
2. Use `@react-oauth/google` package:

```bash
npm install @react-oauth/google
```

3. Wrap your app with GoogleOAuthProvider:

```tsx
import { GoogleOAuthProvider } from '@react-oauth/google';

export default function App() {
  return (
    <GoogleOAuthProvider clientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID}>
      {/* Your app components */}
    </GoogleOAuthProvider>
  );
}
```

4. Add Google Sign-In button:

```tsx
import { GoogleLogin } from '@react-oauth/google';

function LoginPage() {
  const handleGoogleSuccess = async (credentialResponse) => {
    const response = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: credentialResponse.credential })
    });
    
    const data = await response.json();
    // Store JWT token and redirect
  };

  return (
    <GoogleLogin
      onSuccess={handleGoogleSuccess}
      onError={() => console.log('Login Failed')}
    />
  );
}
```

## Step 8: Publish Your App (Optional)

If you want to make your app available to all Google users:

1. Go to **OAuth consent screen**
2. Click **"Publish App"**
3. Submit for verification if required (for apps requesting sensitive scopes)

## Troubleshooting

### "Error 400: redirect_uri_mismatch"
- Verify your redirect URI exactly matches what's configured in Google Cloud Console
- Check for trailing slashes, http vs https, etc.

### "Error 401: invalid_client"
- Verify your Client ID and Client Secret are correct
- Check that they're properly configured in your application

### "Token validation failed"
- Ensure the token is a valid Google ID token (not an access token)
- Verify the token hasn't expired
- Check that the audience (aud) claim matches your Client ID

### "API not enabled"
- Make sure Google+ API or Google Identity API is enabled in your project

## Security Best Practices

1. **Never commit credentials** to version control
2. Use **environment variables** or **Azure Key Vault** for production
3. Use **User Secrets** for local development
4. Validate tokens on the **backend**, never trust frontend validation alone
5. Always verify the **audience (aud)** claim matches your Client ID
6. Check token **expiration** and **issuer**
7. Use **HTTPS** in production
8. Implement **rate limiting** on authentication endpoints
9. Log authentication attempts for security monitoring

## Additional Resources

- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Google Sign-In for Websites](https://developers.google.com/identity/sign-in/web)
- [Google.Apis.Auth Library](https://github.com/googleapis/google-api-dotnet-client)
- [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)
