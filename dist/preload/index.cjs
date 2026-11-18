"use strict";

// src/preload/index.ts
var import_electron = require("electron");
var api = {
  getSettings: () => import_electron.ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => import_electron.ipcRenderer.invoke("settings:update", patch),
  listAccounts: () => import_electron.ipcRenderer.invoke("accounts:list"),
  addAccount: (input) => import_electron.ipcRenderer.invoke("accounts:add", input),
  updateAccount: (id, patch) => import_electron.ipcRenderer.invoke("accounts:update", id, patch),
  removeAccount: (id) => import_electron.ipcRenderer.invoke("accounts:remove", id),
  listSchedules: () => import_electron.ipcRenderer.invoke("schedules:list"),
  createSchedule: (input) => import_electron.ipcRenderer.invoke("schedules:create", input),
  updateSchedule: (id, patch) => import_electron.ipcRenderer.invoke("schedules:update", id, patch),
  removeSchedule: (id) => import_electron.ipcRenderer.invoke("schedules:remove", id),
  listMessages: (options) => import_electron.ipcRenderer.invoke("messages:list", options ?? {}),
  getConversation: (id) => import_electron.ipcRenderer.invoke("conversations:get", id),
  markConversationRead: (conversationId) => import_electron.ipcRenderer.invoke("conversations:markRead", conversationId),
  listFollowUps: () => import_electron.ipcRenderer.invoke("followups:list"),
  createFollowUp: (input) => import_electron.ipcRenderer.invoke("followups:create", input),
  disableFollowUp: (conversationId) => import_electron.ipcRenderer.invoke("followups:disable", conversationId),
  setFollowUpSchedule: (sequenceId, scheduleId) => import_electron.ipcRenderer.invoke("followups:setSchedule", sequenceId, scheduleId),
  updateFollowUpStatus: (id, status, snoozeDays) => import_electron.ipcRenderer.invoke("followups:updateStatus", id, status, snoozeDays),
  scanReminders: () => import_electron.ipcRenderer.invoke("notifications:scan"),
  listNotifications: (limit) => import_electron.ipcRenderer.invoke("notifications:list", limit),
  unreadNotificationCount: () => import_electron.ipcRenderer.invoke("notifications:unreadCount"),
  markNotificationRead: (id) => import_electron.ipcRenderer.invoke("notifications:markRead", id),
  markAllNotificationsRead: () => import_electron.ipcRenderer.invoke("notifications:markAllRead"),
  dismissNotification: (id) => import_electron.ipcRenderer.invoke("notifications:dismiss", id),
  listDrafts: () => import_electron.ipcRenderer.invoke("drafts:list"),
  saveDraft: (input) => import_electron.ipcRenderer.invoke("drafts:save", input),
  removeDraft: (id) => import_electron.ipcRenderer.invoke("drafts:remove", id),
  getAppInfo: () => import_electron.ipcRenderer.invoke("app:info")
};
import_electron.contextBridge.exposeInMainWorld("still", api);
//# sourceMappingURL=index.cjs.map
