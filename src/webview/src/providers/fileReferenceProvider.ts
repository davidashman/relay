import type { DropdownItemType } from '../types/dropdown'
import type { RuntimeInstance } from '../composables/useRuntime'

/**
 */
export interface FileReference {
  path: string
  name: string
  type: 'file' | 'directory'
}

/**
 * @param query
 * @param runtime Runtime
 * @param signal AbortSignal,
 * @returns
 */
export async function getFileReferences(
  query: string,
  runtime: RuntimeInstance | undefined,
  signal?: AbortSignal
): Promise<FileReference[]> {
  if (!runtime) {
    console.warn('[fileReferenceProvider] No runtime available')
    return []
  }

  try {
    const connection = await runtime.connectionManager.get()

    // , +
    const pattern = (query && query.trim()) ? query : ''
    const response = await connection.listFiles(pattern, signal)

    // response.files { path, name, type }
    return response.files || []
  } catch (error) {
    // AbortError,
    if (error instanceof Error && error.name === 'AbortError') {
      return []
    }
    console.error('[fileReferenceProvider] Failed to list files:', error)
    return []
  }
}

/**
 * DropdownItem
 */
export function fileToDropdownItem(file: FileReference): DropdownItemType {
  return {
    id: `file-${file.path}`,
    type: 'item',
    label: file.name,
    detail: file.path,
    // icon FileIcon isDirectory/folderName
    data: {
      file
    }
  }
}
