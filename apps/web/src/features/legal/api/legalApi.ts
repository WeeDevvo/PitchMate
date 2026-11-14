/**
 * Single transport seam for the legal/account-privacy feature.
 *
 * Isolates generated `@pitchmate/api-client` calls, HTTP status checks, and
 * ProblemDetails parsing from UI components.
 */
import type { PitchMateApiClient } from '@pitchmate/api-client';

export type ExportPersonalDataResult =
  | { readonly ok: true; readonly data: unknown }
  | { readonly ok: false; readonly message: string };

export type DeleteAccountResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly kind: 'owner-constraint' | 'error';
      readonly message: string;
    };

const DEFAULT_EXPORT_ERROR =
  'Failed to export your personal data. Please try again.';

const DEFAULT_DELETE_ERROR =
  'Failed to delete your account. Please try again.';

const OWNER_CONSTRAINT_MESSAGE =
  'You are the sole owner of one or more active squads. Please transfer ownership or delete those squads in Squad Settings before deleting your account.';

/**
 * Retrieves the signed-in user's UK GDPR Article 15/20 personal data package.
 */
export async function exportPersonalData(
  apiClient: PitchMateApiClient,
): Promise<ExportPersonalDataResult> {
  const { data, error, response } = await apiClient.GET(
    '/api/v1/users/me/export',
    {},
  );

  if (error || !isResponseOk(response)) {
    const detail = extractProblemDetail(error);
    return {
      ok: false,
      message: detail ?? DEFAULT_EXPORT_ERROR,
    };
  }

  return { ok: true, data };
}

/**
 * Requests permanent UK GDPR Article 17 erasure of the signed-in user's account.
 */
export async function deleteAccount(
  apiClient: PitchMateApiClient,
): Promise<DeleteAccountResult> {
  const { error, response } = await apiClient.DELETE('/api/v1/users/me', {});

  if (error || !isResponseOk(response)) {
    const detail = extractProblemDetail(error);
    const isOwnerConstraint =
      response?.status === 409 || hasOwnerConstraintCode(error);

    if (isOwnerConstraint) {
      return {
        ok: false,
        kind: 'owner-constraint',
        message: detail ?? OWNER_CONSTRAINT_MESSAGE,
      };
    }

    return {
      ok: false,
      kind: 'error',
      message: detail ?? DEFAULT_DELETE_ERROR,
    };
  }

  return { ok: true };
}

function isResponseOk(
  response: { readonly ok?: boolean; readonly status?: number } | undefined,
): boolean {
  if (!response) return true;
  if (typeof response.ok === 'boolean') return response.ok;
  if (typeof response.status === 'number') {
    return response.status >= 200 && response.status < 300;
  }
  return false;
}

function hasOwnerConstraintCode(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'OwnerConstraint'
  );
}

function extractProblemDetail(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  if (
    'detail' in error &&
    typeof (error as { detail?: unknown }).detail === 'string' &&
    (error as { detail: string }).detail.trim().length > 0
  ) {
    return (error as { detail: string }).detail;
  }

  return undefined;
}
