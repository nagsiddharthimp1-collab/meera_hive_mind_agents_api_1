import { truncateFileName } from '@/lib/stringUtils';
import { ChatAttachmentInputState } from '@/types/chat';
import Image from 'next/image';
import React from 'react';
import { FaFilePdf } from 'react-icons/fa';
import { FiPaperclip, FiX } from 'react-icons/fi';

interface AttachmentPreviewProps {
  attachment: ChatAttachmentInputState;
  index: number;
  onRemove: (index: number) => void;
}

export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachment, index, onRemove }) => {
  // If it's an image and has a preview URL, show the image preview
  if (attachment.type === 'image' && attachment.previewUrl) {
    return (
      <div key={index} className="relative inline-block mr-2  group">
        <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-primary/20 shadow-sm">
          <Image src={attachment.previewUrl} alt={attachment.file.name} layout="fill" objectFit="cover" />
        </div>
        <button
          type="button"
          className="absolute -top-1.5 -right-1.5 bg-red-500/90 backdrop-blur-sm rounded-full w-5 h-5 flex items-center justify-center text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600"
          onClick={() => onRemove(index)}
          title="Remove attachment"
        >
          <FiX size={12} />
        </button>
      </div>
    );
  }

  // Otherwise, show an icon and file details
  let icon;
  if (attachment.file.type === 'application/pdf') {
    icon = <FaFilePdf size={32} className="text-red-500" />;
  } else {
    icon = <FiPaperclip size={32} className="text-gray-500" />;
  }

  return (
    <div key={index} className="relative inline-block mr-2 mb-2 group">
      <div className="max-w-xs w-full rounded-lg border border-primary/20 bg-gray-50 flex items-center p-2.5">
        <div className="mr-3 flex-shrink-0">{icon}</div>
        <div className="flex-1 overflow-hidden">
          <p className="text-sm text-primary font-medium truncate" title={attachment.file.name}>
            {truncateFileName(attachment.file.name, 30)}
          </p>
          <p className="text-xs text-primary/60 capitalize">
            {(attachment.file.type.split('/')[1] || attachment.type).toLowerCase()}
          </p>
        </div>
      </div>
      <button
        type="button"
        className="absolute -top-1.5 -right-1.5 bg-red-500/90 backdrop-blur-sm rounded-full w-5 h-5 flex items-center justify-center text-white opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600"
        onClick={() => onRemove(index)}
        title="Remove attachment"
      >
        <FiX size={12} />
      </button>
    </div>
  );
};
