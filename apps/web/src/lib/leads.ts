export const KIND: Record<string, string> = { INTERNET: "Internet (pelanggan baru)", NON_INTERNET: "Non-internet / layanan tambahan" };
export const STAGE: Record<string, string> = {
  NEW: "Baru", CONTACTED: "Dihubungi", QUALIFIED: "Qualified", REGISTERED: "Terdaftar (WO)", INSTALLING: "Instalasi",
  QUOTING: "Penawaran", NEGOTIATION: "Negosiasi", WON: "Won", LOST: "Lost",
};
export const stageTone = (s: string) =>
  s === "WON" ? "bg-green-100 text-green-700" : s === "LOST" ? "bg-red-100 text-red-700" : s === "NEW" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700";
export const CUST_STATUS: Record<string, string> = {
  PROSPECT: "Prospect (Waiting)", INSTALLING: "Instalasi", ACTIVE: "Aktif", NEED_CHECK: "Perlu dicek", SUSPENDED: "Suspend", TERMINATING: "Terminating", TERMINATED: "Terminated",
};
