/** 极简命令面板开关：模块级单例，供顶栏按钮与全局快捷键调用。 */
let openFn: (() => void) | null = null;

export function registerCommandPaletteOpener(fn: () => void): void {
  openFn = fn;
}

export function openCommandPalette(): void {
  openFn?.();
}
