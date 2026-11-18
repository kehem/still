import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Settings } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../../shared/constants';
import { getAPI } from '../services/api';

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void getAPI()
      .getSettings()
      .then(setSettings)
      .catch(() => {
        // Keep defaults if the main process is unreachable.
      });
  }, []);

  const update = useCallback(async (patch: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    const saved = await getAPI().updateSettings(patch);
    setSettings(saved);
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
