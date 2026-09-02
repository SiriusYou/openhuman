import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./lib/platform', () => ({ getIsMobile: () => false }));
vi.mock('./AppRoutesIOS', () => ({ default: () => <div data-testid="ios-routes">ios</div> }));
vi.mock('./components/DefaultRedirect', () => ({
  default: () => <div data-testid="default-redirect">redirect</div>,
}));
vi.mock('./components/ProtectedRoute', () => ({
  default: ({ children, requireAuth }: { children: ReactNode; requireAuth?: boolean }) => (
    <div data-testid="protected-route" data-require-auth={String(requireAuth)}>
      {children}
    </div>
  ),
}));
vi.mock('./components/PublicRoute', () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="public-route">{children}</div>
  ),
}));
vi.mock('./features/human/HumanPage', () => ({
  default: () => <div data-testid="page-human">human</div>,
}));
vi.mock('./pages/Accounts', () => ({
  default: () => <div data-testid="page-accounts">accounts</div>,
}));
vi.mock('./pages/AgentWorkflows', () => ({
  default: () => <div data-testid="page-workflows">workflows</div>,
}));
vi.mock('./pages/Channels', () => ({
  default: () => <div data-testid="page-channels">channels</div>,
}));
vi.mock('./pages/Home', () => ({ default: () => <div data-testid="page-home">home</div> }));
vi.mock('./features/coreRegistries/CoreRegistriesPage', () => ({
  default: () => <div data-testid="page-core-registries">core-registries</div>,
}));
vi.mock('./pages/Intelligence', () => ({
  default: () => <div data-testid="page-intelligence">intelligence</div>,
}));
vi.mock('./pages/Invites', () => ({
  default: () => <div data-testid="page-invites">invites</div>,
}));
vi.mock('./pages/Notifications', () => ({
  default: () => <div data-testid="page-notifications">notifications</div>,
}));
vi.mock('./pages/onboarding/Onboarding', () => ({
  default: () => <div data-testid="page-onboarding">onboarding</div>,
}));
vi.mock('./pages/Rewards', () => ({
  default: () => <div data-testid="page-rewards">rewards</div>,
}));
vi.mock('./pages/Routines', () => ({
  default: () => <div data-testid="page-routines">routines</div>,
}));
vi.mock('./pages/Settings', () => ({
  default: () => <div data-testid="page-settings">settings</div>,
}));
vi.mock('./pages/SkillNew', () => ({
  default: () => <div data-testid="page-skill-new">skill new</div>,
}));
vi.mock('./pages/Skills', () => ({ default: () => <div data-testid="page-skills">skills</div> }));
vi.mock('./pages/SkillsRun', () => ({
  default: () => <div data-testid="page-skills-run">skills run</div>,
}));
vi.mock('./pages/WebCallbackPage', () => ({
  default: () => <div data-testid="page-web-callback">callback</div>,
}));
vi.mock('./pages/Welcome', () => ({
  default: () => <div data-testid="page-welcome">welcome</div>,
}));
vi.mock('./pages/Workbench', () => ({
  default: () => <div data-testid="page-workbench">workbench</div>,
}));
vi.mock('./pages/ActionRequestInbox', () => ({
  default: () => <div data-testid="page-action-request-inbox">action-requests</div>,
}));

const AppRoutes = (await import('./AppRoutes')).default;

describe('AppRoutes', () => {
  it('registers the Core Registries route behind the protected desktop shell', () => {
    render(
      <MemoryRouter initialEntries={['/registries']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByTestId('page-core-registries')).toBeInTheDocument();
    expect(screen.getByTestId('protected-route')).toHaveAttribute('data-require-auth', 'true');
  });

  it('registers the Workbench route behind the protected desktop shell', () => {
    render(
      <MemoryRouter initialEntries={['/workbench']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByTestId('page-workbench')).toBeInTheDocument();
    expect(screen.getByTestId('protected-route')).toHaveAttribute('data-require-auth', 'true');
  });

  it('registers the ActionRequest inbox route behind the protected desktop shell', () => {
    render(
      <MemoryRouter initialEntries={['/action-requests']}>
        <AppRoutes />
      </MemoryRouter>
    );

    expect(screen.getByTestId('page-action-request-inbox')).toBeInTheDocument();
    expect(screen.getByTestId('protected-route')).toHaveAttribute('data-require-auth', 'true');
  });
});
