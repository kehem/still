import { contextBridge, ipcRenderer } from 'electron';
import type { StillAPI } from '../shared/types';

/**
 * The only bridge between the sandboxed renderer and the main process.
 * The renderer never touches Node APIs directly (spec §3).
 */
const api: StillAPI = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  listAccounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: (input) => ipcRenderer.invoke('accounts:add', input),
  updateAccount: (id, patch) => ipcRenderer.invoke('accounts:update', id, patch),
  removeAccount: (id) => ipcRenderer.invoke('accounts:remove', id),
  listSchedules: () => ipcRenderer.invoke('schedules:list'),
  createSchedule: (input) => ipcRenderer.invoke('schedules:create', input),
  updateSchedule: (id, patch) => ipcRenderer.invoke('schedules:update', id, patch),
  removeSchedule: (id) => ipcRenderer.invoke('schedules:remove', id),
  listMessages: (options) => ipcRenderer.invoke('messages:list', options ?? {}),
  getConversation: (id) => ipcRenderer.invoke('conversations:get', id),
  markConversationRead: (conversationId) =>
    ipcRenderer.invoke('conversations:markRead', conversationId),
  trashConversation: (id) => ipcRenderer.invoke('conversations:trash', id),
  restoreConversation: (id) => ipcRenderer.invoke('conversations:restore', id),
  listFollowUps: () => ipcRenderer.invoke('followups:list'),
  createFollowUp: (input) => ipcRenderer.invoke('followups:create', input),
  disableFollowUp: (conversationId) =>
    ipcRenderer.invoke('followups:disable', conversationId),
  setFollowUpSchedule: (sequenceId, scheduleId) =>
    ipcRenderer.invoke('followups:setSchedule', sequenceId, scheduleId),
  updateFollowUpStatus: (id, status, snoozeDays) =>
    ipcRenderer.invoke('followups:updateStatus', id, status, snoozeDays),
  scanReminders: () => ipcRenderer.invoke('notifications:scan'),
  listNotifications: (limit) => ipcRenderer.invoke('notifications:list', limit),
  unreadNotificationCount: () => ipcRenderer.invoke('notifications:unreadCount'),
  markNotificationRead: (id) => ipcRenderer.invoke('notifications:markRead', id),
  markAllNotificationsRead: () => ipcRenderer.invoke('notifications:markAllRead'),
  dismissNotification: (id) => ipcRenderer.invoke('notifications:dismiss', id),
  listDrafts: () => ipcRenderer.invoke('drafts:list'),
  saveDraft: (input) => ipcRenderer.invoke('drafts:save', input),
  removeDraft: (id) => ipcRenderer.invoke('drafts:remove', id),
  sendEmail: (input) => ipcRenderer.invoke('email:send', input),
  syncEmails: () => ipcRenderer.invoke('email:sync'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
};

contextBridge.exposeInMainWorld('still', api);
