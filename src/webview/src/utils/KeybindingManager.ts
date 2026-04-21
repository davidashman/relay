import { normalizeKeystroke, isEditableTarget } from './keyNormalize'

export interface KeyBinding {
  keys: string
  command?: string
  handler?: () => void
  scope?: string
  priority?: number
  when?: () => boolean
  allowInEditable?: boolean
}

type InternalBinding = KeyBinding & { id: number }

export class KeybindingManager {
  private bindings: InternalBinding[] = []
  private nextId = 1
  private listening = false

  constructor() {
    this.ensureListening()
  }

  private ensureListening() {
    if (this.listening) return
    document.addEventListener('keydown', this.onKeydown, true)
    this.listening = true
  }

  register(binding: KeyBinding): () => void {
    const id = this.nextId++
    const b: InternalBinding = { id, priority: 0, ...binding }
    this.bindings.push(b)
    this.bindings.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    return () => this.unregister(id)
  }

  private unregister(id: number) {
    const i = this.bindings.findIndex((b) => b.id === id)
    if (i >= 0) this.bindings.splice(i, 1)
  }

  private onKeydown = (e: KeyboardEvent) => {
    const stroke = normalizeKeystroke(e)

    for (const b of this.bindings) {
      if (b.keys !== stroke) continue
      if (!b.allowInEditable && isEditableTarget(e.target)) continue
      if (b.when && !b.when()) continue

      try {
        if (b.handler) b.handler()
        // command handler runtime.registry
      } catch {}

      e.preventDefault()
      e.stopPropagation()
      break
    }
  }
}

export const keybindingManager = new KeybindingManager()

