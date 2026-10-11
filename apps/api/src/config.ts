/** Jalur API CRM di domain bersama WO (/api milik WO). Konfigurasi `API_BASE`; bawaan /crm/api. */
export const API_BASE = (process.env.API_BASE ?? "/crm/api").replace(/\/+$/, "");
