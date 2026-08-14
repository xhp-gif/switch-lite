// 桌面端 preload 暴露的桥接口（网页版不存在）
interface UpdateStatus {
  state: 'checking' | 'downloading' | 'downloaded' | 'latest' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

interface SwitchLiteDesktop {
  checkUpdate: () => Promise<UpdateStatus>;
  quitAndInstall: () => Promise<void>;
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => () => void;
}

interface Window {
  switchliteDesktop?: SwitchLiteDesktop;
}
