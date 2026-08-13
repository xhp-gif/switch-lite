import { createApp } from './app.js';
import { startRelay } from './relay.js';

const port = Number(process.env.PORT || 4174);
const app = createApp();
startRelay();

app.listen(port, () => {
  console.log(`SwitchLite 服务已启动: http://127.0.0.1:${port}`);
});
