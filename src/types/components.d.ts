import { Dayjs } from 'dayjs';
import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

// Button Types
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'light' | 'dark';
  size?: 'sm' | 'md' | 'lg';
  shape?: 'square' | 'circular';
  fullWidth?: boolean;
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

// Input Types
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  shape?: 'circular' | 'default';
  sizeVariant?: 'sm' | 'md';
  className?: string;
}

// Dialog Types
export interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description: string;
  icon?: ReactNode;
  actions?: {
    confirm?: {
      label: string;
      onClick: () => void;
    };
    cancel?: {
      label: string;
      onClick: () => void;
    };
  };
}

// Provider Types
export interface SessionProviderProps {
  children: ReactNode;
}

export interface DatePickerProps {
  value: dayjs.Dayjs | null;
  onChange: (date: dayjs.Dayjs | null) => void;
  onClose: () => void;
  maxDate?: dayjs.Dayjs;
  minDate?: dayjs.Dayjs;
}

// Typography Types
export interface HeadingProps extends React.HTMLAttributes<HTMLHeadingElement> {
  className?: string;
  children: ReactNode;
}

// Add Toast types
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  message: string;
  type?: ToastType;
  duration?: number;
  onClose?: () => void;
  visible?: boolean;
}

type ToastTypeStyles = {
  success: string;
  error: string;
  info: string;
  warning: string;
};
