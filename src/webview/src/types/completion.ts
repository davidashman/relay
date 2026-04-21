import type { Ref, ComputedRef } from 'vue'
import type { DropdownItemType } from './dropdown'

/**
 */
export interface TriggerQuery {
  /** */
  query: string
  /** */
  start: number
  /** */
  end: number
  /** '/' '@' */
  trigger: string
}

/**
 * Dropdown
 */
export interface DropdownPosition {
  top: number
  left: number
  width: number
  height: number
}

/**
 * - inline: /command, @file
 * - manual:
 */
export type CompletionMode = 'inline' | 'manual'

/**
 */
export interface CompletionConfig<T> {
  /** */
  mode: CompletionMode

  /** inline '/' '@' */
  trigger?: string

  /** AbortSignal */
  provider: (query: string, signal?: AbortSignal) => Promise<T[]> | T[]

  /** DropdownItem */
  toDropdownItem: (item: T) => DropdownItemType

  /** */
  onSelect: (item: T, query?: TriggerQuery) => void

  /** dropdown */
  anchorElement?: Ref<HTMLElement | null>

  /** manual */
  showSectionHeaders?: boolean

  /** manual */
  searchFields?: string[]

  /** manual */
  sectionOrder?: readonly string[]
}

/**
 * Dropdown
 */
export interface CompletionDropdown {
  /** */
  isOpen: Ref<boolean>

  /** Dropdown */
  items: ComputedRef<DropdownItemType[]>

  /** */
  activeIndex: Ref<number>

  /** Dropdown */
  position: ComputedRef<DropdownPosition>

  /** */
  query: Ref<string>

  /** inline */
  triggerQuery: Ref<TriggerQuery | undefined>

  /** */
  navigationMode: Ref<'keyboard' | 'mouse'>

  /** dropdown */
  open: () => void

  /** dropdown */
  close: () => void

  /** */
  handleKeydown: (event: KeyboardEvent) => void

  /** */
  selectActive: () => void

  /** */
  selectIndex: (index: number) => void

  /** manual */
  handleSearch: (term: string) => void

  /** inline */
  evaluateQuery: (text: string, caretOffset?: number) => void

  /** inline */
  replaceText: (text: string, replacement: string) => string

  /** mouse */
  handleMouseEnter: (index: number) => void

  /** */
  handleMouseLeave: () => void

  /** */
  updatePosition: (pos: DropdownPosition) => void
}

/**
 */
export interface KeyboardNavigationOptions {
  /** */
  isOpen: Ref<boolean>

  /** */
  items: ComputedRef<any[]>

  /** */
  activeIndex: Ref<number>

  /** */
  onSelect: (index: number) => void

  /** */
  onClose: () => void

  /** Tab */
  supportTab?: boolean

  /** Escape */
  supportEscape?: boolean

  /** */
  onNavigate?: () => void

  /** 5 */
  pageSize?: number
}

/**
 */
export interface TriggerDetectionOptions {
  /** */
  trigger: string

  /** */
  customRegex?: RegExp
}
