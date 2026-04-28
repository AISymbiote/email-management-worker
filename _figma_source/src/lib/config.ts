declare global {
  interface Window {
    EMAIL_MANAGEMENT_WORKER_CONFIG?: { API_BASE?: string }
  }
}

function normalizeApiBase(value: string): string {
  return (value || '').replace(/\/+$/, '')
}

const runtimeConfig = window.EMAIL_MANAGEMENT_WORKER_CONFIG || {}
const inferredApiBase = window.location.origin

export const API_BASE =
  normalizeApiBase(runtimeConfig.API_BASE ?? '') ||
  normalizeApiBase(inferredApiBase)
