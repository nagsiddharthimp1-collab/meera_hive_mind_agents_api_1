import Image from 'next/image';
import * as React from 'react';

interface VoiceIndicatorProps {
  userImage: string;
  size?: 'normal' | 'small';
  className?: string;
  volume: number;
  connected: boolean;
  isSpeaking: boolean;
}

export const VoiceIndicator = React.forwardRef<HTMLDivElement, VoiceIndicatorProps>(function VoiceIndicator(
  { userImage, size = 'normal', volume, connected, isSpeaking, ...props },
  ref,
) {
  const [isMobile, setIsMobile] = React.useState(false);
  const [smoothedVolume, setSmoothedVolume] = React.useState(0);

  // Add window size detection
  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Smooth volume changes for better visual experience
  React.useEffect(() => {
    if (!connected || !isSpeaking) {
      setSmoothedVolume(0);
      return;
    }

    const targetVolume = volume || 0;
    const smoothingFactor = 0.3; // Adjust for more/less smoothing

    let animationFrameId: number;

    const smoothVolume = () => {
      setSmoothedVolume((prev) => {
        const diff = targetVolume - prev;
        return prev + diff * smoothingFactor;
      });
      animationFrameId = requestAnimationFrame(smoothVolume);
    };

    animationFrameId = requestAnimationFrame(smoothVolume);
    return () => cancelAnimationFrame(animationFrameId);
  }, [
    volume,
    connected,
    isSpeaking,
  ]);

  const effectiveVolume = React.useMemo(() => {
    if (!connected || !isSpeaking) return 0;

    // Normalize volume to a more usable range
    // Your volumes range from ~0.007 to ~0.106, so we'll scale them appropriately
    const normalizedVolume = Math.min(smoothedVolume * 10, 1); // Scale up and cap at 1

    // Apply a threshold to reduce noise
    const threshold = 0.05; // Adjust based on your noise floor
    return normalizedVolume > threshold ? normalizedVolume : 0;
  }, [
    connected,
    isSpeaking,
    smoothedVolume,
  ]);

  // Size mappings for different variants
  const sizeClasses = {
    normal: {
      indicator: 'w-[224px] h-[224px] sm:w-[224px] sm:h-[224px] md:w-[234px] md:h-[234px]',
      avatar: 'w-[220px] h-[220px] sm:w-[220px] sm:h-[220px] md:w-[230px] md:h-[230px]',
    },
    small: {
      indicator: 'w-[124px] h-[124px] sm:w-[144px] sm:h-[144px]',
      avatar: 'w-[120px] h-[120px] sm:w-[140px] sm:h-[140px]',
    },
  };

  // Select the appropriate size classes
  const activeClasses = sizeClasses[size];

  // Calculate scaling factor - much more conservative now
  const baseScale = 1;
  const maxScale = isMobile ? 1.2 : 1.2; // Maximum scale when speaking loudly
  const scaleRange = maxScale - baseScale;
  const currentScale = baseScale + effectiveVolume * scaleRange;

  // Calculate opacity for fade effect
  const indicatorOpacity = effectiveVolume > 0 ? 0.15 + effectiveVolume * 0.1 : 0;

  return (
    <div ref={ref} className={`relative flex items-center justify-center ${props.className || ''}`} {...props}>
      {/** Voice indicator circle container * */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={`absolute rounded-full transition-all duration-75 ease-out z-0 ${activeClasses.indicator}
            will-change-transform`}
          style={{
            backgroundColor: `rgba(128, 128, 128, ${indicatorOpacity})`,
            transform: `scale(${currentScale}) translateZ(0)`,
            WebkitTransform: `scale(${currentScale}) translateZ(0)`,
            opacity: effectiveVolume > 0 ? 1 : 0,
          }}
        />

        {/* Additional ring for more dynamic effect */}
        {effectiveVolume > 0.3 && (
          <div
            className={`absolute rounded-full transition-all duration-100 ease-out z-0 ${activeClasses.indicator}
              will-change-transform`}
            style={{
              backgroundColor: `rgba(128, 128, 128, ${indicatorOpacity * 0.5})`,
              transform: `scale(${currentScale * 1.2}) translateZ(0)`,
              WebkitTransform: `scale(${currentScale * 1.2}) translateZ(0)`,
              opacity: Math.max(0, effectiveVolume - 0.3) * 2,
            }}
          />
        )}
      </div>

      {/* User avatar container */}
      <div
        className={`relative z-10 overflow-hidden rounded-full ${activeClasses.avatar} 
          transform-gpu transition-transform duration-300`}
      >
        <Image
          src={userImage}
          alt="User Avatar"
          fill
          className="object-cover"
          sizes={size === 'small' ? '100px' : '(max-width: 768px) 220px, (max-width: 1024px) 240px, 280px'}
        />
      </div>
    </div>
  );
});
