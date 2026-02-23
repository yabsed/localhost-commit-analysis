import React from 'react';
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

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MantineProvider theme={theme}>
      <App />
    </MantineProvider>
  </React.StrictMode>
);
