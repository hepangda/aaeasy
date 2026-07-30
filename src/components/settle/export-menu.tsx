import { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorToast } from '@/lib/ui/toast';

function parseFileName(disposition: string | null, fallback: string): string {
  if (!disposition) return fallback;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // fall through
    }
  }
  const ascii = /filename="?([^";]+)"?/i.exec(disposition);
  return ascii ? ascii[1] : fallback;
}

export function ExportMenu({ groupId }: { groupId: string }) {
  const t = useTranslations('export');
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null);

  async function handleClick(format: 'csv' | 'pdf') {
    if (busy) return;
    setBusy(format);
    try {
      const res = await fetch(`/api/groups/${groupId}/export?format=${format}`, {
        credentials: 'same-origin',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const fileName = parseFileName(
        res.headers.get('Content-Disposition'),
        `${groupId}.${format}`,
      );
      // Safari (especially iOS) ignores the <a download> attribute on
      // dynamically-created links and on cross-origin / opaque blob URLs,
      // so we both (a) try the programmatic-download path and (b) fall
      // back to opening the blob in a new tab where the user can use the
      // browser's native share/save UI.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.rel = 'noopener';
      const supportsDownload = 'download' in a && !isIosSafari();
      if (supportsDownload) {
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const win = window.open(url, '_blank');
        if (!win) {
          // Popup blocked — navigate the current tab as a last resort.
          window.location.href = url;
        }
      }
      // Give the browser a tick to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      errorToast(t('failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => handleClick('pdf')}
        disabled={busy !== null}
      >
        <Download aria-hidden="true" /> {busy === 'pdf' ? t('exporting') : t('pdf')}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => handleClick('csv')}
        disabled={busy !== null}
      >
        <Download aria-hidden="true" /> {busy === 'csv' ? t('exporting') : t('csv')}
      </Button>
    </div>
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isIos;
}
