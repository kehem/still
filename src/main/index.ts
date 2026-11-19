import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, nativeTheme, Notification, session, shell } from 'electron';
import { DatabaseService, getDefaultDbPath, openDatabaseWithRecovery } from './database/db';
import {
  AccountRepository,
  DraftRepository,
  FollowUpRepository,
  MessageRepository,
  NotificationRepository,
  ScheduleRepository,
  SettingsRepository,
} from './database/repositories';
import { CredentialStore } from './security/credentials';
import { registerIpcHandlers, reminderOptionsFor } from './ipc/handlers';

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

/** Directory the packaged renderer is served from; navigation stays inside it. */
const rendererDir = path.resolve(__dirname, '../renderer');

let mainWindow: BrowserWindow | null = null;
let db: DatabaseService | null = null;
let reminderTimer: NodeJS.Timeout | null = null;

/**
 * Re-derives due reminders and surfaces the ones that are ready.
 *
 * The interval below is only a *poll*. Nothing depends on it for correctness:
 * every reminder is computed from stored timestamps, so one that fell due
 * while the app was closed is raised on the next launch, and one already
 * raised is never raised again (the database enforces a unique dedupe key per
 * occurrence). If this timer never fired at all, the reminder list would still
 * be right — only the desktop banners would lag.
 */
function pumpReminders(
  notifications: NotificationRepository,
  settings: SettingsRepository,
): void {
  const prefs = settings.getAll();
  const ready = notifications.scan(new Date(), reminderOptionsFor(settings));
  if (ready.length === 0) return;

  if (prefs.desktopNotifications && prefs.followUpNotifications && Notification.isSupported()) {
    for (const item of ready) {
      const banner = new Notification({
        title: item.title,
        body: item.body,
        silent: !prefs.notificationSound,
      });
      banner.on('click', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
      banner.show();
    }
  }

  // Marked delivered whether or not a banner was shown, so a disabled
  // notification preference does not cause the same reminder to be re-raised
  // on every tick. It remains visible in the Follow-ups list either way.
  notifications.markDelivered(
    ready.map((n) => n.id),
    new Date(),
  );
}

/**
 * Response-header CSP for the dev server. The packaged app gets its policy
 * from a <meta> tag injected at build time, because `onHeadersReceived` does
 * not reliably fire for `file://` loads.
 */
function installDevContentSecurityPolicy(): void {
  if (!isDev) return;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
            "style-src 'self' 'unsafe-inline'; font-src 'self' data:; " +
            "img-src 'self' data: blob:; worker-src 'self' blob:; " +
            "connect-src 'self' ws://localhost:5173 http://localhost:5173;",
        ],
      },
    });
  });
}

/** Background colour matched to the theme the user will actually see. */
function initialBackgroundColor(settings: SettingsRepository): string {
  const dark =
    settings.getAll().theme === 'dark' ||
    (settings.getAll().theme === 'system' && nativeTheme.shouldUseDarkColors);
  return dark ? '#171717' : '#FAF8F5';
}

function createWindow(settings: SettingsRepository): void {
  const dark = initialBackgroundColor(settings) === '#171717';

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: initialBackgroundColor(settings),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'win32'
        ? { color: dark ? '#171717' : '#FAF8F5', symbolColor: dark ? '#EDEDED' : '#2B2B2B', height: 44 }
        : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // External links: only https, opened in the system browser (spec §3).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Navigation is confined to the app's own renderer. A `file://` allow-all
  // rule would let a crafted link open arbitrary local files in the window.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    let allowed = false;
    if (isDev) {
      allowed = url.startsWith('http://localhost:5173');
    } else if (url.startsWith('file://')) {
      try {
        // fileURLToPath handles the Windows `/C:/…` form correctly.
        allowed = path.resolve(fileURLToPath(url)).startsWith(rendererDir + path.sep);
      } catch {
        allowed = false;
      }
    }
    if (!allowed) event.preventDefault();
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL as string);
  } else {
    void mainWindow.loadFile(path.join(rendererDir, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    installDevContentSecurityPolicy();

    const dbPath = getDefaultDbPath();
    let opened: ReturnType<typeof openDatabaseWithRecovery>;
    try {
      opened = openDatabaseWithRecovery(dbPath);
    } catch (err) {
      // Unrecoverable: tell the user where the data is instead of dying silently.
      dialog.showErrorBox(
        'Still could not open its database',
        `${err instanceof Error ? err.message : String(err)}\n\nDatabase location: ${dbPath}`,
      );
      app.quit();
      return;
    }

    db = opened.service;
    const settings = new SettingsRepository(db);

    registerIpcHandlers({
      db,
      settings,
      accounts: new AccountRepository(db),
      schedules: new ScheduleRepository(db),
      messages: new MessageRepository(db),
      followups: new FollowUpRepository(db),
      notifications: new NotificationRepository(db),
      drafts: new DraftRepository(db),
      credentials: new CredentialStore(db),
    });

    createWindow(settings);

    // Raise anything that fell due while the app was closed (spec §6.7),
    // then keep polling. Failures are logged, never fatal: a reminder problem
    // must not take the window down with it.
    const notifications = new NotificationRepository(db);
    const tick = () => {
      try {
        pumpReminders(notifications, settings);
      } catch (err) {
        console.error('[still] reminder scan failed:', err);
      }
    };
    tick();
    reminderTimer = setInterval(tick, 60_000);

    if (opened.recovered) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Database repaired',
        message: 'Still could not read its local database and started a fresh one.',
        detail:
          `The previous files were kept, not deleted:\n${opened.quarantined.join('\n') || dbPath}\n\n` +
          `Reason: ${opened.error ?? 'unknown'}`,
        buttons: ['Continue'],
      });
    }

    // Keep the window background in step with OS theme changes while on "system".
    nativeTheme.on('updated', () => {
      if (settings.getAll().theme === 'system' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#171717' : '#FAF8F5');
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow(settings);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    if (reminderTimer) clearInterval(reminderTimer);
    reminderTimer = null;
    db?.close();
  });
}
