export function isMac(): boolean {
  return !!(navigator.platform?.startsWith('Mac') || navigator.userAgent.includes('Mac'));
}

export function isWindows(): boolean {
  return !!(navigator.platform?.startsWith('Win') || navigator.userAgent.includes('Windows'));
}

export function isLinux(): boolean {
  return !isMac() && !isWindows();
}

export function getPlatform(): 'macos' | 'windows' | 'linux' {
  if (isMac()) return 'macos';
  if (isWindows()) return 'windows';
  return 'linux';
}

