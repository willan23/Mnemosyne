export type AttachmentType = 'image' | 'audio' | 'document' | 'video';

export interface Attachment {
  type: AttachmentType;
  url: string;
  name: string;
  size?: number;
  duration?: number;
  mimeType?: string;
  source?: 'upload' | 'generated' | 'document-batch';
}
