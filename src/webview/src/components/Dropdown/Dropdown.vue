<template>
  <div
    v-if="isVisible"
    class="dropdown-popover fade-in-fast"
    :style="{ ...dropdownStyle, ...popoverStyle }"
    :data-nav="dataNav"
  >
    <div
      ref="containerRef"
      tabindex="0"
      class="dropdown-container"
      :style="containerStyle"
      @keydown.escape="close"
    >
      <div v-if="showSearch" class="search-input-section">
        <input
          ref="searchInput"
          v-model="searchTerm"
          class="context-search-input"
          :placeholder="searchPlaceholder"
          @input="onSearchInput"
        />
      </div>

      <!--  slot -->
      <slot name="header" />

      <!--  -  ScrollableElement -->
      <ScrollableElement ref="scrollableRef">
        <div class="menu-content">
          <slot
            name="content"
            :search-term="searchTerm"
            :selected-index="selectedIndex"
          />
        </div>
      </ScrollableElement>

      <!--  slot -->
      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import ScrollableElement from '../ScrollableElement.vue'

export interface DropdownItem {
  id: string
  type: string
  [key: string]: any
}

interface Props {
  isVisible: boolean
  position: { top: number; left: number; width?: number; height?: number }
  width?: number
  contentHeight?: number
  containerStyle?: Record<string, any>
  popoverStyle?: Record<string, any>
  contentStyle?: Record<string, any>
  showSearch?: boolean
  searchPlaceholder?: string
  shouldAutoFocus?: boolean
  closeOnClickOutside?: boolean
  closeSelectors?: string[]
  align?: 'left' | 'right' | 'center'
  dataNav?: 'keyboard' | 'mouse'
  offsetY?: number // ==
  offsetX?: number // ==
  preferPlacement?: 'auto' | 'above' | 'below'
  selectedIndex?: number
  scrollPadding?: number
}

interface Emits {
  (e: 'close'): void
  (e: 'select', item: DropdownItem): void
  (e: 'search', term: string): void
}

const props = withDefaults(defineProps<Props>(), {
  containerStyle: () => ({}),
  popoverStyle: () => ({}),
  contentStyle: () => ({}),
  showSearch: false,
  searchPlaceholder: 'Search...',
  shouldAutoFocus: true,
  closeOnClickOutside: true,
  closeSelectors: () => [],
  align: 'left',
  offsetY: 4,
  offsetX: 0,
  preferPlacement: 'auto',
  selectedIndex: -1,
  scrollPadding: 6
})

const emit = defineEmits<Emits>()

const searchInput = ref<HTMLInputElement>()
const searchTerm = ref('')
const selectedIndex = ref(0)
const scrollableRef = ref<any>()
const containerRef = ref<HTMLElement>()

const dropdownStyle = computed(() => {
  const style: any = {
    position: 'fixed',
    minWidth: '140px',
    maxWidth: '240px',
    width: props.width ? `${props.width}px` : 'auto',
    zIndex: 2548
  }

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const triggerRect = props.position

  // dropdown
  const searchHeight = props.showSearch ? 32 : 0
  const footerHeight = 25 // footer
  const dropdownTotalHeight = searchHeight + 240 + footerHeight // 240px

  const spaceAbove = triggerRect.top
  const spaceBelow = viewportHeight - triggerRect.top - (triggerRect.height || 0)

  // preferPlacement
  let showBelow: boolean
  if (props.preferPlacement === 'below') {
    showBelow = true
  } else if (props.preferPlacement === 'above') {
    showBelow = false
  } else {
    // auto
    showBelow = spaceBelow >= dropdownTotalHeight || spaceBelow > spaceAbove
  }

  // offsetY==
  if (showBelow) {
    style.top = `${triggerRect.top + (triggerRect.height || 0) + props.offsetY}px`
  } else {
    // offsetY ""
    style.bottom = `${viewportHeight - triggerRect.top + props.offsetY}px`
  }

  // -
  const triggerWidth = triggerRect.width || 0
  // 240px
  const dropdownWidth = props.width || 240

  // left align
  let leftPosition = 0
  switch (props.align) {
    case 'right':
      // dropdown
      leftPosition = triggerRect.left + triggerWidth - dropdownWidth
      break
    case 'center':
      // dropdown
      leftPosition = triggerRect.left + triggerWidth / 2 - dropdownWidth / 2
      break
    case 'left':
    default:
      // dropdown
      leftPosition = triggerRect.left
      break
  }

  leftPosition += props.offsetX

  const leftBoundary = 8
  const rightPadding = 24
  const rightBoundary = viewportWidth - rightPadding

  if (leftPosition < leftBoundary) {
    leftPosition = leftBoundary
  } else if (leftPosition + dropdownWidth > rightBoundary) {
    leftPosition = rightBoundary - dropdownWidth
  }

  style.left = `${leftPosition}px`

  return style
})

function close() {
  emit('close')
}

function onSearchInput() {
  emit('search', searchTerm.value)
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.isVisible) return

  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      close()
      break
  }
}

function handleClickOutside(event: MouseEvent) {
  if (!props.isVisible || !props.closeOnClickOutside) return

  const target = event.target as HTMLElement

  if (target.closest('.dropdown-popover')) return

  const excludeSelectors = [
    '.premium-pill',
    '.dropdown-trigger',
    ...props.closeSelectors
  ]

  for (const selector of excludeSelectors) {
    if (target.closest(selector)) return
  }

  close()
}

watch(() => props.isVisible, (visible) => {
  if (visible && props.shouldAutoFocus) {
    nextTick(() => {
      searchInput.value?.focus()
    })
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleKeydown)
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown)
  document.removeEventListener('click', handleClickOutside)
})

function ensureSelectedVisible() {
  if (!props.isVisible) return
  if (props.selectedIndex == null || props.selectedIndex < 0) return

  const root = containerRef.value
  const scrollable = scrollableRef.value
  if (!root || !scrollable) return

  const wrapper = root.querySelector('.scrollable-content-wrapper') as HTMLElement | null
  const content = root.querySelector('.scrollable-content-container') as HTMLElement | null
  const selectedEl = root.querySelector('.dropdown-menu-item[data-is-selected="true"]') as HTMLElement | null
  if (!wrapper || !content || !selectedEl) return

  const padding = props.scrollPadding ?? 6
  const wrapperH = wrapper.clientHeight
  const contentH = content.scrollHeight

  if (contentH <= wrapperH + 1) return

  // "" transform
  const contentRect = content.getBoundingClientRect()
  const wrapperRect = wrapper.getBoundingClientRect()
  const currentTop = wrapperRect.top - contentRect.top

  // content
  let offsetTop = 0
  let el: HTMLElement | null = selectedEl
  while (el && el !== content) {
    offsetTop += el.offsetTop
    el = el.offsetParent as HTMLElement | null
  }
  const itemTop = offsetTop
  const itemBottom = itemTop + selectedEl.offsetHeight

  const visibleTop = currentTop + padding
  const visibleBottom = currentTop + wrapperH - padding

  let newTop = currentTop
  if (itemTop < visibleTop) {
    newTop = itemTop - padding
  } else if (itemBottom > visibleBottom) {
    newTop = itemBottom - wrapperH + padding
  } else {
    return
  }

  const maxTop = Math.max(0, contentH - wrapperH)
  newTop = Math.max(0, Math.min(maxTop, newTop))

  try {
    scrollable.scrollTo(newTop, 0, { behavior: 'auto' })
  } catch {}
}

watch(() => props.selectedIndex, () => {
  // RAF DOM
  requestAnimationFrame(() => {
    requestAnimationFrame(() => ensureSelectedVisible())
  })
})

watch(() => props.isVisible, (visible) => {
  if (visible) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => ensureSelectedVisible())
    })
  }
})

defineExpose({
  focusSearch: () => searchInput.value?.focus(),
  setSearchTerm: (term: string) => { searchTerm.value = term },
  getSearchTerm: () => searchTerm.value
})
</script>

<style scoped>
.dropdown-popover {
  box-sizing: border-box;
  padding: 0;
  border-radius: 6px;
  background: transparent;
  border: none;
  align-items: stretch;
  font-size: 10px;
  display: flex;
  flex-direction: column;
  gap: 0;
  visibility: visible;
  transform-origin: left top;
  box-shadow: 0 0 8px 2px color-mix(in srgb, var(--vscode-widget-shadow) 30%, transparent);
  min-width: 140px;
  max-width: 240px;
  width: auto;
}

.dropdown-container {
  box-sizing: border-box;
  border-radius: 6px;
  background-color: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-commandCenter-inactiveBorder, var(--vscode-widget-border));
  align-items: stretch;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0;
  contain: paint;
  outline: none;
  pointer-events: auto;
}

.search-input-container {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 0 6px;
  border: none;
  box-sizing: border-box;
  outline: none;
  margin: 2px;
}

.search-input {
  font-size: 12px;
  line-height: 15px;
  border-radius: 3px;
  background: transparent;
  color: var(--vscode-input-foreground);
  padding: 3px 0;
  flex: 1;
  min-width: 0;
  border: none !important;
  outline: none !important;
  box-sizing: border-box;
}

.search-input::placeholder {
  opacity: 0.5;
}

.menu-content {
  padding: 0.125rem;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.menu-sections {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px;
}

.dropdown-footer {
  flex-shrink: 0;
  background-color: var(--vscode-dropdown-background);
  border-top: 1px solid var(--vscode-commandCenter-inactiveBorder, var(--vscode-widget-border));
}

/* */
.fade-in-fast {
  animation: fadein 0.1s linear;
}

@keyframes fadein {
  0% {
    opacity: 0;
    visibility: visible;
  }
  to {
    opacity: 1;
  }
}
</style>
