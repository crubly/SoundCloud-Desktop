import { useCallback } from 'react';

/**
 * Колесо мыши над горизонтальной лентой. Пока страница может скроллиться
 * вертикально — колесо листает страницу как обычно; лента захватывается ТОЛЬКО
 * когда вертикальный скролл упёрся в границу (вверх/вниз) — тогда колесо листает
 * элемент вбок. Вешаем NATIVE-листенер с `passive: false`: React делегирует
 * `wheel` как passive, и `preventDefault` там не срабатывает.
 *
 * Возвращает стабильный callback-ref (React 19 поддерживает cleanup из ref):
 * листенер крепится при монтировании узла и снимается при размонтировании.
 */

/** Ближайший предок, который реально скроллится по вертикали (страница/модалка). */
function findVerticalScroller(node: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = node.parentElement;
  while (el) {
    const ovY = getComputedStyle(el).overflowY;
    const scrollable = ovY === 'auto' || ovY === 'scroll' || ovY === 'overlay';
    if (scrollable && el.scrollHeight > el.clientHeight + 1) return el;
    el = el.parentElement;
  }
  return null;
}

export function useWheelHorizontalScroll() {
  return useCallback((node: HTMLElement | null) => {
    if (!node) return;
    let page = findVerticalScroller(node);

    const onWheel = (e: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth + 1) return;
      // Страница могла стать высокой после монтирования (асинхронные данные) —
      // тогда вертикального скроллера ещё не было.
      if (!page) page = findVerticalScroller(node);
      const factor = e.deltaMode === 1 ? 24 : e.deltaMode === 2 ? node.clientWidth : 1;
      const deltaY = e.deltaY * factor;

      // Пока страница может крутиться в сторону колеса — не перехватываем.
      if (page && deltaY !== 0) {
        const atTop = page.scrollTop <= 1;
        const atBottom = page.scrollTop + page.clientHeight >= page.scrollHeight - 1;
        const pageCanScroll = deltaY > 0 ? !atBottom : !atTop;
        if (pageCanScroll) return;
      }

      e.preventDefault();
      node.scrollLeft += (e.deltaY + e.deltaX) * factor;
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);
}
