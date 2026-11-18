import type { StillAPI } from '../../shared/types';

declare global {
  interface Window {
    still?: StillAPI;
  }
}

export {};
