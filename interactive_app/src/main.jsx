import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import '@mantine/core/styles.css';
import App from './App';
import './styles.css';

const theme = createTheme({
  fontFamily: '"Space Grotesk", "Pretendard Variable", "Noto Sans KR", sans-serif',
  headings: {
    fontFamily: '"Space Grotesk", "Pretendard Variable", "Noto Sans KR", sans-serif',
  },
  primaryColor: 'teal',
});

const COLOR_SCHEME_STORAGE_KEY = 'wackathon-color-scheme';

function readInitialColorScheme() {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const stored = window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
  if (stored === 'dark' || stored === 'light') {
    return stored;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function Root() {
  const [colorScheme, setColorScheme] = useState(readInitialColorScheme);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, colorScheme);
  }, [colorScheme]);

  const toggleColorScheme = () => {
    setColorScheme((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  return (
    <MantineProvider theme={theme} forceColorScheme={colorScheme}>
      <App colorScheme={colorScheme} onToggleColorScheme={toggleColorScheme} />
    </MantineProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
