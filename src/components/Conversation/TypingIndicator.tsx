import React from 'react';

interface TypingIndicatorProps {
  thoughtText?: string;
}

export const TypingIndicator: React.FC<TypingIndicatorProps> = ({ thoughtText }) => {
  const firstLine = thoughtText ? thoughtText.split('\n')[0] : '';

  const cleanedText = firstLine.replace(/\*\*/g, '');

  return (
    <div className="flex justify-center w-full mb-3">
      <div
        className="
          bg-card shadow-sm rounded-r-lg rounded-bl-lg 
          relative after:content-[''] after:absolute after:w-0 after:h-0 after:border-solid 
          after:top-0 after:left-0 after:border-t-[6px] after:border-r-[6px] 
          after:border-r-transparent after:border-t-card
          p-3
          flex items-center justify-center
          text-primary 
        "
      >
        <div className="flex items-center">
          {thoughtText && <span className="text-primary text-[15px]">{cleanedText}</span>}
          <div className={`flex space-x-1 ${thoughtText ? 'ml-2' : ''}`}>
            <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
            <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
            <div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TypingIndicator;
