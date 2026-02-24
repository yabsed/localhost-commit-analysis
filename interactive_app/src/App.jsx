import { useEffect, useState } from 'react';
import TeamBattleView from './TeamBattleView';
import TeamReviewView from './TeamReviewView';

const TEAM_BATTLE_PATHS = new Set(['/battle', '/team-battle']);

function normalizePath(pathValue = '') {
  const source = String(pathValue || '').trim();
  if (!source) {
    return '/';
  }
  const withSlash = source.startsWith('/') ? source : `/${source}`;
  const trimmed = withSlash.replace(/\/+$/, '');
  return trimmed || '/';
}

function resolveRelativePathname(pathname = '') {
  const base = normalizePath(import.meta.env.BASE_URL || '/');
  const normalizedPathname = normalizePath(pathname);
  if (base === '/' || !normalizedPathname.startsWith(base)) {
    return normalizedPathname;
  }
  const relative = normalizedPathname.slice(base.length);
  return normalizePath(relative);
}

function resolveViewModeFromLocation() {
  if (typeof window === 'undefined') {
    return 'teamReview';
  }

  const hashSource = String(window.location.hash || '').replace(/^#/, '');
  const hashPath = normalizePath(hashSource);
  if (TEAM_BATTLE_PATHS.has(hashPath)) {
    return 'teamBattle';
  }

  const relativePath = resolveRelativePathname(window.location.pathname || '/');
  if (TEAM_BATTLE_PATHS.has(relativePath)) {
    return 'teamBattle';
  }

  return 'teamReview';
}

export default function App({ colorScheme = 'light', onToggleColorScheme = () => {} }) {
  const [viewMode, setViewMode] = useState(resolveViewModeFromLocation);

  useEffect(() => {
    const applyFromLocation = () => {
      setViewMode(resolveViewModeFromLocation());
    };

    if (typeof window === 'undefined') {
      return undefined;
    }

    window.addEventListener('popstate', applyFromLocation);
    window.addEventListener('hashchange', applyFromLocation);
    return () => {
      window.removeEventListener('popstate', applyFromLocation);
      window.removeEventListener('hashchange', applyFromLocation);
    };
  }, []);

  return (
    viewMode === 'teamBattle'
      ? (
        <TeamBattleView
          colorScheme={colorScheme}
          onToggleColorScheme={onToggleColorScheme}
        />
      )
      : (
        <TeamReviewView
          colorScheme={colorScheme}
          onToggleColorScheme={onToggleColorScheme}
        />
      )
  );
}
