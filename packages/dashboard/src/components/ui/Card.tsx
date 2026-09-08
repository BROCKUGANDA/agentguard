import { type HTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
  hoverable?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padded = true, hoverable = false, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={clsx(
        'bg-surface border border-border rounded-md shadow-md',
        padded && 'p-md',
        hoverable && 'transition-shadow duration-200 hover:shadow-lg',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export default Card;