import { useLiveAPIContext } from '@/contexts/LiveAPIContext';
import Image from 'next/image';
import * as React from 'react';
import { BsChatDots } from 'react-icons/bs';
import { FaMicrophone, FaMicrophoneSlash, FaVolumeUp } from 'react-icons/fa';
import { MdCallEnd } from 'react-icons/md';

interface CallButtonProps {
  onClick?: () => void;
  disabled?: boolean;
}

export const StartCallButton = ({ onClick, disabled }: CallButtonProps) => {
  return (
    <div className="flex flex-col items-center">
      <button
        className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-[#27D32F] flex items-center justify-center hover:bg-green-500/90 transition-colors"
        onClick={onClick}
        disabled={disabled}
        aria-label="Start Call"
      >
        <Image src="/icons/startcall.svg" alt="Start Call" width={24} height={24} />
      </button>
    </div>
  );
};

export const MicrophoneButton = ({ disabled, onClick, isMuted }: CallButtonProps & { isMuted: boolean }) => {
  return (
    <div className="flex flex-col items-center">
      <button
        className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-background border border-primary/20 flex items-center justify-center hover:bg-primary/5 transition-colors"
        onClick={onClick}
        disabled={disabled}
        aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
      >
        {isMuted ? (
          <FaMicrophoneSlash className="text-primary text-lg md:text-xl" />
        ) : (
          <FaMicrophone className="text-primary text-lg md:text-xl" />
        )}
      </button>
    </div>
  );
};

export const SpeakerButton = ({ disabled }: CallButtonProps) => {
  const [isOutputDeviceSelectorOpen, setIsOutputDeviceSelectorOpen] = React.useState(false);
  const { outputDevices, activeOutputDevice, setAudioOutput } = useLiveAPIContext();
  const outputMenuRef = React.useRef<HTMLDivElement>(null);
  const speakerButtonRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        outputMenuRef.current &&
        speakerButtonRef.current &&
        !outputMenuRef.current.contains(event.target as Node) &&
        !speakerButtonRef.current.contains(event.target as Node)
      ) {
        setIsOutputDeviceSelectorOpen(false);
      }
    };

    if (isOutputDeviceSelectorOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOutputDeviceSelectorOpen]);

  return (
    <div className="flex flex-col items-center relative">
      {isOutputDeviceSelectorOpen && (
        <div
          ref={outputMenuRef}
          className="fixed md:absolute left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 bottom-24 md:bottom-full mb-2 bg-background rounded-lg shadow-lg p-2 min-w-[240px] max-w-[95vw] md:max-w-none z-50"
        >
          <ul
            className="max-h-[40vh] md:max-h-48 overflow-y-auto"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            <style jsx>{`
              ul::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            {outputDevices.length === 0 ? (
              <li className="py-3 px-4 text-sm text-gray-500">No audio output devices found</li>
            ) : (
              outputDevices.map((device) => (
                <li
                  key={device.deviceId}
                  className={`py-3 border border-primary/20 px-4 text-sm cursor-pointer rounded-md flex items-center justify-between ${
                    device.deviceId === activeOutputDevice?.deviceId
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-primary/5'
                  }`}
                  onClick={async () => {
                    setAudioOutput(device.deviceId);
                      setIsOutputDeviceSelectorOpen(false);
                  }}
                >
                  <span className="flex-1 pr-2">
                    {device.label || `Speaker (${device.deviceId.substring(0, 8)}...)`}
                  </span>
                  {device.deviceId === activeOutputDevice?.deviceId && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-primary"
                    >
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
      <button
        ref={speakerButtonRef}
        className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-background border border-primary/20 flex items-center justify-center hover:bg-primary/5 transition-colors"
        onClick={() => setIsOutputDeviceSelectorOpen((prev) => !prev)}
        disabled={disabled}
        aria-label="Select audio output device"
      >
        <FaVolumeUp className="text-primary text-lg md:text-xl" />
      </button>
    </div>
  );
};

export const EndCallButton = ({ onClick, disabled }: CallButtonProps) => {
  return (
    <div className="flex flex-col items-center">
      <button
        className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-red-500 flex items-center justify-center hover:bg-red-600 transition-colors"
        onClick={onClick}
        disabled={disabled}
        aria-label="End Call"
      >
        <MdCallEnd className="text-white text-2xl md:text-3xl" />
      </button>
    </div>
  );
};

export const ChatButton = ({ onClick, disabled }: CallButtonProps) => {
  return (
    <div className="flex flex-col items-center">
      <button
        className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-background border border-primary/20 flex items-center justify-center hover:bg-primary/5 transition-colors"
        onClick={onClick}
        disabled={disabled}
        aria-label="Open chat"
      >
        <BsChatDots className="text-primary text-lg md:text-xl" />
      </button>
    </div>
  );
};
