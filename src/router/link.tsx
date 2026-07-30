import { forwardRef } from 'react';
import { Link as RouterLink, type LinkProps as RouterLinkProps } from 'react-router';

type Props = Omit<RouterLinkProps, 'to'> & {
  href: string;
};

const Link = forwardRef<HTMLAnchorElement, Props>(function Link({ href, ...props }, ref) {
  return <RouterLink ref={ref} to={href} {...props} />;
});

export default Link;
