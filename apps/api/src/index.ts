import { createApp } from "./app.js";
import { migrate } from "./migrate.js";

await migrate();
const port = Number(process.env.PORT ?? 4100);
createApp().listen(port, () => console.log(`maung-crm API di :${port}`));
