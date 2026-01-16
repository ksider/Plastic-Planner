import { createApp } from "./app.js";

const port = 3000;
const app = await createApp();

app.listen(port, () => {
  console.log(`DOE app running at http://localhost:${port}`);
});
