import { Skeleton } from '@mui/material';
import React, { type FC } from 'react';

export const ConversationCardSkeleton: FC = () => {
  return (
    <div className="font-sans rounded-2xl p-3 border border-dark/20 w-[calc(100vw-60px)] sm:w-[350px] h-[280px] flex-shrink-0 flex flex-col min-w-[calc(100vw-60px)] sm:min-w-[350px]">
      {/* Image container - Fixed height */}
      <div className="w-full h-[140px] flex-shrink-0 rounded-xl overflow-hidden mb-3">
        <Skeleton variant="rectangular" width="100%" height={140} animation="wave" className="rounded-xl" />
      </div>

      {/* Content - Fixed layout with absolute heights */}
      <div className="flex flex-col h-[93px]">
        <div>
          <div className="h-[24px] mb-1">
            <Skeleton variant="text" width="80%" height={24} animation="wave" />
          </div>
          <div className="h-[16px] mb-2">
            <Skeleton variant="text" width="40%" height={16} animation="wave" />
          </div>
          <div className="h-[32px]">
            <Skeleton variant="text" width="100%" height={32} animation="wave" />
          </div>
        </div>
        <div className="h-[40px] mt-auto">
          <Skeleton variant="rectangular" width="100%" height={40} animation="wave" className="rounded-lg" />
        </div>
      </div>
    </div>
  );
};

const ChatAssistantMessageSkeleton: FC = () => {
  return (
    <div className="flex items-start gap-3 max-w-[85%] mb-4">
      <Skeleton variant="circular" width={32} height={32} className="flex-shrink-0" />
      <div className="flex-1">
        <Skeleton
          variant="rectangular"
          height={60}
          className="rounded-tl-none rounded-tr-[20px] rounded-br-[20px] rounded-bl-[20px]"
        />
        <Skeleton variant="text" width={60} height={16} className="mt-1" />
      </div>
    </div>
  );
};

const ChatUserMessageSkeleton: FC = () => {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%]">
        <Skeleton
          variant="rectangular"
          height={40}
          className="rounded-tl-[20px] rounded-tr-none rounded-br-[20px] rounded-bl-[20px]"
        />
        <Skeleton variant="text" width={60} height={16} className="mt-1 ml-auto" />
      </div>
    </div>
  );
};

export const ChatMessagesSkeleton: FC = () => {
  return (
    <div className="space-y-6">
      <ChatAssistantMessageSkeleton />
      <ChatUserMessageSkeleton />
      <ChatAssistantMessageSkeleton />
      <ChatUserMessageSkeleton />
      <ChatAssistantMessageSkeleton />
    </div>
  );
};
