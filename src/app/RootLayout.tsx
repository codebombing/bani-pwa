import { LinkProvider } from '@astryxdesign/core/Link';
import { Link, Outlet } from 'react-router';

/** Подменяет <a> во всех компонентах Astryx на клиентский Link роутера. */
export function RootLayout() {
  return (
    <LinkProvider component={Link}>
      <Outlet />
    </LinkProvider>
  );
}
