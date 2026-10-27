import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { PitchMateApiClient } from '@pitchmate/api-client';
import { openCookiePreferences } from '../lib/cookieConsent';
import './AccountPrivacyScreen.css';

export interface AccountPrivacyScreenProps {
  readonly apiClient?: PitchMateApiClient;
  readonly onSignedOut?: () => Promise<void> | void;
}

export function AccountPrivacyScreen({ apiClient, onSignedOut }: AccountPrivacyScreenProps) {
  const navigate = useNavigate();

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Deletion state
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [confirmCheckbox, setConfirmCheckbox] = useState(false);
  const [confirmDeleteText, setConfirmDeleteText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleExportData = async () => {
    if (!apiClient) {
      setExportError('API client is unavailable.');
      return;
    }

    setIsExporting(true);
    setExportError(null);
    setExportSuccess(false);

    try {
      const response = await apiClient.GET('/api/v1/users/me/export', {});

      if (response.error || !response.data) {
        setExportError(
          (response.error as { message?: string })?.message ??
            'Failed to export personal data. Please try again.',
        );
      } else {
        const json = JSON.stringify(response.data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateStamp = new Date().toISOString().slice(0, 10);
        a.download = `pitchmate-data-export-${dateStamp}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setExportSuccess(true);
      }
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'An unexpected error occurred during export.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!apiClient) {
      setDeleteError('API client is unavailable.');
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const response = await apiClient.DELETE('/api/v1/users/me', {});

      if (response.error) {
        const errObj = response.error as { status?: number; code?: string; message?: string; detail?: string };
        const isOwnerConflict =
          response.response?.status === 409 ||
          errObj.code === 'OwnerConstraint' ||
          (errObj.detail && /owner/i.test(errObj.detail)) ||
          (errObj.message && /owner/i.test(errObj.message));

        if (isOwnerConflict) {
          setDeleteError(
            'Account deletion blocked: You are the sole owner of one or more active squads. Please transfer squad ownership or delete those squads first.',
          );
        } else {
          setDeleteError(
            errObj.detail ?? errObj.message ?? 'Failed to delete account. Please try again.',
          );
        }
      } else {
        // Successful erasure (204 No Content)
        setIsDeleteModalOpen(false);
        if (onSignedOut) {
          await onSignedOut();
        }
        navigate('/');
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsDeleting(false);
    }
  };

  const isDeleteDisabled = !confirmCheckbox || confirmDeleteText.trim().toUpperCase() !== 'DELETE' || isDeleting;

  return (
    <div className="privacy-settings-container" data-testid="privacy-settings-container">
      {/* 1. Data Portability / Export */}
      <section className="privacy-card">
        <h3>Data Portability (GDPR Article 20)</h3>
        <p>
          Download a complete, machine-readable archive of your personal information, including
          your account profile, squad memberships, match history, and recorded performance statistics.
        </p>
        <div className="privacy-action-row">
          <button
            type="button"
            className="privacy-btn privacy-btn-primary"
            onClick={handleExportData}
            disabled={isExporting}
          >
            {isExporting ? 'Compiling Archive...' : 'Download My Data'}
          </button>
        </div>
        {exportSuccess && (
          <div className="privacy-alert privacy-alert-success" role="status">
            ✓ Your personal data export has been downloaded successfully.
          </div>
        )}
        {exportError && (
          <div className="privacy-alert privacy-alert-error" role="alert">
            {exportError}
          </div>
        )}
      </section>

      {/* 2. Cookie Preferences */}
      <section className="privacy-card">
        <h3>Cookie &amp; Tracking Preferences</h3>
        <p>
          PitchMate uses strictly necessary cookies for security and authentication. You can review or
          adjust your opt-in choices for analytics and promotional cookies at any time.
        </p>
        <div className="privacy-action-row">
          <button
            type="button"
            className="privacy-btn privacy-btn-secondary"
            onClick={openCookiePreferences}
          >
            Manage Cookie Preferences
          </button>
        </div>
      </section>

      {/* 3. Account Deletion & Right to Erasure */}
      <section className="privacy-card privacy-card-danger">
        <h3>Delete Account &amp; Personal Data (GDPR Article 17)</h3>
        <p>
          Permanently delete your PitchMate account. When you confirm deletion, your name, email,
          and credentials are immediately erased. To preserve the integrity of completed games,
          your past match appearances will be preserved anonymously as &quot;Former player&quot;.
        </p>
        <div className="privacy-action-row">
          <button
            type="button"
            className="privacy-btn privacy-btn-danger"
            onClick={() => {
              setConfirmCheckbox(false);
              setConfirmDeleteText('');
              setDeleteError(null);
              setIsDeleteModalOpen(true);
            }}
          >
            Delete Account
          </button>
        </div>
      </section>

      {/* Confirmation Modal */}
      {isDeleteModalOpen && (
        <div
          className="privacy-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className="privacy-modal">
            <h2 id="delete-modal-title">Delete Account Confirmation</h2>
            <div className="privacy-modal-body">
              <p>
                <strong>Warning:</strong> This action is permanent and cannot be undone.
              </p>
              <ul>
                <li>Your profile details (name, email) will be permanently anonymised.</li>
                <li>Your sign-in methods and active sessions will be revoked immediately.</li>
                <li>
                  Your match participation will remain in squad history under the name &quot;Former
                  player&quot; so team records remain valid.
                </li>
                <li>
                  If you are the sole owner of an active squad, deletion will be blocked until
                  ownership is transferred.
                </li>
              </ul>

              {deleteError && (
                <div className="privacy-alert privacy-alert-error" role="alert">
                  {deleteError}
                </div>
              )}

              <div className="privacy-modal-confirm-group">
                <label>
                  <input
                    type="checkbox"
                    checked={confirmCheckbox}
                    onChange={(e) => setConfirmCheckbox(e.target.checked)}
                  />
                  <span>I understand that this action is irreversible.</span>
                </label>

                <div>
                  <label htmlFor="confirm-delete-input" style={{ marginBottom: '0.4rem' }}>
                    Type <strong>DELETE</strong> to confirm:
                  </label>
                  <input
                    id="confirm-delete-input"
                    type="text"
                    className="privacy-modal-input"
                    value={confirmDeleteText}
                    onChange={(e) => setConfirmDeleteText(e.target.value)}
                    placeholder="DELETE"
                  />
                </div>
              </div>
            </div>

            <div className="privacy-modal-actions">
              <button
                type="button"
                className="privacy-btn privacy-btn-secondary"
                onClick={() => setIsDeleteModalOpen(false)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="privacy-btn privacy-btn-danger"
                onClick={handleDeleteAccount}
                disabled={isDeleteDisabled}
              >
                {isDeleting ? 'Erasing Account...' : 'Permanently Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AccountPrivacyScreen;
