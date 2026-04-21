import type { TriggerQuery, TriggerDetectionOptions } from '../types/completion'

/**
 * Composable
 *
 * '/' '@'
 *
 * @param options
 * @returns
 *
 * @example
 * const { findQuery, getCaretOffset } = useTriggerDetection({ trigger: '/' })
 * const caret = getCaretOffset(inputElement)
 * const query = findQuery('hello /command world', caret)
 */
export function useTriggerDetection(options: TriggerDetectionOptions) {
  const { trigger, customRegex } = options

  /**
   *
   * @param element contenteditable
   * @returns undefined
   */
  function getCaretOffset(element: HTMLElement | null): number | undefined {
    if (!element) return undefined

    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return undefined

    const range = selection.getRangeAt(0)
    if (!element.contains(range.startContainer)) return undefined

    const preCaretRange = range.cloneRange()
    preCaretRange.selectNodeContents(element)
    preCaretRange.setEnd(range.endContainer, range.endOffset)

    return preCaretRange.toString().length
  }

  /**
   *
   * @param text
   * @param caret
   * @returns undefined
   */
  function findQuery(text: string, caret: number): TriggerQuery | undefined {
    const escapedTrigger = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = customRegex || new RegExp(
      `(?:^|\\s)${escapedTrigger}[^\\s${escapedTrigger}]*`,
      'g'
    )

    const matches = Array.from(text.matchAll(regex))

    for (const match of matches) {
      const matchIndex = match.index ?? 0
      const start = text.indexOf(trigger, matchIndex)
      const end = start + match[0].trim().length

      if (caret > start && caret <= end) {
        return {
          query: text.substring(start + trigger.length, end),
          start,
          end,
          trigger
        }
      }
    }

    return undefined
  }

  /**
   *
   * @param text
   * @param query
   * @param replacement
   * @returns
   */
  function replaceRange(
    text: string,
    query: TriggerQuery,
    replacement: string
  ): string {
    const before = text.substring(0, query.start)
    const after = text.substring(query.end)
    const suffix = after.startsWith(' ') ? '' : ' '
    return `${before}${replacement}${suffix}${after}`
  }

  return {
    findQuery,
    getCaretOffset,
    replaceRange
  }
}
