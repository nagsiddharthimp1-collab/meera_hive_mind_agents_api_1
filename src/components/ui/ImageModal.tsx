'use client';

import { downloadFile } from '@/lib/downloadFile';
import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { FiDownload, FiX } from 'react-icons/fi';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  imageName?: string;
}

export const ImageModal = ({ isOpen, onClose, imageUrl, imageName }: ImageModalProps) => {
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!isOpen) return;

    const body = document.body;
    const originalStyle = body.style.cssText;

    // Lock body scroll
    Object.assign(body.style, {
      overflow: 'hidden',
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
    });

    document.addEventListener('keydown', handleEscape);

    return () => {
      body.style.cssText = originalStyle;
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, handleEscape]);

  if (!isOpen) return null;

  const modal = (
    <div
      className="fixed inset-0 z-[2147483647] bg-black flex items-center justify-center pt-16 pb-10 px-10"
      onClick={handleClose}
    >
      <button
        onClick={handleClose}
        className="absolute top-5 right-5 z-[2147483647] w-12 h-12 rounded-full bg-black/70 border-2 border-white/30 text-white flex items-center justify-center transition-all duration-200 backdrop-blur-md hover:bg-black/90 hover:scale-110"
        title="Close (Esc)"
      >
        <FiX size={24} />
      </button>

      <button
        onClick={() => downloadFile(imageUrl)}
        className="absolute top-5 right-20 z-[2147483647] w-12 h-12 rounded-full bg-black/70 border-2 border-white/30 text-white flex items-center justify-center transition-all duration-200 backdrop-blur-md hover:bg-black/90 hover:scale-110"
        title="Download image"
      >
        <FiDownload size={24} />
      </button>

      <div onClick={(e) => e.stopPropagation()} className="w-full h-full flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={imageName || 'Preview'}
          className="max-w-full max-h-full object-contain select-none"
          draggable={false}
          onError={() => console.error('Image failed to load:', imageUrl)}
          onLoad={() => console.log('Image loaded successfully:', imageUrl)}
        />
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};
