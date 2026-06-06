import { createApp } from "./app.js";

const port = parseInt(process.env.BACKEND_PORT ?? "4010", 10);
createApp().listen(port, () => {
  console.log(`backend listening on :${port}`);
});
