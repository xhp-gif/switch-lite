// 主题：浅色 / 深色 / 跟随系统。选择持久化在 localStorage，
// 应用方式是在 <html> 上写 data-theme，样式表按 [data-theme="dark"] 覆盖变量。
export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'switchlite-theme';

export function getTheme(): ThemeMode {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function resolved(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function applyTheme(mode: ThemeMode = getTheme()) {
  document.documentElement.dataset.theme = resolved(mode);
}

export function setTheme(mode: ThemeMode) {
  localStorage.setItem(KEY, mode);
  applyTheme(mode);
}

// system 模式下跟随系统切换；返回取消监听函数
export function watchSystemTheme(onChange: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}
