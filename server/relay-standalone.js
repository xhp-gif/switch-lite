// 中继独立进程入口：由 relayLauncher 以 detached 方式拉起，
// 生命周期与 SwitchLite 主程序解耦——关闭窗口后中继继续运行，Agent 不受影响。
import { startRelay } from './relay.js';

startRelay();
