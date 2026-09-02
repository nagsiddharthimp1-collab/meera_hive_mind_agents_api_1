import { cn } from '@/lib/utils';
import type { DialogProps } from '@/types/components';
import { Dialog as HeadlessDialog, Transition } from '@headlessui/react';
import { Fragment } from 'react';

export function Dialog({ isOpen, onClose, title, description, icon, actions }: DialogProps) {
  return (
    <Transition appear show={isOpen} as={Fragment}>
      <HeadlessDialog onClose={onClose} className="relative z-[60]">
        {/* Backdrop */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </Transition.Child>

        {/* Full-screen container to center the panel */}
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4 sm:p-6">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <HeadlessDialog.Panel className="w-full max-w-[calc(100%-2rem)] sm:max-w-md transform overflow-hidden rounded-2xl bg-background text-left shadow-xl">
                <div className="p-4 sm:p-6">
                  {icon && (
                    <div className="mx-auto flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center">{icon}</div>
                  )}

                  <HeadlessDialog.Title
                    as="h3"
                    className={cn('text-base sm:text-lg font-medium text-primary text-center', icon && 'mt-3 sm:mt-4')}
                  >
                    {title}
                  </HeadlessDialog.Title>

                  <div className="mt-2">
                    <p className="text-sm sm:text-base text-secondary text-center">{description}</p>
                  </div>
                </div>

                {actions && (
                  <div className="border-t border-primary">
                    <div className="grid grid-cols-2">
                      {actions.cancel && (
                        <button
                          type="button"
                          className="text-secondary py-3 sm:py-4 text-sm font-medium border-r border-primary hover:text-primary transition-colors hover:bg-primary/5"
                          onClick={actions.cancel.onClick}
                        >
                          {actions.cancel.label}
                        </button>
                      )}
                      {actions.confirm && (
                        <button
                          type="button"
                          className="text-primary py-3 sm:py-4 text-sm font-medium hover:text-primary/80 transition-colors hover:bg-primary/5"
                          onClick={actions.confirm.onClick}
                        >
                          {actions.confirm.label}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </HeadlessDialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </HeadlessDialog>
    </Transition>
  );
}
