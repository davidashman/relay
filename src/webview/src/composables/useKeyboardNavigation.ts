import type { KeyboardNavigationOptions } from '../types/completion'

/**
 * Composable
 *
 * EnterTabEscapePageUpPageDown
 *
 * @param options
 * @returns
 *
 * @example
 * const { handleKeydown, moveNext, movePrev } = useKeyboardNavigation({
 *   isOpen: ref(true),
 *   items: computed(() => [item1, item2]),
 *   activeIndex: ref(0),
 *   onSelect: (index) => console.log('Selected:', index),
 *   onClose: () => console.log('Closed'),
 *   pageSize: 5
 * })
 */
export function useKeyboardNavigation(options: KeyboardNavigationOptions) {
  const {
    isOpen,
    items,
    activeIndex,
    onSelect,
    onClose,
    supportTab = true,
    supportEscape = true,
    onNavigate,
    pageSize = 5
  } = options

  /**
   */
  function moveNext() {
    if (items.value.length === 0) return
    activeIndex.value = (activeIndex.value + 1) % items.value.length
    onNavigate?.()
  }

  /**
   */
  function movePrev() {
    if (items.value.length === 0) return
    activeIndex.value =
      (activeIndex.value - 1 + items.value.length) % items.value.length
    onNavigate?.()
  }

  /**
   */
  function moveNextPage() {
    if (items.value.length === 0) return
    const newIndex = Math.min(activeIndex.value + pageSize, items.value.length - 1)
    activeIndex.value = newIndex
    onNavigate?.()
  }

  /**
   */
  function movePrevPage() {
    if (items.value.length === 0) return
    const newIndex = Math.max(activeIndex.value - pageSize, 0)
    activeIndex.value = newIndex
    onNavigate?.()
  }

  /**
   */
  function selectActive() {
    if (items.value.length === 0) return
    onSelect(activeIndex.value)
  }

  /**
   */
  function reset() {
    activeIndex.value = 0
  }

  /**
   *
   * @param event
   * @returns
   */
  function handleKeydown(event: KeyboardEvent): boolean {
    if (!isOpen.value || items.value.length === 0) {
      return false
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveNext()
        return true

      case 'ArrowUp':
        event.preventDefault()
        movePrev()
        return true

      case 'PageDown':
        event.preventDefault()
        moveNextPage()
        return true

      case 'PageUp':
        event.preventDefault()
        movePrevPage()
        return true

      case 'Enter':
        event.preventDefault()
        selectActive()
        return true

      case 'Tab':
        if (supportTab && !event.shiftKey) {
          event.preventDefault()
          selectActive()
          return true
        }
        break

      case 'Escape':
        if (supportEscape) {
          event.preventDefault()
          onClose()
          return true
        }
        break
    }

    return false
  }

  return {
    handleKeydown,
    moveNext,
    movePrev,
    moveNextPage,
    movePrevPage,
    selectActive,
    reset
  }
}
