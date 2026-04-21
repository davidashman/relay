import { ref, computed, watch } from 'vue'
import type {
  CompletionConfig,
  CompletionDropdown,
  DropdownPosition,
  TriggerQuery
} from '../types/completion'
import type { DropdownItemType } from '../types/dropdown'
import { useTriggerDetection } from './useTriggerDetection'
import { useKeyboardNavigation } from './useKeyboardNavigation'

/**
 * Dropdown Composable
 *
 * - inline: /command, @file
 * - manual:
 *
 * @param config
 * @returns dropdown
 *
 * @example
 * // inline
 * const slashCompletion = useCompletionDropdown({
 *   mode: 'inline',
 *   trigger: '/',
 *   provider: getSlashCommands,
 *   toDropdownItem: (cmd) => ({ ... }),
 *   onSelect: (cmd, query) => { ... },
 *   anchorElement: inputRef
 * })
 *
 * @example
 * // manual
 * const commandMenu = useCompletionDropdown({
 *   mode: 'manual',
 *   provider: getCommands,
 *   toDropdownItem: (cmd) => ({ ... }),
 *   onSelect: (cmd) => { ... }
 * })
 */
export function useCompletionDropdown<T>(
  config: CompletionConfig<T>
): CompletionDropdown {
  const {
    mode,
    trigger,
    provider,
    toDropdownItem,
    onSelect,
    anchorElement,
    showSectionHeaders = false,
    searchFields = ['label', 'detail'],
    sectionOrder = []
  } = config

  if (mode === 'inline' && !trigger) {
    throw new Error('[useCompletionDropdown] inline mode must provide trigger parameter')
  }

  // === ===
  const isOpen = ref(false)
  const activeIndex = ref(0)
  const query = ref('')
  const triggerQuery = ref<TriggerQuery | undefined>(undefined)
  const rawItems = ref<T[]>([])
  const navigationMode = ref<'keyboard' | 'mouse'>('keyboard')

  // === inline ===
  const triggerDetection = mode === 'inline' && trigger
    ? useTriggerDetection({ trigger })
    : null

  // === + + + AbortController ===
  const requestSeq = ref(0)
  const isLoading = ref(false)
  let debounceTimerId: number | undefined
  let currentAbortController: AbortController | undefined

  async function loadItems(searchQuery: string, signal?: AbortSignal) {
    try {
      const seq = ++requestSeq.value
      isLoading.value = true

      const result = provider(searchQuery, signal)
      const data = result instanceof Promise ? await result : result

      if (seq === requestSeq.value) {
        rawItems.value = (data ?? []) as T[]
      }
    } catch (error) {
      // AbortError,
      if (error instanceof Error && error.name === 'AbortError') {
        return
      }
      console.error('[useCompletionDropdown] Failed to load data:', error)
      rawItems.value = []
    } finally {
      isLoading.value = false
    }
  }

  // inline 200ms + AbortController
  function loadItemsDebounced(searchQuery: string, delay = 200) {
    if (debounceTimerId !== undefined) {
      window.clearTimeout(debounceTimerId)
    }

    if (currentAbortController) {
      currentAbortController.abort()
      currentAbortController = undefined
    }

    debounceTimerId = window.setTimeout(() => {
      // AbortController
      currentAbortController = new AbortController()
      void loadItems(searchQuery, currentAbortController.signal)
    }, delay)
  }

  // === ===
  const items = computed<DropdownItemType[]>(() => {
    if (rawItems.value.length === 0) return []

    // DropdownItem
    const source = (rawItems.value as unknown as T[]) || []
    let dropdownItems = source.map((it) => toDropdownItem(it as T))

    // manual
    if (mode === 'manual' && showSectionHeaders) {
      dropdownItems = organizeItemsWithSections(dropdownItems)
    }

    return dropdownItems
  })

  function organizeItemsWithSections(items: DropdownItemType[]): DropdownItemType[] {
    if (!showSectionHeaders) return items

    const result: DropdownItemType[] = []
    const grouped = new Map<string, DropdownItemType[]>()

    // section
    for (const item of items) {
      const section = (item as any).section || 'Other'
      if (!grouped.has(section)) {
        grouped.set(section, [])
      }
      grouped.get(section)!.push(item)
    }

    const sections = sectionOrder.length > 0
      ? sectionOrder
      : Array.from(grouped.keys())

    for (const section of sections) {
      const sectionItems = grouped.get(section)
      if (!sectionItems || sectionItems.length === 0) continue

      if (result.length > 0) {
        result.push({
          id: `separator-${section}`,
          type: 'separator'
        } as DropdownItemType)
      }

      result.push({
        id: `section-${section}`,
        type: 'section-header',
        text: section
      } as DropdownItemType)

      result.push(...sectionItems)
    }

    return result
  }

  const navigableItems = computed<T[]>(() => rawItems.value as unknown as T[])

  // === ===
  const positionRef = ref<DropdownPosition>({ top: 0, left: 0, width: 0, height: 0 })
  const position = computed<DropdownPosition>(() => positionRef.value)

  function updatePosition(pos: DropdownPosition) {
    positionRef.value = pos
  }

  // anchorElement
  function updateDefaultPosition() {
    if (!anchorElement?.value) {
      positionRef.value = { top: 0, left: 0, width: 0, height: 0 }
      return
    }

    const rect = anchorElement.value.getBoundingClientRect()
    positionRef.value = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height
    }
  }

  // === ===
  const navigation = useKeyboardNavigation({
    isOpen,
    items: computed(() => navigableItems.value),
    activeIndex,
    onSelect: (index) => {
      const item = navigableItems.value[index] as unknown as T
      if (item != null) {
        onSelect(item as T, triggerQuery.value)
        close()
      }
    },
    onClose: close,
    supportTab: true,
    supportEscape: mode === 'inline', // inline  Escape
    onNavigate: () => {
      // keyboard
      navigationMode.value = 'keyboard'
    }
  })

  // === inline ===
  function evaluateQuery(text: string, caretOffset?: number) {
    if (mode !== 'inline' || !triggerDetection) return

    const caret = caretOffset ?? triggerDetection.getCaretOffset(anchorElement?.value || null)
    if (caret === undefined) {
      triggerQuery.value = undefined
      isOpen.value = false
      return
    }

    const foundQuery = triggerDetection.findQuery(text, caret)
    triggerQuery.value = foundQuery

    if (foundQuery) {
      query.value = foundQuery.query
      isOpen.value = true
      activeIndex.value = 0
      // ,200ms
      loadItemsDebounced(foundQuery.query)
    } else {
      isOpen.value = false
    }
  }

  // === inline ===
  function replaceText(text: string, replacement: string): string {
    if (mode !== 'inline' || !triggerDetection || !triggerQuery.value) {
      return text
    }

    return triggerDetection.replaceRange(text, triggerQuery.value, replacement)
  }

  // === manual / ===
  function open() {
    isOpen.value = true
    activeIndex.value = 0
    query.value = ''
    void loadItems('')
  }

  function close() {
    isOpen.value = false
    activeIndex.value = -1 // -1
    query.value = ''
    triggerQuery.value = undefined
    rawItems.value = []
    navigationMode.value = 'keyboard'
  }

  // === ===
  function handleMouseEnter(index: number) {
    navigationMode.value = 'mouse'
    activeIndex.value = index
  }

  function handleMouseLeave() {
    // -1
    activeIndex.value = -1
  }

  // === manual ===
  let debounceTimer: number | undefined
  function handleSearch(term: string) {
    query.value = term
    activeIndex.value = 0
    if (debounceTimer) window.clearTimeout(debounceTimer)
    debounceTimer = window.setTimeout(() => {
      void loadItems(term)
    }, 120)
  }

  // === ===
  function handleKeydown(event: KeyboardEvent) {
    navigation.handleKeydown(event)
  }

  // === / ===
  function selectActive() {
    navigation.selectActive()
  }

  function selectIndex(index: number) {
    if (index < 0 || index >= navigableItems.value.length) return
    activeIndex.value = index
    const item = navigableItems.value[index] as unknown as T
    if (item != null) {
      onSelect(item as T, triggerQuery.value)
      close()
    }
  }

  // === manual inline evaluateQuery ===
  // inline evaluateQuery loadItemsDebounced
  watch(query, (newQuery) => {
    // inline watch
    if (mode === 'inline') return
    // manual handleSearch
    if (mode === 'manual') return

    if (isOpen.value) void loadItems(newQuery)
  })

  // === ===
  watch(items, (list) => {
    const len = list.length
    if (len === 0) {
      activeIndex.value = -1
      return
    }
    if (activeIndex.value < 0) activeIndex.value = 0
    if (activeIndex.value >= len) activeIndex.value = len - 1
  })

  return {
    isOpen,
    items,
    activeIndex,
    position,
    query,
    triggerQuery,
    navigationMode,
    // loading
    // @ts-expect-error:
    loading: isLoading,
    open,
    close,
    handleKeydown,
    selectActive,
    selectIndex,
    handleSearch,
    evaluateQuery,
    replaceText,
    handleMouseEnter,
    handleMouseLeave,
    updatePosition
  }
}
