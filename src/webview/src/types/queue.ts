
import type { AttachmentPayload } from '../core/Session';

export interface QueuedMessage {
  id: string
  content: string
  timestamp: number
  attachments?: AttachmentPayload[]
  includeSelection?: boolean
}

export interface MessageQueueState {
  queuedMessages: QueuedMessage[]
}