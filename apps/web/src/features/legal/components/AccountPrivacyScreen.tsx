import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { PitchMateApiClient } from '@pitchmate/api-client';

import { Banner, Button, Card, Checkbox, Dialog, Icon, TextField } from '../../../ui';
import { deleteAccount, exportPersonalData } from '../api/legalApi';
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
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const canConfirmDelete = confirmChecked && confirmText.trim() === 'DELETE';

  const handleExportData = async () => {
    if (isExporting) return;

    setExportSuccess(false);
    setExportError(null);

    if (!apiClient) {
      setExportError('Account service is currently unavailable.');
      return;
    }

    setIsExporting(true);
    try {
      const result = await exportPersonalData(apiClient);
      if (!result.ok) {
        setExportError(result.message);
        return;
      }

      downloadJsonFile(
        result.data,
        `pitchmate-personal-data-${new Date().toISOString().slice(0, 10)}.json`,
      );
      setExportSuccess(true);
    } catch {
      setExportError('Failed to export your personal data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenDeleteModal = () => {
    setConfirmChecked(false);
    setConfirmText('');
    setDeleteError(null);
    setIsDeleteModalOpen(true);
  };

  const handleCloseDeleteModal = () => {
    if (isDeleting) return;
    setIsDeleteModalOpen(false);
  };

  const handleConfirmDelete = async () => {
    if (!canConfirmDelete || isDeleting) return;

    if (!apiClient) {
      setDeleteError('Account service is currently unavailable.');
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const result = await deleteAccount(apiClient);
      if (!result.ok) {
        if (result.kind === 'owner-constraint') {
          const prefixed = result.message.startsWith('Account deletion blocked:')
            ? result.message
            : `Account deletion blocked: ${result.message}`;
          setDeleteError(prefixed);
        } else {
          setDeleteError(result.message);
        }
        return;
      }

      setIsDeleteModalOpen(false);
      if (onSignedOut) {
        await onSignedOut();
      }
      navigate('/', { replace: true });
    } catch {
      setDeleteError('An unexpected error occurred while deleting your account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="privacy-screen">
      <div className="privacy-screen__grid">
        <Card as="section" className="privacy-card" aria-labelledby="export-heading">
          <div className="privacy-card__header">
            <span className="privacy-card__icon" aria-hidden="true">
              <Icon name="download" size={20} />
            </span>
            <h2 id="export-heading" className="privacy-card__heading">
              Data Portability (GDPR Article 20)
            </h2>
          </div>

          <p className="privacy-card__desc">
            Download a complete machine-readable JSON archive of the personal data PitchMate holds
            about you, including your profile, squad memberships and ratings, availability
            responses, match participation, live-tracked statistics, notifications, and guest
            claims.
          </p>

          <div className="privacy-card__actions">
            <Button
              type="button"
              variant="secondary"
              icon="download"
              loading={isExporting}
              disabled={isExporting}
              onClick={() => void handleExportData()}
            >
              {isExporting ? 'Preparing Data Export…' : 'Download My Data'}
            </Button>
          </div>

          {exportSuccess && (
            <Banner tone="success" icon="check" announce>
              Your personal data export has been downloaded successfully.
            </Banner>
          )}

          {exportError && (
            <Banner tone="error" icon="alert" announce>
              {exportError}
            </Banner>
          )}
        </Card>

        <Card as="section" className="privacy-card" aria-labelledby="cookies-heading">
          <div className="privacy-card__header">
            <span className="privacy-card__icon" aria-hidden="true">
              <Icon name="settings" size={20} />
            </span>
            <h2 id="cookies-heading" className="privacy-card__heading">
              Cookie &amp; Tracking Preferences
            </h2>
          </div>

          <p className="privacy-card__desc">
            Inspect or update your optional analytics and marketing tracking preferences in line
            with UK PECR requirements. Review our{' '}
            <Link to="/privacy" className="privacy-link">
              Privacy Policy
            </Link>
            ,{' '}
            <Link to="/terms" className="privacy-link">
              Terms of Service
            </Link>
            , and{' '}
            <Link to="/cookies" className="privacy-link">
              Cookie Policy
            </Link>
            .
          </p>

          <div className="privacy-card__actions">
            <Button
              type="button"
              variant="secondary"
              icon="settings"
              onClick={() => openCookiePreferences()}
            >
              Manage Cookie Preferences
            </Button>
          </div>
        </Card>

        <Card
          as="section"
          className="privacy-card privacy-card--danger"
          aria-labelledby="delete-heading"
        >
          <div className="privacy-card__header">
            <span className="privacy-card__icon privacy-card__icon--danger" aria-hidden="true">
              <Icon name="trash" size={20} />
            </span>
            <h2 id="delete-heading" className="privacy-card__heading">
              Delete Account &amp; Personal Data (GDPR Article 17)
            </h2>
          </div>

          <p className="privacy-card__desc">
            Permanently erase your PitchMate account, authentication tokens, notifications, and any
            pending guest claims linked to you. Historical match memberships that already appear in
            recorded match results will be anonymised so match histories remain accurate. If you
            are the sole Owner of any active squad, please transfer ownership or delete that squad
            first.
          </p>

          <div className="privacy-card__actions">
            <Button
              type="button"
              variant="destructive"
              icon="trash"
              onClick={handleOpenDeleteModal}
            >
              Delete Account
            </Button>
          </div>
        </Card>
      </div>

      <Dialog
        open={isDeleteModalOpen}
        title="Delete Account Confirmation"
        icon="alert"
        tone="danger"
        onClose={handleCloseDeleteModal}
        actions={
          <>
            <Button
              type="button"
              variant="ghost"
              disabled={isDeleting}
              onClick={handleCloseDeleteModal}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={isDeleting}
              disabled={!canConfirmDelete || isDeleting}
              onClick={() => void handleConfirmDelete()}
            >
              {isDeleting ? 'Deleting Account…' : 'Permanently Delete Account'}
            </Button>
          </>
        }
      >
        <p className="pm-dialog__body">
          This action is permanent and cannot be undone. Your account credentials, email, and
          notifications will be wiped immediately, and any squad history containing recorded matches
          will be anonymised.
        </p>

        {deleteError && (
          <Banner tone="error" icon="alert" announce>
            {deleteError}
          </Banner>
        )}

        <div className="privacy-dialog__fields">
          <div className="privacy-dialog__checkbox">
            <Checkbox
              label="I understand that this action is irreversible and all my personal data will be permanently erased."
              checked={confirmChecked}
              disabled={isDeleting}
              onChange={setConfirmChecked}
            />
          </div>

          <TextField
            label="Type DELETE to confirm:"
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder="DELETE"
            disabled={isDeleting}
            autoComplete="off"
          />
        </div>
      </Dialog>
    </div>
  );
}

function downloadJsonFile(payload: unknown, filename: string): void {
  if (typeof URL.createObjectURL !== 'function') {
    return;
  }

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(url);
  }
}

export default AccountPrivacyScreen;
