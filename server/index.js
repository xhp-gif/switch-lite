import { createApp } from './app.js';
import { ensureRelay } from './relayLauncher.js';

const port = Number(process.env.PORT || 4174);
const app = createApp();

// 中继以独立进程常驻：本服务退出后 Agent 仍可正常使用、用量持续记录
ensureRelay()
  .then((r) => console.log(`[relay] ${r.status}${r.pid ? ` (pid ${r.pid})` : ''}`))
  .catch((err) => console.error('[relay] 启动失败:', err.message));

app.listen(port, () => {
  console.log(`SwitchLite 服务已启动: http://127.0.0.1:${port}`);
});
