# Dropdown Component System

A general-purpose Dropdown component system following the **container/content separation** design principle.

## Design Philosophy

### Core Principles
- **Dropdown**: a pure container component, responsible for positioning and show/hide logic
- **DropdownItem**: a general data-driven component, adapted to different business needs via an interface
- **Business logic**: fully implemented in the consumer (e.g. ChatInputBox)

### Benefits of Generality
- Reusable for any dropdown scenario (menus, selects, autocomplete, etc.)
- Driven by a data interface with no hard-coded business logic
- Supports custom icons, styles, and behaviors
- Type-safe TypeScript interfaces

## Data Interface

### DropdownItemData
```typescript
interface DropdownItemData {
  id: string           // unique identifier
  label?: string       // primary display text
  name?: string        // fallback display text
  detail?: string      // supplementary info (e.g. path, description)
  icon?: string        // left icon CSS class
  rightIcon?: string   // right icon CSS class
  checked?: boolean    // checked state
  disabled?: boolean   // disabled state
  type?: string        // business type identifier
  data?: any          // additional business data
  [key: string]: any  // extension fields
}
```

## Usage Examples

### Basic Usage
```vue
<template>
  <Dropdown
    :is-visible="showDropdown"
    :position="dropdownPosition"
    @close="hideDropdown"
  >
    <template #content>
      <DropdownItem
        v-for="(item, index) in items"
        :key="item.id"
        :item="item"
        :index="index"
        @click="handleSelect"
      />
    </template>
  </Dropdown>
</template>
```

### Custom Icons
```vue
<DropdownItem :item="item" :index="index">
  <template #icon="{ item }">
    <FileIcon v-if="item.type === 'file'" :file-name="item.name" />
    <i v-else :class="item.icon"></i>
  </template>
</DropdownItem>
```

### Business Data Example
```typescript
const contextItems: DropdownItemData[] = [
  {
    id: 'file-1',
    label: 'main.ts',
    detail: 'src/main.ts',
    type: 'file',
    data: { path: '/project/src/main.ts' }
  },
  {
    id: 'option-1',
    label: 'Settings',
    icon: 'codicon-settings',
    rightIcon: 'codicon-chevron-right',
    type: 'submenu',
    data: { category: 'settings' }
  }
]
```

## Component Architecture

```
Dropdown (container)
├── ScrollableElement (scrolling)
│   └── business content (slot)
│       ├── DropdownItem (generic item)
│       ├── DropdownSeparator (separator)
│       └── custom content
└── Footer (bottom info)
```

## Style System

- Uses global CSS variables for consistency
- Supports VSCode theme adaptation
- Monaco editor-style scrollbars
- Responsive design

## Best Practices

1. **Data-driven**: all display logic controlled through the data interface
2. **Type-safe**: use TypeScript interfaces to ensure type checking
3. **Business separation**: business logic implemented in the consumer; component stays generic
4. **Extensible**: supports customization via slots and data fields

## Migration Guide

Migrating from a hard-coded version to the generic version:

1. Move business data to the consumer
2. Redefine data using the `DropdownItemData` interface
3. Use `item.type` and `item.data` for business logic in event handlers
4. Customize special display needs via slots

This design ensures high reusability and maintainability of the Dropdown component while retaining powerful extensibility.
