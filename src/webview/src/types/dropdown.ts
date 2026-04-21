export interface DropdownItemData {
  id: string
  label?: string
  name?: string
  detail?: string
  icon?: string // CSS
  rightIcon?: string // CSS
  checked?: boolean
  disabled?: boolean
  type?: string
  data?: any
  [key: string]: any
}

// Dropdown
export interface DropdownItem {
  id: string
  label: string
  name?: string
  detail?: string
  icon?: string
  rightIcon?: string
  checked?: boolean
  disabled?: boolean
  type?: string
  data?: any
}

export interface DropdownSeparator {
  type: 'separator'
  id: string
}

export interface DropdownSectionHeader {
  type: 'section-header'
  id: string
  text?: string
}

export type DropdownItemType = DropdownItemData | DropdownSeparator | DropdownSectionHeader

export function isDropdownItemData(item: DropdownItemType): item is DropdownItemData {
  return item.type !== 'separator' && item.type !== 'section-header'
}

export function isDropdownSeparator(item: DropdownItemType): item is DropdownSeparator {
  return item.type === 'separator'
}

export function isDropdownSectionHeader(item: DropdownItemType): item is DropdownSectionHeader {
  return item.type === 'section-header'
}

export type { DropdownItemData as DropdownItemDataType }