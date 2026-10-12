export const KIND: Record<string, string> = { INTERNET: "Internet (pelanggan baru)", NON_INTERNET: "Non-internet / layanan tambahan" };
export const STAGE: Record<string, string> = {
  NEW: "Baru", CONTACTED: "Dihubungi", QUALIFIED: "Qualified", REGISTERED: "Terdaftar (WO)", INSTALLING: "Instalasi",
  QUOTING: "Penawaran", NEGOTIATION: "Negosiasi", WON: "Won", LOST: "Lost",
};
export const stageTone = (s: string): "slate" | "amber" | "green" | "red" => (s === "WON" ? "green" : s === "LOST" ? "red" : s === "NEW" ? "slate" : "amber");
export const CUST_STATUS: Record<string, string> = {
  PROSPECT: "Prospect (Waiting)", INSTALLING: "Instalasi", ACTIVE: "Aktif", NEED_CHECK: "Perlu dicek", SUSPENDED: "Suspend", TERMINATING: "Terminating", TERMINATED: "Terminated",
};
