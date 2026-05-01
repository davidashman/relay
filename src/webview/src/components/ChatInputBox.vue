<template>
  <div
    class="full-input-box"
    :style="{ position: 'relative', '--mode-border-color': modeBorderColor }"
  >
    <div v-if="attachments && attachments.length > 0" class="attachments-list">
      <div
        v-for="attachment in attachments"
        :key="attachment.id"
        class="attachment-item"
      >
        <!-- Image: fills tile as thumbnail -->
        <img
          v-if="attachment.mediaType?.startsWith('image/')"
          :src="`data:${attachment.mediaType};base64,${attachment.data}`"
          :alt="attachment.fileName"
          class="attachment-thumbnail"
        />
        <!-- Non-image: icon + name stacked -->
        <template v-else>
          <div class="attachment-file-icon">
            <FileIcon :file-name="attachment.fileName" :size="20" />
          </div>
          <span class="attachment-name">{{ attachment.fileName }}</span>
        </template>
        <!-- Remove X (top-right corner, appears on hover) -->
        <button
          class="remove-button-thumbnail"
          @click.stop="handleRemoveAttachment(attachment.id)"
          :aria-label="`Remove ${attachment.fileName}`"
        >
          <span class="codicon codicon-close" />
        </button>
      </div>
    </div>

    <div
      ref="textareaRef"
      contenteditable="true"
      class="aislash-editor-input custom-scroll-container"
      :data-placeholder="placeholder"
      style="min-height: 34px; max-height: 240px; resize: none; overflow-y: hidden; word-wrap: break-word; white-space: pre-wrap; width: 100%; height: 34px;"
      @input="handleInput"
      @keydown="handleKeydown"
      @paste="handlePaste"
      @dragover="handleDragOver"
      @drop="handleDrop"
    />

    <!-- ButtonArea  + TokenIndicator -->
    <ButtonArea
      :disabled="isSubmitDisabled"
      :loading="isLoading"
      :selected-model="selectedModel"
      :conversation-working="conversationWorking"
      :has-input-content="!!content.trim()"
      :show-progress="showProgress"
      :progress-percentage="progressPercentage"
      :context-tooltip="contextTooltip"
      :input-tokens="inputTokens"
      :output-tokens="outputTokens"
      :show-token-usage="showTokenUsage"
      :thinking-enabled="thinkingEnabled"
      :effort-level="effortLevel"
      :permission-mode="permissionMode"
      @submit="handleSubmit"
      @stop="handleStop"
      @add-attachment="handleAddFiles"
      @mention="handleMention"
      @thinking-toggle="() => emit('thinkingToggle')"
      @mode-select="(mode) => emit('modeSelect', mode)"
      @model-select="(modelId) => emit('modelSelect', modelId)"
      @effort-select="(level) => emit('effortSelect', level)"
    />

    <!-- Slash Command Dropdown -->
    <Dropdown
      v-if="slashCompletion.isOpen.value"
      :is-visible="slashCompletion.isOpen.value"
      :position="slashCompletion.position.value"
      :width="240"
      :should-auto-focus="false"
      :close-on-click-outside="false"
      :data-nav="slashCompletion.navigationMode.value"
      :selected-index="slashCompletion.activeIndex.value"
      :offset-y="-8"
      :offset-x="-8"
      :prefer-placement="'above'"
      @close="slashCompletion.close"
    >
      <template #content>
        <div @mouseleave="slashCompletion.handleMouseLeave">
          <template v-if="slashCompletion.items.value.length > 0">
            <template v-for="(item, index) in slashCompletion.items.value" :key="item.id">
              <DropdownItem
                :item="item"
                :index="index"
                :is-selected="index === slashCompletion.activeIndex.value"
                @click="slashCompletion.selectActive()"
                @mouseenter="slashCompletion.handleMouseEnter(index)"
              />
            </template>
          </template>
          <div v-else class="px-2 py-1 text-xs opacity-60">No matches</div>
        </div>
      </template>
    </Dropdown>

    <!-- @  Dropdown -->
    <Dropdown
      v-if="fileCompletion.isOpen.value"
      :is-visible="fileCompletion.isOpen.value"
      :position="fileCompletion.position.value"
      :width="320"
      :should-auto-focus="false"
      :close-on-click-outside="false"
      :data-nav="fileCompletion.navigationMode.value"
      :selected-index="fileCompletion.activeIndex.value"
      :offset-y="-8"
      :offset-x="-8"
      :prefer-placement="'above'"
      @close="fileCompletion.close"
    >
      <template #content>
        <div @mouseleave="fileCompletion.handleMouseLeave">
          <template v-if="fileCompletion.items.value.length > 0">
            <template v-for="(item, index) in fileCompletion.items.value" :key="item.id">
              <DropdownItem
                :item="item"
                :index="index"
                :is-selected="index === fileCompletion.activeIndex.value"
                @click="fileCompletion.selectActive()"
                @mouseenter="fileCompletion.handleMouseEnter(index)"
              >
                <template #icon v-if="'data' in item && item.data?.file">
                  <FileIcon
                    :file-name="item.data.file.name"
                    :is-directory="item.data.file.type === 'directory'"
                    :folder-path="item.data.file.path"
                    :size="16"
                  />
                </template>
              </DropdownItem>
            </template>
          </template>
          <div v-else class="px-2 py-1 text-xs opacity-60">No matches</div>
        </div>
      </template>
    </Dropdown>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, inject, onMounted, onUnmounted } from 'vue'
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk'
import FileIcon from './FileIcon.vue'
import ButtonArea from './ButtonArea.vue'
import type { AttachmentItem } from '../types/attachment'
import { Dropdown, DropdownItem } from './Dropdown'
import { RuntimeKey } from '../composables/runtimeContext'
import { useCompletionDropdown } from '../composables/useCompletionDropdown'
import { getSlashCommands, commandToDropdownItem } from '../providers/slashCommandProvider'
import { getFileReferences, fileToDropdownItem, type FileReference } from '../providers/fileReferenceProvider'
import { captureSourceSnapshot, type SendSnapshot } from '../composables/useSendAnimation'

interface Props {
  showProgress?: boolean
  progressPercentage?: number
  contextTooltip?: string
  inputTokens?: number
  outputTokens?: number
  showTokenUsage?: boolean
  placeholder?: string
  readonly?: boolean
  showSearch?: boolean
  selectedModel?: string
  conversationWorking?: boolean
  attachments?: AttachmentItem[]
  thinkingEnabled?: boolean
  effortLevel?: string
  permissionMode?: PermissionMode
}

interface Emits {
  (e: 'submit', content: string, snapshot?: SendSnapshot | null): void
  (e: 'submitAndInterrupt', content: string, snapshot?: SendSnapshot | null): void
  (e: 'stop'): void
  (e: 'input', content: string): void
  (e: 'attach'): void
  (e: 'addAttachment', files: FileList): void
  (e: 'removeAttachment', id: string): void
  (e: 'thinkingToggle'): void
  (e: 'modeSelect', mode: PermissionMode): void
  (e: 'modelSelect', modelId: string): void
  (e: 'effortSelect', level: string | undefined): void
}

const props = withDefaults(defineProps<Props>(), {
  showProgress: true,
  progressPercentage: 48.7,
  contextTooltip: '',
  inputTokens: 0,
  outputTokens: 0,
  showTokenUsage: true,
  // Enter: send (interleaves mid-turn). Cmd/Ctrl+Enter: interrupt then send.
  // IIFE-wrapped so defineProps defaults don't reference a setup-local binding.
  placeholder: (() => {
    const isMac = typeof navigator !== 'undefined'
      && /Mac|iPhone|iPad|iPod/i.test(
        (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
          || navigator.platform
          || navigator.userAgent
      )
    const modifierKey = isMac ? 'Cmd' : 'Ctrl'
    return `Plan, @ for context, / for commands — Enter: send • ${modifierKey}+Enter: interrupt then send`
  })(),
  readonly: false,
  showSearch: false,
  conversationWorking: false,
  attachments: () => [],
  thinkingEnabled: true,
  effortLevel: undefined,
  permissionMode: 'default'
})

const emit = defineEmits<Emits>()

const runtime = inject(RuntimeKey)

const content = ref('')
const isLoading = ref(false)
const textareaRef = ref<HTMLDivElement | null>(null)

// Prompt history for up/down arrow navigation
const promptHistory = ref<string[]>([])
const historyIndex = ref(-1)  // -1 = not in history mode
const draftContent = ref('')  // saved draft when entering history mode

const isSubmitDisabled = computed(() => {
  return !content.value.trim() || isLoading.value
})

const modeBorderColor = computed(() => {
  switch (props.permissionMode) {
    case 'acceptEdits':
      return 'color-mix(in srgb, #a855f7 45%, transparent)'
    case 'plan':
      return 'color-mix(in srgb, #3b82f6 45%, transparent)'
    default:
      return 'color-mix(in srgb, var(--vscode-foreground) 25%, transparent)'
  }
})

// === Completion Dropdown Composable ===

// Slash Command
const slashCompletion = useCompletionDropdown({
  mode: 'inline',
  trigger: '/',
  provider: (query, signal) => getSlashCommands(query, runtime, signal),
  toDropdownItem: commandToDropdownItem,
  onSelect: (command, query) => {
    if (query) {
      const updated = slashCompletion.replaceText(content.value.trim(), `${command.label} `)
      content.value = updated

      // DOM
      if (textareaRef.value) {
        textareaRef.value.textContent = updated
        placeCaretAtEnd(textareaRef.value)
      }

      emit('input', updated)
    }
  },
  anchorElement: textareaRef
})

// @
const fileCompletion = useCompletionDropdown({
  mode: 'inline',
  trigger: '@',
  provider: (query, signal) => getFileReferences(query, runtime, signal),
  toDropdownItem: fileToDropdownItem,
  onSelect: (file, query) => {
    if (query) {
      const updated = fileCompletion.replaceText(content.value.trim(), `@${file.path} `)
      content.value = updated

      // DOM
      if (textareaRef.value) {
        textareaRef.value.textContent = updated
        placeCaretAtEnd(textareaRef.value)
      }

      emit('input', updated)
    }
  },
  anchorElement: textareaRef
})

function placeCaretAtEnd(node: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(node)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function placeCaretAtOffset(node: HTMLElement, charOffset: number) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  let remaining = charOffset
  let textNode: Text | null = null

  while ((textNode = walker.nextNode() as Text | null)) {
    const len = textNode.textContent?.length ?? 0
    if (remaining <= len) {
      const range = document.createRange()
      range.setStart(textNode, Math.max(0, remaining))
      range.collapse(true)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
    remaining -= len
  }

  placeCaretAtEnd(node)
}

function getCaretClientRect(editable: HTMLElement | null): DOMRect | undefined {
  if (!editable) return undefined

  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return undefined

  const range = sel.getRangeAt(0).cloneRange()
  if (!editable.contains(range.startContainer)) return undefined

  // collapsed range 0 getClientRects
  const rects = range.getClientRects()
  const rect = rects[0] || range.getBoundingClientRect()
  if (!rect) return undefined

  // 0 Dropdown
  const lh = parseFloat(getComputedStyle(editable).lineHeight || '0') || 16
  const height = rect.height || lh

  return new DOMRect(rect.left, rect.top, rect.width, height)
}

function getRectAtCharOffset(editable: HTMLElement, charOffset: number): DOMRect | undefined {
  const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT)
  let remaining = charOffset
  let node: Text | null = null

  while ((node = walker.nextNode() as Text | null)) {
    const len = node.textContent?.length ?? 0
    if (remaining <= len) {
      const range = document.createRange()
      range.setStart(node, Math.max(0, remaining))
      range.collapse(true)
      const rects = range.getClientRects()
      const rect = rects[0] || range.getBoundingClientRect()
      const lh = parseFloat(getComputedStyle(editable).lineHeight || '0') || 16
      const height = rect.height || lh
      return new DOMRect(rect.left, rect.top, rect.width, height)
    }
    remaining -= len
  }

  return undefined
}

// dropdown
function updateDropdownPosition(
  completion: typeof slashCompletion | typeof fileCompletion,
  anchor: 'caret' | 'queryStart' = 'queryStart'
) {
  const el = textareaRef.value
  if (!el) return

  let rect: DOMRect | undefined

  if (anchor === 'queryStart' && completion.triggerQuery.value) {
    rect = getRectAtCharOffset(el, completion.triggerQuery.value.start)
  }

  if (!rect && anchor === 'caret') {
    rect = getCaretClientRect(el)
  }

  if (!rect) {
    const r = el.getBoundingClientRect()
    rect = new DOMRect(r.left, r.top, r.width, r.height)
  }

  completion.updatePosition({
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height
  })
}

function handleInput(event: Event) {
  const target = event.target as HTMLDivElement
  const textContent = target.textContent || ''

  // div
  if (textContent.length === 0) {
    target.innerHTML = ''
  }

  content.value = textContent
  emit('input', textContent)

  // slash @
  slashCompletion.evaluateQuery(textContent)
  fileCompletion.evaluateQuery(textContent)

  // dropdown
  if (slashCompletion.isOpen.value) {
    nextTick(() => {
      updateDropdownPosition(slashCompletion, 'queryStart')
    })
  }
  if (fileCompletion.isOpen.value) {
    nextTick(() => {
      updateDropdownPosition(fileCompletion, 'queryStart')
    })
  }

  autoResizeTextarea()
}

function autoResizeTextarea() {
  if (!textareaRef.value) return

  nextTick(() => {
    const divElement = textareaRef.value!

    // scrollHeight
    divElement.style.height = '20px'

    const scrollHeight = divElement.scrollHeight
    const minHeight = 20
    const maxHeight = 240

    if (scrollHeight <= maxHeight) {
      divElement.style.height = Math.max(scrollHeight, minHeight) + 'px'
      divElement.style.overflowY = 'hidden'
    } else {
      divElement.style.height = maxHeight + 'px'
      divElement.style.overflowY = 'auto'
    }
  })
}

// contenteditable textarea
function getCaretCharOffset(): number | undefined {
  const el = textareaRef.value
  if (!el) return undefined
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return undefined
  const range = sel.getRangeAt(0)
  if (!el.contains(range.startContainer)) return undefined
  const pre = range.cloneRange()
  pre.selectNodeContents(el)
  pre.setEnd(range.endContainer, range.endOffset)
  return pre.toString().length
}

// @ FileReference undefined
function activeFileItem(): FileReference | undefined {
  const idx = fileCompletion.activeIndex.value
  if (idx < 0) return undefined
  const item = fileCompletion.items.value[idx] as { data?: { file?: FileReference } } | undefined
  return item?.data?.file
}

// "foo/bar/" + /
function normalizeDirPath(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  return trimmed ? `${trimmed}/` : ''
}

//   "foo/bar"   -> "foo/"
//   "foo/bar/"  -> "foo/"
//   "foo/"      -> ""
//   "foo"       -> ""
function computeParentQuery(query: string): string {
  if (!query) return ''
  const stripped = query.endsWith('/') ? query.slice(0, -1) : query
  const lastSep = stripped.lastIndexOf('/')
  return lastSep >= 0 ? stripped.slice(0, lastSep + 1) : ''
}

// @ `@<newQuery>`,,
function rewriteTriggerQuery(newQuery: string) {
  const tq = fileCompletion.triggerQuery.value
  const el = textareaRef.value
  if (!tq || !el) return

  const before = content.value.substring(0, tq.start)
  const after = content.value.substring(tq.end)
  const updated = `${before}@${newQuery}${after}`

  content.value = updated
  el.textContent = updated

  // @<newQuery>
  placeCaretAtOffset(el, before.length + 1 + newQuery.length)

  emit('input', updated)
  nextTick(() => {
    fileCompletion.evaluateQuery(updated)
    updateDropdownPosition(fileCompletion, 'queryStart')
  })
  autoResizeTextarea()
}

function handleKeydown(event: KeyboardEvent) {
  if (slashCompletion.isOpen.value) {
    slashCompletion.handleKeydown(event)
    return
  }

  if (fileCompletion.isOpen.value) {
    const tq = fileCompletion.triggerQuery.value
    const caret = getCaretCharOffset()
    const atTriggerEnd = tq !== undefined && caret !== undefined && caret === tq.end
    const active = activeFileItem()
    const noModifiers = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey

    // Enter IME →
    if (
      event.key === 'Enter' &&
      !event.isComposing &&
      noModifiers &&
      active?.type === 'directory'
    ) {
      event.preventDefault()
      event.stopPropagation()
      rewriteTriggerQuery(normalizeDirPath(active.path))
      return
    }

    // Right arrow
    if (event.key === 'ArrowRight' && noModifiers && atTriggerEnd) {
      if (active?.type === 'directory') {
        event.preventDefault()
        event.stopPropagation()
        rewriteTriggerQuery(normalizeDirPath(active.path))
        return
      }
      if (active?.type === 'file') {
        event.preventDefault()
        event.stopPropagation()
        fileCompletion.selectActive()
        return
      }
    }

    // Left arrow query "/" →
    if (
      event.key === 'ArrowLeft' &&
      noModifiers &&
      atTriggerEnd &&
      tq &&
      tq.query.includes('/')
    ) {
      event.preventDefault()
      event.stopPropagation()
      rewriteTriggerQuery(computeParentQuery(tq.query))
      return
    }

    fileCompletion.handleKeydown(event)
    return
  }

  // Prompt history navigation (only on single-line content or when already in history mode)
  if (event.key === 'ArrowUp' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (!content.value.includes('\n')) {
      event.preventDefault()
      navigateHistoryUp()
      return
    }
  }

  if (event.key === 'ArrowDown' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
    if (historyIndex.value !== -1) {
      event.preventDefault()
      navigateHistoryDown()
      return
    }
  }

  if (event.key === 'Escape' && historyIndex.value !== -1) {
    event.preventDefault()
    historyIndex.value = -1
    setHistoryContent(draftContent.value)
    draftContent.value = ''
    return
  }

  // Enter / Cmd+Enter / Ctrl+Enter all submit. Shift+Enter keeps inserting
  // a newline. Cmd/Ctrl+Enter additionally interrupts the current turn first.
  if (event.key === 'Enter' && !event.shiftKey) {
    // ()
    if (event.isComposing) {
      return
    }
    const interrupt = event.metaKey || event.ctrlKey
    event.preventDefault()
    handleSubmit(interrupt)
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    setTimeout(() => {
      const target = event.target as HTMLDivElement
      const textContent = target.textContent || ''
      if (textContent.length === 0) {
        target.innerHTML = ''
        content.value = ''
      }
    }, 0)
  }
}

function handlePaste(event: ClipboardEvent) {
  const clipboard = event.clipboardData
  if (!clipboard) {
    return
  }

  const items = clipboard.items
  if (!items || items.length === 0) {
    return
  }

  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile()
      if (file) {
        files.push(file)
      }
    }
  }

  if (files.length > 0) {
    event.preventDefault()
    // FileList-like
    const dataTransfer = new DataTransfer()
    for (const file of files) {
      dataTransfer.items.add(file)
    }
    handleAddFiles(dataTransfer.files)
  }
}

function getWorkspaceRoot(): string | undefined {
  const r = runtime as any
  if (!r) return undefined

  try {
    const sessionStore = r.sessionStore
    const activeSession = sessionStore?.activeSession?.()
    const cwdFromSession = activeSession?.cwd?.()
    if (typeof cwdFromSession === 'string' && cwdFromSession) {
      return cwdFromSession
    }
  } catch {
    // ignore
  }

  try {
    const connection = r.connectionManager?.connection?.()
    const config = connection?.config?.()
    if (config?.defaultCwd && typeof config.defaultCwd === 'string') {
      return config.defaultCwd
    }
  } catch {
    // ignore
  }

  return undefined
}

function toWorkspaceRelativePath(absoluteOrMixedPath: string): string {
  const root = getWorkspaceRoot()
  if (!root) return absoluteOrMixedPath

  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '')
  let normPath = absoluteOrMixedPath.replace(/\\/g, '/')

  // Windows file:// URI /C:/
  if (normPath.startsWith('/') && /^[A-Za-z]:\//.test(normPath.slice(1))) {
    normPath = normPath.slice(1)
  }

  if (normPath === normRoot) {
    return ''
  }

  if (normPath.startsWith(normRoot + '/')) {
    return normPath.slice(normRoot.length + 1)
  }

  return absoluteOrMixedPath
}

function isFileDrop(event: DragEvent): boolean {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return false

  const types = Array.from(dataTransfer.types || [])
  if (types.includes('Files')) return true
  if (types.includes('text/uri-list')) return true

  return false
}

function extractFilePathsFromDataTransfer(dataTransfer: DataTransfer): string[] {
  const paths: string[] = []

  const uriList = dataTransfer.getData('text/uri-list')
  if (uriList) {
    const lines = uriList
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))

    for (const line of lines) {
      try {
        const url = new URL(line)
        if (url.protocol === 'file:') {
          const decodedPath = decodeURIComponent(url.pathname)
          paths.push(toWorkspaceRelativePath(decodedPath))
        } else {
          paths.push(toWorkspaceRelativePath(line))
        }
      } catch {
        paths.push(toWorkspaceRelativePath(line))
      }
    }
  }

  if (paths.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
    for (const file of Array.from(dataTransfer.files)) {
      const fileWithPath = file as File & { path?: string }
      if (fileWithPath.path) {
        paths.push(toWorkspaceRelativePath(fileWithPath.path))
      } else {
        paths.push(toWorkspaceRelativePath(file.name))
      }
    }
  }

  return paths
}

async function statPaths(
  paths: string[]
): Promise<Record<string, 'file' | 'directory' | 'other' | 'not_found'>> {
  const result: Record<string, 'file' | 'directory' | 'other' | 'not_found'> = {}
  if (!paths.length) return result

  const r = runtime as any
  if (!r) return result

  try {
    const connection = await r.connectionManager.get()
    const response = await connection.statPaths(paths)
    const entries = (response?.entries ?? []) as Array<{ path: string; type: any }>
    for (const entry of entries) {
      if (!entry || typeof entry.path !== 'string') continue
      const t = entry.type
      if (t === 'file' || t === 'directory' || t === 'other' || t === 'not_found') {
        result[entry.path] = t
      }
    }
  } catch (error) {
    console.warn('[ChatInputBox] statPaths failed:', error)
  }

  return result
}

function handleDragOver(event: DragEvent) {
  // Shift /URI
  if (!event.shiftKey) return
  if (!isFileDrop(event)) return

  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

async function insertPathsFromDataTransfer(dataTransfer: DataTransfer) {
  const paths = extractFilePathsFromDataTransfer(dataTransfer)
  if (paths.length === 0) return

  const types = await statPaths(paths)

  const mentionText = paths
    .map(p => {
      const t = types[p]
      const isDir = t === 'directory'
      const normalized = isDir && !p.endsWith('/') ? `${p}/` : p
      return `@${normalized}`
    })
    .join(' ')

  const baseContent = content.value.trimEnd()
  const updatedContent = baseContent ? `${baseContent} ${mentionText} ` : `${mentionText} `

  content.value = updatedContent

  if (textareaRef.value) {
    textareaRef.value.textContent = updatedContent
    placeCaretAtEnd(textareaRef.value)
  }

  emit('input', updatedContent)
  autoResizeTextarea()

  nextTick(() => {
    textareaRef.value?.focus()
  })
}

async function handleDrop(event: DragEvent) {
  const dataTransfer = event.dataTransfer
  if (!dataTransfer) return

  // Shift+drop /URI
  if (!event.shiftKey) return
  if (!isFileDrop(event)) return

  event.preventDefault()
  event.stopPropagation()

  // File Finder/Explorer
  const files = dataTransfer.files
  if (files && files.length > 0) {
    handleAddFiles(files)
    return
  }

  // URI VS Code @
  await insertPathsFromDataTransfer(dataTransfer)
}

function setHistoryContent(text: string) {
  content.value = text
  if (textareaRef.value) {
    textareaRef.value.textContent = text
    placeCaretAtEnd(textareaRef.value)
  }
  autoResizeTextarea()
}

function navigateHistoryUp() {
  if (promptHistory.value.length === 0) return

  if (historyIndex.value === -1) {
    draftContent.value = content.value
    historyIndex.value = promptHistory.value.length - 1
  } else if (historyIndex.value > 0) {
    historyIndex.value--
  } else {
    return
  }

  setHistoryContent(promptHistory.value[historyIndex.value])
}

function navigateHistoryDown() {
  if (historyIndex.value === -1) return

  if (historyIndex.value < promptHistory.value.length - 1) {
    historyIndex.value++
    setHistoryContent(promptHistory.value[historyIndex.value])
  } else {
    historyIndex.value = -1
    setHistoryContent(draftContent.value)
    draftContent.value = ''
  }
}

function handleSubmit(interrupt: boolean = false) {
  if (!content.value.trim()) return

  // Save to history (skip exact duplicate of most recent entry)
  const text = content.value
  if (promptHistory.value.length === 0 || promptHistory.value[promptHistory.value.length - 1] !== text) {
    promptHistory.value.push(text)
  }
  historyIndex.value = -1
  draftContent.value = ''

  // Capture the visual state of the input BEFORE we clear it, so the parent
  // can animate the text/attachments gliding up into the thread.
  const inputRoot = textareaRef.value?.closest('.full-input-box') as HTMLElement | null
  const snapshot = captureSourceSnapshot(inputRoot)

  // Default: straight send (SDK interleaves mid-turn).
  // Modifier (Cmd/Ctrl+Enter): interrupt the current turn, then send.
  if (interrupt) {
    emit('submitAndInterrupt', content.value, snapshot)
  } else {
    emit('submit', content.value, snapshot)
  }

  content.value = ''
  if (textareaRef.value) {
    textareaRef.value.textContent = ''
  }

  // DOM
  nextTick(() => {
    autoResizeTextarea()
  })
}

function handleStop() {
  emit('stop')
}

function handleMention(filePath?: string) {
  if (!filePath) return

  // @
  const updatedContent = content.value + `@${filePath} `
  content.value = updatedContent

  // DOM
  if (textareaRef.value) {
    textareaRef.value.textContent = updatedContent
    placeCaretAtEnd(textareaRef.value)
  }

  emit('input', updatedContent)

  nextTick(() => {
    textareaRef.value?.focus()
  })
}

function handleAddFiles(files: FileList) {
  emit('addAttachment', files)
}

function handleRemoveAttachment(id: string) {
  emit('removeAttachment', id)
}

function handleSelectionChange() {
  if (!content.value || !textareaRef.value) return

  // evaluateQuery handleInput
  if (slashCompletion.isOpen.value) {
    nextTick(() => {
      updateDropdownPosition(slashCompletion, 'queryStart')
    })
  }
  if (fileCompletion.isOpen.value) {
    nextTick(() => {
      updateDropdownPosition(fileCompletion, 'queryStart')
    })
  }
}

// Shift+drop window
// dragover drop textarea
// “ Shift ”
function handleWindowDragOver(event: DragEvent) {
  if (!event.shiftKey) return
  if (!isFileDrop(event)) return
  event.preventDefault()
  event.stopPropagation()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

async function handleWindowDrop(event: DragEvent) {
  if (!event.shiftKey) return
  if (!isFileDrop(event)) return
  event.preventDefault()
  event.stopPropagation()

  const dt = event.dataTransfer
  if (!dt) return

  const files = dt.files
  if (files && files.length > 0) {
    handleAddFiles(files)
    return
  }

  await insertPathsFromDataTransfer(dt)
}

// / selectionchange
onMounted(() => {
  document.addEventListener('selectionchange', handleSelectionChange)
  window.addEventListener('dragover', handleWindowDragOver, { capture: true })
  window.addEventListener('drop', handleWindowDrop, { capture: true })
})

onUnmounted(() => {
  document.removeEventListener('selectionchange', handleSelectionChange)
  window.removeEventListener('dragover', handleWindowDragOver, { capture: true } as EventListenerOptions)
  window.removeEventListener('drop', handleWindowDrop, { capture: true } as EventListenerOptions)
})

defineExpose({
  /** */
  setContent(text: string) {
    content.value = text || ''
    if (textareaRef.value) {
      textareaRef.value.textContent = content.value
    }
    autoResizeTextarea()
  },
  /** */
  focus() {
    nextTick(() => textareaRef.value?.focus())
  }
})

</script>

<style scoped>
/* - caret */
.aislash-editor-input {
  line-height: 18px;
}

/* */
.aislash-editor-input:focus {
  outline: none !important;
  border: none !important;
}

/* */
.full-input-box:focus-within {
  border-color: var(--mode-border-color) !important;
  background: color-mix(in srgb, var(--vscode-input-background) 70%, transparent);
  outline: none !important;
}

/* Placeholder */
.aislash-editor-input:empty::before {
  content: attr(data-placeholder);
  color: var(--vscode-input-placeholderForeground);
  pointer-events: none;
  position: absolute;
}

.aislash-editor-input:focus:empty::before {
  content: attr(data-placeholder);
  color: var(--vscode-input-placeholderForeground);
  pointer-events: none;
}

/* Attachment tiles */
.attachments-list {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 4px;
  padding: 6px 0px 8px;
  width: 100%;
  box-sizing: border-box;
  overflow: visible;
}

.attachment-item {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
  outline: none;
  overflow: visible;
  box-sizing: border-box;
}

.attachment-item:hover {
  background-color: var(--vscode-list-hoverBackground);
  border-color: var(--vscode-focusBorder);
}

.attachment-thumbnail {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: 5px;
}

.attachment-file-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-foreground);
  width: 100%;
  text-align: center;
  font-size: 9px;
  line-height: 1.2;
}

.remove-button-thumbnail {
  position: absolute;
  top: -6px;
  right: -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  background: color-mix(in srgb, var(--vscode-foreground) 18%, var(--vscode-editor-background));
  border: 1px solid color-mix(in srgb, var(--vscode-foreground) 50%, var(--vscode-editor-background));
  border-radius: 50%;
  cursor: pointer;
  color: var(--vscode-foreground);
  z-index: 1;
}

.remove-button-thumbnail .codicon {
  font-size: 10px;
}

</style>
