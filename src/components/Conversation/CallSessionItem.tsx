import { formatTime } from '@/lib/dateUtils';
import { ChatMessageFromServer } from '@/types/chat';
import React, { useCallback, useMemo, useState } from 'react';
import { FiChevronDown, FiChevronUp, FiPhoneOutgoing } from 'react-icons/fi';

interface CallSessionItemProps {
  messages: ChatMessageFromServer[];
}

const formatCallDuration = (seconds: number): string => {
  if (seconds < 0) return '0 sec';

  const totalSeconds = Math.round(seconds);
  if (totalSeconds < 60) {
    return `${totalSeconds} ${totalSeconds === 1 ? 'sec' : 'secs'}`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (totalMinutes < 60) {
    const minText = `${totalMinutes} ${totalMinutes === 1 ? 'min' : 'mins'}`;
    const secText = remainingSeconds > 0 ? ` ${remainingSeconds} ${remainingSeconds === 1 ? 'sec' : 'secs'}` : '';
    return `${minText}${secText}`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  const hourText = `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const minText = remainingMinutes > 0 ? ` ${remainingMinutes} ${remainingMinutes === 1 ? 'min' : 'mins'}` : '';
  return `${hourText}${minText}`;
};

const CallSessionItemComponent = ({ messages }: CallSessionItemProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const { callDuration, lastMessageTimestamp } = useMemo(() => {
    if (messages.length === 0) {
      return {
        callDuration: '0 sec',
        lastMessageTimestamp: new Date().toISOString(),
      };
    }

    const timestamps = messages.map((msg) => new Date(msg.timestamp).getTime()).sort((a, b) => a - b);
    const start = new Date(timestamps[0]);
    const end = new Date(timestamps[timestamps.length - 1]);
    let durationInSeconds = (end.getTime() - start.getTime()) / 1000;

    if (durationInSeconds === 0 && messages.length > 0) {
      durationInSeconds = 1;
    }

    return {
      callDuration: messages.length === 1 ? null : formatCallDuration(durationInSeconds),
      lastMessageTimestamp: messages[messages.length - 1].timestamp,
    };
  }, [messages]);

  const toggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((prev) => !prev);
  }, []);

  if (messages.length === 0) return null;

  return (
    <div className="group mb-3 flex justify-end">
      <div
        className={`relative w-full max-w-[90%] md:max-w-sm rounded-br-lg rounded-l-lg bg-primary p-3 text-background shadow-sm after:absolute after:right-0 after:top-0 after:h-0 after:w-0 after:border-solid after:border-l-[6px] after:border-t-[6px] after:border-l-transparent after:border-t-primary after:content-['']`}
      >
        <div className="flex items-center rounded-lg bg-background/10 p-2">
          <div className="mr-2 rounded-full bg-black/10 p-2">
            <FiPhoneOutgoing className="text-background" size={18} />
          </div>
          <div className="flex flex-col">
            <span className="block text-background">Voice call</span>
            {callDuration && <span className="text-xs text-background/80">{callDuration}</span>}
          </div>
        </div>

        {/* transcript section */}
        <div
          className={`scrollbar-xs transition-all duration-300 ease-in-out overflow-y-auto ${
            isExpanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="mt-2 border-t border-background/20 p-1 pt-2">
            <div className="space-y-2">
              {messages.map((msg) => (
                <div key={msg.message_id} className="text-sm text-background/90 ">
                  <span className="font-semibold text-background">
                    {msg.content_type === 'user' ? 'You: ' : 'Meera: '}
                  </span>
                  <span>{msg.content}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-1.5 flex items-center justify-between">
          <button
            onClick={toggleExpand}
            className=" rounded text-background/60 hover:text-background/90 transition-colors duration-200 focus:outline-none cursor-pointer"
            title={isExpanded ? 'Show less' : 'Show more'}
          >
            <div className="transition-transform duration-200 ease-in-out">
              {isExpanded ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
            </div>
          </button>

          <span className="text-xs text-background/70">{formatTime(lastMessageTimestamp)}</span>
        </div>
      </div>
    </div>
  );
};

export const CallSessionItem = React.memo(CallSessionItemComponent);
