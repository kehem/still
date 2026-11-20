import type { AutomationWorkspace } from '../../../shared/automation';
import { limitsValid } from './model';
import { getAPI } from '../../services/api';

/** One-time handoff of the older localStorage queue. Keep it until SQLite acknowledges. */
export async function loadAutomation() {
  let snapshot = await getAPI().getAutomation();
  const legacy = localStorage.getItem('still:automation:v1');
  if (legacy && !snapshot.workspace.fileName && !snapshot.workspace.rows.length) {
    try {
      const rows = JSON.parse(legacy) as AutomationWorkspace['rows'];
      const config = JSON.parse(localStorage.getItem('still:automation:config') || '{}') as { account?: string; daily?: number; seconds?: number };
      const settings = limitsValid(config.daily || 50, config.seconds || 30)
        ? { daily: config.daily || 50, seconds: config.seconds || 30 } : {};
      if (Array.isArray(rows) && rows.length) {
        snapshot = await getAPI().saveAutomation({ ...snapshot.workspace, ...settings, accountId: config.account || snapshot.workspace.accountId, fileName: 'Recovered queue', rows: rows.map(r => r.status === 'sending' ? { ...r, status: 'failed', error: 'Interrupted send. Check Sent before retrying.' } : r) });
      }
      localStorage.removeItem('still:automation:v1');
    } catch { /* Leave the legacy copy intact if migration fails. */ }
  }
  return snapshot;
}
export async function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read source file'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}
