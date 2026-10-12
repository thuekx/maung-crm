import { createApp } from "./app.js";
import { startExpirySweep } from "./quotations.js";
import { startWoSync } from "./woSync.js";
import { startWoPush } from "./woPush.js";
import { startAutoBackup } from "./autoBackup.js";
import { migrate } from "./migrate.js";

await migrate();
const port = Number(process.env.PORT ?? 4000);
createApp().listen(port, () => console.log(`maung-crm API di :${port}`));
startWoSync();
startExpirySweep();
startWoPush();
startAutoBackup();
