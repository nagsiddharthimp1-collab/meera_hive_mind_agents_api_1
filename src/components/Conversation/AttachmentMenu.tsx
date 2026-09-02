import React from 'react';
import { CgImage } from 'react-icons/cg';
import { FiUpload } from 'react-icons/fi';

interface AttachmentMenuProps {
  menuRef: React.RefObject<HTMLDivElement>;
  handleDocumentAttachment: () => void;
  handleImageAttachment: () => void;
}

export const AttachmentMenuComponent: React.FC<AttachmentMenuProps> = ({
  menuRef,
  handleDocumentAttachment,
  handleImageAttachment,
}) => (
  <div
    ref={menuRef}
    className="absolute bottom-full right-0 md:left-0 mb-2 bg-card backdrop-blur-md border border-primary/20 rounded-lg shadow-xl py-1 w-48 z-20"
  >
    <button
      type="button"
      onClick={handleDocumentAttachment}
      className="w-full px-3 py-2.5 text-left text-sm flex items-center text-primary hover:bg-primary/10 transition-colors"
    >
      <FiUpload className="mr-2.5 text-primary/70" size={16} /> Upload files
    </button>
    <button
      type="button"
      onClick={handleImageAttachment}
      className="w-full px-3 py-2.5 text-left text-sm flex items-center text-primary hover:bg-primary/10 transition-colors"
    >
      <CgImage className="mr-2.5 text-primary/70" size={16} /> Add photos
    </button>
  </div>
);
