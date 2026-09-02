import { cn } from '@/lib/utils';
import type { HeadingProps } from '@/types/components';
import { HTMLAttributes, ReactNode } from 'react';

interface ParagraphProps extends HTMLAttributes<HTMLParagraphElement> {
  size?: string;
  className?: string;
}

interface ItalicProps {
  children: ReactNode;
}

// Italic component for inline usage
export function Italic({ children }: ItalicProps) {
  return <span className="italic">{children}</span>;
}

export function H1({ children, className, ...props }: HeadingProps) {
  return (
    <h1 className={cn('text-primary text-[28px] font-normal font-serif', className)} {...props}>
      {children}
    </h1>
  );
}

export function H2({ children, className, ...props }: HeadingProps) {
  return (
    <h2 className={cn('text-primary text-[24px] font-normal font-serif', className)} {...props}>
      {children}
    </h2>
  );
}

export function Paragraph({ children, size, className, ...props }: ParagraphProps) {
  return (
    <p className={cn('text-secondary font-normal', size || 'text-[13px]', className)} {...props}>
      {children}
    </p>
  );
}
